// plugins/drumgen/src/lib.rs
//
// DrumGen: a transport synced MIDI drum generator, and the worked example of
// a JigDAW drum machine. It is a port of the downspout VST3 of the same name,
// keeping its controls, its seeded pattern engine and its loop behaviour
// rather than reimagining any of them.
//
// Fourteen genres, seven style modes, two kit maps and four resolutions shape
// an eleven-lane pattern of up to 128 steps, built from anchor probabilities
// and a Euclidean layer, with fills on the last bar of the loop and a Vary
// control that mutates the loop as it comes round. The host's transport is
// the only clock: with no tempo and no beat position this outputs nothing,
// and every event is located by absolute stream position, never by equality
// with a block boundary.
//
// Ported from downspout plugins/drumgen (MIT, danja). Three deliberate
// deviations, each marked where it happens: the meter model counts steps from
// the time signature rather than carrying downspout's shared pulse tables;
// the mutation interval uses the square where the original raises to 2.5,
// because core has no pow; and changing the MIDI channel does not rebuild
// the pattern, because the channel is not an input to it.
//
// The same real-time rules as bassgen and pulse, visible the same way:
// no_std, no allocator, fixed arrays, no transcendental functions. Pattern
// generation runs on a parameter write or a loop wrap, both bounded, and
// jig_process only ever reads the pattern and appends to fixed buffers.

#![no_std]

mod anchors;
mod meter;
mod pattern;
mod rng;
mod variation;

use core::cell::UnsafeCell;

use meter::Meter;
use pattern::{clamp_controls, manual_fill_controls, regenerate, refresh_fill_bar, structural_changed, Controls, Pattern, OHAT, CRASH, LANES};
use variation::{apply_loop_variation, Variation};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const MIDI_IN_CAPACITY: usize = 64;
const MIDI_OUT_CAPACITY: usize = 256;
const PENDING_OFFS: usize = 96;

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

#[derive(Clone, Copy)]
struct Pending {
    active: bool,
    note: u8,
    channel: u8,
    remaining: u32,
}

