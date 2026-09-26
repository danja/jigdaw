// plugins/cadence/src/variation.rs
//
// What happens each cycle while Vary is up: revoiced chords at first,
// rebuilt progressions the higher it goes. A direct port of downspout's
// cadence_variation.cpp, except the mutation interval curve, which uses the
// square where the original raises to 2.5: core has no pow, and the square
// keeps the same endpoints and the same direction, mutating only somewhat
// earlier through the middle.

use crate::harmony::{revoice_progression, BuildOptions, ChordSlot, Controls, SegmentCapture};
use crate::rng::{mix_u32, Rng};

pub struct Variation {
    pub completed_cycles: i64,
    pub last_mutation_cycle: i64,
    pub mutation_serial: i32,
}

impl Variation {
    pub const fn new() -> Self {
        Variation { completed_cycles: 0, last_mutation_cycle: 0, mutation_serial: 0 }
    }

    pub fn reset(&mut self) {
        self.completed_cycles = 0;
        self.last_mutation_cycle = 0;
        self.mutation_serial = 0;
    }
}

fn cycles_between(vary: f32) -> i32 {
    let t = 1.0 - vary;
    let target = 1.0 + 7.0 * t * t;
    // ceil without libm: the quotient is positive, so truncation plus one
    // unless it is already whole.
    let q = target - 0.000001;
    let t = q as i32;
    (if q > 0.0 && t as f32 != q { t + 1 } else { t }).clamp(1, 64)
}

fn controls_seed(c: &Controls) -> u32 {
    let mut seed = 0xC4D3A91Bu32;
    seed ^= (c.key & 0xFF) as u32;
    seed ^= ((c.scale & 0xFF) as u32) << 8;
    seed ^= ((c.cycle_bars & 0xFF) as u32) << 16;
    seed ^= ((c.granularity & 0xFF) as u32) << 24;
    seed ^= mix_u32(lround(c.complexity * 1000.0) as u32);
    seed ^= mix_u32(lround(c.movement * 1000.0) as u32);
    seed ^= mix_u32(lround(c.color * 1000.0) as u32);
    seed ^= mix_u32(((c.chord_size & 0xFF) as u32) << 1);
    seed ^= mix_u32(((c.reg & 0xFF) as u32) << 2);
    seed ^= mix_u32(lround(c.spread * 1000.0) as u32);
    seed
}

fn lround(v: f32) -> i32 {
    (v + 0.5) as i32
}

/// Mutate the playback progression for a new cycle. Returns true with the
/// mutated slots when anything changed. The dynamic programming scratch
/// lives in the engine state, passed down, because it does not fit the
/// WebAssembly stack.
pub fn apply_cycle_variation(
    learned: Option<(&[SegmentCapture], usize)>,
    c: &Controls,
    variation: &mut Variation,
    base: &[ChordSlot],
    base_count: usize,
    previous: &[ChordSlot],
    previous_count: usize,
    out_slots: &mut [ChordSlot],
    scratch: &mut super::harmony::DpScratch,
) -> bool {
    if base_count == 0 {
        return false;
    }
    if variation.completed_cycles < i64::MAX {
        variation.completed_cycles += 1;
    }
    let vary = c.vary.clamp(0.0, 1.0);
    if vary <= 0.0001 {
        return false;
    }
    if variation.completed_cycles - variation.last_mutation_cycle < cycles_between(vary) as i64 {
        return false;
    }
    variation.last_mutation_cycle = variation.completed_cycles;
    if variation.mutation_serial < i32::MAX {
        variation.mutation_serial += 1;
    }

    let seed = controls_seed(c)
        ^ mix_u32(variation.completed_cycles as u32)
        ^ mix_u32((variation.mutation_serial as u32).wrapping_mul(3266489917));
    let mut rng = Rng::new(seed);
    let roll = rng.next_float();

    let mut options = BuildOptions::plain();
    options.seed = seed ^ mix_u32((variation.mutation_serial as u32).wrapping_mul(2246822519));
    options.anchor_endpoints = vary < 0.92;
    let prefer_revoice: bool;
    if vary < 0.20 {
        options.voicing_jitter = (0.28 + vary * 1.8).clamp(0.0, 1.0);
        options.continuity = 0.95;
        prefer_revoice = true;
    } else if vary < 0.45 {
        options.voicing_jitter = (0.30 + vary * 1.2).clamp(0.0, 1.0);
        options.local_jitter = 0.05 + vary * 0.12;
        options.transition_jitter = 0.03 + vary * 0.08;
        options.continuity = 0.82;
        prefer_revoice = roll < 0.58;
    } else if vary < 0.75 {
        options.voicing_jitter = (0.36 + vary * 0.75).clamp(0.0, 1.0);
        options.local_jitter = 0.10 + vary * 0.20;
        options.transition_jitter = 0.06 + vary * 0.14;
        options.continuity = 0.56;
        prefer_revoice = roll < 0.24;
    } else {
        options.voicing_jitter = (0.55 + vary * 0.45).clamp(0.0, 1.0);
        options.local_jitter = 0.18 + vary * 0.28;
        options.transition_jitter = 0.10 + vary * 0.20;
        options.continuity = if vary >= 0.999 { 0.0 } else { 0.18 };
        options.anchor_endpoints = vary < 0.999;
        prefer_revoice = roll < 0.10;
    }

    if prefer_revoice {
        return revoice_progression(base, base_count, c, &options, out_slots);
    }
    if let Some((learned_slots, learned_count)) = learned {
        if learned_count == base_count
            && super::harmony::build_progression_from_capture(
                learned_slots,
                learned_count,
                c,
                Some((previous, previous_count)),
                &options,
                out_slots,
                scratch,
            )
        {
            return true;
        }
    }
    revoice_progression(base, base_count, c, &options, out_slots)
}
