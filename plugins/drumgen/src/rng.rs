// plugins/drumgen/src/rng.rs
//
// The same linear congruential generator as downspout's drumgen_rng.hpp, so a
// seed means the same sequence in both: state_ * 1664525 + 1013904223, with a
// zero seed replaced rather than honoured, because a zero state would repeat
// one value for ever.

#[derive(Clone, Copy)]
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng { state: if seed == 0 { 0x12345678 } else { seed } }
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
