// plugins/melgen/src/lib.rs
//
// MelGen: a phrase-aware MIDI melody generator, and the worked example of a
// JigDAW melody line. It is a port of the downspout VST3 of the same name,
// itself derived from the bassgen architecture, keeping its controls, its
// period forms and contour shapes, and its question/answer derivations rather
// than reimagining any of them.
//
// Scale-degree motifs grow per phrase and derive across the period - free,
// A A, A B, A A', call and answer, A B A - steered by contour, answer
// transform, structure, cadence and color, with a strict Fugue-friendly
// region rather than a genre selector. Follow pulls generated pitches toward
// an incoming line without copying it, and the Conductor CC map steers
// contour, scale, density, variation and regeneration live.
//
// Ported from downspout plugins/melgen (MIT, danja). Three deliberate
// deviations, each marked where it happens: vary is a 0 to 1 control rather
// than the wrapper's 0 to 100 display scaling; the mutation interval uses the
// square where the original raises to 2.5, because core has no pow; and the
// beat clock flywheels between transport messages, because a host that
// reports the beat on a slow loop would otherwise quantise the line to that
// grid - the same flywheel the drumgen and bassgen ports carry.
//
// The same real-time rules as bassgen, visible the same way: no_std, no
// allocator, fixed arrays, no transcendental functions. Pattern generation
// runs on a parameter write or a loop wrap, both bounded, and jig_process
// only ever reads the pattern and appends to fixed buffers.

#![no_std]

mod meter;
mod pattern;
mod rng;
mod variation;

use core::cell::UnsafeCell;

