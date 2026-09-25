// plugins/melgen/src/variation.rs
//
// What happens each time the loop comes round while Vary is up: partial note
// mutation at first, increasingly fuller rebuilds the higher it goes. A
// direct port of downspout's melgen_variation.cpp, except the mutation
// interval curve, which uses the square where the original raises to 2.5:
// core has no pow, and the square keeps the same endpoints and the same
// direction, mutating only somewhat earlier through the middle.

use crate::meter::Meter;
use crate::pattern::{partial_mutation, regenerate, Controls, Pattern};
use crate::rng::Rng;

pub struct Variation {
    pub completed_loops: i64,
    pub last_mutation_loop: i64,
}

impl Variation {
    pub const fn new() -> Self {
        Variation { completed_loops: 0, last_mutation_loop: 0 }
    }

    pub fn reset(&mut self) {
        self.completed_loops = 0;
        self.last_mutation_loop = 0;
    }
}

fn loops_between_mutations(vary: f32, bars_per_loop: f64) -> i32 {
    let t = 1.0 - vary;
    let target_bars = 1.0 + 7.0 * t * t;
    let per_loop = if bars_per_loop > 0.0 { bars_per_loop } else { 1.0 };
    // ceil without libm: the quotient is positive, so truncation plus one
    // unless it is already whole.
    let q = (target_bars as f64 / per_loop - 0.000000001) as f32;
    let t = q as i32;
    (if q > 0.0 && t as f32 != q { t + 1 } else { t }).clamp(1, 64)
}

fn partial_strength(vary: f32) -> f32 {
    (0.16 + vary * 0.84).clamp(0.16, 1.0)
}

/// Called when the loop wraps. Returns true when the pattern changed, so the
/// caller can cut the sounding note rather than leave it hanging over a line
/// that is no longer there.
pub fn apply_loop_variation(
    pattern: &mut Pattern,
    variation: &mut Variation,
    controls: &Controls,
    meter: Meter,
    beats_per_bar: f64,
) -> bool {
    if variation.completed_loops < i64::MAX {
        variation.completed_loops += 1;
    }
    let vary = controls.vary.clamp(0.0, 1.0);
    if vary <= 0.0001 {
        return false;
    }
    let safe_beats = if beats_per_bar > 0.0 { beats_per_bar } else { meter.num as f64 };
    let bars_per_loop = controls.length_beats as f64 / safe_beats;
    if variation.completed_loops - variation.last_mutation_loop
        < loops_between_mutations(vary, bars_per_loop) as i64
    {
        return false;
    }
    variation.last_mutation_loop = variation.completed_loops;

    if vary >= 0.999 {
        regenerate(pattern, controls, meter, true, true);
        return true;
    }

    let mut rng = Rng::new(
        controls
            .seed
            .wrapping_add((variation.completed_loops as u32).wrapping_mul(2246822519))
            .wrapping_add((pattern.serial as u32).wrapping_mul(3266489917)),
    );
    let roll = rng.next_float();
    if vary < 0.20 {
        partial_mutation(pattern, controls, partial_strength(vary) * 0.45);
    } else if vary < 0.45 {
        if roll < 0.68 {
            partial_mutation(pattern, controls, partial_strength(vary) * 0.70);
        } else {
            regenerate(pattern, controls, meter, false, true);
        }
    } else if vary < 0.75 {
        if roll < 0.30 {
            partial_mutation(pattern, controls, partial_strength(vary));
        } else if roll < 0.74 {
            regenerate(pattern, controls, meter, false, true);
        } else {
            regenerate(pattern, controls, meter, true, false);
        }
    } else if roll < 0.16 {
        partial_mutation(pattern, controls, partial_strength(vary));
    } else if roll < 0.38 {
        regenerate(pattern, controls, meter, false, true);
    } else if roll < 0.70 {
        regenerate(pattern, controls, meter, true, false);
    } else {
        regenerate(pattern, controls, meter, true, true);
    }
    true
}
