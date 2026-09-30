// plugins/canticle/src/voice.rs
//
// One canticle voice, ported from downspout's canticle_engine.cpp: three
// detuned oscillators (sine, triangle, soft saw) plus a sub-octave sine
// through one model profile, body resonance and a metal edge of inharmonic
// partials, a one-pole lowpass, a tanh-bounded drive stage, an ADSR
// envelope and an equal-power pan.
//
// Two structural deltas from the C++, both from the no-libm rule. The
// envelope times, the detune ratio and the filter coefficient are derived
// on note and parameter changes rather than per sample: the C++ already
// derives everything but the coefficient that way, and the coefficient only
// moves when the cutoff does, so it is cached against it. The sine, tanh,
// exp and sqrt calls evaluate the approximations in dsp.rs.

use crate::dsp::{
    detune_ratio, exp_map, note_frequency, one_pole_coeff, sin_phase, sqrt_approx, tanh_approx,
    LN_ATTACK_RATIO, LN_DECAY_RATIO, LN_RELEASE_RATIO,
};
use crate::params::{
    ARTICULATION, ATTACK, BODY, DECAY, DETUNE, DRIVE, ENSEMBLE, METAL, MODEL, MOVEMENT, OUTPUT,
    RANGE, RELEASE, SUSTAIN, TONE, WIDTH,
};

pub const MAX_VOICES: usize = 12;
const OUTPUT_GAIN: f32 = 3.0;

#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Idle,
    Attack,
    Decay,
    Release,
}

fn param_choice(params: &[f32; 16], index: usize, max: i32) -> i32 {
    ((params[index] + 0.5) as i32).clamp(0, max)
}

fn floor_i(v: f32) -> i32 {
    let t = v as i32;
    if v < 0.0 && (t as f32) != v { t - 1 } else { t }
}

struct ModelProfile {
    sine_mix: f32,
    tri_mix: f32,
    saw_mix: f32,
    octave_mix: f32,
    cutoff_base: f32,
    cutoff_range: f32,
    body_scale: f32,
    attack_bias: f32,
    decay_bias: f32,
    sustain_bias: f32,
    release_bias: f32,
    movement_scale: f32,
    drive_scale: f32,
}

fn profile_for_model(model: i32) -> ModelProfile {
    match model.clamp(0, 4) {
        0 => ModelProfile {
            sine_mix: 0.22, tri_mix: 0.70, saw_mix: 0.10, octave_mix: 0.12,
            cutoff_base: 850.0, cutoff_range: 5600.0, body_scale: 0.34,
            attack_bias: 0.45, decay_bias: 0.75, sustain_bias: 0.78, release_bias: 0.75,
            movement_scale: 0.18, drive_scale: 0.55,
        },
        1 => ModelProfile {
            sine_mix: 0.12, tri_mix: 0.45, saw_mix: 0.42, octave_mix: 0.10,
            cutoff_base: 700.0, cutoff_range: 4200.0, body_scale: 0.48,
            attack_bias: 0.70, decay_bias: 1.10, sustain_bias: 0.92, release_bias: 0.82,
            movement_scale: 0.35, drive_scale: 0.70,
        },
        2 => ModelProfile {
            sine_mix: 0.45, tri_mix: 0.44, saw_mix: 0.12, octave_mix: 0.22,
            cutoff_base: 500.0, cutoff_range: 3000.0, body_scale: 0.62,
            attack_bias: 1.85, decay_bias: 1.50, sustain_bias: 1.00, release_bias: 1.75,
            movement_scale: 0.58, drive_scale: 0.38,
        },
        3 => ModelProfile {
            sine_mix: 0.18, tri_mix: 0.72, saw_mix: 0.24, octave_mix: 0.08,
            cutoff_base: 1200.0, cutoff_range: 7000.0, body_scale: 0.28,
            attack_bias: 0.18, decay_bias: 0.26, sustain_bias: 0.20, release_bias: 0.32,
            movement_scale: 0.10, drive_scale: 0.85,
        },
        _ => ModelProfile {
            sine_mix: 0.62, tri_mix: 0.22, saw_mix: 0.06, octave_mix: 0.34,
            cutoff_base: 1800.0, cutoff_range: 8800.0, body_scale: 0.30,
            attack_bias: 0.34, decay_bias: 1.35, sustain_bias: 0.52, release_bias: 1.18,
            movement_scale: 0.24, drive_scale: 0.30,
        },
    }
}

