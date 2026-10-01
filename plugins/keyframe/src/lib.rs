// plugins/keyframe/src/lib.rs
//
// Keyframe: time and pitch stretching from the local extrema of the signal.
// docs/plugins/keyframe-design.md is the design and says why each choice was
// made. The algorithm is Matthew Nielsen's, "Keyframe Time Stretching via
// Extrema Sampling", DAFx26, CC BY 4.0, written here from the paper.
//
// Real-time rules are Quefrency's: no_std, no allocator, every buffer a static
// array sized for the worst case, and nothing grown after jig_init.
//
// The input is reduced to keyframes, the extrema with a position and a value.
// A reference playhead moves at the time rate, a play playhead at the pitch
// rate, and when they drift further apart than K keyframes a splice crossfades
// to the reference over the span of the next K keyframes. Both ends of the
// capture ring are bounded by moving the reference, which starts a splice, so
// the live case needs no mechanism the offline case does not have.

#![no_std]

use core::cell::UnsafeCell;
use libm::powf;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const CHANNELS: usize = 2;

// The keyframe ring. A power of two so an index wraps with a mask. How much
// time it holds depends on how dense the signal is, which is the point of
// the representation: a bass note costs a few keyframes, a cymbal a great many.
const CAP: usize = 1 << 17;
const MASK: usize = CAP - 1;

// A keyframe is forced at every HOP-th input sample, so a stretch of signal
// with no extremum still advances the known timeline (paper 2.7). The output
// lags the input by LATENCY, which is two hops, so reconstruction always has
// a keyframe ahead of the reference.
const HOP: u64 = 256;
const LATENCY: usize = 512;
const DRY_LEN: usize = 1024;
const DRY_MASK: usize = DRY_LEN - 1;

// How far behind the input the reference may fall, in seconds, before it is
// brought forward. A capture ring is a bounded thing.
const MAX_LAG_SECONDS: f64 = 8.0;

// Minimum, default and maximum of each port, in jig:paramIndex order.
// tests/dsp/keyframe.test.js binds this table to the profile's ports.
const PORTS: [(f32, f32, f32); 9] = [
    (25.0, 100.0, 400.0),  // time_rate, percent
    (-24.0, 0.0, 24.0),    // pitch_shift, semitones
    (4.0, 16.0, 256.0),    // splice_keyframes
    (5.0, 200.0, 500.0),   // max_splice, ms
    (-90.0, -60.0, -30.0), // threshold, dB
    (0.0, 1.0, 1.0),       // mix
    (-24.0, 0.0, 12.0),    // output, dB
    (0.0, 0.0, 2.0),       // quality: 0 Economy, 1 Balanced, 2 Full
    (0.0, 0.0, 1.0),       // stereo: 0 Linked, 1 Independent
];
const PARAM_COUNT: usize = PORTS.len();

#[derive(Clone, Copy, PartialEq)]
enum Quality {
    Economy,
    Balanced,
    Full,
}

#[derive(Clone, Copy)]
struct Params {
    tau: f64,
    sigma: f64,
    leash: usize,
    max_splice: f64,
    eps: f32,
    mix: f32,
    gain: f32,
    quality: Quality,
    linked: bool,
}

impl Params {
    const fn new() -> Self {
        Self {
            tau: 1.0, sigma: 1.0, leash: 16, max_splice: 9600.0, eps: 0.001,
            mix: 1.0, gain: 1.0, quality: Quality::Economy, linked: true,
        }
    }
}

#[derive(Clone, Copy)]
struct Keyframe {
    pos: f64,
    val: [f32; 2],
}

struct Engine {
    // Which ring is this engine's.
    id: usize,
    // Values per keyframe: both channels when linked, one when independent.
    chans: usize,
    count: usize,

    // Analysis. hist[c][3] is the newest input sample.
    hist: [[f32; 4]; 2],
    tick: u64,
    d_prev: f32,
    v_prev: f32,

    // Playback.
    ref_pos: f64,
    play_pos: f64,
    idx_ref: usize,
    idx_play: usize,
    splicing: bool,
    temp_pos: f64,
    idx_temp: usize,
    t_temp: f64,
    t_inc: f64,
    splices: u32,
}

