// plugins/cadence/src/rng.rs
//
// The deterministic hashes downspout's cadence_rng.hpp provides: a 32 bit
// mixer, a signed unit jitter from a seed, and a small LCG for the
// variation roll. Same constants, so the same seed shuffles the same way.

pub fn mix_u32(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846ca68b);
    value ^= value >> 16;
    value
}

pub fn signed_jitter(seed: u32) -> f32 {
    let unit = (mix_u32(seed) & 0x00FF_FFFF) as f32 / 16777215.0;
    unit * 2.0 - 1.0
}

#[derive(Clone, Copy)]
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng { state: if seed == 0 { 0xA341316C } else { seed } }
    }

    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_mul(1664525).wrapping_add(1013904223);
        self.state
    }

    pub fn next_float(&mut self) -> f32 {
        ((self.next_u32() & 0x00FF_FFFF) as f32) / 16777215.0
    }

    /// Inclusive on both ends. A degenerate range returns its lower bound
    /// rather than dividing by zero.
    pub fn next_int(&mut self, min: i32, max: i32) -> i32 {
        if max <= min {
            return min;
        }
        let span = (max - min + 1) as u32;
        min + (self.next_u32() % span) as i32
    }
}
