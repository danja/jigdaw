// plugins/ground/src/lib.rs
//
// Ground: a long-form transport-synced bass generator, and the worked
// example of a JigDAW section planner. It is a port of the downspout VST3 of
// the same name, keeping its form shapes, phrase roles, arc tension and
// guarded bass register rather than reimagining any of them.
//
// A form of bars divides into phrases, each phrase carries a musical role,
// and roles generate the notes: statements assert, climbs rise, pedals hold,
// breakdowns thin out, cadences resolve. Named shapes pin the plan the way
// the repertoire does; the free planner rolls its own against the tension
// arc. Every note is folded into the bass lane, and the Conductor CC map
// steers density, motion, mutation, regeneration, tension and even phrase
// roles live.
//
// Ported from downspout plugins/ground (MIT, danja). Four deliberate
// deviations, each marked where it happens: the two status outputs are not
// parameters here, because a JigDAW profile cannot carry an output
// parameter; vary is a 0 to 1 control rather than the wrapper's 0 to 100
// display scaling; the mutation interval uses the square where the original
// raises to 2.3, because core has no pow; phrases regenerate through one
// 512 event workspace spliced in place rather than a 32 by 512 scratch
// buffer, a quarter megabyte of stack a 64KB WebAssembly stack cannot hold.
// The beat clock flywheels between transport messages, the same flywheel the
// drumgen, bassgen and melgen ports carry.
//
// The same real-time rules as bassgen, visible the same way: no_std, no
// allocator, fixed arrays, no transcendental functions. Form generation runs
// on a parameter write or a form wrap, both bounded, and jig_process only
// ever reads the form and appends to fixed buffers.

#![no_std]

mod generate;
mod meter;
mod pattern;
mod rng;
mod variation;

use core::cell::UnsafeCell;

use generate::{mutate_cell, refresh_phrase, regenerate_form, set_phrase_role};
use meter::Meter;
use pattern::{clamp_controls, structural_matches, Controls, Form};
use variation::{apply_loop_variation, Variation};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const MIDI_IN_CAPACITY: usize = 64;
const MIDI_OUT_CAPACITY: usize = 4128;
const PHRASE_ROLES: usize = 32;

// docs/module-abi.md: the transport valid bits.
const VALID_BPM: u32 = 1;
const VALID_BEAT: u32 = 2;
const VALID_METER: u32 = 8;

/// The 8 byte event record the ABI fixes.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct MidiEvent {
    frame: u32,
    size: u8,
    data: [u8; 3],
}

/// The 64 byte transport block the host fills in before each jig_process.
#[repr(C)]
#[derive(Clone, Copy)]
struct Transport {
    playing: u32,
    ticks_per_beat: u32,
    bpm: f64,
    beat: f64,
    bar_start_beat: f64,
    bar: i32,
    beat_in_bar: i32,
    tick: i32,
    numerator: i32,
    denominator: i32,
    valid: u32,
    seconds: f64,
}

struct State {
    sample_rate: f64,
    controls: Controls,
    previous: Controls,
    trig_level: [f32; 3],
    form: Form,
    form_valid: bool,
    variation: Variation,
    active_note: i32,
    pending_off: i32,
    current_phrase: i32,
    current_role: i32,
    last_step: i64,
    was_playing: bool,
    clock_beat: f64,
    clock_on: bool,
    last_t: f64,
    midi_in: [MidiEvent; MIDI_IN_CAPACITY],
    midi_in_count: u32,
    midi_out: [MidiEvent; MIDI_OUT_CAPACITY],
    midi_out_count: u32,
    transport: Transport,
}

impl State {
    const fn new() -> Self {
        State {
            sample_rate: 48000.0,
            controls: Controls::new(),
            previous: Controls::new(),
            trig_level: [0.0; 3],
            form: Form::empty(),
            form_valid: false,
            variation: Variation::new(),
            active_note: -1,
            pending_off: -1,
            current_phrase: 0,
            current_role: 0,
            last_step: -1,
            was_playing: false,
            clock_beat: 0.0,
            clock_on: false,
            last_t: 0.0,
            midi_in: [MidiEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_IN_CAPACITY],
            midi_in_count: 0,
            midi_out: [MidiEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_OUT_CAPACITY],
            midi_out_count: 0,
            transport: Transport {
                playing: 0, ticks_per_beat: 0, bpm: 120.0, beat: 0.0, bar_start_beat: 0.0,
                bar: 1, beat_in_bar: 1, tick: 0, numerator: 4, denominator: 4,
                valid: 0, seconds: 0.0,
            },
        }
    }
}