impl Engine {
    const fn new(id: usize) -> Self {
        Self {
            id,
            chans: 2,
            count: 0,
            hist: [[0.0; 4]; 2],
            tick: 0,
            d_prev: 0.0,
            v_prev: 0.0,
            ref_pos: 0.0,
            play_pos: 0.0,
            idx_ref: 0,
            idx_play: 0,
            splicing: false,
            temp_pos: 0.0,
            idx_temp: 0,
            t_temp: 0.0,
            t_inc: 0.0,
            splices: 0,
        }
    }

    /// Empty the ring and start the playheads where a fresh input would put
    /// them: LATENCY behind the first sample. The first keyframe is silence
    /// just before the signal begins.
    fn reset(&mut self, chans: usize) {
        self.chans = chans;
        self.count = 0;
        self.hist = [[0.0; 4]; 2];
        self.tick = 0;
        self.d_prev = 0.0;
        self.v_prev = 0.0;
        self.push_keyframe(-1.0, [0.0; 2]);
        self.ref_pos = -(LATENCY as f64);
        self.play_pos = self.ref_pos;
        self.idx_ref = 0;
        self.idx_play = 0;
        self.splicing = false;
        self.splices = 0;
    }

    #[inline]
    fn at(&self, m: usize) -> Keyframe {
        ring(self.id)[m & MASK]
    }

    #[inline]
    fn pos(&self, m: usize) -> f64 {
        self.at(m).pos
    }

    #[inline]
    fn oldest(&self) -> usize {
        self.count.saturating_sub(CAP)
    }

    /// Positions must increase strictly, because reconstruction divides by the
    /// gap between two keyframes. A keyframe that would not is dropped.
    fn push_keyframe(&mut self, pos: f64, val: [f32; 2]) -> bool {
        if self.count > 0 && pos <= self.pos(self.count - 1) {
            return false;
        }
        ring(self.id)[self.count & MASK] = Keyframe { pos, val };
        self.count += 1;
        true
    }

    /// One input sample into the analysis (paper 2.1 to 2.3). `x` holds the
    /// channels this engine owns: both when linked, the first when not.
    fn analyse(&mut self, x: [f32; 2], p: &Params) {
        let chans = self.chans;
        for c in 0..chans {
            let h = &mut self.hist[c];
            h[0] = h[1];
            h[1] = h[2];
            h[2] = h[3];
            h[3] = x[c];
        }
        let c = self.tick;
        self.tick += 1;
        if c < 3 {
            return;
        }

        let scale = 1.0 / chans as f32;
        let mono = |i: usize, hist: &[[f32; 4]; 2]| -> f32 {
            let mut s = 0.0;
            for ch in 0..chans {
                s += hist[ch][i];
            }
            s * scale
        };

        let full = p.quality == Quality::Full;
        // Economy and Balanced difference the last two samples, so the
        // extremum is the sample before the sign change. Full takes the
        // derivative of the B-spline, which at a sample is the central
        // difference, so the sign change lies between two samples and is
        // placed within it.
        let d = if full {
            0.5 * (mono(3, &self.hist) - mono(1, &self.hist))
        } else {
            mono(3, &self.hist) - mono(2, &self.hist)
        };
        let changed = (d > 0.0) != (self.d_prev > 0.0);
        let d_prev = self.d_prev;
        self.d_prev = d;

        if changed {
            let (pos, val) = if full {
                // Reverse linear interpolation of the derivative, then the
                // cubic B-spline of the four samples around it.
                let a = d_prev.abs();
                let alpha = a / (a + d.abs()).max(1e-30);
                let t = alpha;
                let b0 = (1.0 - t) * (1.0 - t) * (1.0 - t) / 6.0;
                let b1 = (3.0 * t * t * t - 6.0 * t * t + 4.0) / 6.0;
                let b2 = (-3.0 * t * t * t + 3.0 * t * t + 3.0 * t + 1.0) / 6.0;
                let b3 = t * t * t / 6.0;
                let mut val = [0.0; 2];
                for ch in 0..chans {
                    let h = &self.hist[ch];
                    val[ch] = h[0] * b0 + h[1] * b1 + h[2] * b2 + h[3] * b3;
                }
                ((c - 2) as f64 + alpha as f64, val)
            } else {
                let mut val = [0.0; 2];
                for ch in 0..chans {
                    val[ch] = self.hist[ch][2];
                }
                ((c - 1) as f64, val)
            };
            let mut v = 0.0;
            for ch in 0..chans {
                v += val[ch];
            }
            v *= scale;
            // Hysteresis: the reference is the last extremum kept (paper 2.2).
            if (v - self.v_prev).abs() > p.eps && self.push_keyframe(pos, val) {
                self.v_prev = v;
            }
        }

        // The forced keyframe, after any natural one so positions stay in order.
        if c % HOP == 0 {
            let mut val = [0.0; 2];
            for ch in 0..chans {
                let h = &self.hist[ch];
                val[ch] = if full { (h[1] + 4.0 * h[2] + h[3]) / 6.0 } else { h[2] };
            }
            self.push_keyframe((c - 1) as f64, val);
        }
    }

