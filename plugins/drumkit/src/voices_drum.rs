// plugins/drumkit/src/voices_drum.rs
//
// The membrane voices: kick, snare, clap and tom. Each is a direct port of
// its downspout counterpart, keeping the module topology, the parameter
// mappings and the per-sample order of operations, with the shared math
// approximations standing in for libm.

use crate::biquad::{Biquad, BiquadType};
use crate::envelope::{AdEnvelope, PitchEnvelope};
use crate::math::{expo_map, kick_pitch_to_hz, sin, tanh};
use crate::bus::DcBlocker;
use crate::bus::Distortion;
use crate::noise::Noise;

const TAU: f32 = 6.28318530718;

// The kick: pitch-swept sine with a pink transient, distortion, a
// highpassed noise punch early in the attack, and DC removal.
pub struct Kick {
    sample_rate: f32,
    pitch_env: PitchEnvelope,
    amp_env: AdEnvelope,
    distortion: Distortion,
    dc_blocker: DcBlocker,
    noise: Noise,
    click_filter: Biquad,
    phase: f32,
    pitch_end: f32,
    punch: f32,
    transient_amount: f32,
    transient_env: f32,
    transient_decay: f32,
    pink0: f32,
    pink1: f32,
    pink2: f32,
    level: f32,
    velocity: f32,
}

impl Kick {
    pub fn new(sample_rate: f32) -> Self {
        let mut voice = Kick {
            sample_rate,
            pitch_env: PitchEnvelope::new(sample_rate),
            amp_env: AdEnvelope::new(sample_rate),
            distortion: Distortion::new(),
            dc_blocker: DcBlocker::new(0.999),
            noise: Noise::new(987654321),
            click_filter: Biquad::new(sample_rate, BiquadType::Highpass),
            phase: 0.0,
            pitch_end: 40.0,
            punch: 0.15,
            transient_amount: 0.0,
            transient_env: 0.0,
            transient_decay: crate::math::exp(-1.0 / (sample_rate * 0.012)),
            pink0: 0.0,
            pink1: 0.0,
            pink2: 0.0,
            level: 1.0,
            velocity: 1.0,
        };
        voice.click_filter.set_parameters(8000.0, 0.707);
        voice.amp_env.set_attack_time(0.001);
        voice.amp_env.set_decay_time(0.3);
        voice.pitch_env.set_parameters(100.0, 40.0, 0.05);
        voice
    }

    pub fn set_pitch(&mut self, value: f32) {
        let start = kick_pitch_to_hz(value);
        self.pitch_env.set_start(start);
        self.pitch_env.set_end(self.pitch_end);
    }

    pub fn set_decay(&mut self, value: f32) {
        let decay = expo_map(value, 0.05, 1.5);
        self.amp_env.set_decay_time(decay);
        self.pitch_env.set_decay_time(decay * 0.2);
    }

    pub fn set_drive(&mut self, value: f32) {
        self.distortion.set_drive(1.0 + value * 9.0);
    }

    pub fn set_punch(&mut self, value: f32) {
        self.punch = value.clamp(0.0, 1.0);
    }