fn wrap01(mut phase: f32) -> f32 {
    phase -= (phase as i32) as f32;
    if phase < 0.0 {
        phase += 1.0;
    }
    phase
}

fn triangle(phase: f32) -> f32 {
    let shifted = phase + 0.5;
    4.0 * (shifted - (shifted as i32) as f32).abs() - 1.0
}

fn soft_saw(phase: f32) -> f32 {
    // floor, not truncation: the LFO term can push the argument negative,
    // and a truncated negative folds the wrong way.
    let saw = 2.0 * (phase - floor_i(phase + 0.5) as f32);
    tanh_approx(saw * 1.35)
}

fn sanitize(value: f32) -> f32 {
    if !value.is_finite() {
        return 0.0;
    }
    tanh_approx(value.clamp(-4.0, 4.0))
}

#[derive(Clone, Copy)]
pub struct Voice {
    sample_rate: f32,
    note: i32,
    velocity: f32,
    serial: u64,
    phase_a: f32,
    phase_b: f32,
    phase_c: f32,
    lfo_phase: f32,
    voice_frequency: f32,
    detune_ratio: f32,
    movement: f32,
    body: f32,
    metal: f32,
    drive: f32,
    cutoff: f32,
    pan_base: f32,
    open_range_boost: f32,
    sine_mix: f32,
    tri_mix: f32,
    saw_mix: f32,
    octave_mix: f32,
    body_scale: f32,
    attack_step: f32,
    decay_coeff: f32,
    sustain: f32,
    release_step: f32,
    filter_z: f32,
    filter_coeff: f32,
    filter_cutoff: f32,
    env_value: f32,
    env_active: bool,
    stage: Stage,
}

impl Voice {
    pub const fn new() -> Self {
        Voice {
            sample_rate: 44100.0, note: -1, velocity: 0.0, serial: 0,
            phase_a: 0.0, phase_b: 0.0, phase_c: 0.0, lfo_phase: 0.0,
            voice_frequency: 440.0, detune_ratio: 1.0, movement: 0.0, body: 0.0,
            metal: 0.0, drive: 0.0, cutoff: 1000.0, pan_base: 0.0, open_range_boost: 0.0,
            sine_mix: 0.30, tri_mix: 0.55, saw_mix: 0.18, octave_mix: 0.12, body_scale: 0.35,
            attack_step: 0.0, decay_coeff: 0.0, sustain: 0.7, release_step: 0.0,
            filter_z: 0.0, filter_coeff: 0.0, filter_cutoff: -1.0,
            env_value: 0.0, env_active: false, stage: Stage::Idle,
        }
    }

    pub fn set_sample_rate(&mut self, rate: f32, params: &[f32; 16]) {
        self.sample_rate = rate.max(1000.0);
        self.parameters_changed(params);
    }

    pub fn reset(&mut self) {
        let rate = self.sample_rate;
        *self = Voice::new();
        self.sample_rate = rate;
    }

    pub fn active(&self) -> bool {
        self.env_active
    }

    pub fn releasing(&self) -> bool {
        self.stage == Stage::Release
    }

    pub fn note(&self) -> i32 {
        self.note
    }

    pub fn serial(&self) -> u64 {
        self.serial
    }

    pub fn start(&mut self, midi_note: i32, velocity: u8, params: &[f32; 16], serial: u64) {
        self.note = midi_note;
        self.velocity = (velocity as f32 / 127.0).clamp(0.0, 1.0);
        self.serial = serial;
        self.phase_a = wrap01(((midi_note * 17 + velocity as i32) % 127) as f32 / 127.0);
        self.phase_b = wrap01(self.phase_a + 0.31);
        self.phase_c = wrap01(self.phase_a + 0.61);
        self.lfo_phase = wrap01(((midi_note * 11) % 97) as f32 / 97.0);
        self.parameters_changed(params);
        self.stage = Stage::Attack;
        self.env_active = true;
        self.filter_z = 0.0;
        self.filter_cutoff = -1.0;
    }