    /// The window holding `phi`: the keyframe index m with pos(m) <= phi < pos(m+1),
    /// clamped to the ring. Starts from where the playhead was, because it moves
    /// a little at a time, and falls back to a binary search after a jump.
    fn locate(&self, phi: f64, hint: usize) -> usize {
        let hi = self.count - 1;
        let lo = self.oldest();
        if hi <= lo {
            return lo;
        }
        let mut m = hint.clamp(lo, hi - 1);
        let mut steps = 0;
        while m + 1 < hi && self.pos(m + 1) <= phi {
            m += 1;
            steps += 1;
            if steps > 64 {
                return self.search(phi);
            }
        }
        while m > lo && self.pos(m) > phi {
            m -= 1;
            steps += 1;
            if steps > 64 {
                return self.search(phi);
            }
        }
        m
    }

    fn search(&self, phi: f64) -> usize {
        let hi = self.count - 1;
        let (mut a, mut b) = (self.oldest(), hi - 1);
        while a < b {
            let mid = a + (b - a + 1) / 2;
            if self.pos(mid) <= phi { a = mid } else { b = mid - 1 }
        }
        a
    }

    /// The reconstructed value at `phi` (paper 2.4 and 2.5). Outside the known
    /// span it holds the nearest keyframe.
    fn interp(&self, phi: f64, m: usize, q: Quality) -> [f32; 2] {
        let hi = self.count - 1;
        if hi <= self.oldest() {
            return self.at(hi).val;
        }
        let (a, b) = (self.at(m), self.at(m + 1));
        let t = ((phi - a.pos) / (b.pos - a.pos)).clamp(0.0, 1.0) as f32;
        // Both tangents are zero because every keyframe is an extremum, so the
        // cubic Hermite blend is the smoothstep (equation 11). Economy takes
        // the straight line, which is the paper's reduced variant.
        let w = if q == Quality::Economy { t } else { t * t * (3.0 - 2.0 * t) };
        let mut out = [0.0; 2];
        for ch in 0..self.chans {
            out[ch] = a.val[ch] + (b.val[ch] - a.val[ch]) * w;
        }
        out
    }