    pub fn set_transient(&mut self, value: f32) {
        self.transient_amount = value.clamp(0.0, 1.0);
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn trigger(&mut self, vel: f32) {
        self.velocity = vel.clamp(0.0, 1.0);
        self.phase = 0.0;
        self.pitch_env.trigger();
        self.amp_env.trigger();
        self.transient_env = 1.0;
        self.pink0 = 0.0;
        self.pink1 = 0.0;
        self.pink2 = 0.0;
        self.dc_blocker.reset();
    }

    fn pink(&mut self) -> f32 {
        let white = self.noise.process();
        self.pink0 = 0.99765 * self.pink0 + white * 0.0990460;
        self.pink1 = 0.96300 * self.pink1 + white * 0.2965164;
        self.pink2 = 0.57000 * self.pink2 + white * 1.0526913;
        (self.pink0 + self.pink1 + self.pink2 + white * 0.1848) * 0.16
    }

    pub fn process(&mut self) -> f32 {
        if !self.amp_env.is_active() {
            return 0.0;
        }
        let freq = self.pitch_env.process();
        self.phase += TAU * freq / self.sample_rate;
        if self.phase >= TAU {
            self.phase -= TAU;
        }
        let mut sample = sin(self.phase);
        if self.transient_env > 0.0001 {
            if self.transient_amount > 0.001 {
                let transient =
                    self.pink() * self.transient_env * self.transient_amount * self.velocity;
                sample += transient * 0.65;
            }
            self.transient_env *= self.transient_decay;
        }
        sample = self.distortion.process(sample);
        if self.punch > 0.01 && self.amp_env.value() > 0.9 {
            let click = self.click_filter.process(self.noise.process());
            sample += click * self.punch * 0.3;
        }
        let env = self.amp_env.process();
        sample *= env * self.velocity;
        sample = self.dc_blocker.process(sample);
        sample * 0.8 * self.level
    }


    pub fn reset(&mut self) {
        self.amp_env.reset();
        self.pitch_env.reset();
        self.dc_blocker.reset();
        self.phase = 0.0;
        self.transient_env = 0.0;
        self.pink0 = 0.0;
        self.pink1 = 0.0;
        self.pink2 = 0.0;
    }
}

// The snare: body and shell resonators excited by noise, a highpassed snap
// burst, a short crack band, and an optional inharmonic metal ping.
pub struct Snare {
    sample_rate: f32,
    body: Biquad,
    shell: Biquad,
    noise_filter: Biquad,
    crack: Biquad,
    metal_res: Biquad,
    noise: Noise,
    amp_env: AdEnvelope,
    noise_env: AdEnvelope,
    crack_env: AdEnvelope,
    tone: f32,
    snap: f32,
    metal: f32,
    level: f32,
    velocity: f32,
}

impl Snare {
    pub fn new(sample_rate: f32) -> Self {
        let mut voice = Snare {
            sample_rate,
            body: Biquad::new(sample_rate, BiquadType::Bandpass),
            shell: Biquad::new(sample_rate, BiquadType::Bandpass),
            noise_filter: Biquad::new(sample_rate, BiquadType::Highpass),
            crack: Biquad::new(sample_rate, BiquadType::Bandpass),
            metal_res: Biquad::new(sample_rate, BiquadType::Bandpass),
            noise: Noise::new(111222333),
            amp_env: AdEnvelope::new(sample_rate),
            noise_env: AdEnvelope::new(sample_rate),
            crack_env: AdEnvelope::new(sample_rate),
            tone: 0.5,
            snap: 0.6,
            metal: 0.0,
            level: 1.0,
            velocity: 1.0,
        };
        voice.body.set_parameters(185.0, 8.0);
        voice.shell.set_parameters(360.0, 9.0);
        voice.crack.set_parameters(2200.0, 1.8);
        voice.metal_res.set_parameters(4200.0, 7.0);
        voice.noise_filter.set_parameters(2200.0, 0.85);
        voice.amp_env.set_attack_time(0.0004);
        voice.amp_env.set_decay_time(0.17);
        voice.noise_env.set_attack_time(0.0001);
        voice.noise_env.set_decay_time(0.12);
        voice.crack_env.set_attack_time(0.0001);
        voice.crack_env.set_decay_time(0.032);
        voice
    }

    pub fn set_tone(&mut self, value: f32) {
        self.tone = value.clamp(0.0, 1.0);
        let body_freq = 165.0 + self.tone * 65.0;
        let shell_freq = 300.0 + self.tone * 140.0;
        let crack_freq = 1500.0 + self.tone * 2200.0;
        self.body.set_parameters(body_freq, 4.5 + self.tone * 8.0);
        self.shell.set_parameters(shell_freq, 6.0 + self.tone * 10.0);
        self.crack.set_parameters(crack_freq, 1.3 + self.tone * 1.4);
        self.metal_res.set_parameters(
            (crack_freq * 1.72).min(self.sample_rate * 0.43),
            7.0 + self.tone * 3.0,
        );
    }

