// plugins/canticle/src/dsp.rs
//
// The arithmetic the voice needs without libm. Three approximations with
// exact rational coefficients, each verifiable by hand rather than fitted:
//
// - exp_approx over [-8, +8]: the argument sixteenthed, a sixth-order Taylor
//   polynomial, then four squarings. Powers the envelope time maps, the
//   detune ratio and the filter coefficient, all of which run on the
//   parameter path, plus tanh below.
// - tanh through exp_approx, for the oscillator shaping and the output clip.
// - sin_phase over a non-negative phase: folded into [-pi/2, pi/2] and a
//   ninth-order Taylor polynomial, for the oscillators, the LFO and the
//   inharmonic metallic partials.
// - sqrt_approx by four Newton iterations from the argument itself, for the
//   equal-power pan gains. Pan arguments stay inside [0.06, 0.94].
//
// Pitch comes from a twelve-entry table plus an octave shift, the way Pulse
// avoids powf: a synth that needs libm on the audio thread has chosen to.

const TWO_PI: f32 = 6.2831853;
const LN_2: f32 = 0.6931472;

/// ln(max/min) for the three envelope maps, so exp_map needs no log.
pub const LN_ATTACK_RATIO: f32 = 7.0900768; // ln(1200), 0.001 to 1.2 s
pub const LN_DECAY_RATIO: f32 = 4.7874917; // ln(120), 0.02 to 2.4 s
pub const LN_RELEASE_RATIO: f32 = 5.0751738; // ln(160), 0.02 to 3.2 s

fn exp_pos(y: f32) -> f32 {
    // y in [0, 8]: sixteenth it, Taylor to z^6, square four times back up.
    let z = y * (1.0 / 16.0);
    let z2 = z * z;
    let z3 = z2 * z;
    let mut t = 1.0 + z + z2 * 0.5 + z3 * (1.0 / 6.0);
    t += z2 * z2 * (1.0 / 24.0);
    t += z3 * z2 * (1.0 / 120.0);
    t += z3 * z3 * (1.0 / 720.0);
    t *= t;
    t *= t;
    t *= t;
    t *= t;
    t
}

/// e^x for x in [-8, +8]. Every call site clamps into that range first.
pub fn exp_approx(x: f32) -> f32 {
    if x < 0.0 {
        1.0 / exp_pos(-x)
    } else {
        exp_pos(x)
    }
}

/// min * (max/min)^v without pow: the ratio's log is a constant here.
pub fn exp_map(min: f32, ln_ratio: f32, v: f32) -> f32 {
    min * exp_approx(v.clamp(0.0, 1.0) * ln_ratio)
}

/// 2^(cents/1200) for the detune spread, cents in [0, 19].
pub fn detune_ratio(cents: f32) -> f32 {
    exp_approx(cents.clamp(0.0, 19.0) * (1.0 / 1200.0) * LN_2)
}

/// 1 - e^(-x) for the one-pole coefficient, x = 2pi*cutoff/rate >= 0.
pub fn one_pole_coeff(cutoff: f32, rate: f32) -> f32 {
    1.0 - exp_approx(-TWO_PI * cutoff / rate.max(1000.0))
}

pub fn tanh_approx(x: f32) -> f32 {
    let e = exp_approx((2.0 * x).clamp(-8.0, 8.0));
    (e - 1.0) / (e + 1.0)
}

/// sin(2*pi*p) for a non-negative phase p. Every oscillator phase in the
/// voice stays non-negative by construction, wrapped after each increment,
// so truncation is floor and the fold below is exact.
pub fn sin_phase(p: f32) -> f32 {
    let q = p - (p as i32) as f32;
    let mut y = q * TWO_PI - core::f32::consts::PI;
    if y > core::f32::consts::FRAC_PI_2 {
        y = core::f32::consts::PI - y;
    } else if y < -core::f32::consts::FRAC_PI_2 {
        y = -core::f32::consts::PI - y;
    }
    let y2 = y * y;
    y * (1.0 + y2 * (-1.0 / 6.0 + y2 * (1.0 / 120.0 + y2 * (-1.0 / 5040.0 + y2 / 362880.0))))
}

/// sqrt(a) for a in (0, 1]: four Newton iterations seeded with the argument
/// itself, which converges from above on this interval.
pub fn sqrt_approx(a: f32) -> f32 {
    if a <= 0.0 {
        return 0.0;
    }
    let mut g = a;
    g = 0.5 * (g + a / g);
    g = 0.5 * (g + a / g);
    g = 0.5 * (g + a / g);
    g = 0.5 * (g + a / g);
    g
}

/// Frequency of MIDI note n as a quarter-semitone-accurate table over one
/// octave plus a shift, after Pulse. No powf.
const SEMITONE: [f32; 12] = [
    1.000000, 1.059463, 1.122462, 1.189207, 1.259921, 1.334840, 1.414214, 1.498307, 1.587401,
    1.681793, 1.781797, 1.887749,
];

pub fn note_frequency(note: u8) -> f32 {
    let n = note as i32 - 69;
    let octave = n.div_euclid(12);
    let step = n.rem_euclid(12) as usize;
    let mut frequency = 440.0 * SEMITONE[step];
    let mut shifts = octave;
    while shifts > 0 {
        frequency *= 2.0;
        shifts -= 1;
    }
    while shifts < 0 {
        frequency *= 0.5;
        shifts += 1;
    }
    frequency
}