    /// One output sample (paper algorithm 3).
    fn render(&mut self, p: &Params, sample_rate: f64) -> [f32; 2] {
        let k = p.leash;
        self.idx_ref = self.locate(self.ref_pos, self.idx_ref);

        // Keep the reference inside what is known. Past the newest keyframe it
        // can read nothing, and behind the oldest, or further back than the
        // capture is meant to hold, it is stale. Either way it is moved to
        // where a fresh input would put it, and the splice below does the rest.
        let head = self.pos(self.count - 1);
        let lag = self.tick as f64 - self.ref_pos;
        let too_old = self.oldest() > 0 && self.idx_ref < self.oldest() + 2 * k + 4;
        if self.ref_pos > head - 2.0 || lag > MAX_LAG_SECONDS * sample_rate || too_old {
            self.ref_pos = self.tick as f64 - LATENCY as f64;
            self.idx_ref = self.locate(self.ref_pos, self.idx_ref);
        }
        self.idx_play = self.locate(self.play_pos, self.idx_play);

        let hi = self.count - 1;
        let dist = if self.idx_play > self.idx_ref {
            self.idx_play - self.idx_ref
        } else {
            self.idx_ref - self.idx_play
        };

        // A play playhead that has run off either end of what is known has to be
        // brought back too, whatever its distance from the reference in keyframes:
        // with the reference held back at a fast time rate that distance can stay
        // small while the play playhead sits past the newest keyframe, reading a
        // constant.
        let off_end = self.play_pos > head - 1.0 || (self.oldest() > 0 && self.play_pos < self.pos(self.oldest()));
        if !self.splicing && (dist > k || off_end) {
            let j = (self.idx_ref + k).min(hi);
            let span = (self.pos(j) - self.pos(self.idx_ref)).clamp(1.0, p.max_splice.max(1.0));
            self.temp_pos = self.ref_pos;
            self.idx_temp = self.idx_ref;
            self.t_temp = 0.0;
            self.t_inc = 1.0 / span;
            self.splicing = true;
            self.splices += 1;
        }

        let q = p.quality;
        let y;
        if self.splicing && self.t_temp <= 1.0 {
            self.idx_temp = self.locate(self.temp_pos, self.idx_temp);
            let a = self.interp(self.play_pos, self.idx_play, q);
            let b = self.interp(self.temp_pos, self.idx_temp, q);
            let t = self.t_temp as f32;
            let mut out = [0.0; 2];
            for ch in 0..self.chans {
                out[ch] = b[ch] * t + a[ch] * (1.0 - t);
            }
            y = out;
            self.play_pos += p.sigma;
            self.temp_pos += p.sigma;
            self.t_temp += self.t_inc * p.sigma;
        } else {
            if self.splicing {
                // The crossfade is done: the play playhead takes the temporary one's place.
                self.play_pos = self.temp_pos;
                self.idx_play = self.idx_temp;
                self.splicing = false;
            }
            y = self.interp(self.play_pos, self.idx_play, q);
            self.play_pos += p.sigma;
        }
        self.ref_pos += p.tau;
        y
    }
}

struct State {
    sample_rate: f64,
    engines: [Engine; 2],
    params: Params,
    values: [f32; PARAM_COUNT],
    input: [[f32; MAX_FRAMES]; CHANNELS],
    output: [[f32; MAX_FRAMES]; CHANNELS],
    dry: [[f32; DRY_LEN]; CHANNELS],
    dry_pos: usize,
    ready: bool,
}

impl State {
    const fn new() -> Self {
        Self {
            sample_rate: 48000.0,
            engines: [Engine::new(0), Engine::new(1)],
            params: Params::new(),
            values: [0.0; PARAM_COUNT],
            input: [[0.0; MAX_FRAMES]; CHANNELS],
            output: [[0.0; MAX_FRAMES]; CHANNELS],
            dry: [[0.0; DRY_LEN]; CHANNELS],
            dry_pos: 0,
            ready: false,
        }
    }

    fn reset_engines(&mut self) {
        if self.params.linked {
            self.engines[0].reset(2);
        } else {
            self.engines[0].reset(1);
            self.engines[1].reset(1);
        }
    }
}

struct Shared<T>(UnsafeCell<T>);
unsafe impl<T> Sync for Shared<T> {}

static STATE: Shared<State> = Shared(UnsafeCell::new(State::new()));

// The keyframes, apart from the rest of the state and all zero, so they sit in
// the zero-initialised part of memory and the module file does not carry 4 MB
// of zeros.
static RINGS: Shared<[[Keyframe; CAP]; 2]> =
    Shared(UnsafeCell::new([[Keyframe { pos: 0.0, val: [0.0; 2] }; CAP]; 2]));

#[inline]
#[allow(clippy::mut_from_ref)]
fn ring(id: usize) -> &'static mut [Keyframe; CAP] {
    unsafe { &mut (*RINGS.0.get())[id] }
}