    pub fn note_off(&mut self) {
        if self.env_active {
            self.stage = Stage::Release;
        }
    }

    pub fn parameters_changed(&mut self, params: &[f32; 16]) {
        let model = param_choice(params, MODEL, 4);
        let profile = profile_for_model(model);
        let range = param_choice(params, RANGE, 3);
        let ensemble = param_choice(params, ENSEMBLE, 3);
        let range_ratio = if range == 1 { 0.5 } else if range == 2 { 2.0 } else { 1.0 };
        let ensemble_detune = if ensemble == 0 { 0.65 } else if ensemble == 1 { 1.00 } else if ensemble == 2 { 1.55 } else { 2.10 };
        let ensemble_movement = if ensemble == 0 { 0.70 } else if ensemble == 1 { 1.00 } else if ensemble == 2 { 1.25 } else { 1.45 };
        let ensemble_width = if ensemble == 0 { -0.18 } else if ensemble == 1 { 0.0 } else if ensemble == 2 { 0.16 } else { 0.28 };

        let frequency = note_frequency(self.note.clamp(0, 127) as u8);
        self.voice_frequency = frequency * range_ratio;
        let detune_cents = (params[DETUNE] * 18.0 + 1.0) * ensemble_detune;
        self.detune_ratio = detune_ratio(detune_cents);
        self.movement = params[MOVEMENT] * profile.movement_scale * ensemble_movement;
        self.body = params[BODY];
        self.metal = params[METAL];
        let tone = params[TONE];
        self.drive = params[DRIVE] * profile.drive_scale + self.metal * 0.45;
        self.cutoff = profile.cutoff_base + profile.cutoff_range * tone * tone
            + (self.voice_frequency * (0.8 + self.body)).clamp(0.0, 3200.0)
            + self.metal * (2400.0 + tone * 3600.0);
        let width = (params[WIDTH] + ensemble_width).clamp(0.0, 1.0);
        self.pan_base = ((self.note * 37) % 101) as f32 / 100.0 - 0.5;
        self.pan_base = self.pan_base * 1.35 * width;
        self.open_range_boost = if range == 3 { 0.22 } else { 0.0 };
        self.sine_mix = profile.sine_mix;
        self.tri_mix = profile.tri_mix;
        self.saw_mix = profile.saw_mix;
        self.octave_mix = profile.octave_mix;
        self.body_scale = profile.body_scale;

        let (attack_bias, decay_bias, sustain_bias, release_bias) = match param_choice(params, ARTICULATION, 3) {
            1 => (0.45, 0.38, 0.45, 0.42),
            2 => (0.70, 1.20, 1.18, 1.25),
            3 => (1.80, 1.35, 0.95, 1.45),
            _ => (1.0, 1.0, 1.0, 1.0),
        };
        // Biases multiply the unit control, exactly as the C++ multiplies
        // before its own configureEnvelope; profile biases fold in here.
        let attack = (params[ATTACK] * attack_bias * profile.attack_bias).clamp(0.0, 1.0);
        let decay = (params[DECAY] * decay_bias * profile.decay_bias).clamp(0.0, 1.0);
        self.sustain = (params[SUSTAIN] * sustain_bias * profile.sustain_bias).clamp(0.0, 1.0);
        let release = (params[RELEASE] * release_bias * profile.release_bias).clamp(0.0, 1.0);
        let rate = self.sample_rate.max(1000.0);
        let attack_sec = exp_map(0.001, LN_ATTACK_RATIO, attack);
        let decay_sec = exp_map(0.020, LN_DECAY_RATIO, decay);
        let release_sec = exp_map(0.020, LN_RELEASE_RATIO, release);
        self.attack_step = 1.0 / (attack_sec * rate).max(1.0);
        self.decay_coeff = 1.0 / (decay_sec * rate).max(1.0);
        self.release_step = 1.0 / (release_sec * rate).max(1.0);
    }

