// plugins/quefrency/src/lib.rs
//
// Quefrency: each frame is split through the cepstrum into a formant envelope
// and a harmonic fine structure, the two are transformed independently, and
// they are multiplied back together. docs/plugins/quefrency-design.md is the
// design and says why each choice was made.
//
// The real-time rules are Cascade's: no_std, no allocator, every buffer a
// static array sized for the largest frame. Unlike Cascade it depends on libm,
// because log, exp and atan2 run on every bin of every frame.
//
// Every change to the spectrum is applied as a gain on X, the input's own
// spectrum, never by rebuilding a spectrum from magnitudes. At neutral settings
// that gain is exp(0), so the plugin reconstructs its input exactly, delayed,
// and tests/dsp/quefrency.test.js holds it to that.

#![no_std]

use core::cell::UnsafeCell;
use core::f32::consts::{LN_10, PI};
use libm::{atan2f, cosf, expf, floorf, log2f, logf, powf, roundf, sinf, sqrtf};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const CHANNELS: usize = 2;
const MAX_N: usize = 4096;
const MAX_BINS: usize = MAX_N / 2 + 1;
const TWO_PI: f32 = 2.0 * PI;

// Fixed so a frame costs a known amount whatever the input.
const TRUE_ENVELOPE_ITERATIONS: usize = 4;
// Floor on |X| before the log, so silence gives a finite cepstrum.
const MAGNITUDE_FLOOR: f32 = 1e-9;
// A peak more than about 80 dB below the loudest bin is not worth moving.
const PEAK_RANGE: f32 = 9.2;
// Guard on any gain exponent, so no setting can produce an infinity.
const EXPONENT_LIMIT: f32 = 40.0;

// Minimum, default and maximum of each port, in jig:paramIndex order. The
// defaults are applied by jig_init, and a controller maps onto these ranges.
// tests/dsp/quefrency.test.js binds this table to the profile's ports.
const PORTS: [(f32, f32, f32); 11] = [
    (-12.0, 0.0, 12.0),     // formant_shift, semitones
    (0.0, 100.0, 200.0),    // formant_depth, percent
    (-6.0, 0.0, 6.0),       // formant_tilt, dB per octave
    (-24.0, 0.0, 24.0),     // pitch_shift, semitones
    (-100.0, 0.0, 100.0),   // pitch_fine, cents
    (-1000.0, 0.0, 1000.0), // freq_shift, Hz
    (0.0, 100.0, 200.0),    // harmonic_depth, percent
    (0.5, 1.5, 5.0),        // lifter, ms
    (0.0, 0.0, 1.0),        // estimator, 0 cepstral, 1 true envelope
    (0.0, 1.0, 1.0),        // mix
    (-24.0, 0.0, 12.0),     // output, dB
];
const PARAM_COUNT: usize = PORTS.len();

// Control change 70 drives parameter 0, and so on up to 80, the 8-Bit
// 8asterd's convention. 70 to 79 are the MIDI sound controllers, which is what
// these are, and 80 is the first general purpose controller.
const FIRST_CC: u8 = 70;
const MIDI_IN_CAPACITY: usize = 64;

/// One record of docs/module-abi.md's event layout: 8 bytes, little endian.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MidiEvent {
    frame: u32,
    size: u8,
    data: [u8; 3],
}

/// A controller value, 0 to 127, as a value for a port. 64 is the port's
/// default wherever the default lies strictly inside the range, so a centred
/// knob on a controller means "unchanged"; otherwise the range is linear.
fn controller_value(index: usize, cc: u8) -> f32 {
    let (minimum, default, maximum) = PORTS[index];
    let v = cc.min(127) as f32;
    if minimum < default && default < maximum {
        if v <= 64.0 {
            minimum + (default - minimum) * v / 64.0
        } else {
            default + (maximum - default) * (v - 64.0) / 63.0
        }
    } else {
        minimum + (maximum - minimum) * v / 127.0
    }
}

/// Frame size for a sample rate: the same span of time at 44.1 and 96 kHz.
fn frame_size(sample_rate: f32) -> usize {
    if sample_rate > 50000.0 { 4096 } else { 2048 }
}

