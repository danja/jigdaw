// plugins/drumkit/src/envelope.rs
//
// The two envelopes every voice is built from, ported straight from
// downspout: a linear attack/decay amplitude envelope, and an exponential
// pitch sweep evaluated per sample by the shared pow approximation.

use crate::math::pow;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Attack,
    Decay,
}

#[derive(Clone, Copy)]
pub struct AdEnvelope {
    sample_rate: f32,
    attack_samples: f32,
    decay_samples: f32,
    value: f32,
    counter: f32,
    active: bool,
    phase: Phase,
}

impl AdEnvelope {
    pub fn new(sample_rate: f32) -> Self {
        AdEnvelope {
            sample_rate,
            attack_samples: (0.001 * sample_rate).max(1.0),
            decay_samples: (0.1 * sample_rate).max(1.0),
            value: 0.0,
            counter: 0.0,
            active: false,
            phase: Phase::Idle,
        }
    }

    pub fn set_attack_time(&mut self, seconds: f32) {
        self.attack_samples = (seconds * self.sample_rate).max(1.0);
    }

    pub fn set_decay_time(&mut self, seconds: f32) {
        self.decay_samples = (seconds * self.sample_rate).max(1.0);
    }

    pub fn trigger(&mut self) {
        self.phase = Phase::Attack;
        self.counter = 0.0;
        self.value = 0.0;
        self.active = true;
    }

    pub fn reset(&mut self) {
        self.phase = Phase::Idle;
        self.value = 0.0;
        self.counter = 0.0;
        self.active = false;
    }

    pub fn process(&mut self) -> f32 {
        if !self.active {
            return 0.0;
        }
        match self.phase {
            Phase::Attack => {
                self.value = self.counter / self.attack_samples;
                self.counter += 1.0;
                if self.counter >= self.attack_samples {
                    self.phase = Phase::Decay;
                    self.counter = 0.0;
                    self.value = 1.0;
                }
            }
            Phase::Decay => {
                self.value = 1.0 - self.counter / self.decay_samples;
                self.counter += 1.0;
                if self.value <= 0.0 || self.counter >= self.decay_samples {
                    self.value = 0.0;
                    self.phase = Phase::Idle;
                    self.active = false;
                }
            }
            Phase::Idle => {
                self.value = 0.0;
                self.active = false;
            }
        }
        self.value.clamp(0.0, 1.0)
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn value(&self) -> f32 {
        self.value
    }
}

#[derive(Clone, Copy)]
pub struct PitchEnvelope {
    sample_rate: f32,
    start_freq: f32,
    end_freq: f32,
    decay_time: f32,
    current: f32,
    counter: f32,
    active: bool,
}

impl PitchEnvelope {
    pub fn new(sample_rate: f32) -> Self {
        PitchEnvelope {
            sample_rate,
            start_freq: 150.0,
            end_freq: 40.0,
            decay_time: 0.2,
            current: 40.0,
            counter: 0.0,
            active: false,
        }
    }

    pub fn set_parameters(&mut self, start: f32, end: f32, decay: f32) {
        self.start_freq = start.max(10.0);
        self.end_freq = end.max(10.0);
        self.decay_time = decay.max(0.001);
    }

    pub fn set_start(&mut self, freq: f32) {
        self.start_freq = freq.max(10.0);
    }

    pub fn set_end(&mut self, freq: f32) {
        self.end_freq = freq.max(10.0);
    }

    pub fn set_decay_time(&mut self, seconds: f32) {
        self.decay_time = seconds.max(0.001);
    }

    pub fn trigger(&mut self) {
        self.counter = 0.0;
        self.current = self.start_freq;
        self.active = true;
    }

    pub fn reset(&mut self) {
        self.counter = 0.0;
        self.current = self.end_freq;
        self.active = false;
    }

    pub fn process(&mut self) -> f32 {
        if !self.active {
            return self.end_freq;
        }
        let decay_samples = self.decay_time * self.sample_rate;
        let t = self.counter / decay_samples;
        if t >= 1.0 {
            self.current = self.end_freq;
            self.active = false;
        } else {
            let ratio = self.start_freq / self.end_freq;
            self.current = self.end_freq * pow(ratio, 1.0 - t);
        }
        self.counter += 1.0;
        self.current
    }
}
