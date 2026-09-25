// plugins/drumkit/src/voices_metal.rs
//
// The metallic voices: bash, cowbell and clave. Bash clusters two
// pitch-modulated sines with ring modulation through resonators and heavy
// saturation; cowbell mixes two detuned squares through a resonant bandpass;
// clave is a short bandpassed noise burst with an optional metallic ping.

use crate::biquad::{Biquad, BiquadType};
use crate::envelope::AdEnvelope;
use crate::math::{expo_map, sin, tanh};
use crate::bus::Distortion;
use crate::noise::Noise;

const TAU: f32 = 6.28318530718;

pub struct Bash {
    sample_rate: f32,
    noise: Noise,
    env: AdEnvelope,
    hp: Biquad,
    res_a: Biquad,
    res_b: Biquad,
    saturator: Distortion,
    phase_a: f32,
    phase_b: f32,
    mod_phase: f32,
    base_freq: f32,
    spread: f32,
    drive: f32,
    noise_amount: f32,
    velocity: f32,
    level: f32,
    osc_a: f32,
    osc_b: f32,
}

impl Bash {
    pub fn new(sample_rate: f32) -> Self {
        let mut voice = Bash {
            sample_rate,
            noise: Noise::new(444121),
            env: AdEnvelope::new(sample_rate),
            hp: Biquad::new(sample_rate, BiquadType::Highpass),
            res_a: Biquad::new(sample_rate, BiquadType::Bandpass),
            res_b: Biquad::new(sample_rate, BiquadType::Bandpass),
            saturator: Distortion::new(),
            phase_a: 0.0,
            phase_b: 0.0,
            mod_phase: 0.0,
            base_freq: 420.0,
            spread: 0.55,
            drive: 4.0,
            noise_amount: 0.6,
            velocity: 1.0,
            level: 1.0,
            osc_a: 420.0,
            osc_b: 780.0,
        };
        voice.env.set_attack_time(0.002);
        voice.set_size(0.45);
        voice.set_spread(0.55);
        voice.set_decay(0.70);
        voice.set_drive(0.65);
        voice.set_noise(0.60);
        voice.set_edge(0.70);
        voice
    }

    fn update_resonators(&mut self) {
        let freq_a = self.base_freq;
        let freq_b = self.base_freq * (1.25 + self.spread * 1.6);
        let q = 7.0 + self.spread * 9.0;
        self.res_a.set_parameters(freq_a, q);
        self.res_b.set_parameters(freq_b, q * 0.9);
        self.osc_a = freq_a;
        self.osc_b = freq_b * 1.05;
    }

    pub fn set_size(&mut self, value: f32) {
        self.base_freq = expo_map(value, 180.0, 1200.0);
        self.update_resonators();
    }

    pub fn set_spread(&mut self, value: f32) {
        self.spread = value.clamp(0.0, 1.0);
        self.update_resonators();
    }

    pub fn set_decay(&mut self, value: f32) {
        self.env.set_decay_time(expo_map(value, 0.12, 1.6));
    }

    pub fn set_drive(&mut self, value: f32) {
        self.drive = 1.0 + value * 9.0;
        self.saturator.set_drive(self.drive);
    }

    pub fn set_noise(&mut self, value: f32) {
        self.noise_amount = value.clamp(0.0, 1.0);
    }

    pub fn set_edge(&mut self, value: f32) {
        self.hp.set_parameters(expo_map(value, 800.0, 8000.0), 0.8);
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn trigger(&mut self, vel: f32) {
        self.velocity = vel.clamp(0.0, 1.0);
        self.phase_a = 0.0;
        self.phase_b = 0.0;
        self.mod_phase = 0.0;
        self.env.trigger();
        self.hp.reset();
        self.res_a.reset();
        self.res_b.reset();
    }

    pub fn process(&mut self) -> f32 {
        if !self.env.is_active() {
            return 0.0;
        }
        let env_value = self.env.process();
        let mod_freq = 35.0 + env_value * 1800.0;
        self.mod_phase += TAU * mod_freq / self.sample_rate;
        if self.mod_phase >= TAU {
            self.mod_phase -= TAU;
        }
        let modulation = sin(self.mod_phase);
        let jitter = self.noise.process() * 0.015 * (env_value + 0.1);
        let freq_a = self.osc_a * (1.0 + modulation * 0.18 + jitter);
        let freq_b = self.osc_b * (1.0 - modulation * 0.22 + jitter * 1.2);
        self.phase_a += TAU * freq_a / self.sample_rate;
        self.phase_b += TAU * freq_b / self.sample_rate;
        if self.phase_a >= TAU {
            self.phase_a -= TAU;
        }
        if self.phase_b >= TAU {
            self.phase_b -= TAU;
        }
        let osc_a = sin(self.phase_a);
        let osc_b = sin(self.phase_b);
        let ring = osc_a * osc_b;
        let burst = self.noise.process() * (0.3 + self.noise_amount * 1.4) * (env_value + 0.15);
        let mut sample = ring + 0.35 * (osc_a + osc_b) + burst;
        sample = self.hp.process(sample);
        sample = self.res_a.process(sample) + self.res_b.process(sample * 0.9);
        sample = self.saturator.process(sample * 0.85);
        sample * env_value * self.velocity * 0.7 * self.level
    }


    pub fn reset(&mut self) {
        self.env.reset();
        self.hp.reset();
        self.res_a.reset();
        self.res_b.reset();
        self.phase_a = 0.0;
        self.phase_b = 0.0;
    }
}

pub struct Cowbell {
    sample_rate: f32,
    env: AdEnvelope,
    bandpass: Biquad,
    saturator: Distortion,
    phase_a: f32,
    phase_b: f32,
    base_freq: f32,
    metal: f32,
    velocity: f32,
    level: f32,
}

impl Cowbell {
    pub fn new(sample_rate: f32) -> Self {
        let mut voice = Cowbell {
            sample_rate,
            env: AdEnvelope::new(sample_rate),
            bandpass: Biquad::new(sample_rate, BiquadType::Bandpass),
            saturator: Distortion::new(),
            phase_a: 0.0,
            phase_b: 0.0,
            base_freq: 540.0,
            metal: 0.0,
            velocity: 1.0,
            level: 1.0,
        };
        voice.env.set_attack_time(0.0015);
        voice.set_tone(0.45);
        voice.set_decay(0.35);
        voice.saturator.set_drive(2.0);
        voice
    }