    pub fn set_snap(&mut self, value: f32) {
        self.snap = value.clamp(0.0, 1.0);
        let cutoff = expo_map(self.snap, 700.0, 6500.0);
        self.noise_filter.set_parameters(cutoff, 0.75 + self.snap * 0.45);
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn set_metal(&mut self, value: f32) {
        self.metal = value.clamp(0.0, 1.0);
    }

    pub fn trigger(&mut self, vel: f32) {
        self.velocity = vel.clamp(0.0, 1.0);
        self.amp_env.trigger();
        self.noise_env.trigger();
        self.crack_env.trigger();
        self.body.reset();
        self.shell.reset();
        self.noise_filter.reset();
        self.crack.reset();
        self.metal_res.reset();
    }

    pub fn process(&mut self) -> f32 {
        if !self.amp_env.is_active() && !self.noise_env.is_active() && !self.crack_env.is_active() {
            return 0.0;
        }
        let body_env = self.amp_env.process();
        let noise_amt = 0.32 + self.snap * 0.88;
        let raw_noise = self.noise.process();
        let excite = raw_noise * (0.65 + 0.18 * self.velocity);
        let body_out = self.body.process(excite);
        let shell_out = self.shell.process(excite * 0.92);
        let tonal = (body_out * (1.0 - self.tone) + shell_out * self.tone) * body_env;
        let filtered = self.noise_filter.process(raw_noise);
        let noise_out = filtered * self.noise_env.process() * noise_amt;
        let crack_value = self.crack_env.process();
        let crack = self
            .crack
            .process(filtered * (0.9 + self.snap * 0.5))
            * crack_value;
        let mut sample = tonal * 0.95 + noise_out * 0.72 + crack * 0.58;
        if self.metal > 0.0 {
            let m = self.metal * self.metal;
            let metal = self
                .metal_res
                .process(filtered * 2.2 + excite * 0.9)
                * (crack_value + body_env * 0.35);
            sample = sample * (1.0 - m * 0.58) + tanh(metal * 3.8) * (1.7 * m);
        }
        sample = tanh(sample * (1.15 + self.snap * 0.55 + self.metal * 0.85));
        sample *= self.velocity;
        sample * 0.72 * self.level
    }


    pub fn reset(&mut self) {
        self.amp_env.reset();
        self.noise_env.reset();
        self.crack_env.reset();
        self.body.reset();
        self.shell.reset();
        self.noise_filter.reset();
        self.crack.reset();
        self.metal_res.reset();
    }
}

// The clap: a burst of bandpassed noise impulses with a metallic bite on top.
pub struct Clap {
    sample_rate: f32,
    noise: Noise,
    bandpass: Biquad,
    metal_band: Biquad,
    env: AdEnvelope,
    density: f32,
    metal: f32,
    level: f32,
    impulse_count: i32,
    current_impulse: i32,
    samples_until_next: i32,
    impulse_spacing: i32,
    burst_length: i32,
    burst_samples: i32,
}

impl Clap {
    pub fn new(sample_rate: f32) -> Self {
        let mut voice = Clap {
            sample_rate,
            noise: Noise::new(444555666),
            bandpass: Biquad::new(sample_rate, BiquadType::Bandpass),
            metal_band: Biquad::new(sample_rate, BiquadType::Bandpass),
            env: AdEnvelope::new(sample_rate),
            density: 0.55,
            metal: 0.0,
            level: 1.0,
            impulse_count: 5,
            current_impulse: 0,
            samples_until_next: 0,
            impulse_spacing: 480,
            burst_length: 240,
            burst_samples: 0,
        };
        voice.bandpass.set_parameters(1500.0, 6.0);
        voice.metal_band.set_parameters(3600.0, 8.0);
        voice.env.set_attack_time(0.001);
        voice.env.set_decay_time(0.3);
        voice
    }

    pub fn set_density(&mut self, value: f32) {
        self.density = value.clamp(0.0, 1.0);
        self.impulse_count = (3.0 + self.density * 4.0) as i32;
        self.impulse_spacing = (self.sample_rate * (0.025 - self.density * 0.015)) as i32;
        self.burst_length = (self.sample_rate * (0.003 + self.density * 0.004)) as i32;
    }

    pub fn set_tone(&mut self, value: f32) {
        let tone = value.clamp(0.0, 1.0);
        let freq = expo_map(tone, 1000.0, 4500.0);
        self.bandpass.set_parameters(freq, 4.0 + tone * 4.0);
        self.metal_band.set_parameters(
            (freq * 2.35).min(self.sample_rate * 0.43),
            8.0 + tone * 4.0,
        );
    }

    pub fn set_metal(&mut self, value: f32) {
        self.metal = value.clamp(0.0, 1.0);
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn trigger(&mut self, _vel: f32) {
        self.current_impulse = 0;
        self.samples_until_next = 0;
        self.burst_samples = 0;
        self.env.trigger();
        self.bandpass.reset();
        self.metal_band.reset();
    }

    pub fn process(&mut self) -> f32 {
        if !self.env.is_active() {
            return 0.0;
        }
        let mut sample = 0.0;
        if self.current_impulse < self.impulse_count {
            if self.burst_samples > 0 {
                sample = self.noise.process() * 1.2;
                self.burst_samples -= 1;
            } else if self.samples_until_next <= 0 {
                sample = self.noise.process() * 1.2;
                self.burst_samples = self.burst_length;
                self.current_impulse += 1;
                self.samples_until_next = self.impulse_spacing;
            } else {
                self.samples_until_next -= 1;
            }
        }
        let raw = sample;
        sample = self.bandpass.process(raw);
        if self.metal > 0.0 {
            let m = self.metal * self.metal;
            let bite = raw * raw.abs();
            let ping = self.metal_band.process(raw * 1.8 + bite * 1.2);
            sample = sample * (1.0 - m * 0.72) + tanh(ping * 4.2) * (1.55 * m);
        }
        sample *= self.env.process();
        sample * 0.8 * self.level
    }


    pub fn reset(&mut self) {
        self.env.reset();
        self.bandpass.reset();
        self.metal_band.reset();
    }
}

// The tom: a pitch-swept sine/triangle body with a resonant knock and an
// optional metallic clang. One struct serves both toms; the base frequency
// is what makes one low and the other high.
pub struct Tom {
    sample_rate: f32,
    pitch_env: PitchEnvelope,
    amp_env: AdEnvelope,
    attack_env: AdEnvelope,
    body: Biquad,
    knock: Biquad,
    metal_res: Biquad,
    noise: Noise,
    phase: f32,
    base_pitch: f32,
    pitch_param: f32,
    metal: f32,
    velocity: f32,
    level: f32,
}

impl Tom {
    pub fn new(sample_rate: f32, base_freq: f32) -> Self {
        let mut voice = Tom {
            sample_rate,
            pitch_env: PitchEnvelope::new(sample_rate),
            amp_env: AdEnvelope::new(sample_rate),
            attack_env: AdEnvelope::new(sample_rate),
            body: Biquad::new(sample_rate, BiquadType::Bandpass),
            knock: Biquad::new(sample_rate, BiquadType::Bandpass),
            metal_res: Biquad::new(sample_rate, BiquadType::Bandpass),
            noise: Noise::new(777888999),
            phase: 0.0,
            base_pitch: base_freq,
            pitch_param: 0.0,
            metal: 0.0,
            velocity: 1.0,
            level: 1.0,
        };
        voice.body.set_parameters(base_freq, 10.0);
        voice.knock.set_parameters(2200.0, 2.4);
        voice
            .metal_res
            .set_parameters((base_freq * 7.4).clamp(700.0, 7200.0), 6.0);
        voice.amp_env.set_attack_time(0.0003);
        voice.amp_env.set_decay_time(0.24);
        voice.attack_env.set_attack_time(0.0001);
        voice.attack_env.set_decay_time(0.022);
        voice
    }

