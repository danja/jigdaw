// plugins/drumkit/src/voices_cymbal.rs
//
// The cymbal voices: hi-hat and crash. The hat stacks six inharmonic square
// oscillators against noise through a highpass and a sizzle band; the crash
// runs noise through a cascade of three bandpasses with a soft clipper. One
// HiHat struct serves both hats; closed versus open is a decay range.

use crate::biquad::{Biquad, BiquadType};
use crate::envelope::AdEnvelope;
use crate::math::{expo_map, tanh};
use crate::bus::Distortion;
use crate::noise::Noise;

const HAT_RATIOS: [f32; 6] = [1.0, 1.34, 1.71, 2.08, 2.56, 3.01];

pub struct HiHat {
    sample_rate: f32,
    noise: Noise,
    hpf: Biquad,
    sizzle: Biquad,
    env: AdEnvelope,
    phases: [f32; 6],
    brightness: f32,
    metal: f32,
    closed: bool,
    level: f32,
    velocity: f32,
}

impl HiHat {
    pub fn new(sample_rate: f32, closed: bool) -> Self {
        let mut voice = HiHat {
            sample_rate,
            noise: Noise::new(123123123),
            hpf: Biquad::new(sample_rate, BiquadType::Highpass),
            sizzle: Biquad::new(sample_rate, BiquadType::Bandpass),
            env: AdEnvelope::new(sample_rate),
            phases: [0.0; 6],
            brightness: 0.6,
            metal: 0.0,
            closed,
            level: 1.0,
            velocity: 1.0,
        };
        voice.hpf.set_parameters(7000.0, 0.85);
        voice.sizzle.set_parameters(9000.0, 1.3);
        voice.env.set_attack_time(0.0001);
        voice.env.set_decay_time(if closed { 0.1 } else { 0.5 });
        voice
    }

    pub fn set_brightness(&mut self, value: f32) {
        self.brightness = value.clamp(0.0, 1.0);
        let cutoff = expo_map(self.brightness, 5500.0, 14500.0);
        self.hpf.set_parameters(cutoff, 0.85 + self.brightness * 0.35);
        self.sizzle.set_parameters(
            (cutoff * 1.12).min(self.sample_rate * 0.42),
            1.15 + self.brightness * 0.9,
        );
    }

