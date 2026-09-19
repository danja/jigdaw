// plugins/dynamix/src/lib.rs
//
// Dynamix: a compressor/expander, a limiter and a clipper/soft distortion, in
// series. Channels 0 and 1 of jig_input_ptr are the main stereo signal;
// channels 2 and 3 are the side chain key, present only when the host has
// something connected to the plugin's second audio input. The compressor/
// expander stage detects on the key when dynamix_set_sidechain_active(1) has
// been called for this block, and on the main signal otherwise; see
// dynamix-processor.js, which is what decides that, because it is the one
// holding the Web Audio inputs array and can tell a connected input from an
// empty one. That is a contract requirement (section 4.2), not a choice.
//
// #![no_std], no allocator, no libm: the same real-time discipline as
// cascade/src/lib.rs. A compressor's gain law is a logarithm and a power by
// definition, though, so unlike Cascade's damping this cannot be flattened
// into a linear mapping and still behave like a compressor. fast_log2 and
// fast_exp2 below are a bit-manipulation approximation of the kind used
// throughout real-time audio DSP for exactly this reason: IEEE 754 already
// stores a float's base-2 exponent directly in its bits, so extracting it is
// free, and a short polynomial correction on the mantissa gets the rest to
// within about 0.03 dB, worlds tighter than a control anyone turns by ear
// needs. Neither function calls libm, links against it, or leaves the
// deterministic, bounded, allocation-free territory process() is required to
// stay in; they are pure arithmetic on the bit pattern.

#![no_std]

use core::cell::UnsafeCell;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const CHANNELS: usize = 2;

// 20 * log10(2), the constant that turns a base-2 log or power into decibels.
const LOG2_TO_DB: f32 = 6.020_600;
const DB_TO_LOG2: f32 = 1.0 / LOG2_TO_DB;

/// log2(x) for x > 0, accurate to within about 0.005 in log2 units (0.03 dB).
/// The exponent comes straight out of the IEEE 754 bit pattern; only the
/// mantissa's contribution, which lies in [1, 2), needs approximating, and a
/// quadratic does that well enough. See the module comment for why this
/// exists instead of a call to a transcendental function.
#[inline]
fn fast_log2(x: f32) -> f32 {
    let bits = x.to_bits();
    let log_exp = ((bits >> 23) & 0xFF) as i32 - 128;
    let mantissa_bits = (bits & !(0xFFu32 << 23)).wrapping_add(127 << 23);
    let m = f32::from_bits(mantissa_bits);
    log_exp as f32 + (-0.344_848_4 * m + 2.024_665_8) * m - 0.674_877_6
}

/// 2^p, the inverse of fast_log2, accurate to within about 0.005% relative
/// error over the range this plugin ever asks it for (roughly -20 to 20).
#[inline]
fn fast_exp2(p: f32) -> f32 {
    let clipped = p.max(-120.0).min(120.0);
    // core has no floor(): built by hand from the truncating f32-to-i32 cast,
    // which is a compiler intrinsic (fptosi) and not a libm call.
    let truncated = clipped as i32 as f32;
    let w = if clipped < 0.0 && truncated != clipped { truncated - 1.0 } else { truncated };
    let z = clipped - w;
    let v = (1u32 << 23) as f32
        * (clipped + 121.274_06 + 27.728_023 / (4.842_525_7 - z) - 1.490_129_1 * z);
    // `as u32` on a float is saturating, not UB, since Rust 1.45: v is always
    // positive and well inside range here, so this is an exact truncation.
    f32::from_bits(v as u32)
}

#[inline]
fn lin_to_db(lin: f32) -> f32 {
    LOG2_TO_DB * fast_log2(lin.abs().max(1.0e-9))
}

#[inline]
fn db_to_lin(db: f32) -> f32 {
    fast_exp2(db * DB_TO_LOG2)
}

/// A one-pole time constant for an envelope follower or a smoothed gain,
/// expressed as the coefficient that leaves the target after `time_ms`
/// milliseconds. Computed only when a parameter changes, never per sample.
#[inline]
fn coeff_for(time_ms: f32, sample_rate: f32) -> f32 {
    let t = time_ms.max(0.05) * 0.001 * sample_rate;
    db_to_lin(-8.685_89 / t) // exp(-1/t) via fast_exp2, in one step: -8.68589 = -20/ln(10)
}

/// The cubic soft clip, exact polynomial arithmetic: y = x - x^3/3 inside
/// [-1, 1], saturating at +-2/3 beyond it. No transcendental involved, unlike
/// the tanh shaper this stands in for.
#[inline]
fn soft_clip(x: f32) -> f32 {
    let c = x.max(-4.0).min(4.0);
    if c.abs() <= 1.0 {
        c - c * c * c * (1.0 / 3.0)
    } else {
        (2.0_f32 / 3.0).copysign(c)
    }
}