    pub fn set_tone(&mut self, value: f32) {
        self.base_freq = expo_map(value, 380.0, 1400.0);
        self.bandpass.set_parameters(self.base_freq * 1.15, 6.0);
    }

    pub fn set_decay(&mut self, value: f32) {
        self.env.set_decay_time(expo_map(value, 0.05, 1.0));
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn set_metal(&mut self, value: f32) {
        self.metal = value.clamp(0.0, 1.0);
        self.saturator.set_drive(2.0 + self.metal * self.metal * 4.0);
    }

    pub fn trigger(&mut self, vel: f32) {
        self.velocity = vel.clamp(0.0, 1.0);
        self.phase_a = 0.0;
        self.phase_b = 0.0;
        self.env.trigger();
        self.bandpass.reset();
    }

    pub fn process(&mut self) -> f32 {
        if !self.env.is_active() {
            return 0.0;
        }
        let env_value = self.env.process();
        self.phase_a += TAU * self.base_freq / self.sample_rate;
        self.phase_b += TAU * self.base_freq * 1.45 / self.sample_rate;
        if self.phase_a >= TAU {
            self.phase_a -= TAU;
        }
        if self.phase_b >= TAU {
            self.phase_b -= TAU;
        }
        let osc_a = sin(self.phase_a);
        let osc_b = sin(self.phase_b);
        let square_a = if osc_a >= 0.0 { 1.0 } else { -1.0 };
        let square_b = if osc_b >= 0.0 { 1.0 } else { -1.0 };
        let clang = square_a * square_b + (osc_a * square_b - osc_b * square_a) * 0.32;
        let mut sample = 0.55 * square_a + 0.45 * square_b + 0.2 * (osc_a + osc_b);
        if self.metal > 0.0 {
            let m = self.metal * self.metal;
            sample = sample * (1.0 - m * 0.52) + clang * (1.7 * m);
        }
        sample = self.bandpass.process(sample * (0.8 + self.metal * 0.35));
        sample = self.saturator.process(sample);
        sample * env_value * self.velocity * 0.6 * self.level
    }


    pub fn reset(&mut self) {
        self.env.reset();
        self.bandpass.reset();
        self.phase_a = 0.0;
        self.phase_b = 0.0;
    }
}

pub struct Clave {
    sample_rate: f32,
    noise: Noise,
    env: AdEnvelope,
    bandpass: Biquad,
    metal_band: Biquad,
    tone_freq: f32,
    metal: f32,
    velocity: f32,
    level: f32,
}

impl Clave {
    pub fn new(sample_rate: f32) -> Self {
        let mut voice = Clave {
            sample_rate,
            noise: Noise::new(910231),
            env: AdEnvelope::new(sample_rate),
            bandpass: Biquad::new(sample_rate, BiquadType::Bandpass),
            metal_band: Biquad::new(sample_rate, BiquadType::Bandpass),
            tone_freq: 1800.0,
            metal: 0.0,
            velocity: 1.0,
            level: 1.0,
        };
        voice.env.set_attack_time(0.0008);
        voice.set_tone(0.5);
        voice.set_decay(0.25);
        voice
    }

    pub fn set_tone(&mut self, value: f32) {
        self.tone_freq = expo_map(value, 900.0, 4200.0);
        self.bandpass.set_parameters(self.tone_freq, 10.0);
        self.metal_band.set_parameters(
            (self.tone_freq * 2.45).min(self.sample_rate * 0.43),
            8.0,
        );
    }

    pub fn set_decay(&mut self, value: f32) {
        self.env.set_decay_time(expo_map(value, 0.02, 0.4));
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn set_metal(&mut self, value: f32) {
        self.metal = value.clamp(0.0, 1.0);
    }

    pub fn trigger(&mut self, vel: f32) {
        self.velocity = vel.clamp(0.0, 1.0);
        self.env.trigger();
        self.bandpass.reset();
        self.metal_band.reset();
    }

    pub fn process(&mut self) -> f32 {
        if !self.env.is_active() {
            return 0.0;
        }
        let env_value = self.env.process();
        let excitation = self.noise.process() * (0.8 + env_value * 0.4);
        let mut sample = self.bandpass.process(excitation);
        if self.metal > 0.0 {
            let m = self.metal * self.metal;
            let bite = excitation * excitation.abs();
            let ping = self
                .metal_band
                .process(excitation * 1.9 + bite * 1.4)
                * (0.7 + env_value * 0.85);
            sample = sample * (1.0 - m * 0.7) + tanh(ping * 4.0) * (1.45 * m);
        }
        sample * env_value * self.velocity * 0.5 * self.level
    }


    pub fn reset(&mut self) {
        self.env.reset();
        self.bandpass.reset();
        self.metal_band.reset();
    }
}
