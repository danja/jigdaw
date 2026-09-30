// plugins/canticle/src/lib.rs
//
// Canticle: a twelve-voice polyphonic tonal instrument, and the JigDAW port
// of the downspout VST3 of the same name. One engine with five model layers
// (Keys, Reed, Pad, Pluck, Glass) over a shared voice allocator with
// release tails and stealing, stereo spread, and bounded output through a
// final soft clip.
//
// Ported from downspout plugins/canticle (MIT, danja), keeping its models,
// its envelope curves, its register and ensemble handling, its metal edge
// and its output calibration rather than reimagining any of them.
//
// Three deliberate deviations, each marked where it happens: the sine, tanh,
// exp and sqrt calls evaluate the polynomial approximations in dsp.rs,
// because core has no libm; the envelope times, detune ratio and filter
// coefficient derive on note and parameter changes rather than per sample,
// which the original already does for everything but the coefficient; and CC
// 120 and 123 arrive as jig_all_notes_off from the processor, because Abi1
// carries notes rather than controller messages.
//
// The same real-time rules as Pulse, visible the same way: no_std, no
// allocator, a fixed twelve-voice array, no transcendental functions.

#![no_std]

mod dsp;
mod params;
mod voice;

use core::cell::UnsafeCell;

use params::{clamp_param, default_params, PARAM_COUNT};
use voice::{Voice, MAX_VOICES};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;

fn sanitize(value: f32) -> f32 {
    if !value.is_finite() {
        return 0.0;
    }
    crate::dsp::tanh_approx(value.clamp(-4.0, 4.0))
}

struct State {
    output: [[f32; MAX_FRAMES]; 2],
    voices: [Voice; MAX_VOICES],
    params: [f32; PARAM_COUNT],
    params_dirty: bool,
    sample_rate: f32,
    serial: u64,
    dc_x: f32,
    dc_y: f32,
}

impl State {
    const fn new() -> Self {
        State {
            output: [[0.0; MAX_FRAMES]; 2],
            voices: [Voice::new(); MAX_VOICES],
            params: [0.0; PARAM_COUNT],
            params_dirty: false,
            sample_rate: 48000.0,
            serial: 0,
            dc_x: 0.0,
            dc_y: 0.0,
        }
    }

    fn refresh_active_voices(&mut self) {
        for voice in self.voices.iter_mut() {
            if voice.active() {
                voice.parameters_changed(&self.params);
            }
        }
    }

    fn note_on(&mut self, note: i32, velocity: u8) {
        if !(0..128).contains(&note) || velocity == 0 {
            return;
        }
        self.serial = self.serial.wrapping_add(1);
        // The same note retriggered first, else a free voice, else steal:
        // releasing voices go before sounding ones, oldest serial wins.
        // Stealing rather than refusing: a synth that stops responding at
        // twelve notes is worse than one that drops the earliest.
        if let Some(v) = self.voices.iter_mut().find(|v| v.active() && v.note() == note) {
            v.start(note, velocity, &self.params, self.serial);
            return;
        }
        if let Some(v) = self.voices.iter_mut().find(|v| !v.active()) {
            v.start(note, velocity, &self.params, self.serial);
            return;
        }
        let mut chosen = 0;
        let mut oldest = u64::MAX;
        let mut found_releasing = false;
        for (i, v) in self.voices.iter().enumerate() {
            if v.releasing() && v.serial() < oldest {
                oldest = v.serial();
                chosen = i;
                found_releasing = true;
            }
        }
        if !found_releasing {
            oldest = u64::MAX;
            for (i, v) in self.voices.iter().enumerate() {
                if v.serial() < oldest {
                    oldest = v.serial();
                    chosen = i;
                }
            }
        }
        self.voices[chosen].start(note, velocity, &self.params, self.serial);
    }

    fn note_off(&mut self, note: i32) {
        for voice in self.voices.iter_mut() {
            if voice.active() && voice.note() == note {
                voice.note_off();
            }
        }
    }

    fn all_notes_off(&mut self) {
        for voice in self.voices.iter_mut() {
            voice.note_off();
        }
    }

    fn process(&mut self, frames: u32) {
        let frames = (frames as usize).min(MAX_FRAMES);
        if self.params_dirty {
            self.params_dirty = false;
            self.refresh_active_voices();
        }
        let gain = Voice::output_gain(&self.params);
        for frame in 0..frames {
            let mut left = 0.0;
            let mut right = 0.0;
            for voice in self.voices.iter_mut() {
                if let Some((l, r)) = voice.process() {
                    left += l;
                    right += r;
                }
            }
            // Keep lead lines useful at nominal host gain while the final
            // soft clip below protects dense chords from exceeding full scale.
            left *= gain;
            right *= gain;
            let mono = (left + right) * 0.5;
            let dc = mono - self.dc_x + 0.995 * self.dc_y;
            self.dc_x = mono;
            self.dc_y = dc;
            let correction = mono - dc;
            left -= correction;
            right -= correction;
            self.output[0][frame] = sanitize(left);
            self.output[1][frame] = sanitize(right);
        }
    }
}

static STATE: Wrapper = Wrapper(UnsafeCell::new(State::new()));
struct Wrapper(UnsafeCell<State>);
unsafe impl Sync for Wrapper {}

#[allow(clippy::mut_from_ref)]
fn state() -> &'static mut State {
    unsafe { &mut *STATE.0.get() }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    let s = state();
    s.sample_rate = if sample_rate > 0.0 { sample_rate } else { 48000.0 };
    s.params = default_params();
    s.params_dirty = false;
    s.serial = 0;
    s.dc_x = 0.0;
    s.dc_y = 0.0;
    for voice in s.voices.iter_mut() {
        voice.reset();
        voice.set_sample_rate(s.sample_rate, &s.params);
    }
}

#[no_mangle]
pub extern "C" fn jig_output_ptr(channel: u32) -> *mut f32 {
    let s = state();
    s.output[(channel as usize).min(1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 {
    MAX_FRAMES as u32
}

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    let i = index as usize;
    if i >= PARAM_COUNT {
        return;
    }
    let clamped = clamp_param(i, value);
    if s.params[i] == clamped {
        return;
    }
    s.params[i] = clamped;
    s.params_dirty = true;
}

#[no_mangle]
pub extern "C" fn jig_note_on(note: u8, velocity: u8) {
    let s = state();
    if velocity == 0 {
        s.note_off(note as i32);
    } else {
        s.note_on(note as i32, velocity);
    }
}

#[no_mangle]
pub extern "C" fn jig_note_off(note: u8) {
    state().note_off(note as i32);
}

#[no_mangle]
pub extern "C" fn jig_all_notes_off() {
    state().all_notes_off();
}

#[no_mangle]
pub extern "C" fn jig_active_voices() -> u32 {
    state().voices.iter().filter(|v| v.active()).count() as u32
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    state().process(frames);
}