/// floor for f64, which lives in std and not in core. Truncation rounds the
/// wrong way for the negative pre-roll positions a host counts backwards
/// from the timeline start.
#[inline]
fn floor_i64(value: f64) -> i64 {
    let truncated = value as i64;
    if value < 0.0 && (truncated as f64) != value { truncated - 1 } else { truncated }
}

impl State {
    fn channel0(&self) -> u8 {
        (self.controls.channel.clamp(1, 16) - 1) as u8
    }

    fn emit(&mut self, frame: u32, status: u8, a: u8, b: u8) {
        if (self.midi_out_count as usize) >= MIDI_OUT_CAPACITY {
            return;
        }
        self.midi_out[self.midi_out_count as usize] =
            MidiEvent { frame, size: 3, data: [status, a, b] };
        self.midi_out_count += 1;
    }

    fn stop_sounding(&mut self, frame: u32) {
        if self.active_note >= 0 {
            self.emit(frame, 0x80 | self.channel0(), self.active_note as u8, 0);
            self.active_note = -1;
        }
    }

    /// The Conductor control path: CCs 21 to 23 steer density, motion and
    /// mutation, a full-value CC 24 plans a fresh form, and CC 20 sets arc
    /// tension while writing a role override for the playing phrase straight
    /// out of the Conductor's section vocabulary. This runs before the form
    /// update, exactly where the downspout wrapper folds them in.
    fn scan_conductor(&mut self) {
        let count = self.midi_in_count.min(MIDI_IN_CAPACITY as u32);
        self.midi_in_count = 0;
        let conductor = self.controls.conductor_ch;
        if conductor < 1 {
            return;
        }
        let want = 0xB0 | (conductor - 1) as u8;
        for i in 0..count as usize {
            let event = self.midi_in[i];
            if event.size < 3 || event.data[0] != want {
                continue;
            }
            match event.data[1] {
                20 => {
                    self.controls.tension = (event.data[2] as f32) / 127.0;
                    let played = self.current_phrase.clamp(0, PHRASE_ROLES as i32 - 1) as usize;
                    let role = match event.data[2] {
                        0..=16 => 1,
                        17..=48 => 3,
                        49..=80 => 5,
                        81..=112 => 2,
                        _ => 6,
                    };
                    self.controls.overrides[played] = role;
                }
                21 => self.controls.density = (event.data[2] as f32) / 127.0,
                22 => self.controls.motion = (event.data[2] as f32) / 127.0,
                23 => self.controls.vary = (event.data[2] as f32) / 127.0,
                24 => {
                    if event.data[2] == 127 {
                        self.controls.action_new_form =
                            self.controls.action_new_form.wrapping_add(1);
                    }
                }
                _ => {}
            }
        }
    }

    fn meter_from_transport(&self) -> Option<Meter> {
        if (self.transport.valid & VALID_METER) != 0
            && self.transport.numerator > 0
            && self.transport.denominator > 0
        {
            Some(Meter::new(self.transport.numerator, self.transport.denominator))
        } else {
            None
        }
    }

    fn beats_per_bar(&self) -> f64 {
        self.meter_from_transport().map(|m| m.num as f64).unwrap_or(4.0)
    }

    fn playing(&self) -> bool {
        self.transport.playing != 0
            && (self.transport.valid & VALID_BEAT) != 0
            && (self.transport.valid & VALID_BPM) != 0
            && self.transport.bpm > 0.0
            && self.beats_per_bar() > 0.0
    }

    fn local_step(total: i32, absolute: f64) -> f64 {
        let local = absolute % total as f64;
        if local < 0.0 { local + total as f64 } else { local }
    }

