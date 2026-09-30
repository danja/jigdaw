// plugins/canticle/src/params.rs
//
// The 16 host parameters in ParamId order, with the downspout defaults.
// Model, Articulation, Register and Ensemble are integer choices with the
// wrapper's own name tables; the rest are unit dials.

pub const PARAM_COUNT: usize = 16;

pub const MODEL: usize = 0;
pub const TONE: usize = 1;
pub const BODY: usize = 2;
pub const MOVEMENT: usize = 3;
pub const ATTACK: usize = 4;
pub const DECAY: usize = 5;
pub const SUSTAIN: usize = 6;
pub const RELEASE: usize = 7;
pub const DETUNE: usize = 8;
pub const WIDTH: usize = 9;
pub const DRIVE: usize = 10;
pub const OUTPUT: usize = 11;
pub const METAL: usize = 12;
pub const ARTICULATION: usize = 13;
pub const RANGE: usize = 14;
pub const ENSEMBLE: usize = 15;

pub struct ParamSpec {
    pub minimum: f32,
    pub maximum: f32,
    pub default: f32,
    pub integer: bool,
}

pub const SPECS: [ParamSpec; PARAM_COUNT] = [
    ParamSpec { minimum: 0.0, maximum: 4.0, default: 0.0, integer: true }, // model
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.52, integer: false }, // tone
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.58, integer: false }, // body
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.20, integer: false }, // movement
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.10, integer: false }, // attack
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.34, integer: false }, // decay
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.78, integer: false }, // sustain
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.42, integer: false }, // release
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.18, integer: false }, // detune
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.62, integer: false }, // width
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.10, integer: false }, // drive
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.68, integer: false }, // output
    ParamSpec { minimum: 0.0, maximum: 1.0, default: 0.0, integer: false }, // metal
    ParamSpec { minimum: 0.0, maximum: 3.0, default: 0.0, integer: true }, // articulation
    ParamSpec { minimum: 0.0, maximum: 3.0, default: 0.0, integer: true }, // range
    ParamSpec { minimum: 0.0, maximum: 3.0, default: 0.0, integer: true }, // ensemble
];

/// Clamp a host value the way the DPF wrapper does: non-finite falls back
/// to the default, integers round.
pub fn clamp_param(index: usize, value: f32) -> f32 {
    let spec = &SPECS[index.min(PARAM_COUNT - 1)];
    let mut v = if value.is_finite() { value } else { spec.default };
    v = v.clamp(spec.minimum, spec.maximum);
    if spec.integer {
        v = (v + 0.5) as i32 as f32;
    }
    v
}

pub fn default_params() -> [f32; PARAM_COUNT] {
    let mut out = [0.0; PARAM_COUNT];
    let mut i = 0;
    while i < PARAM_COUNT {
        out[i] = SPECS[i].default;
        i += 1;
    }
    out
}