struct State {
    // Inputs 0..1 are the main signal, 2..3 the side chain key.
    input: [[f32; MAX_FRAMES]; 4],
    output: [[f32; MAX_FRAMES]; CHANNELS],
    sample_rate: f32,
    sidechain_active: bool,

    // Parameters, in the order dynamix-processor.js writes them.
    comp_enable: f32,
    comp_mode: f32,
    threshold: f32,
    ratio: f32,
    attack: f32,
    release: f32,
    knee: f32,
    makeup: f32,
    limit_enable: f32,
    ceiling: f32,
    limit_release: f32,
    clip_enable: f32,
    drive: f32,
    shape: f32,

    // Derived from the parameters above, recomputed when one of them changes
    // rather than every sample. See retune().
    attack_coeff: f32,
    release_coeff: f32,
    limit_attack_coeff: f32,
    limit_release_coeff: f32,
    makeup_lin: f32,
    ceiling_lin: f32,
    drive_lin: f32,

    // Running state, updated every sample.
    envelope: f32,
    limiter_gain: f32,
}

impl State {
    const fn new() -> Self {
        Self {
            input: [[0.0; MAX_FRAMES]; 4],
            output: [[0.0; MAX_FRAMES]; CHANNELS],
            sample_rate: 44100.0,
            sidechain_active: false,

            comp_enable: 1.0,
            comp_mode: 0.0,
            threshold: -18.0,
            ratio: 4.0,
            attack: 10.0,
            release: 100.0,
            knee: 6.0,
            makeup: 0.0,
            limit_enable: 1.0,
            ceiling: -0.3,
            limit_release: 50.0,
            clip_enable: 0.0,
            drive: 0.0,
            shape: 0.3,

            attack_coeff: 0.0,
            release_coeff: 0.0,
            limit_attack_coeff: 0.0,
            limit_release_coeff: 0.0,
            makeup_lin: 1.0,
            ceiling_lin: 1.0,
            drive_lin: 1.0,

            envelope: 0.0,
            limiter_gain: 1.0,
        }
    }

    /// Recompute every value derived from a parameter or the sample rate.
    /// Called on jig_init and on every jig_set_param: cheap next to a
    /// per-sample cost, since none of it runs inside the sample loop.
    fn retune(&mut self) {
        self.attack_coeff = coeff_for(self.attack, self.sample_rate);
        self.release_coeff = coeff_for(self.release, self.sample_rate);
        // Fixed, short, not exposed: a limiter's attack is not a creative
        // control, it is how quickly it can stop an over. 0.3 ms is a few
        // samples even at low sample rates.
        self.limit_attack_coeff = coeff_for(0.3, self.sample_rate);
        self.limit_release_coeff = coeff_for(self.limit_release, self.sample_rate);
        self.makeup_lin = db_to_lin(self.makeup);
        self.ceiling_lin = db_to_lin(self.ceiling);
        self.drive_lin = db_to_lin(self.drive);
    }
}

struct Shared(UnsafeCell<State>);
unsafe impl Sync for Shared {}

static STATE: Shared = Shared(UnsafeCell::new(State::new()));

#[inline]
#[allow(clippy::mut_from_ref)]
fn state() -> &'static mut State {
    unsafe { &mut *STATE.0.get() }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    let s = state();
    s.sample_rate = if sample_rate > 0.0 { sample_rate } else { 44100.0 };
    s.retune();
}