    fn phrase_at(&self, local: i32) -> i32 {
        if !self.form_valid || self.form.phrase_count <= 0 {
            return 0;
        }
        for p in 0..self.form.phrase_count as usize {
            let phrase = self.form.phrases[p];
            if local >= phrase.start_step && local < phrase.start_step + phrase.step_count {
                return p as i32;
            }
        }
        self.form.phrase_count - 1
    }

    fn find_starting(&self, local: i32) -> Option<(i32, i32)> {
        for i in 0..self.form.event_count as usize {
            let event = self.form.events[i];
            if event.start == local {
                return Some((event.note, event.velocity));
            }
        }
        None
    }

    fn find_covering(&self, local_pos: f64) -> Option<(i32, i32)> {
        for i in 0..self.form.event_count as usize {
            let event = self.form.events[i];
            let start = event.start as f64;
            if local_pos >= start && local_pos < start + event.duration as f64 {
                return Some((event.note, event.velocity));
            }
        }
        None
    }

    fn ends_at(&self, local: i32) -> bool {
        let total = self.form.pattern_steps;
        if total <= 0 {
            return false;
        }
        for i in 0..self.form.event_count as usize {
            let event = self.form.events[i];
            if event.duration < total && (event.start + event.duration) % total == local {
                return true;
            }
        }
        false
    }

    fn update_phrase_status(&mut self, local_pos: f64) {
        if !self.form_valid {
            self.current_phrase = 0;
            self.current_role = 0;
            return;
        }
        let total = self.form.pattern_steps.max(1);
        let step = (local_pos as i32).clamp(0, total - 1);
        self.current_phrase = self.phrase_at(step);
        self.current_role = self.form.phrases[self.current_phrase as usize].role;
    }

    /// Sound whatever the position holds, for restarts and forward seeks.
    fn sync_to_position(&mut self, abs_start: f64) {
        let total = self.form.pattern_steps;
        if total <= 0 {
            return;
        }
        let local_pos = Self::local_step(total, abs_start);
        self.update_phrase_status(local_pos);
        let covering = self.find_covering(local_pos);
        let should = covering.map(|(note, _)| note).unwrap_or(-1);
        if self.active_note >= 0 && self.active_note != should {
            self.stop_sounding(0);
        }
        if should >= 0 && self.active_note < 0 {
            let velocity = covering.map(|(_, v)| v).unwrap_or(96);
            self.emit(0, 0x90 | self.channel0(), should as u8, velocity as u8);
            self.active_note = should;
        }
    }

    fn apply_overrides(&mut self, fresh: &Controls, previous: &Controls) {
        if !self.form_valid {
            return;
        }
        for p in 0..self.form.phrase_count as usize {
            if fresh.overrides[p] == previous.overrides[p] {
                continue;
            }
            if fresh.overrides[p] > 0 {
                let role = (fresh.overrides[p] - 1).clamp(0, 6);
                set_phrase_role(&mut self.form, fresh, p as i32, role);
            } else {
                refresh_phrase(&mut self.form, fresh, p as i32);
            }
        }
        self.sync_phrase_tracking();
    }

    fn sync_phrase_tracking(&mut self) {
        if !self.form_valid {
            self.current_phrase = 0;
            self.current_role = 0;
            return;
        }
        self.current_phrase = self.current_phrase.clamp(0, self.form.phrase_count - 1);
        self.current_role = self.form.phrases[self.current_phrase as usize].role;
    }

