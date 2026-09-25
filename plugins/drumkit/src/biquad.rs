// plugins/drumkit/src/biquad.rs
//
// A bandpass/highpass biquad with the RBJ coefficients the downspout voices
// tune by, ported with nothing culled: same coefficient update on every parameter
// write, same difference equation per sample, same NaN guard. The sin and cos
// in the coefficient update come from the shared approximations; the audio
// path is multiply-adds only.

use crate::math::{cos, sin};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum BiquadType {
    Bandpass,
    Highpass,
}

#[derive(Clone, Copy)]
pub struct Biquad {
    sample_rate: f32,
    kind: BiquadType,
    frequency: f32,
    q: f32,
    a0: f32,
    a1: f32,
    a2: f32,
    b1: f32,
    b2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    pub fn new(sample_rate: f32, kind: BiquadType) -> Self {
        let mut filter = Biquad {
            sample_rate,
            kind,
            frequency: 1000.0,
            q: 1.0,
            a0: 1.0,
            a1: 0.0,
            a2: 0.0,
            b1: 0.0,
            b2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        };
        filter.update();
        filter
    }

    fn update(&mut self) {
        let omega =
            6.28318530718 * self.frequency.clamp(20.0, self.sample_rate * 0.49) / self.sample_rate;
        let sn = sin(omega);
        let cs = cos(omega);
        let alpha = sn / (2.0 * self.q.max(0.5));
        let (a0_raw, a1_raw, a2_raw, b0, b1_raw, b2_raw) = match self.kind {
            BiquadType::Bandpass => {
                (1.0 + alpha, -2.0 * cs, 1.0 - alpha, self.q * alpha, 0.0, -self.q * alpha)
            }
            BiquadType::Highpass => {
                let half = (1.0 + cs) / 2.0;
                (1.0 + alpha, -2.0 * cs, 1.0 - alpha, half, -(1.0 + cs), half)
            }
        };
        self.a0 = b0 / a0_raw;
        self.a1 = b1_raw / a0_raw;
        self.a2 = b2_raw / a0_raw;
        self.b1 = a1_raw / a0_raw;
        self.b2 = a2_raw / a0_raw;
    }

    pub fn set_frequency(&mut self, freq: f32) {
        self.frequency = freq;
        self.update();
    }

    pub fn set_parameters(&mut self, freq: f32, q: f32) {
        self.frequency = freq;
        self.q = q;
        self.update();
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }

    pub fn process(&mut self, input: f32) -> f32 {
        let output = self.a0 * input + self.a1 * self.x1 + self.a2 * self.x2
            - self.b1 * self.y1
            - self.b2 * self.y2;
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;
        if !output.is_finite() {
            self.reset();
            return 0.0;
        }
        output
    }
}
