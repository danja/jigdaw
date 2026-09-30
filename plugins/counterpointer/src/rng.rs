// plugins/counterpointer/src/rng.rs
//
// The deterministic generator downspout's counterpointer engine uses:
// xorshift32 with a 0x12345678 fallback seed, and a 24 bit unit float.
// Same constants, so the same seed shuffles the same way.

pub fn mix_u32(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846ca68b);
    value ^= value >> 16;
    value
}

#[derive(Clone, Copy)]
pub struct Rng {
    pub(crate) state: u32,
}

impl Rng {
    pub fn seed(&mut self, value: u32) {
        self.state = if value == 0 { 0x12345678 } else { value };
    }

    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.state;
        x ^= x.wrapping_shl(13);
        x ^= x >> 17;
        x ^= x.wrapping_shl(5);
        self.state = x;
        x
    }

    pub fn next_float(&mut self) -> f32 {
        ((self.next_u32() & 0x00FF_FFFF) as f32) / 16777216.0
    }
}
