// plugins/drumgen/src/variation.rs
//
// What happens each time the loop comes round while Vary is up: nothing when
// it is down, a single refreshed bar at first, and increasingly a fuller
// rebuild the higher it goes. A direct port of downspout's
// drumgen_variation.cpp, except the mutation interval curve, which uses the
// square where the original raises to 2.5: core has no pow, and the square
// keeps the same endpoints and the same direction, mutating only somewhat
// earlier through the middle.

use crate::pattern::{refresh_bar, regenerate, Controls, Pattern};
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

fn loops_between_mutations(vary: f32, bars: i32) -> i32 {
    let t = 1.0 - vary;
    let target_bars = 1.0 + 7.0 * t * t;
    let per_loop = bars.max(1) as f32;
    // ceil without libm: the quotient is positive, so truncation plus one
    // unless it is already whole.
    let q = target_bars / per_loop - 0.000001;
    let t = q as i32;
    (if q > 0.0 && t as f32 != q { t + 1 } else { t }).clamp(1, 64)
}

fn pick_bar(pattern: &Pattern, controls: &Controls, rng: &mut Rng) -> i32 {
    if pattern.bars <= 1 {
        return 0;
    }
    if controls.fill > 0.12 && rng.next_float() < 0.55 {
        return pattern.bars - 1;
    }
    rng.next_int(0, pattern.bars - 1)
}

/// Called when the loop wraps. Returns true when the pattern changed, so the
/// caller can cut the ringing notes rather than leave them hanging over a
/// groove that is no longer there.
pub fn apply_loop_variation(
    pattern: &mut Pattern,
    variation: &mut Variation,
    controls: &Controls,
) -> bool {
    if variation.completed_loops < i64::MAX {
        variation.completed_loops += 1;
    }
    let vary = controls.vary.clamp(0.0, 1.0);
    if vary <= 0.0001 {
        return false;
    }
    if (variation.completed_loops - variation.last_mutation_loop)
        < loops_between_mutations(vary, controls.bars) as i64
    {
        return false;
    }
    variation.last_mutation_loop = variation.completed_loops;

    if vary >= 0.999 {
        regenerate(pattern, controls, pattern.meter, false);
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
        refresh_bar(pattern, controls, pattern.meter, pick_bar(pattern, controls, &mut rng));
    } else if vary < 0.45 {
        if roll < 0.60 {
            refresh_bar(pattern, controls, pattern.meter, pick_bar(pattern, controls, &mut rng));
        } else {
            regenerate(pattern, controls, pattern.meter, true);
        }
    } else if vary < 0.75 {
        if roll < 0.24 {
            refresh_bar(pattern, controls, pattern.meter, pick_bar(pattern, controls, &mut rng));
            if pattern.bars > 1 && rng.next_float() < 0.35 {
                refresh_bar(pattern, controls, pattern.meter, pick_bar(pattern, controls, &mut rng));
            }
        } else if roll < 0.58 {
            regenerate(pattern, controls, pattern.meter, true);
        } else {
            regenerate(pattern, controls, pattern.meter, false);
        }
    } else if roll < 0.14 {
        refresh_bar(pattern, controls, pattern.meter, pick_bar(pattern, controls, &mut rng));
    } else if roll < 0.34 {
        regenerate(pattern, controls, pattern.meter, true);
    } else {
        regenerate(pattern, controls, pattern.meter, false);
    }
    true
}