/// Channel 0 and 1: the main stereo input. Channel 2 and 3: the side chain
/// key. dynamix-processor.js writes silence there when nothing is connected;
/// dynamix_set_sidechain_active is what says whether that silence means "the
/// key is quiet" or "there is no key".
#[no_mangle]
pub extern "C" fn jig_input_ptr(channel: u32) -> *mut f32 {
    let s = state();
    s.input[(channel as usize).min(3)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_output_ptr(channel: u32) -> *mut f32 {
    let s = state();
    s.output[(channel as usize).min(CHANNELS - 1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 {
    MAX_FRAMES as u32
}

/// Whether the host's second audio input is actually connected this block.
/// Not a parameter: it is not a control a person sets, it is a fact about the
/// graph that only the processor, holding the Web Audio inputs array, can
/// observe (contract section 4.2: a disconnected input is an empty array,
/// which looks identical to "connected and silent" once it has been copied
/// into a fixed-size scratch buffer).
#[no_mangle]
pub extern "C" fn jig_set_sidechain_active(active: u32) {
    state().sidechain_active = active != 0;
}

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    match index {
        0 => s.comp_enable = value,
        1 => s.comp_mode = value,
        2 => s.threshold = value,
        3 => s.ratio = value.max(1.0),
        4 => { s.attack = value; }
        5 => { s.release = value; }
        6 => s.knee = value.max(0.0),
        7 => { s.makeup = value; }
        8 => s.limit_enable = value,
        9 => { s.ceiling = value; }
        10 => { s.limit_release = value; }
        11 => s.clip_enable = value,
        12 => { s.drive = value; }
        13 => s.shape = value.max(0.0).min(1.0),
        _ => return,
    }
    s.retune();
}

/// The gain reduction in dB for one detected level, given a threshold and a
/// soft knee, shared by the compressor and the expander: they differ only in
/// which side of the threshold reacts and in the sign of the slope. `slope`
/// is `1 - 1/ratio` for the compressor and `ratio - 1` for the expander, both
/// non-negative for ratio >= 1, and `over` is signed so that the reacting
/// side is positive.
#[inline]
fn knee_reduction(over: f32, knee: f32, slope: f32) -> f32 {
    let half = knee * 0.5;
    if over <= -half {
        0.0
    } else if over >= half || half <= 0.0 {
        over.max(0.0) * slope
    } else {
        let t = over + half;
        (t * t) / (2.0 * knee) * slope
    }
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    let s = state();
    let frames = (frames as usize).min(MAX_FRAMES);

    let is_expander = s.comp_mode >= 0.5;
    let slope = if is_expander { s.ratio - 1.0 } else { 1.0 - 1.0 / s.ratio };
    let comp_on = s.comp_enable >= 0.5;
    let limit_on = s.limit_enable >= 0.5;
    let clip_on = s.clip_enable >= 0.5;
    let use_sidechain = s.sidechain_active;

    for frame in 0..frames {
        let main_l = s.input[0][frame];
        let main_r = s.input[1][frame];

        // Stage 1: compressor/expander, gain reduction linked across both
        // channels from one detected level so it never shifts the stereo
        // image. The detector reads the side chain key when one is
        // connected, and the main signal otherwise: a compressor with
        // nothing plugged into its key input detects on itself, which is
        // the ordinary, not the sidechain, use of a dynamics processor.
        let (mut out_l, mut out_r) = (main_l, main_r);
        if comp_on {
            let side_l = s.input[2][frame];
            let side_r = s.input[3][frame];
            let detector = if use_sidechain {
                side_l.abs().max(side_r.abs())
            } else {
                main_l.abs().max(main_r.abs())
            };
            let coeff = if detector > s.envelope { s.attack_coeff } else { s.release_coeff };
            s.envelope = coeff * s.envelope + (1.0 - coeff) * detector;

            let level_db = lin_to_db(s.envelope);
            let over = if is_expander { s.threshold - level_db } else { level_db - s.threshold };
            let reduction_db = knee_reduction(over, s.knee, slope);
            let gain = db_to_lin(-reduction_db) * s.makeup_lin;

            out_l = main_l * gain;
            out_r = main_r * gain;
        }

        // Stage 2: a lookahead-free peak limiter. Fast, fixed attack so it
        // can catch an over; the release is the one exposed control, since
        // that is the part that is audible as a texture rather than as a
        // safety margin.
        if limit_on {
            let peak = out_l.abs().max(out_r.abs());
            let target = if peak > s.ceiling_lin && peak > 1.0e-9 {
                s.ceiling_lin / peak
            } else {
                1.0
            };
            let coeff = if target < s.limiter_gain { s.limit_attack_coeff } else { s.limit_release_coeff };
            s.limiter_gain = (coeff * s.limiter_gain + (1.0 - coeff) * target).min(1.0).max(0.0);
            out_l *= s.limiter_gain;
            out_r *= s.limiter_gain;
        }

        // Stage 3: clipper/soft distortion. Drive pushes the signal into the
        // shaper; shape blends from a cubic soft clip (0) to a hard clip (1).
        if clip_on {
            let driven_l = out_l * s.drive_lin;
            let driven_r = out_r * s.drive_lin;
            let hard_l = driven_l.max(-1.0).min(1.0);
            let hard_r = driven_r.max(-1.0).min(1.0);
            out_l = soft_clip(driven_l) * (1.0 - s.shape) + hard_l * s.shape;
            out_r = soft_clip(driven_r) * (1.0 - s.shape) + hard_r * s.shape;
        }

        s.output[0][frame] = out_l;
        s.output[1][frame] = out_r;
    }
}