use meter::Meter;
use pattern::{
    clamp_controls, nearest_scale_note, regenerate, structural_changed, Controls, Pattern,
};
use variation::{apply_loop_variation, Variation};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const MIDI_IN_CAPACITY: usize = 64;
const MIDI_OUT_CAPACITY: usize = 528;

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
    pattern: Pattern,
    pattern_valid: bool,
    variation: Variation,
    active_note: i32,
    follow_note: i32,
    pending_off: i32,
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
            pattern: Pattern::empty(),
            pattern_valid: false,
            variation: Variation::new(),
            active_note: -1,
            follow_note: -1,
            pending_off: -1,
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

    /// The Conductor control path: plain CCs on one channel steer contour,
    /// scale, density and variation, and a full-value CC 24 starts a fresh
    /// pattern. This runs before the pattern update, exactly where the
    /// downspout wrapper folds them into the controls.
    fn scan_conductor(&mut self) {
        let count = self.midi_in_count.min(MIDI_IN_CAPACITY as u32);
        self.midi_in_count = 0;
        let conductor = self.controls.conductor_ch;
        if conductor < 1 {
            // Without a conductor channel the same buffer carries follow
            // notes instead; take_input below sorts that out.
            self.midi_in_count = count;
            return;
        }
        let want = 0xB0 | (conductor - 1) as u8;
        let mut kept = 0;
        for i in 0..count as usize {
            let event = self.midi_in[i];
            if event.size >= 3 && event.data[0] == want {
                match event.data[1] {
                    20 => self.controls.contour = ((event.data[2] / 22).min(5)) as i32,
                    21 => self.controls.scale = ((event.data[2] as i32 * 23 / 128).min(22)) as i32,
                    22 => self.controls.density = (event.data[2] as f32) / 127.0,
                    23 => self.controls.vary = (event.data[2] as f32) / 127.0,
                    24 => {
                        if event.data[2] == 127 {
                            self.controls.action_new = self.controls.action_new.wrapping_add(1);
                        }
                    }
                    _ => {}
                }
                continue;
            }
            // Anything that is not a conductor CC stays in the buffer for
            // the follow tracker, which reads the same queue.
            self.midi_in[kept] = event;
            kept += 1;
        }
        self.midi_in_count = kept as u32;
    }

    /// Follow listens to note-ons for a pitch to lean toward, forgetting it
    /// when that note ends or every note ends. Only runs while follow is up;
    /// otherwise the buffer is not follow traffic at all.
    fn consume_follow(&mut self, offset: u32) {
        if self.controls.follow <= 0.001 {
            self.follow_note = -1;
            return;
        }
        let count = self.midi_in_count.min(MIDI_IN_CAPACITY as u32) as usize;
        let mut kept = 0;
        for i in 0..count {
            let event = self.midi_in[i];
            if event.size >= 3 && event.frame <= offset {
                match event.data[0] & 0xf0 {
                    0x90 if event.data[2] > 0 => self.follow_note = event.data[1] as i32,
                    0x80 => {
                        if self.follow_note == event.data[1] as i32 {
                            self.follow_note = -1;
                        }
                    }
                    0x90 => {
                        if self.follow_note == event.data[1] as i32 {
                            self.follow_note = -1;
                        }
                    }
                    0xB0 if event.data[1] == 120 || event.data[1] == 123 => {
                        self.follow_note = -1;
                    }
                    _ => {}
                }
                continue;
            }
            self.midi_in[kept] = event;
            kept += 1;
        }
        self.midi_in_count = kept as u32;
    }

    /// Pull a generated pitch toward the followed line without copying it:
    /// blended most of the way at full follow, nudged by a seeded hash, then
    /// snapped back into the scale so the pull never leaves the key.
    fn apply_follow(&self, source: i32, local_step: i32) -> i32 {
        let follow = self.controls.follow;
        if follow <= 0.001 || self.follow_note < 0 {
            return source;
        }
        let mut target = self.follow_note;
        while target < source - 12 {
            target += 12;
        }
        while target > source + 12 {
            target -= 12;
        }
        let blend = follow * 0.72;
        let mut shaped = source + lround((target - source) as f32 * blend);
        let mut hash = self.controls.seed
            ^ (((source + 129) as u32).wrapping_mul(2246822519))
            ^ (((self.follow_note + 257) as u32).wrapping_mul(3266489917))
            ^ (((local_step + self.pattern.serial * 17) as u32).wrapping_mul(668265263));
        hash ^= hash >> 15;
        hash = hash.wrapping_mul(2246822519);
        hash ^= hash >> 13;
        if follow > 0.20 && hash % 100 < (follow * 36.0) as u32 {
            shaped += ((hash / 101) % 3) as i32 - 1;
        }
        nearest_scale_note(&self.controls, shaped, source - 12, source + 12)
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

    fn find_starting(&self, local: i32) -> Option<(i32, i32, i32)> {
        for i in 0..self.pattern.event_count as usize {
            let event = self.pattern.events[i];
            if event.start == local {
                return Some((event.note, event.velocity, event.duration));
            }
        }
        None
    }

    fn find_covering(&self, local_pos: f64) -> Option<(i32, i32)> {
        for i in 0..self.pattern.event_count as usize {
            let event = self.pattern.events[i];
            let start = event.start as f64;
            let end = (event.start + event.duration) as f64;
            if local_pos >= start && local_pos < end {
                return Some((event.note, event.velocity));
            }
        }
        None
    }

    fn ends_at(&self, local: i32) -> bool {
        if self.pattern.pattern_steps <= 0 {
            return false;
        }
        for i in 0..self.pattern.event_count as usize {
            let event = self.pattern.events[i];
            if event.duration < self.pattern.pattern_steps
                && (event.start + event.duration) % self.pattern.pattern_steps == local
            {
                return true;
            }
        }
        false
    }

    /// Sound whatever the position holds, for restarts and forward seeks: a
    /// held note with no note off is a stuck note, and a landing position
    /// inside a note should hear it rather than wait for the next one.
    fn sync_to_position(&mut self, abs_start: f64) {
        let total = self.pattern.pattern_steps;
        if total <= 0 {
            return;
        }
        let local_pos = Self::local_step(total, abs_start);
        let local = local_pos as i32 % total;
        let covering = self.find_covering(local_pos);
        let should = covering.map(|(note, _)| self.apply_follow(note, local)).unwrap_or(-1);
        if self.active_note >= 0 && self.active_note != should {
            self.stop_sounding(0);
        }
        if should >= 0 && self.active_note < 0 {
            let velocity = covering.map(|(_, v)| v).unwrap_or(96);
            self.emit(0, 0x90 | self.channel0(), should as u8, velocity as u8);
            self.active_note = should;
        }
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
        // While stopped the pattern keeps its own meter, so a loop in an odd
        // time is not rebuilt against the project's signature before it is
        // ever heard.
        let playing_hint = self.transport.playing != 0;
        let target_meter = if playing_hint {
            self.meter_from_transport().unwrap_or_else(|| {
                if self.pattern_valid { self.pattern.meter } else { Meter::new(4, 4) }
            })
        } else if self.pattern_valid {
            self.pattern.meter
        } else {
            Meter::new(4, 4)
        };

        if !self.pattern_valid
            || structural_changed(&clamped, &self.previous)
            || (self.pattern_valid && self.pattern.meter != target_meter)
            || clamped.action_new != self.previous.action_new
        {
            regenerate(&mut self.pattern, &clamped, target_meter, true, true);
            self.pattern_valid = true;
            self.variation.reset();
        } else if clamped.action_rhythm != self.previous.action_rhythm {
            regenerate(&mut self.pattern, &clamped, target_meter, true, false);
            self.variation.reset();
        } else if clamped.action_notes != self.previous.action_notes {
            regenerate(&mut self.pattern, &clamped, target_meter, false, true);
            self.variation.reset();
        } else if self.previous.vary <= 0.0001 && clamped.vary > 0.0001 {
            self.variation.reset();
        }
        self.controls = clamped;
        self.previous = clamped;

        let playing = self.playing();
        if !playing || !self.pattern_valid {
            self.stop_sounding(0);
            self.was_playing = false;
            self.clock_on = false;
            self.last_step = -1;
            return;
        }

        // The beat clock flywheels between transport messages: see drumgen.
        let spb = self.pattern.steps_per_beat;
        let beats_step = (frames as f64 * self.transport.bpm) / (60.0 * self.sample_rate);
        let beats_bar = self.beats_per_bar();
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
        let start_floor = floor_i64(abs_start + 0.000000001);

        if seek_forward || !self.was_playing || (self.last_step >= 0 && start_floor < self.last_step) {
            self.consume_follow(0);
            self.stop_sounding(0);
            self.sync_to_position(abs_start);
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
            let total = self.pattern.pattern_steps as i64;
            let local = (((boundary % total) + total) % total) as i32;
            self.consume_follow(frame);

            if local == 0
                && apply_loop_variation(
                    &mut self.pattern,
                    &mut self.variation,
                    &self.controls,
                    target_meter,
                    beats_bar,
                )
            {
                self.stop_sounding(frame);
            }
            if self.ends_at(local) {
                self.stop_sounding(frame);
            }
            if let Some((note, velocity, _)) = self.find_starting(local) {
                let on = (frame as i32 + 1).clamp(0, frames as i32 - 1) as u32;
                let sounded = self.apply_follow(note, local);
                self.stop_sounding(frame);
                self.emit(on, 0x90 | self.channel0(), sounded as u8, velocity as u8);
                self.active_note = sounded;
            }
            boundary += 1;
        }
        self.consume_follow(frames.saturating_sub(1));
    }
}