struct State {
    sample_rate: f64,
    controls: Controls,
    previous: Controls,
    trig_level: [f32; 3],
    pattern: Pattern,
    pattern_valid: bool,
    variation: Variation,
    pending: [Pending; PENDING_OFFS],
    flush_all: bool,
    last_step: i64,
    was_playing: bool,
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
            pending: [Pending { active: false, note: 0, channel: 10, remaining: 0 }; PENDING_OFFS],
            flush_all: false,
            last_step: -1,
            was_playing: false,
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

#[inline]
fn lround_u32(value: f64) -> u32 {
    if value <= 0.0 { 0 } else { (value + 0.5) as u32 }
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

    fn emit_off(&mut self, frame: u32, note: u8, channel1: i32) {
        let ch0 = (channel1.clamp(1, 16) - 1) as u8;
        self.emit(frame, 0x80 | ch0, note, 0);
    }

    fn enqueue_off(&mut self, note: u8, channel1: i32, remaining: u32) {
        for pending in self.pending.iter_mut() {
            if !pending.active {
                pending.active = true;
                pending.note = note;
                pending.channel = channel1.clamp(1, 16) as u8;
                pending.remaining = remaining;
                return;
            }
        }
    }

    /// Note-offs whose gate crosses a block boundary wait here. The first
    /// thing each block does is sound the ones that fall due inside it.
    fn process_pending(&mut self, frames: u32) {
        for i in 0..PENDING_OFFS {
            if !self.pending[i].active {
                continue;
            }
            if self.pending[i].remaining < frames {
                let at = self.pending[i].remaining;
                let note = self.pending[i].note;
                let channel = self.pending[i].channel;
                self.pending[i].active = false;
                self.emit_off(at, note, channel as i32);
            } else {
                self.pending[i].remaining -= frames;
            }
        }
    }

    fn clear_pending(&mut self, frame: u32) {
        for i in 0..PENDING_OFFS {
            if !self.pending[i].active {
                continue;
            }
            let note = self.pending[i].note;
            let channel = self.pending[i].channel;
            self.pending[i].active = false;
            self.emit_off(frame, note, channel as i32);
        }
    }

    /// The Conductor control path: channel aftertouch-free plain CCs on one
    /// channel steer density, variation and mutation, and a full-value CC 24
    /// starts a fresh pattern. This runs before the pattern update, exactly
    /// where the downspout wrapper folds them into the controls.
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
                21 => self.controls.density = (event.data[2] as f32) / 127.0,
                22 => self.controls.variation = (event.data[2] as f32) / 127.0,
                23 => self.controls.vary = (event.data[2] as f32) / 127.0,
                24 => {
                    if event.data[2] == 127 {
                        self.controls.action_new = self.controls.action_new.wrapping_add(1);
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

    fn playing(&self) -> bool {
        self.transport.playing != 0
            && (self.transport.valid & VALID_BEAT) != 0
            && (self.transport.valid & VALID_BPM) != 0
            && self.transport.bpm > 0.0
            && self.meter_from_transport().map(|m| m.num).unwrap_or(4) > 0
    }

    fn local_step(total: i32, absolute: f64) -> f64 {
        let local = absolute % total as f64;
        if local < 0.0 { local + total as f64 } else { local }
    }

    /// Which bar a manual Fill rebuilds: the current one while there is still
    /// room to hear it, otherwise the next. A fill asked for at the bar line
    /// lands on the bar that is about to play, not the one just gone.
    fn fill_target_bar(&self, abs_steps_start: f64) -> i32 {
        let p = &self.pattern;
        if p.bars <= 1 || p.steps_per_bar <= 0 || p.total_steps <= 0 {
            return 0;
        }
        let c = manual_fill_controls(&self.controls);
        let local = Self::local_step(p.total_steps, abs_steps_start);
        let current = (floor_i64(local + 0.000000001) % p.total_steps as i64) as i32;
        let bar = current / p.steps_per_bar;
        let in_bar = current % p.steps_per_bar;
        let fill_beats = p.meter.fill_beats(c.fill);
        let fill_steps = (fill_beats * p.steps_per_beat)
            .clamp(p.steps_per_beat, p.steps_per_bar);
        if in_bar < p.steps_per_bar - fill_steps {
            bar.clamp(0, p.bars - 1)
        } else {
            (bar + 1) % p.bars
        }
    }

    fn emit_step(&mut self, local: i32, frame: u32, frames: u32, samples_per_step: f64) {
        if !self.pattern_valid || local < 0 || local >= self.pattern.total_steps {
            return;
        }
        let channel1 = self.controls.channel;
        for lane in 0..LANES {
            let velocity = self.pattern.vel[lane][local as usize];
            if velocity == 0 {
                continue;
            }
            let note = self.pattern.notes[lane];
            // The open hat's attack sits one sample behind the closed hat it
            // shares the step with, so the two never start together.
            let mut on = frame as i32 + (if lane as i32 == OHAT { 1 } else { 0 });
            on = on.clamp(0, frames as i32 - 1);
            self.emit(on as u32, 0x90 | self.channel0(), note, velocity);
            let gate = lround_u32(samples_per_step * (if lane as i32 == CRASH { 0.60 } else { 0.35 }))
                as i32;
            let gate = gate.clamp(24, (self.sample_rate * 0.05) as i32);
            let off_at = on + gate;
            if off_at < frames as i32 {
                self.emit_off(off_at as u32, note, channel1);
            } else if off_at >= 0 {
                self.enqueue_off(note, channel1, (off_at - frames as i32) as u32);
            }
        }
    }

    fn process(&mut self, frames: u32) {
        self.midi_out_count = 0;
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

        let mut fill_triggered = false;
        if !self.pattern_valid
            || structural_changed(&clamped, &self.previous)
            || (self.pattern_valid && self.pattern.meter != target_meter)
            || clamped.action_new != self.previous.action_new
            || clamped.action_mutate != self.previous.action_mutate
        {
            regenerate(&mut self.pattern, &clamped, target_meter, false);
            self.pattern_valid = true;
            self.variation.reset();
        } else if (clamped.vary - self.previous.vary).abs() >= 0.0001 {
            self.variation.reset();
        }
        if clamped.action_fill != self.previous.action_fill {
            fill_triggered = true;
        }
        self.controls = clamped;
        self.previous = clamped;

        if self.flush_all {
            self.flush_all = false;
            self.clear_pending(0);
        }
        self.process_pending(frames);

        let playing = self.playing();
        if fill_triggered && self.pattern_valid {
            if playing {
                let spb = self.pattern.steps_per_beat;
                let start = self.transport.beat * spb as f64;
                let bar = self.fill_target_bar(start);
                refresh_fill_bar(&mut self.pattern, &self.controls, target_meter, bar);
            } else {
                let last = self.pattern.bars - 1;
                let meter = self.pattern.meter;
                refresh_fill_bar(&mut self.pattern, &self.controls, meter, last);
            }
        }

        if !playing || !self.pattern_valid {
            // Stopping sounds the ringing notes now rather than leaving them
            // held: a held note with no note off is a stuck note.
            self.clear_pending(0);
            self.was_playing = false;
            self.last_step = -1;
            return;
        }

        let spb = self.pattern.steps_per_beat;
        let abs_beats_start = self.transport.beat;
        let abs_beats_step = (frames as f64 * self.transport.bpm) / (60.0 * self.sample_rate);
        let abs_start = abs_beats_start * spb as f64;
        let abs_end = (abs_beats_start + abs_beats_step) * spb as f64;
        let samples_per_step = self.sample_rate * 60.0 / (self.transport.bpm * spb as f64);
        let start_floor = floor_i64(abs_start + 0.000000001);

        if !self.was_playing || (self.last_step >= 0 && start_floor < self.last_step) {
            self.clear_pending(0);
            let wrapped = Self::local_step(self.pattern.total_steps, abs_start);
            let frac = wrapped - floor_i64(wrapped) as f64;
            if frac < 0.000001 || frac > 1.0 - 0.000001 {
                let at = (floor_i64(wrapped + 0.000001) % self.pattern.total_steps as i64) as i32;
                self.emit_step(at, 0, frames, samples_per_step);
            }
        }
        self.was_playing = true;
        self.last_step = start_floor;

        let mut boundary = floor_i64(abs_start) + 1;
        let boundary_end = floor_i64(abs_end + 0.000000001);
        while boundary <= boundary_end {
            let rel = boundary as f64 - abs_start;
            let t = rel / (abs_end - abs_start + 0.000000000001);
            let frame = ((t * frames as f64) as i64).clamp(0, frames as i64 - 1) as u32;
            let total = self.pattern.total_steps as i64;
            let local = (((boundary % total) + total) % total) as i32;
            if local == 0
                && apply_loop_variation(&mut self.pattern, &mut self.variation, &self.controls)
            {
                self.clear_pending(frame);
            }
            self.emit_step(local, frame, frames, samples_per_step);
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
    regenerate(&mut s.pattern, &s.controls, meter, false);
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
        0 => s.controls.genre = value as i32,
        1 => s.controls.style_mode = value as i32,
        2 => s.controls.channel = value as i32,
        3 => s.controls.kit_map = value as i32,
        4 => s.controls.bars = value as i32,
        5 => s.controls.resolution = value as i32,
        6 => s.controls.density = value,
        7 => s.controls.variation = value,
        8 => s.controls.fill = value,
        9 => s.controls.seed = (value as i32).max(0) as u32,
        10 => s.controls.kick_amt = value,
        11 => s.controls.backbeat_amt = value,
        12 => s.controls.hat_amt = value,
        13 => s.controls.aux_amt = value,
        // Triggers fire on the rising edge: a held 1 is one press, not a
        // held button, and the counter is what the scheduler compares.
        14 | 15 | 16 => {
            let slot = (index - 14) as usize;
            let was = s.trig_level[slot];
            s.trig_level[slot] = value;
            if value > 0.5 && was <= 0.5 {
                match index {
                    14 => s.controls.action_new = s.controls.action_new.wrapping_add(1),
                    15 => s.controls.action_mutate = s.controls.action_mutate.wrapping_add(1),
                    _ => s.controls.action_fill = s.controls.action_fill.wrapping_add(1),
                }
            }
            return;
        }
        17 => s.controls.tom_amt = value,
        18 => s.controls.metal_amt = value,
        19 => s.controls.vary = value,
        20 => s.controls.conductor_ch = value as i32,
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
    state().flush_all = true;
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    state().process(frames);
}