#[inline]
#[allow(clippy::mut_from_ref)]
fn state() -> &'static mut State {
    unsafe { &mut *STATE.0.get() }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    let s = state();
    s.sample_rate = if sample_rate > 0.0 { sample_rate as f64 } else { 48000.0 };
    for (index, &(_, default, _)) in PORTS.iter().enumerate() {
        s.values[index] = default;
    }
    apply_all(s);
    s.reset_engines();
    for c in 0..CHANNELS {
        s.dry[c] = [0.0; DRY_LEN];
    }
    s.dry_pos = 0;
    s.ready = true;
}

/// Frames by which the output lags the input. Not part of ABI version 1; the
/// processor reads it for its ready message.
#[no_mangle]
pub extern "C" fn jig_latency_frames() -> u32 {
    LATENCY as u32
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

/// A port's value as last set. Not part of the ABI: tests read it.
#[no_mangle]
pub extern "C" fn keyframe_param(index: u32) -> f32 {
    state().values.get(index as usize).copied().unwrap_or(f32::NAN)
}

/// Keyframes held by an engine, and splices it has started. Not part of the
/// ABI: tests read them to check the deadband and the leash.
#[no_mangle]
pub extern "C" fn keyframe_count(engine: u32) -> u32 {
    state().engines[(engine as usize).min(1)].count.min(CAP) as u32
}

#[no_mangle]
pub extern "C" fn keyframe_splices(engine: u32) -> u32 {
    state().engines[(engine as usize).min(1)].splices
}

fn apply_all(s: &mut State) {
    for index in 0..PARAM_COUNT {
        apply(s, index);
    }
}

fn apply(s: &mut State, index: usize) {
    let value = s.values[index];
    let p = &mut s.params;
    match index {
        0 => p.tau = (value / 100.0) as f64,
        1 => p.sigma = powf(2.0, value / 12.0) as f64,
        2 => p.leash = (value + 0.5) as usize,
        3 => p.max_splice = (value as f64) * 0.001 * s.sample_rate,
        4 => p.eps = powf(10.0, value / 20.0),
        5 => p.mix = value,
        6 => p.gain = powf(10.0, value / 20.0),
        7 => {
            p.quality = if value >= 1.5 {
                Quality::Full
            } else if value >= 0.5 {
                Quality::Balanced
            } else {
                Quality::Economy
            }
        }
        8 => p.linked = value < 0.5,
        _ => {}
    }
}

fn set_param(s: &mut State, index: usize, value: f32) {
    if index >= PARAM_COUNT || !value.is_finite() {
        return;
    }
    let (minimum, _, maximum) = PORTS[index];
    let value = value.clamp(minimum, maximum);
    let (quality, linked) = (s.params.quality, s.params.linked);
    s.values[index] = value;
    apply(s, index);
    // The ring holds keyframes made by one analysis, and another cannot read
    // them, so a change of method or of stereo mode starts it again.
    if s.ready && (s.params.quality != quality || s.params.linked != linked) {
        s.reset_engines();
    }
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    let s = state();
    let frames = (frames as usize).min(MAX_FRAMES);
    if !s.ready {
        for c in 0..CHANNELS {
            s.output[c][..frames].fill(0.0);
        }
        return;
    }
    let p = s.params;
    let rate = s.sample_rate;
    for i in 0..frames {
        let mut x = [s.input[0][i], s.input[1][i]];
        for v in x.iter_mut() {
            if !v.is_finite() {
                *v = 0.0;
            }
        }

        let wet = if p.linked {
            s.engines[0].analyse(x, &p);
            s.engines[0].render(&p, rate)
        } else {
            s.engines[0].analyse([x[0], 0.0], &p);
            s.engines[1].analyse([x[1], 0.0], &p);
            [s.engines[0].render(&p, rate)[0], s.engines[1].render(&p, rate)[0]]
        };

        for c in 0..CHANNELS {
            s.dry[c][s.dry_pos & DRY_MASK] = x[c];
            let dry = s.dry[c][(s.dry_pos + DRY_LEN - LATENCY) & DRY_MASK];
            let mut y = (dry * (1.0 - p.mix) + wet[c] * p.mix) * p.gain;
            if !y.is_finite() {
                y = 0.0;
            }
            s.output[c][i] = y;
        }
        s.dry_pos = (s.dry_pos + 1) & DRY_MASK;
    }
}
