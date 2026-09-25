// plugins/drumkit/src/math.rs
//
// The transcendental functions the synthesis needs, without libm. Pulse keeps
// sinf, powf and friends off the audio thread entirely; a drum engine cannot,
// so they live here instead: deterministic polynomials over f32 arithmetic,
// which is exact in WebAssembly however many times a block runs.
//
// Accuracy is deliberately better than the ear: sin within a few units in the
// last place, exp2/log2 around 1e-5 relative, tanh inheriting exp. A drum hit
// through two distortion stages does not resolve finer than that.

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const HALF_PI: f32 = 1.5707963267948966;
const INV_TAU: f32 = 0.15915494309189535;
const INV_LN2: f32 = 1.4426950408889634;

fn floor_i32(x: f32) -> i32 {
    if x >= 2147483520.0 {
        return 2147483647;
    }
    if x <= -2147483648.0 {
        return -2147483648;
    }
    let t = x as i32;
    if x < 0.0 && t as f32 != x {
        t - 1
    } else {
        t
    }
}

pub fn floor_f32(x: f32) -> f32 {
    floor_i32(x) as f32
}

/// Sine by a 9th-order Taylor series after folding into [-pi/2, pi/2].
/// Worst case error is below 1e-6, which a saturated drum transient hides
/// several orders of magnitude below audibility.
pub fn sin(x: f32) -> f32 {
    let k = floor_i32(x * INV_TAU + 0.5);
    let mut r = x - k as f32 * TAU;
    if r > HALF_PI {
        r = PI - r;
    } else if r < -HALF_PI {
        r = -PI - r;
    }
    let r2 = r * r;
    r * (1.0 + r2 * (-0.1666666667 + r2 * (0.008333333333 + r2 * (-0.0001984126984 + r2 * 0.0000027557319))))
}

#[inline]
pub fn cos(x: f32) -> f32 {
    sin(x + HALF_PI)
}

fn pow2_int(k: i32) -> f32 {
    f32::from_bits(((k + 127) << 23) as u32)
}

/// 2^x by splitting the integer part off and approximating the fraction with
/// a degree-6 series. Relative error is around 3e-5.
pub fn exp2(x: f32) -> f32 {
    if x <= -126.0 {
        return 0.0;
    }
    if x >= 128.0 {
        return f32::INFINITY;
    }
    let xi = floor_i32(x);
    let f = x - xi as f32;
    let p = 1.0
        + f * (0.6931471806
            + f * (0.2402265069
                + f * (0.0555041087 + f * (0.0096181291 + f * (0.0013333558 + f * 0.0001540353)))));
    p * pow2_int(xi)
}

#[inline]
pub fn exp(x: f32) -> f32 {
    exp2(x * INV_LN2)
}

/// log2 by extracting the exponent straight out of the bits and
/// approximating the mantissa, halved into [sqrt(1/2), sqrt(2)) first so a
/// short Taylor series converges. Absolute error is around 3e-4, which moves
/// an exponential parameter mapping by hundredths of a percent.
pub fn log2(x: f32) -> f32 {
    if x <= 0.0 {
        return -126.0;
    }
    let bits = x.to_bits();
    let mut e = ((bits >> 23) & 0xff) as i32 - 127;
    let mut m = f32::from_bits((bits & 0x7fffff) | 0x3f800000);
    if m >= 1.4142135624 {
        e += 1;
        m *= 0.5;
    }
    let f = m - 1.0;
    let p = f * (1.0 + f * (-0.5 + f * (0.3333333333 + f * (-0.25 + f * (0.2 - f * 0.1666666667)))));
    e as f32 + p
}

/// a^b for a > 0, via exp2 and log2. Used by the exponential parameter
/// mappings and the per-sample pitch envelope.
pub fn pow(a: f32, b: f32) -> f32 {
    if a <= 0.0 {
        return 0.0;
    }
    exp2(b * log2(a))
}

/// Exponential mapping of a normalised parameter, the expoMap the downspout
/// voices use for every pitch, decay and brightness control.
pub fn expo_map(value: f32, min: f32, max: f32) -> f32 {
    min * pow(max / min, value.clamp(0.0, 1.0))
}

/// tanh from exp, exact to the exp approximation. Saturates past |x| = 9,
/// where the result is 1 to float precision anyway.
pub fn tanh(x: f32) -> f32 {
    if x > 9.0 {
        return 1.0;
    }
    if x < -9.0 {
        return -1.0;
    }
    let e = exp(2.0 * x);
    (e - 1.0) / (e + 1.0)
}

/// The kick's normalised pitch control keeps 0.35 at its inherited default
/// pitch while reaching down to 30 Hz: two exponential halves meeting at the
/// default, ported from downspout's normalisedKickPitchToHz.
pub fn kick_pitch_to_hz(value: f32) -> f32 {
    let clamped = value.clamp(0.0, 1.0);
    let old_minimum = 60.0f32;
    let minimum = 30.0f32;
    let maximum = 250.0f32;
    let default_norm = 0.35f32;
    let default_hz = old_minimum * pow(maximum / old_minimum, default_norm);
    if clamped <= default_norm {
        minimum * pow(default_hz / minimum, clamped / default_norm)
    } else {
        default_hz * pow(maximum / default_hz, (clamped - default_norm) / (1.0 - default_norm))
    }
}