    fn process(&mut self, frames: u32) {
        self.midi_out_count = 0;
        if self.pending_off >= 0 {
            self.emit(0, 0x80 | self.channel0(), self.pending_off as u8, 0);
            self.pending_off = -1;
            self.active_note = -1;
        }
        self.scan_conductor();

        let clamped = clamp_controls(&self.controls);
        let playing_hint = self.transport.playing != 0;
        let target_meter = if playing_hint {
            self.meter_from_transport().unwrap_or_else(|| {
                if self.form_valid { self.form.meter } else { Meter::new(4, 4) }
            })
        } else if self.form_valid {
            self.form.meter
        } else {
            Meter::new(4, 4)
        };

        // The phrase the transport is in, for the phrase-scoped actions.
        // Computed from the form as it stands before any rebuild below.
        let mut target_phrase = self.current_phrase;
        if self.form_valid && self.playing() {
            let spb = self.form.steps_per_beat;
            let abs = self.transport.beat * spb as f64;
            let local = Self::local_step(self.form.pattern_steps.max(1), abs);
            target_phrase = self.phrase_at(local as i32);
        }

        let mut force_resync = false;
        if !self.form_valid
            || !structural_matches(&clamped, &self.previous)
            || clamped.action_new_form != self.previous.action_new_form
            || (self.form_valid && self.form.meter != target_meter)
        {
            regenerate_form(&mut self.form, &clamped, target_meter);
            self.form_valid = true;
            for p in 0..self.form.phrase_count as usize {
                let setting = clamped.overrides[p];
                if setting > 0 {
                    set_phrase_role(&mut self.form, &clamped, p as i32, (setting - 1).clamp(0, 6));
                }
            }
            self.sync_phrase_tracking();
            self.variation.reset();
            force_resync = true;
        } else if clamped.action_new_phrase != self.previous.action_new_phrase {
            let at = target_phrase.clamp(0, self.form.phrase_count - 1);
            if clamped.overrides[at as usize] > 0 {
                let role = (clamped.overrides[at as usize] - 1).clamp(0, 6);
                set_phrase_role(&mut self.form, &clamped, at, role);
            } else {
                refresh_phrase(&mut self.form, &clamped, at);
            }
            self.variation.reset();
            force_resync = true;
        } else if clamped.action_mutate != self.previous.action_mutate {
            let at = target_phrase.clamp(0, self.form.phrase_count - 1);
            mutate_cell(&mut self.form, &clamped, at, 0.70);
            self.variation.reset();
            force_resync = true;
        } else if clamped.overrides != self.previous.overrides {
            let prev = self.previous;
            self.apply_overrides(&clamped, &prev);
            self.variation.reset();
            force_resync = true;
        } else if self.previous.vary <= 0.0001 && clamped.vary > 0.0001 {
            self.variation.reset();
        }
        self.controls = clamped;
        self.previous = clamped;

        let playing = self.playing();
        if !playing || !self.form_valid {
            self.stop_sounding(0);
            self.was_playing = false;
            self.clock_on = false;
            self.last_step = -1;
            return;
        }

        // The beat clock flywheels between transport messages: see drumgen.
        let spb = self.form.steps_per_beat;
        let beats_step = (frames as f64 * self.transport.bpm) / (60.0 * self.sample_rate);
        let t_beat = self.transport.beat;
        let mut seek_forward = false;
        let base = if !self.was_playing || !self.clock_on {
            self.clock_on = true;
            self.last_t = t_beat;
            t_beat
        } else if t_beat != self.last_t {
            self.last_t = t_beat;
            if t_beat < self.clock_beat - 1.0 {
                t_beat
            } else if t_beat > self.clock_beat + 1.0 {
                seek_forward = true;
                t_beat
            } else {
                self.clock_beat
            }
        } else {
            self.clock_beat
        };

        let abs_start = base * spb as f64;
        let abs_end = (base + beats_step) * spb as f64;
        let local_start = Self::local_step(self.form.pattern_steps.max(1), abs_start);
        let start_floor = floor_i64(abs_start + 0.000000001);

        if seek_forward || !self.was_playing || (self.last_step >= 0 && start_floor < self.last_step) {
            self.stop_sounding(0);
            self.sync_to_position(abs_start);
        } else {
            self.update_phrase_status(local_start);
            if force_resync {
                self.sync_to_position(abs_start);
            }
        }
        self.was_playing = true;
        self.last_step = start_floor;
        self.clock_beat = base + beats_step;

        let mut boundary = floor_i64(abs_start) + 1;
        let boundary_end = floor_i64(abs_end + 0.000000001);
        while boundary <= boundary_end {
            let rel = boundary as f64 - abs_start;
            let t = rel / (abs_end - abs_start + 0.000000000001);
            let frame = ((t * frames as f64) as i64).clamp(0, frames as i64 - 1) as u32;
            let total = self.form.pattern_steps.max(1) as i64;
            let local = (((boundary % total) + total) % total) as i32;
            if local == 0
                && apply_loop_variation(
                    &mut self.form,
                    &mut self.variation,
                    &self.controls,
                    self.current_phrase,
                )
            {
                self.stop_sounding(frame);
            }
            self.update_phrase_status(local as f64);
            if self.ends_at(local) {
                self.stop_sounding(frame);
            }
            if let Some((note, velocity)) = self.find_starting(local) {
                let on = (frame as i32 + 1).clamp(0, frames as i32 - 1) as u32;
                self.stop_sounding(frame);
                self.emit(on, 0x90 | self.channel0(), note as u8, velocity as u8);
                self.active_note = note;
            }
            boundary += 1;
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
    s.sample_rate = sample_rate as f64;
    let meter = Meter::new(4, 4);
    regenerate_form(&mut s.form, &s.controls, meter);
    s.form_valid = true;
    s.previous = s.controls;
    s.sync_phrase_tracking();
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 {
    MAX_FRAMES as u32
}

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    match index {
        0 => s.controls.root_note = value as i32,
        1 => s.controls.scale = value as i32,
        2 => s.controls.style = value as i32,
        3 => s.controls.channel = value as i32,
        4 => s.controls.form_bars = value as i32,
        5 => s.controls.phrase_bars = value as i32,
        6 => s.controls.density = value,
        7 => s.controls.motion = value,
        8 => s.controls.tension = value,
        9 => s.controls.cadence = value,
        10 => s.controls.reg = value as i32,
        11 => s.controls.register_arc = value,
        12 => s.controls.sequence = value,
        13 => s.controls.seed = (value as i32).max(1) as u32,
        14 => s.controls.vary = value,
        // Triggers fire on the rising edge: a held 1 is one press, not a
        // held button, and the counter is what the scheduler compares.
        15 | 16 | 17 => {
            let slot = (index - 15) as usize;
            let was = s.trig_level[slot];
            s.trig_level[slot] = value;
            if value > 0.5 && was <= 0.5 {
                match index {
                    15 => {
                        s.controls.action_new_form = s.controls.action_new_form.wrapping_add(1)
                    }
                    16 => {
                        s.controls.action_new_phrase =
                            s.controls.action_new_phrase.wrapping_add(1)
                    }
                    _ => {
                        s.controls.action_mutate = s.controls.action_mutate.wrapping_add(1)
                    }
                }
            }
            return;
        }
        18 => s.controls.color = value,
        19 => s.controls.note_length = value,
        20 => s.controls.note_length_var = value,
        21 => s.controls.form_shape = value as i32,
        22..=53 => s.controls.overrides[(index - 22) as usize] = value as i32,
        54 => s.controls.clamp_semi = value as i32,
        55 => s.controls.conductor_ch = value as i32,
        _ => return,
    }
}

#[no_mangle]
pub extern "C" fn jig_midi_in_ptr() -> *const MidiEvent {
    state().midi_in.as_ptr()
}

#[no_mangle]
pub extern "C" fn jig_midi_in_capacity() -> u32 {
    MIDI_IN_CAPACITY as u32
}

#[no_mangle]
pub extern "C" fn jig_midi_in(count: u32) {
    state().midi_in_count = count.min(MIDI_IN_CAPACITY as u32);
}

#[no_mangle]
pub extern "C" fn jig_midi_out_ptr() -> *const MidiEvent {
    state().midi_out.as_ptr()
}

#[no_mangle]
pub extern "C" fn jig_midi_out_capacity() -> u32 {
    MIDI_OUT_CAPACITY as u32
}

#[no_mangle]
pub extern "C" fn jig_midi_out_count() -> u32 {
    state().midi_out_count
}

#[no_mangle]
pub extern "C" fn jig_transport_ptr() -> *const Transport {
    &state().transport
}

#[no_mangle]
pub extern "C" fn jig_all_notes_off() {
    let s = state();
    if s.active_note >= 0 {
        s.pending_off = s.active_note;
    }
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    state().process(frames);
}