/// lround for the non-negative blend the follow pull computes.
#[inline]
fn lround(value: f32) -> i32 {
    if value >= 0.0 { (value + 0.5) as i32 } else { (value - 0.5) as i32 }
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
    regenerate(&mut s.pattern, &s.controls, meter, true, true);
    s.pattern_valid = true;
    s.previous = s.controls;
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
        2 => s.controls.channel = value as i32,
        3 => s.controls.length_beats = value as i32,
        4 => s.controls.phrase_bars = value as i32,
        5 => s.controls.subdivision = value as i32,
        6 => s.controls.period = value as i32,
        7 => s.controls.contour = value as i32,
        8 => s.controls.answer = value as i32,
        9 => s.controls.density = value,
        10 => s.controls.reg = value as i32,
        11 => s.controls.hold = value,
        12 => s.controls.accent = value,
        13 => s.controls.structure = value,
        14 => s.controls.range = value,
        15 => s.controls.leap = value,
        16 => s.controls.rest = value,
        17 => s.controls.cadence = value,
        18 => s.controls.seed = (value as i32).max(1) as u32,
        19 => s.controls.vary = value,
        // Triggers fire on the rising edge: a held 1 is one press, not a
        // held button, and the counter is what the scheduler compares.
        20 | 21 | 22 => {
            let slot = (index - 20) as usize;
            let was = s.trig_level[slot];
            s.trig_level[slot] = value;
            if value > 0.5 && was <= 0.5 {
                match index {
                    20 => s.controls.action_new = s.controls.action_new.wrapping_add(1),
                    21 => s.controls.action_notes = s.controls.action_notes.wrapping_add(1),
                    _ => s.controls.action_rhythm = s.controls.action_rhythm.wrapping_add(1),
                }
            }
            return;
        }
        23 => s.controls.follow = value,
        24 => s.controls.color = value,
        25 => s.controls.conductor_ch = value as i32,
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