struct Fft {
    n: usize,
    cos: [f32; MAX_N / 2],
    sin: [f32; MAX_N / 2],
    bitrev: [u16; MAX_N],
}

impl Fft {
    const fn new() -> Self {
        Self { n: 0, cos: [0.0; MAX_N / 2], sin: [0.0; MAX_N / 2], bitrev: [0; MAX_N] }
    }

    fn setup(&mut self, n: usize) {
        self.n = n;
        for i in 0..n / 2 {
            let angle = TWO_PI * i as f32 / n as f32;
            self.cos[i] = cosf(angle);
            self.sin[i] = sinf(angle);
        }
        let bits = n.trailing_zeros();
        for i in 0..n {
            self.bitrev[i] = ((i as u32).reverse_bits() >> (32 - bits)) as u16;
        }
    }

    /// In place, radix 2. The inverse is scaled by 1/n, so a forward and an
    /// inverse transform in either order is the identity.
    fn transform(&self, re: &mut [f32; MAX_N], im: &mut [f32; MAX_N], inverse: bool) {
        let n = self.n;
        for i in 0..n {
            let j = self.bitrev[i] as usize;
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let direction = if inverse { 1.0 } else { -1.0 };
        let mut size = 2;
        while size <= n {
            let half = size / 2;
            let stride = n / size;
            let mut start = 0;
            while start < n {
                for k in 0..half {
                    let wr = self.cos[k * stride];
                    let wi = direction * self.sin[k * stride];
                    let a = start + k;
                    let b = a + half;
                    let tr = re[b] * wr - im[b] * wi;
                    let ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
                start += size;
            }
            size *= 2;
        }
        if inverse {
            let scale = 1.0 / n as f32;
            for i in 0..n {
                re[i] *= scale;
                im[i] *= scale;
            }
        }
    }
}

struct Channel {
    // The last n input samples, oldest first.
    in_fifo: [f32; MAX_N],
    // Overlap-add accumulator; its first `hop` samples are finished output.
    accum: [f32; MAX_N],
    out_fifo: [f32; MAX_N],
    // Samples gathered since the last frame, and read from out_fifo since.
    filled: usize,
    // The dry signal, delayed by the same latency as the wet one.
    dry: [f32; MAX_N],
    dry_pos: usize,
    // Per-bin analysis phase of the previous frame, for frequency estimates.
    last_phase: [f32; MAX_BINS],
    // Laroche and Dolson's accumulated phase rotation, per source bin.
    rotation: [f32; MAX_BINS],
}

impl Channel {
    const fn new() -> Self {
        Self {
            in_fifo: [0.0; MAX_N],
            accum: [0.0; MAX_N],
            out_fifo: [0.0; MAX_N],
            filled: 0,
            dry: [0.0; MAX_N],
            dry_pos: 0,
            last_phase: [0.0; MAX_BINS],
            rotation: [0.0; MAX_BINS],
        }
    }

    fn reset(&mut self) {
        *self = Self::new();
    }
}

/// Buffers used within one frame and meaningless between frames, so both
/// channels share them.
struct Scratch {
    re: [f32; MAX_N],
    im: [f32; MAX_N],
    cre: [f32; MAX_N],
    cim: [f32; MAX_N],
    yre: [f32; MAX_N],
    yim: [f32; MAX_N],
    log_mag: [f32; MAX_BINS],
    log_env: [f32; MAX_BINS],
    log_env_out: [f32; MAX_BINS],
    upper: [f32; MAX_BINS],
    next_rotation: [f32; MAX_BINS],
    peaks: [u16; MAX_BINS],
}

impl Scratch {
    const fn new() -> Self {
        Self {
            re: [0.0; MAX_N],
            im: [0.0; MAX_N],
            cre: [0.0; MAX_N],
            cim: [0.0; MAX_N],
            yre: [0.0; MAX_N],
            yim: [0.0; MAX_N],
            log_mag: [0.0; MAX_BINS],
            log_env: [0.0; MAX_BINS],
            log_env_out: [0.0; MAX_BINS],
            upper: [0.0; MAX_BINS],
            next_rotation: [0.0; MAX_BINS],
            peaks: [0; MAX_BINS],
        }
    }
}

/// Parameters as the frame processing wants them, derived once on each
/// jig_set_param rather than per frame.
struct Params {
    formant_ratio: f32,
    formant_depth: f32,
    formant_tilt: f32,
    pitch_semitones: f32,
    pitch_cents: f32,
    pitch_ratio: f32,
    freq_shift: f32,
    harmonic_depth: f32,
    lifter_ms: f32,
    true_envelope: bool,
    mix: f32,
    gain: f32,
}

impl Params {
    const fn zero() -> Self {
        Self {
            formant_ratio: 0.0, formant_depth: 0.0, formant_tilt: 0.0, pitch_semitones: 0.0,
            pitch_cents: 0.0, pitch_ratio: 0.0, freq_shift: 0.0, harmonic_depth: 0.0,
            lifter_ms: 0.0, true_envelope: false, mix: 0.0, gain: 0.0,
        }
    }
}

struct State {
    input: [[f32; MAX_FRAMES]; CHANNELS],
    output: [[f32; MAX_FRAMES]; CHANNELS],
    channels: [Channel; CHANNELS],
    scratch: Scratch,
    fft: Fft,
    window: [f32; MAX_N],
    // Tilt as a natural-log gain per bin, rebuilt when tilt or rate changes.
    tilt: [f32; MAX_BINS],
    params: Params,
    // Each port's value as last set, by the host or by a controller.
    values: [f32; PARAM_COUNT],
    midi_in: [MidiEvent; MIDI_IN_CAPACITY],
    midi_in_count: u32,
    sample_rate: f32,
    n: usize,
    hop: usize,
}

impl State {
    // Every field zero, deliberately: one non-zero byte would move the whole
    // static, a few hundred kilobytes of buffers, from .bss into the module's
    // data section. The real defaults are set by jig_init.
    const fn new() -> Self {
        Self {
            input: [[0.0; MAX_FRAMES]; CHANNELS],
            output: [[0.0; MAX_FRAMES]; CHANNELS],
            channels: [Channel::new(), Channel::new()],
            scratch: Scratch::new(),
            fft: Fft::new(),
            window: [0.0; MAX_N],
            tilt: [0.0; MAX_BINS],
            params: Params::zero(),
            values: [0.0; PARAM_COUNT],
            midi_in: [MidiEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_IN_CAPACITY],
            midi_in_count: 0,
            sample_rate: 0.0,
            n: 0,
            hop: 0,
        }
    }

    fn latency(&self) -> usize {
        self.n.saturating_sub(1)
    }

    fn rebuild_tilt(&mut self) {
        let half = self.n / 2;
        // dB per octave about 1 kHz, as a natural log of amplitude.
        let per_octave = self.params.formant_tilt * LN_10 / 20.0;
        for k in 0..=half {
            let hz = (k as f32 * self.sample_rate / self.n as f32).max(20.0);
            self.tilt[k] = per_octave * log2f(hz / 1000.0);
        }
    }
}

struct Shared(UnsafeCell<State>);
// Sound because wasm32-unknown-unknown without the threads proposal is
// single-threaded, and this module is instantiated once per processor.
unsafe impl Sync for Shared {}

static STATE: Shared = Shared(UnsafeCell::new(State::new()));

#[inline]
#[allow(clippy::mut_from_ref)]
fn state() -> &'static mut State {
    unsafe { &mut *STATE.0.get() }
}

#[inline]
fn wrap_phase(x: f32) -> f32 {
    x - TWO_PI * roundf(x / TWO_PI)
}

/// Cepstral smoothing: `src` is a log magnitude over bins 0 to n/2, `dst`
/// receives the same with every quefrency at or above `nc` removed.
fn lifter(fft: &Fft, cre: &mut [f32; MAX_N], cim: &mut [f32; MAX_N],
          src: &[f32; MAX_BINS], dst: &mut [f32; MAX_BINS], nc: usize) {
    let n = fft.n;
    let half = n / 2;
    cre[0] = src[0];
    cre[half] = src[half];
    for k in 1..half {
        cre[k] = src[k];
        cre[n - k] = src[k];
    }
    cim[..n].fill(0.0);
    fft.transform(cre, cim, true);
    // The cepstrum of a real even sequence is real and even: keep c[0..nc)
    // and its mirror, drop the rest.
    for q in nc..=n - nc {
        cre[q] = 0.0;
    }
    cim[..n].fill(0.0);
    fft.transform(cre, cim, false);
    dst[..=half].copy_from_slice(&cre[..=half]);
}

fn process_frame(ch: &mut Channel, sc: &mut Scratch, fft: &Fft, window: &[f32; MAX_N],
                 tilt: &[f32; MAX_BINS], p: &Params, sample_rate: f32, n: usize, hop: usize) {
    let half = n / 2;

    for i in 0..n {
        sc.re[i] = ch.in_fifo[i] * window[i];
        sc.im[i] = 0.0;
    }
    fft.transform(&mut sc.re, &mut sc.im, false);

    let mut loudest = f32::MIN;
    for k in 0..=half {
        let magnitude = sqrtf(sc.re[k] * sc.re[k] + sc.im[k] * sc.im[k]);
        let log_mag = logf(magnitude.max(MAGNITUDE_FLOOR));
        sc.log_mag[k] = log_mag;
        loudest = loudest.max(log_mag);
    }

    // The formant envelope.
    let nc = (roundf(p.lifter_ms * 0.001 * sample_rate) as usize).clamp(1, half - 1);
    lifter(fft, &mut sc.cre, &mut sc.cim, &sc.log_mag, &mut sc.log_env, nc);
    if p.true_envelope {
        sc.upper[..=half].copy_from_slice(&sc.log_mag[..=half]);
        for _ in 0..TRUE_ENVELOPE_ITERATIONS {
            for k in 0..=half {
                sc.upper[k] = sc.upper[k].max(sc.log_env[k]);
            }
            lifter(fft, &mut sc.cre, &mut sc.cim, &sc.upper, &mut sc.log_env, nc);
        }
    }

    // Its mean over the whole circle, c[0], about which depth scales.
    let mut sum = sc.log_env[0] + sc.log_env[half];
    for k in 1..half {
        sum += 2.0 * sc.log_env[k];
    }
    let mean = sum / n as f32;

    // The transformed envelope: warped, deepened, tilted.
    for j in 0..=half {
        let source = j as f32 / p.formant_ratio;
        let warped = if source >= half as f32 {
            sc.log_env[half]
        } else {
            let below = floorf(source);
            let index = below as usize;
            let fraction = source - below;
            sc.log_env[index] + (sc.log_env[index + 1] - sc.log_env[index]) * fraction
        };
        sc.log_env_out[j] = mean + p.formant_depth * (warped - mean) + tilt[j];
    }

    let harmonic = p.harmonic_depth - 1.0;
    let shifting = p.pitch_ratio != 1.0 || p.freq_shift != 0.0;

    if !shifting {
        for k in 0..=half {
            let excitation = sc.log_mag[k] - sc.log_env[k];
            let exponent = harmonic * excitation + sc.log_env_out[k] - sc.log_env[k];
            let gain = expf(exponent.clamp(-EXPONENT_LIMIT, EXPONENT_LIMIT));
            sc.yre[k] = sc.re[k] * gain;
            sc.yim[k] = sc.im[k] * gain;
        }
        ch.rotation[..=half].fill(0.0);
    } else {
        sc.yre[..=half].fill(0.0);
        sc.yim[..=half].fill(0.0);
        sc.next_rotation[..=half].fill(0.0);

        // Peaks: a bin louder than its two neighbours either side.
        let mut count = 0;
        for k in 2..half - 1 {
            let m = sc.log_mag[k];
            if m > loudest - PEAK_RANGE
                && m > sc.log_mag[k - 1] && m >= sc.log_mag[k + 1]
                && m > sc.log_mag[k - 2] && m >= sc.log_mag[k + 2] {
                sc.peaks[count] = k as u16;
                count += 1;
            }
        }

        let bin_hz = TWO_PI / n as f32;
        let offset = TWO_PI * p.freq_shift / sample_rate;
        for i in 0..count {
            let peak = sc.peaks[i] as usize;
            // Each peak owns the bins halfway to its neighbours.
            let low = if i == 0 { 0 } else { (sc.peaks[i - 1] as usize + peak) / 2 + 1 };
            let high = if i + 1 == count { half } else { (peak + sc.peaks[i + 1] as usize) / 2 };

            let phase = atan2f(sc.im[peak], sc.re[peak]);
            let expected = bin_hz * peak as f32 * hop as f32;
            let deviation = wrap_phase(phase - ch.last_phase[peak] - expected);
            let omega = bin_hz * peak as f32 + deviation / hop as f32;
            let target = omega * p.pitch_ratio + offset;
            if target <= 0.0 || target >= PI {
                continue;
            }
            let shift = roundf((target - omega) / bin_hz) as isize;
            let rotation = wrap_phase(ch.rotation[peak] + (target - omega) * hop as f32);
            let (rc, rs) = (cosf(rotation), sinf(rotation));

            for k in low..=high {
                sc.next_rotation[k] = rotation;
                let j = k as isize + shift;
                if j < 0 || j > half as isize {
                    continue;
                }
                let j = j as usize;
                let excitation = sc.log_mag[k] - sc.log_env[k];
                let exponent = harmonic * excitation - sc.log_env[k] + sc.log_env_out[j];
                let gain = expf(exponent.clamp(-EXPONENT_LIMIT, EXPONENT_LIMIT));
                sc.yre[j] += (sc.re[k] * rc - sc.im[k] * rs) * gain;
                sc.yim[j] += (sc.re[k] * rs + sc.im[k] * rc) * gain;
            }
        }
        ch.rotation[..=half].copy_from_slice(&sc.next_rotation[..=half]);
    }

    // Kept on every frame, so a shift switched on mid-stream starts from a
    // true previous phase rather than a stale one.
    for k in 0..=half {
        ch.last_phase[k] = atan2f(sc.im[k], sc.re[k]);
    }

    // Hermitian mirror, so the inverse transform is real.
    for k in 1..half {
        sc.yre[n - k] = sc.yre[k];
        sc.yim[n - k] = -sc.yim[k];
    }
    sc.yim[0] = 0.0;
    sc.yim[half] = 0.0;
    fft.transform(&mut sc.yre, &mut sc.yim, true);

    // Square-root Hann twice is Hann, which sums to 2 at 75% overlap.
    for i in 0..n {
        ch.accum[i] += sc.yre[i] * window[i] * 0.5;
    }
    ch.out_fifo[..hop].copy_from_slice(&ch.accum[..hop]);
    ch.accum.copy_within(hop..n, 0);
    ch.accum[n - hop..n].fill(0.0);
    ch.in_fifo.copy_within(hop..n, 0);
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    let s = state();
    s.sample_rate = if sample_rate > 0.0 { sample_rate } else { 48000.0 };
    s.n = frame_size(s.sample_rate);
    s.hop = s.n / 4;
    s.fft.setup(s.n);
    for i in 0..s.n {
        // Periodic, so overlapped copies sum exactly.
        let hann = 0.5 - 0.5 * cosf(TWO_PI * i as f32 / s.n as f32);
        s.window[i] = sqrtf(hann);
    }
    for channel in s.channels.iter_mut() {
        channel.reset();
    }
    s.midi_in_count = 0;
    for (index, &(_, default, _)) in PORTS.iter().enumerate() {
        set_param(s, index, default);
    }
}

/// Frames by which the output lags the input at the rate given to jig_init.
/// Not part of ABI version 1, which carries no latency; the processor reads
/// it for its ready message.
#[no_mangle]
pub extern "C" fn jig_latency_frames() -> u32 {
    state().latency() as u32
}

#[no_mangle]
pub extern "C" fn jig_input_ptr(channel: u32) -> *mut f32 {
    state().input[(channel as usize).min(CHANNELS - 1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_output_ptr(channel: u32) -> *mut f32 {
    state().output[(channel as usize).min(CHANNELS - 1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 {
    MAX_FRAMES as u32
}

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    set_param(state(), index as usize, value);
}

/// A port's value as last set, by the host or by a controller. Not part of
/// the ABI: tests read it to check a controller lands where the profile says.
#[no_mangle]
pub extern "C" fn quefrency_param(index: u32) -> f32 {
    state().values.get(index as usize).copied().unwrap_or(f32::NAN)
}

fn set_param(s: &mut State, index: usize, value: f32) {
    if index >= PARAM_COUNT {
        return;
    }
    s.values[index] = value;
    let p = &mut s.params;
    match index {
        0 => p.formant_ratio = powf(2.0, value / 12.0),
        1 => p.formant_depth = value / 100.0,
        2 => {
            p.formant_tilt = value;
            s.rebuild_tilt();
        }
        3 | 4 => {
            if index == 3 { p.pitch_semitones = value } else { p.pitch_cents = value }
            p.pitch_ratio = powf(2.0, (p.pitch_semitones + p.pitch_cents / 100.0) / 12.0);
        }
        5 => p.freq_shift = value,
        6 => p.harmonic_depth = value / 100.0,
        7 => p.lifter_ms = value,
        8 => p.true_envelope = value >= 0.5,
        9 => p.mix = value.clamp(0.0, 1.0),
        10 => p.gain = powf(10.0, value / 20.0),
        _ => {}
    }
}

#[no_mangle]
pub extern "C" fn jig_midi_in_ptr() -> *mut MidiEvent {
    state().midi_in.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_midi_in_capacity() -> u32 {
    MIDI_IN_CAPACITY as u32
}

/// The host has written `count` events for the next jig_process.
#[no_mangle]
pub extern "C" fn jig_midi_in(count: u32) {
    state().midi_in_count = count.min(MIDI_IN_CAPACITY as u32);
}

/// Apply one event if it is a control change this plugin answers to, on any
/// channel. Everything else, notes included, is ignored.
fn apply_event(s: &mut State, event: MidiEvent) {
    if event.size != 3 || event.data[0] & 0xf0 != 0xb0 {
        return;
    }
    let controller = event.data[1];
    if controller < FIRST_CC || controller >= FIRST_CC + PARAM_COUNT as u8 {
        return;
    }
    let index = (controller - FIRST_CC) as usize;
    set_param(s, index, controller_value(index, event.data[2]));
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    let s = state();
    let frames = (frames as usize).min(MAX_FRAMES);
    // The events describe this block and nothing else: taken now, so a block
    // with none never replays the last block's.
    let count = s.midi_in_count as usize;
    s.midi_in_count = 0;
    if s.n == 0 {
        // Not initialised: silence rather than a trap on an empty frame.
        for c in 0..CHANNELS {
            s.output[c][..frames].fill(0.0);
        }
        return;
    }

    // The block runs in segments, each ending where the next event is due, so
    // an event changes the signal from its own frame. Mix and output act per
    // sample; the spectral parameters are read per analysis frame, so they
    // take effect at the next hop at or after the event.
    let mut at = 0;
    let mut next = 0;
    while at < frames {
        while next < count && s.midi_in[next].frame as usize <= at {
            let event = s.midi_in[next];
            apply_event(s, event);
            next += 1;
        }
        let end = if next < count {
            (s.midi_in[next].frame as usize).clamp(at + 1, frames)
        } else {
            frames
        };
        render(s, at, end);
        at = end;
    }
}

fn render(s: &mut State, from: usize, to: usize) {
    let (n, hop, latency) = (s.n, s.hop, s.latency());
    let (mix, gain) = (s.params.mix, s.params.gain);

    for c in 0..CHANNELS {
        let ch = &mut s.channels[c];
        for i in from..to {
            let x = s.input[c][i];
            ch.in_fifo[n - hop + ch.filled] = x;
            ch.filled += 1;
            if ch.filled == hop {
                process_frame(ch, &mut s.scratch, &s.fft, &s.window, &s.tilt,
                              &s.params, s.sample_rate, n, hop);
                ch.filled = 0;
            }
            // Read after the frame, so a sample is emitted the moment it is
            // complete: that makes the latency n - 1 rather than n.
            let wet = ch.out_fifo[ch.filled];

            ch.dry[ch.dry_pos] = x;
            let dry = ch.dry[(ch.dry_pos + MAX_N - latency) % MAX_N];
            ch.dry_pos = (ch.dry_pos + 1) % MAX_N;

            s.output[c][i] = (dry * (1.0 - mix) + wet * mix) * gain;
        }
    }
}
