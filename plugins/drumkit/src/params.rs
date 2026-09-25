// plugins/drumkit/src/params.rs
//
// The 75 input parameters, in downspout order: 43 synthesis and master
// controls, 11 mutes, 10 transient/metal amounts, and 11 pans. The 11 trig
// outputs the DPF wrapper exposes as UI LEDs are not here: a JigDAW profile
// cannot carry an output parameter, and the generated panel has nothing to
// show one on. The note map and the per-instrument mute and pan indices live
// here too, so the engine and the profile read the same table.

pub const COUNT: usize = 75;

pub struct Spec {
    // symbol and name are read by profile.json and the processor rather than
    // by this module: they are what binds the three lists together, checked
    // by tests/host/drumkit.test.js against the profile's ports.
    #[allow(dead_code)]
    pub symbol: &'static str,
    #[allow(dead_code)]
    pub name: &'static str,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    pub toggled: bool,
}

pub const SPECS: [Spec; COUNT] = [
    Spec { symbol: "kick_pitch", name: "Kick Pitch", min: 0.0, max: 1.0, default: 0.35, toggled: false },
    Spec { symbol: "kick_decay", name: "Kick Decay", min: 0.0, max: 1.0, default: 0.4, toggled: false },
    Spec { symbol: "kick_drive", name: "Kick Drive", min: 0.0, max: 1.0, default: 0.3, toggled: false },
    Spec { symbol: "kick_punch", name: "Kick Punch", min: 0.0, max: 1.0, default: 0.15, toggled: false },
    Spec { symbol: "kick_level", name: "Kick Level", min: 0.0, max: 1.5, default: 1.0, toggled: false },
    Spec { symbol: "snare_tone", name: "Snare Tone", min: 0.0, max: 1.0, default: 0.5, toggled: false },
    Spec { symbol: "snare_snap", name: "Snare Snap", min: 0.0, max: 1.0, default: 0.6, toggled: false },
    Spec { symbol: "snare_level", name: "Snare Level", min: 0.0, max: 1.5, default: 1.05, toggled: false },
    Spec { symbol: "clap_density", name: "Clap Density", min: 0.0, max: 1.0, default: 0.55, toggled: false },
    Spec { symbol: "clap_tone", name: "Clap Tone", min: 0.0, max: 1.0, default: 0.45, toggled: false },
    Spec { symbol: "clap_level", name: "Clap Level", min: 0.0, max: 1.5, default: 1.0, toggled: false },
    Spec { symbol: "tom1_pitch", name: "Tom 1 Pitch", min: 0.0, max: 1.0, default: 0.4, toggled: false },
    Spec { symbol: "tom1_decay", name: "Tom 1 Decay", min: 0.0, max: 1.0, default: 0.45, toggled: false },
    Spec { symbol: "tom1_level", name: "Tom 1 Level", min: 0.0, max: 1.5, default: 0.74, toggled: false },
    Spec { symbol: "tom2_pitch", name: "Tom 2 Pitch", min: 0.0, max: 1.0, default: 0.55, toggled: false },
    Spec { symbol: "tom2_decay", name: "Tom 2 Decay", min: 0.0, max: 1.0, default: 0.45, toggled: false },
    Spec { symbol: "tom2_level", name: "Tom 2 Level", min: 0.0, max: 1.5, default: 0.72, toggled: false },
    Spec { symbol: "hh_closed_brightness", name: "Closed HH Brightness", min: 0.0, max: 1.0, default: 0.6, toggled: false },
    Spec { symbol: "hh_closed_decay", name: "Closed HH Decay", min: 0.0, max: 1.0, default: 0.3, toggled: false },
    Spec { symbol: "hh_closed_level", name: "Closed HH Level", min: 0.0, max: 1.5, default: 1.05, toggled: false },
    Spec { symbol: "hh_open_brightness", name: "Open HH Brightness", min: 0.0, max: 1.0, default: 0.7, toggled: false },
    Spec { symbol: "hh_open_decay", name: "Open HH Decay", min: 0.0, max: 1.0, default: 0.55, toggled: false },
    Spec { symbol: "hh_open_level", name: "Open HH Level", min: 0.0, max: 1.5, default: 1.02, toggled: false },
    Spec { symbol: "crash_brightness", name: "Crash Brightness", min: 0.0, max: 1.0, default: 0.65, toggled: false },
    Spec { symbol: "crash_decay", name: "Crash Decay", min: 0.0, max: 1.0, default: 0.5, toggled: false },
    Spec { symbol: "crash_level", name: "Crash Level", min: 0.0, max: 1.5, default: 1.0, toggled: false },
    Spec { symbol: "cowbell_tone", name: "Cowbell Tone", min: 0.0, max: 1.0, default: 0.45, toggled: false },
    Spec { symbol: "cowbell_decay", name: "Cowbell Decay", min: 0.0, max: 1.0, default: 0.35, toggled: false },
    Spec { symbol: "cowbell_level", name: "Cowbell Level", min: 0.0, max: 1.5, default: 1.0, toggled: false },
    Spec { symbol: "clave_tone", name: "Clave Tone", min: 0.0, max: 1.0, default: 0.5, toggled: false },
    Spec { symbol: "clave_decay", name: "Clave Decay", min: 0.0, max: 1.0, default: 0.25, toggled: false },
    Spec { symbol: "clave_level", name: "Clave Level", min: 0.0, max: 1.5, default: 1.0, toggled: false },
    Spec { symbol: "bash_size", name: "Bash Size", min: 0.0, max: 1.0, default: 0.45, toggled: false },
    Spec { symbol: "bash_spread", name: "Bash Spread", min: 0.0, max: 1.0, default: 0.55, toggled: false },
    Spec { symbol: "bash_decay", name: "Bash Decay", min: 0.0, max: 1.0, default: 0.7, toggled: false },
    Spec { symbol: "bash_drive", name: "Bash Drive", min: 0.0, max: 1.0, default: 0.65, toggled: false },
    Spec { symbol: "bash_noise", name: "Bash Noise", min: 0.0, max: 1.0, default: 0.6, toggled: false },
    Spec { symbol: "bash_edge", name: "Bash Edge", min: 0.0, max: 1.0, default: 0.7, toggled: false },
    Spec { symbol: "bash_level", name: "Bash Level", min: 0.0, max: 1.5, default: 1.0, toggled: false },
    Spec { symbol: "bit_crush", name: "Bit Crush", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "master_drive", name: "Master Drive", min: 0.0, max: 1.0, default: 0.25, toggled: false },
    Spec { symbol: "master_reverb", name: "Master Reverb", min: 0.0, max: 1.0, default: 0.2, toggled: false },
    Spec { symbol: "master_gain", name: "Master Gain", min: 0.0, max: 1.0, default: 0.7, toggled: false },
    Spec { symbol: "kick_mute", name: "Kick Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "clap_mute", name: "Clap Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "snare_mute", name: "Snare Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "crash_mute", name: "Crash Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "hh_closed_mute", name: "Closed HH Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "tom1_mute", name: "Tom 1 Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "hh_open_mute", name: "Open HH Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "tom2_mute", name: "Tom 2 Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "bash_mute", name: "Bash Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "cowbell_mute", name: "Cowbell Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "clave_mute", name: "Clave Mute", min: 0.0, max: 1.0, default: 0.0, toggled: true },
    Spec { symbol: "kick_transient", name: "Kick Transient", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "clap_metal", name: "Clap Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "snare_metal", name: "Snare Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "crash_metal", name: "Crash Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "hh_closed_metal", name: "Closed HH Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "tom1_metal", name: "Tom 1 Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "hh_open_metal", name: "Open HH Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "tom2_metal", name: "Tom 2 Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "cowbell_metal", name: "Cowbell Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "clave_metal", name: "Clave Metal", min: 0.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "kick_pan", name: "Kick Pan", min: -1.0, max: 1.0, default: 0.0, toggled: false },
    Spec { symbol: "clap_pan", name: "Clap Pan", min: -1.0, max: 1.0, default: 0.16, toggled: false },
    Spec { symbol: "snare_pan", name: "Snare Pan", min: -1.0, max: 1.0, default: -0.08, toggled: false },
    Spec { symbol: "crash_pan", name: "Crash Pan", min: -1.0, max: 1.0, default: -0.44, toggled: false },
    Spec { symbol: "hh_closed_pan", name: "Closed HH Pan", min: -1.0, max: 1.0, default: -0.52, toggled: false },
    Spec { symbol: "tom1_pan", name: "Tom 1 Pan", min: -1.0, max: 1.0, default: 0.22, toggled: false },
    Spec { symbol: "hh_open_pan", name: "Open HH Pan", min: -1.0, max: 1.0, default: 0.32, toggled: false },
    Spec { symbol: "tom2_pan", name: "Tom 2 Pan", min: -1.0, max: 1.0, default: -0.16, toggled: false },
    Spec { symbol: "bash_pan", name: "Bash Pan", min: -1.0, max: 1.0, default: 0.42, toggled: false },
    Spec { symbol: "cowbell_pan", name: "Cowbell Pan", min: -1.0, max: 1.0, default: 0.14, toggled: false },
    Spec { symbol: "clave_pan", name: "Clave Pan", min: -1.0, max: 1.0, default: -0.24, toggled: false },
];

pub const KICK: usize = 0;
pub const CLAP: usize = 1;
pub const SNARE: usize = 2;
pub const CRASH: usize = 3;
pub const CLOSED_HH: usize = 4;
pub const TOM1: usize = 5;
pub const OPEN_HH: usize = 6;
pub const TOM2: usize = 7;
pub const BASH: usize = 8;
pub const COWBELL: usize = 9;
pub const CLAVE: usize = 10;
pub const INSTRUMENTS: usize = 11;

// The MIDI note each instrument answers to, in instrument order.
pub const NOTES: [u8; INSTRUMENTS] = [36, 39, 40, 41, 42, 45, 46, 50, 51, 52, 53];

// The mute parameter for each instrument, in instrument order.
pub const MUTES: [usize; INSTRUMENTS] = [43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53];

// The pan parameter for each instrument, in instrument order.
pub const PANS: [usize; INSTRUMENTS] = [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74];