    /// One stereo sample. Returns None when the voice went idle on it.
    pub fn process(&mut self) -> Option<(f32, f32)> {
        if !self.env_active {
            return None;
        }
        match self.stage {
            Stage::Idle => {
                self.env_value = 0.0;
            }
            Stage::Attack => {
                self.env_value += self.attack_step;
                if self.env_value >= 1.0 {
                    self.env_value = 1.0;
                    self.stage = Stage::Decay;
                }
            }
            Stage::Decay => {
                self.env_value += (self.sustain - self.env_value) * self.decay_coeff;
                if (self.env_value - self.sustain).abs() < 0.0004 {
                    self.env_value = self.sustain;
                }
            }
            Stage::Release => {
                self.env_value -= self.release_step;
                if self.env_value <= 0.0 {
                    self.env_value = 0.0;
                    self.env_active = false;
                    self.stage = Stage::Idle;
                }
            }
        }
        let env = if self.env_value.is_finite() { self.env_value.clamp(0.0, 1.0) } else { 0.0 };
        if !self.env_active {
            self.note = -1;
            return None;
        }

        let lfo = sin_phase(self.lfo_phase);
        self.lfo_phase = wrap01(self.lfo_phase + (0.08 + self.movement * 4.2) / self.sample_rate);

        let vibrato = 1.0 + lfo * self.movement * 0.0045;
        let inc_a = self.voice_frequency * vibrato / self.sample_rate;
        let inc_b = self.voice_frequency * self.detune_ratio * (1.0 - self.movement * 0.001) / self.sample_rate;
        let inc_c = self.voice_frequency * 2.0 * (1.0 + self.movement * 0.0015) / self.sample_rate;
        self.phase_a = wrap01(self.phase_a + inc_a);
        self.phase_b = wrap01(self.phase_b + inc_b);
        self.phase_c = wrap01(self.phase_c + inc_c);

        let raw = sin_phase(self.phase_a) * self.sine_mix
            + triangle(self.phase_b) * self.tri_mix
            + soft_saw(wrap01(self.phase_a + 0.15 * lfo)) * self.saw_mix
            + sin_phase(self.phase_c) * (self.octave_mix + self.open_range_boost);
        // The metal edge: inharmonic partials off all three phases.
        // Arguments stay non-negative: phases wrap at 1 and every
        // coefficient is positive, so sin_phase's domain holds.
        let metallic = sin_phase(self.phase_a * 2.997 + self.phase_b * 0.173) * 0.42
            + triangle(wrap01(self.phase_b * 4.011 + self.phase_c * 0.071)) * 0.26
            + soft_saw(wrap01(self.phase_c * 3.731 + self.phase_a * 0.113)) * 0.20;
        let body_tone = raw
            + self.body * self.body_scale * (sin_phase(self.phase_a * 0.5) + 0.35 * sin_phase(self.phase_c * 0.5))
            + self.metal * (0.16 + self.body * 0.28) * metallic;
        if self.cutoff != self.filter_cutoff {
            self.filter_coeff = one_pole_coeff(self.cutoff, self.sample_rate);
            self.filter_cutoff = self.cutoff;
        }
        self.filter_z += self.filter_coeff * (body_tone - self.filter_z);
        if !self.filter_z.is_finite() {
            self.filter_z = 0.0;
        }
        let shaped = sanitize(self.filter_z * (1.0 + self.drive * 3.5) + metallic * self.metal * 0.08);
        let amp = env * (0.18 + self.velocity * 0.82);
        let mono = sanitize(shaped * amp * 0.42);

        let pan = (self.pan_base + lfo * self.movement * 0.15).clamp(-0.88, 0.88);
        let left_gain = sqrt_approx(0.5 * (1.0 - pan));
        let right_gain = sqrt_approx(0.5 * (1.0 + pan));
        Some((mono * left_gain, mono * right_gain))
    }

    pub fn output_gain(params: &[f32; 16]) -> f32 {
        params[OUTPUT] * OUTPUT_GAIN
    }
}