    pub fn set_decay(&mut self, value: f32) {
        let (min_decay, max_decay) = if self.closed { (0.05, 0.2) } else { (0.2, 1.2) };
        self.env.set_decay_time(expo_map(value, min_decay, max_decay));
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn set_metal(&mut self, value: f32) {
        self.metal = value.clamp(0.0, 1.0);
    }

    pub fn trigger(&mut self, vel: f32) {
        self.velocity = vel.clamp(0.0, 1.0);
        for phase in self.phases.iter_mut() {
            *phase = 0.0;
        }
        self.env.trigger();
        self.hpf.reset();
        self.sizzle.reset();
    }

    pub fn process(&mut self) -> f32 {
        if !self.env.is_active() {
            return 0.0;
        }
        let mut osc_sum = 0.0;
        let mut ring = 0.0;
        let mut previous = 0.0;
        for i in 0..6 {
            let freq = 320.0 * 1.35 * HAT_RATIOS[i];
            self.phases[i] += freq / self.sample_rate;
            if self.phases[i] >= 1.0 {
                self.phases[i] -= 1.0;
            }
            let square = if self.phases[i] < 0.5 { 1.0 } else { -1.0 };
            osc_sum += square * (0.85 / (i + 1) as f32);
            if i > 0 {
                ring += square * previous * (0.34 / i as f32);
            }
            previous = square;
        }
        let noise_sample = self.noise.process();
        let m = self.metal * self.metal;
        let sample = osc_sum * (0.19 + m * 0.32)
            + ring * (0.42 + m * 1.65)
            + noise_sample * (0.95 - m * 0.58);
        let filtered = self.hpf.process(sample);
        let sizzle = self.sizzle.process(
            self.noise.process() * (0.75 - m * 0.22) + ring * (0.28 + m * 1.25),
        );
        let mixed = filtered * (0.92 + m * 0.25) + sizzle * (0.48 + m * 1.35) + ring * (m * 0.38);
        let shaped = tanh(mixed * (1.08 + 0.45 * self.brightness + m * 1.55));
        shaped * self.env.process() * (if self.closed { 0.66 } else { 0.74 }) * self.level
            * (0.9 + 0.1 * self.velocity)
    }


    pub fn reset(&mut self) {
        self.env.reset();
        self.hpf.reset();
        self.sizzle.reset();
        for phase in self.phases.iter_mut() {
            *phase = 0.0;
        }
    }

    pub fn kill(&mut self) {
        self.reset();
    }
}

pub struct Crash {
    noise: Noise,
    bp1: Biquad,
    bp2: Biquad,
    bp3: Biquad,
    metal_band: Biquad,
    env: AdEnvelope,
    soft_clipper: Distortion,
    brightness: f32,
    metal: f32,
    level: f32,
}

impl Crash {
    pub fn new(sample_rate: f32) -> Self {
        let mut voice = Crash {
            noise: Noise::new(321321321),
            bp1: Biquad::new(sample_rate, BiquadType::Bandpass),
            bp2: Biquad::new(sample_rate, BiquadType::Bandpass),
            bp3: Biquad::new(sample_rate, BiquadType::Bandpass),
            metal_band: Biquad::new(sample_rate, BiquadType::Bandpass),
            env: AdEnvelope::new(sample_rate),
            soft_clipper: Distortion::new(),
            brightness: 0.65,
            metal: 0.0,
            level: 1.0,
        };
        voice.bp1.set_parameters(2500.0, 2.0);
        voice.bp2.set_parameters(5000.0, 1.5);
        voice.bp3.set_parameters(8000.0, 1.2);
        voice.metal_band.set_parameters(9600.0, 5.0);
        voice.env.set_attack_time(0.005);
        voice.env.set_decay_time(1.0);
        voice.soft_clipper.set_drive(1.3);
        voice
    }

    pub fn set_brightness(&mut self, value: f32) {
        self.brightness = value.clamp(0.0, 1.0);
        // Downspout maps this to 1.5-10.0 while its own comment says
        // 1.5kHz-10kHz and its constructor tunes the cascade to
        // 2500/5000/8000 Hz, which collapses the crash body to a clamped
        // 20 Hz bandpass and renders the voice nearly silent. The thousands
        // stand in for the missing factor, restoring the documented range.
        let shift = expo_map(self.brightness, 1500.0, 10000.0);
        self.bp1.set_frequency(shift);
        self.bp2.set_frequency(shift * 1.8);
        self.bp3.set_frequency(shift * 2.6);
        self.metal_band.set_parameters(
            5200.0 + self.brightness * 6200.0,
            4.5 + self.brightness * 3.0,
        );
    }

    pub fn set_decay(&mut self, value: f32) {
        self.env.set_decay_time(expo_map(value, 0.3, 2.5));
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn set_metal(&mut self, value: f32) {
        self.metal = value.clamp(0.0, 1.0);
    }

    pub fn trigger(&mut self, _vel: f32) {
        self.env.trigger();
        self.bp1.reset();
        self.bp2.reset();
        self.bp3.reset();
        self.metal_band.reset();
    }

    pub fn process(&mut self) -> f32 {
        if !self.env.is_active() {
            return 0.0;
        }
        let raw = self.noise.process();
        let mut sample = self.bp1.process(raw);
        sample = self.bp2.process(sample);
        sample = self.bp3.process(sample);
        if self.metal > 0.0 {
            let m = self.metal * self.metal;
            let bright = raw * raw.abs();
            let shimmer = self.metal_band.process(raw * 1.8 + bright * 1.4);
            sample = sample * (1.0 - m * 0.65) + tanh(shimmer * 3.2) * (1.45 * m);
        }
        sample = self.soft_clipper.process(sample);
        sample *= self.env.process();
        sample * 0.5 * self.level
    }


    pub fn reset(&mut self) {
        self.env.reset();
        self.bp1.reset();
        self.bp2.reset();
        self.bp3.reset();
        self.metal_band.reset();
    }
}
