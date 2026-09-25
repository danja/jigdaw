// plugins/drumkit/src/noise.rs
//
// White noise from a linear congruential generator, bit for bit the
// downspout NoiseGenerator: same Numerical Recipes constants, same signed
// normalisation, so a voice seeded like its counterpart hisses identically.

#[derive(Clone, Copy)]
pub struct Noise {
    state: u32,
}

impl Noise {
    pub fn new(seed: u32) -> Self {
        Noise { state: seed }
    }

    pub fn process(&mut self) -> f32 {
        self.state = self.state.wrapping_mul(1103515245).wrapping_add(12345);
        (self.state as i32) as f32 / 2147483648.0
    }
}
