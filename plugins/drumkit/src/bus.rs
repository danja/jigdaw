// plugins/drumkit/src/bus.rs
//
// The master bus: bitcrusher, distortion, a Schroeder reverb and a DC
// blocker, each instantiated once per channel. Ported from downspout's
// modules with one structural change: the reverb's delay lines are fixed
// arrays rather than vectors, because a real-time module never allocates.
// They are sized for 192 kHz, the fastest rate this host runs, and shorter
// rates simply use a prefix of each line.

use crate::math::{exp2, floor_f32, pow, tanh};

// The longest line the reverb needs at 192 kHz, rounded up to whole samples:
// 0.0437 s of comb and 0.005 s of allpass.
const COMB_CAP: [usize; 4] = [5760, 7168, 7936, 8448];
const AP_CAP: [usize; 2] = [1024, 384];

pub struct Bitcrusher {
    amount: f32,
}

impl Bitcrusher {
    pub fn new() -> Self {
        Bitcrusher { amount: 0.0 }
    }

    pub fn set_amount(&mut self, amt: f32) {
        self.amount = amt.clamp(0.0, 1.0);
    }

    pub fn process(&self, input: f32) -> f32 {
        if self.amount < 0.01 {
            return input;
        }
        let shaped = pow(self.amount, 0.7);
        let bit_depth = (16.0 - shaped * 14.0).max(2.0);
        let levels = exp2(bit_depth);
        let normalized = (input + 1.0) * 0.5;
        let quantized = floor_f32(normalized * levels + 0.5) / levels;
        (quantized * 2.0 - 1.0).clamp(-1.0, 1.0)
    }
}

pub struct Distortion {
    drive: f32,
    output_gain: f32,
}

impl Distortion {
    pub fn new() -> Self {
        Distortion { drive: 1.0, output_gain: 1.0 }
    }

    pub fn set_drive(&mut self, drive: f32) {
        self.drive = drive.clamp(1.0, 10.0);
        self.output_gain = 1.0 / tanh(self.drive);
    }

    pub fn process(&self, input: f32) -> f32 {
        if self.drive <= 1.001 {
            return input;
        }
        tanh(input * self.drive) * self.output_gain
    }
}

pub struct DcBlocker {
    r: f32,
    x1: f32,
    y1: f32,
}

impl DcBlocker {
    pub fn new(r: f32) -> Self {
        DcBlocker { r, x1: 0.0, y1: 0.0 }
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.y1 = 0.0;
    }

    pub fn process(&mut self, input: f32) -> f32 {
        let output = input - self.x1 + self.r * self.y1;
        self.x1 = input;
        self.y1 = output;
        output
    }
}

pub struct Reverb {
    size: f32,
    level: f32,
    comb_len: [usize; 4],
    comb_buf: [[f32; COMB_CAP[3]]; 4],
    comb_idx: [usize; 4],
    ap_len: [usize; 2],
    ap_buf: [[f32; AP_CAP[0]]; 2],
    ap_idx: [usize; 2],
}

impl Reverb {
    pub fn new(sample_rate: f32) -> Self {
        let mut reverb = Reverb {
            size: 0.5,
            level: 0.3,
            comb_len: [0; 4],
            comb_buf: [[0.0; COMB_CAP[3]]; 4],
            comb_idx: [0; 4],
            ap_len: [0; 2],
            ap_buf: [[0.0; AP_CAP[0]]; 2],
            ap_idx: [0; 2],
        };
        let comb_times = [0.0297, 0.0371, 0.0411, 0.0437];
        for i in 0..4 {
            reverb.comb_len[i] = ((comb_times[i] * sample_rate) as usize).min(COMB_CAP[i]).max(1);
        }
        let ap_times = [0.005, 0.0017];
        for i in 0..2 {
            reverb.ap_len[i] = ((ap_times[i] * sample_rate) as usize).min(AP_CAP[i]).max(1);
        }
        reverb
    }

    pub fn set_size(&mut self, value: f32) {
        self.size = value.clamp(0.0, 1.0);
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.0);
    }

    pub fn process(&mut self, input: f32) -> f32 {
        let feedback = 0.7 + self.size * 0.28;
        let mut comb_sum = 0.0;
        for i in 0..4 {
            let len = self.comb_len[i];
            let idx = self.comb_idx[i];
            let delayed = self.comb_buf[i][idx];
            self.comb_buf[i][idx] = input + delayed * feedback;
            comb_sum += delayed;
            self.comb_idx[i] = (idx + 1) % len;
        }
        let mut output = comb_sum / 4.0;
        for i in 0..2 {
            let len = self.ap_len[i];
            let idx = self.ap_idx[i];
            let delayed = self.ap_buf[i][idx];
            let g = 0.5;
            let out = -output * g + delayed;
            self.ap_buf[i][idx] = output + delayed * g;
            output = out;
            self.ap_idx[i] = (idx + 1) % len;
        }
        input * (1.0 - self.level) + output * self.level
    }

    pub fn reset(&mut self) {
        for line in self.comb_buf.iter_mut() {
            for sample in line.iter_mut() {
                *sample = 0.0;
            }
        }
        for line in self.ap_buf.iter_mut() {
            for sample in line.iter_mut() {
                *sample = 0.0;
            }
        }
        self.comb_idx = [0; 4];
        self.ap_idx = [0; 2];
    }
}