    pub fn set_pitch(&mut self, value: f32) {
        self.pitch_param = value.clamp(0.0, 1.0);
        let start = self.base_pitch * (1.55 + value * 0.65);
        let end = self.base_pitch * (0.86 + value * 0.12);
        self.pitch_env.set_parameters(start, end, 0.09);
        self.metal_res.set_parameters(
            (self.base_pitch * (6.4 + self.pitch_param * 5.8)).clamp(700.0, 7600.0),
            6.0 + self.pitch_param * 2.5,
        );
    }

    pub fn set_decay(&mut self, value: f32) {
        self.amp_env.set_decay_time(expo_map(value, 0.08, 0.8));
    }

    pub fn set_level(&mut self, value: f32) {
        self.level = value.clamp(0.0, 1.5);
    }

    pub fn set_metal(&mut self, value: f32) {
        self.metal = value.clamp(0.0, 1.0);
    }

    pub fn trigger(&mut self, vel: f32) {
        self.velocity = vel.clamp(0.0, 1.0);
        self.phase = 0.0;
        self.pitch_env.trigger();
        self.amp_env.trigger();
        self.attack_env.trigger();
        self.body.reset();
        self.knock.reset();
        self.metal_res.reset();
    }

    pub fn process(&mut self) -> f32 {
        if !self.amp_env.is_active() {
            return 0.0;
        }
        let freq = self.pitch_env.process();
        let amp = self.amp_env.process();
        let attack = self.attack_env.process();
        self.phase += freq / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        let sine = sin(TAU * self.phase);
        let triangle = if self.phase < 0.5 {
            4.0 * self.phase - 1.0
        } else {
            3.0 - 4.0 * self.phase
        };
        let excite = sine * 0.78 + triangle * 0.22 + self.noise.process() * 0.04;
        self.body.set_parameters(freq, 8.0 + self.velocity * 5.0);
        let body = self.body.process(excite);
        let knock_freq = (freq * 8.5).clamp(1400.0, 4200.0);
        self.knock.set_parameters(knock_freq, 1.7 + self.velocity * 1.4);
        let attack_noise = self.noise.process();
        let knock_excite = attack_noise * (0.55 + 0.35 * self.velocity) + triangle * 0.25;
        let knock = self.knock.process(knock_excite) * attack;
        let mut sample = body * (0.95 + 0.12 * self.velocity) + knock * 0.44;
        if self.metal > 0.0 {
            let m = self.metal * self.metal;
            let clang_env = attack + amp * 0.48;
            let clang = self
                .metal_res
                .process(attack_noise * 1.6 + triangle * 1.05 + sine * 0.35)
                * clang_env;
            sample = sample * (1.0 - m * 0.62) + tanh(clang * 3.4) * (1.65 * m);
        }
        sample = tanh(sample * (1.45 + self.metal * 0.75));
        sample *= amp * self.velocity;
        sample * 0.52 * self.level
    }


    pub fn reset(&mut self) {
        self.amp_env.reset();
        self.attack_env.reset();
        self.pitch_env.reset();
        self.body.reset();
        self.knock.reset();
        self.metal_res.reset();
        self.phase = 0.0;
    }
}
