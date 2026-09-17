// plugins/pulse/src/lib.rs
//
// Pulse: an eight voice subtractive synthesiser, and the worked example of a
// JigDAW instrument. It accepts MIDI and produces audio, which makes it the
// plugin that exercises contract section 6 end to end.
//
// The same real-time rules as cascade apply and are visible the same way:
// no_std, no allocator, fixed voice array, no transcendental functions.
//
// No sine table and no sinf. The three waveforms here are computable from a
// phase accumulator with arithmetic alone, and pitch comes from a fixed table
// rather than from powf. A synth that needs libm on the audio thread has chosen
// to.

#![no_std]

use core::cell::UnsafeCell;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const VOICES: usize = 8;

/// Frequency of MIDI note n, for n in 0..128, as a quarter-semitone-accurate
/// table built from the twelve ratios within an octave. Avoids powf entirely.
const SEMITONE: [f32; 12] = [
    1.000000, 1.059463, 1.122462, 1.189207, 1.259921, 1.334840,
    1.414214, 1.498307, 1.587401, 1.681793, 1.781797, 1.887749,
];

#[inline]
fn note_frequency(note: u8) -> f32 {
    // A4 = note 69 = 440 Hz. Octave is a doubling, so the octave part is a
    // shift and only the twelve ratios need a table.
    let n = note as i32 - 69;
    let octave = n.div_euclid(12);
    let step = n.rem_euclid(12) as usize;
    let mut frequency = 440.0 * SEMITONE[step];
    let mut shifts = octave;
    while shifts > 0 { frequency *= 2.0; shifts -= 1; }
    while shifts < 0 { frequency *= 0.5; shifts += 1; }
    frequency
}

#[derive(Clone, Copy, PartialEq)]
enum Stage { Idle, Attack, Sustain, Release }

#[derive(Clone, Copy)]
struct Voice {
    stage: Stage,
    note: u8,
    phase: f32,
    increment: f32,
    level: f32,
    velocity: f32,
    age: u32,
    filter: f32,
}

impl Voice {
    const fn new() -> Self {
        Self {
            stage: Stage::Idle, note: 0, phase: 0.0, increment: 0.0,
            level: 0.0, velocity: 0.0, age: 0, filter: 0.0,
        }
    }
}

struct State {
    output: [[f32; MAX_FRAMES]; 2],
    voices: [Voice; VOICES],
    sample_rate: f32,
    counter: u32,
    // Parameters, in the order pulse-processor.js writes them.
    waveform: f32,
    attack: f32,
    release: f32,
    cutoff: f32,
    gain: f32,
}

impl State {
    const fn new() -> Self {
        Self {
            output: [[0.0; MAX_FRAMES]; 2],
            voices: [Voice::new(); VOICES],
            sample_rate: 48000.0,
            counter: 0,
            waveform: 0.0,
            attack: 5.0,
            release: 200.0,
            cutoff: 6000.0,
            gain: 0.3,
        }
    }
}

struct Shared(UnsafeCell<State>);
unsafe impl Sync for Shared {}
static STATE: Shared = Shared(UnsafeCell::new(State::new()));

#[inline]
#[allow(clippy::mut_from_ref)]
fn state() -> &'static mut State {
    unsafe { &mut *STATE.0.get() }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    let s = state();
    s.sample_rate = if sample_rate > 0.0 { sample_rate } else { 48000.0 };
    for voice in s.voices.iter_mut() { *voice = Voice::new(); }
}

#[no_mangle]
pub extern "C" fn jig_output_ptr(channel: u32) -> *mut f32 {
    let s = state();
    s.output[(channel as usize).min(1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 { MAX_FRAMES as u32 }

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    match index {
        0 => s.waveform = value,
        1 => s.attack = value,
        2 => s.release = value,
        3 => s.cutoff = value,
        4 => s.gain = value,
        _ => {}
    }
}

#[no_mangle]
pub extern "C" fn jig_note_on(note: u8, velocity: u8) {
    let s = state();
    s.counter = s.counter.wrapping_add(1);

    // A free voice, else the same note retriggered, else the oldest. Stealing
    // the oldest rather than refusing the note: a synth that stops responding
    // at eight notes is worse than one that drops the earliest.
    let mut chosen = 0;
    let mut best = u32::MAX;
    for (i, voice) in s.voices.iter().enumerate() {
        let score = match voice.stage {
            Stage::Idle => 0,
            _ if voice.note == note => 1,
            Stage::Release => 2 + voice.age,
            _ => 1000 + voice.age,
        };
        if score < best { best = score; chosen = i; }
    }

    let frequency = note_frequency(note);
    let voice = &mut s.voices[chosen];
    voice.stage = Stage::Attack;
    voice.note = note;
    voice.increment = frequency / s.sample_rate;
    voice.velocity = velocity as f32 / 127.0;
    voice.age = s.counter;
    // Phase is not reset, so a stolen voice does not click.
}

#[no_mangle]
pub extern "C" fn jig_note_off(note: u8) {
    let s = state();
    for voice in s.voices.iter_mut() {
        if voice.note == note && voice.stage != Stage::Idle && voice.stage != Stage::Release {
            voice.stage = Stage::Release;
        }
    }
}

#[no_mangle]
pub extern "C" fn jig_all_notes_off() {
    let s = state();
    for voice in s.voices.iter_mut() {
        if voice.stage != Stage::Idle { voice.stage = Stage::Release; }
    }
}

#[no_mangle]
pub extern "C" fn jig_active_voices() -> u32 {
    state().voices.iter().filter(|v| v.stage != Stage::Idle).count() as u32
}

#[inline]
fn shape(waveform: f32, phase: f32) -> f32 {
    match waveform as i32 {
        // Square.
        1 => if phase < 0.5 { 1.0 } else { -1.0 },
        // Triangle.
        2 => 1.0 - 4.0 * (phase - 0.5).abs(),
        // Saw.
        _ => 2.0 * phase - 1.0,
    }
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    let s = state();
    let frames = (frames as usize).min(MAX_FRAMES);

    let attack_step = 1.0 / (s.attack.max(0.5) * 0.001 * s.sample_rate);
    let release_step = 1.0 / (s.release.max(0.5) * 0.001 * s.sample_rate);
    // A normalised one-pole coefficient, linear in cutoff. No expf.
    let nyquist = s.sample_rate * 0.5;
    let coefficient = (s.cutoff / nyquist).clamp(0.02, 1.0);
    let waveform = s.waveform;
    let gain = s.gain;

    for frame in 0..frames {
        let mut sum = 0.0;

        for voice in s.voices.iter_mut() {
            if voice.stage == Stage::Idle { continue; }

            match voice.stage {
                Stage::Attack => {
                    voice.level += attack_step;
                    if voice.level >= 1.0 { voice.level = 1.0; voice.stage = Stage::Sustain; }
                }
                Stage::Release => {
                    voice.level -= release_step;
                    if voice.level <= 0.0 {
                        voice.level = 0.0;
                        voice.stage = Stage::Idle;
                        continue;
                    }
                }
                _ => {}
            }

            voice.phase += voice.increment;
            if voice.phase >= 1.0 { voice.phase -= 1.0; }

            let raw = shape(waveform, voice.phase);
            voice.filter += (raw - voice.filter) * coefficient;
            sum += voice.filter * voice.level * voice.velocity;
        }

        let value = sum * gain;
        s.output[0][frame] = value;
        s.output[1][frame] = value;
    }
}
