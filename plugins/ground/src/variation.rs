// plugins/ground/src/variation.rs
//
// What happens each time the form loops while Vary is up: a phrase cell
// mutation at first, refreshes and full regenerations the higher it goes. A
// direct port of downspout's ground_variation.cpp, except the mutation
// interval curve, which uses the square where the original raises to 2.3:
// core has no pow, and the square keeps the same endpoints and the same
// direction, mutating only somewhat earlier through the middle.

use crate::generate::{mutate_cell, refresh_phrase, regenerate_form};
use crate::pattern::{Controls, Form};
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

fn loops_between_mutations(vary: f32) -> i32 {
    let t = 1.0 - vary;
    let target = 1.0 + 4.0 * t * t;
    // ceil without libm: the quotient is positive, so truncation plus one
    // unless it is already whole.
    let q = target - 0.000000001;
    let t = q as i32;
    (if q > 0.0 && t as f32 != q { t + 1 } else { t }).clamp(1, 8)
}

fn choose_target(form: &Form, current: i32, vary: f32, rng: &mut Rng) -> i32 {
    if form.phrase_count <= 1 {
        return 0;
    }
    let first = if form.phrase_count > 2 { 1 } else { 0 };
    let last = if form.phrase_count > 2 { form.phrase_count - 2 } else { form.phrase_count - 1 };
    let mut target = (current + 1 + rng.next_int(0, (last - first).max(0))).clamp(first, last);
    if vary > 0.82 && form.phrase_count > 1 && rng.next_float() < 0.18 {
        target = form.phrase_count - 1;
    } else if vary < 0.28 && target == form.phrase_count - 1 && form.phrase_count > 2 {
        target = form.phrase_count - 2;
    }
    target.clamp(0, form.phrase_count - 1)
}

/// Called when the form wraps. Returns true when the form changed, so the
/// caller can cut the sounding note rather than leave it hanging over a line
/// that is no longer there.
pub fn apply_loop_variation(
    form: &mut Form,
    variation: &mut Variation,
    controls: &Controls,
    current_phrase: i32,
) -> bool {
    if variation.completed_loops < i64::MAX {
        variation.completed_loops += 1;
    }
    let vary = controls.vary.clamp(0.0, 1.0);
    if vary <= 0.0001 || form.phrase_count <= 0 {
        return false;
    }
    if variation.completed_loops - variation.last_mutation_loop
        < loops_between_mutations(vary) as i64
    {
        return false;
    }
    variation.last_mutation_loop = variation.completed_loops;

    let mut rng = Rng::new(
        controls
            .seed
            .wrapping_add((variation.completed_loops as u32).wrapping_mul(2246822519))
            .wrapping_add((form.serial as u32).wrapping_mul(3266489917)),
    );
    let target = choose_target(form, current_phrase, vary, &mut rng);
    let roll = rng.next_float();

    if vary < 0.20 {
        mutate_cell(form, controls, target, 0.28 + vary * 0.50);
    } else if vary < 0.45 {
        if roll < 0.70 {
            mutate_cell(form, controls, target, 0.42 + vary * 0.40);
        } else {
            refresh_phrase(form, controls, target);
        }
    } else if vary < 0.75 {
        if roll < 0.18 {
            mutate_cell(form, controls, target, 0.70);
        } else if roll < 0.74 {
            refresh_phrase(form, controls, target);
        } else {
            regenerate_form(form, controls, form.meter);
        }
    } else if roll < 0.14 {
        mutate_cell(form, controls, target, 0.90);
    } else if roll < 0.54 {
        refresh_phrase(form, controls, target);
        if form.phrase_count > 2 && rng.next_float() < 0.40 {
            let companion =
                (target + (if rng.next_float() < 0.5 { -1 } else { 1 })).clamp(0, form.phrase_count - 1);
            if companion != target {
                mutate_cell(form, controls, companion, 0.58);
            }
        }
    } else {
        regenerate_form(form, controls, form.meter);
    }
    true
}
