// plugins/cadence/src/lib.rs
//
// Cadence: a transport-aware MIDI harmonizer that learns a cycle and plays
// voiced chord progressions, and the worked example of a JigDAW MIDI
// processor. It is a port of the downspout VST3 of the same name, keeping
// its learn loop, its chord fitting, its comping planner and its
// voice-leading playback rather than reimagining any of them.
//
// What it does, in order: while the transport rolls it listens to incoming
// notes, accumulating how long and how often each pitch class sounds in each
// segment of the cycle. At every cycle boundary the capture is fitted to
// chords — candidates scored by fit, motion rewarded, smooth transitions
// found by dynamic programming — and voiced near the middle with the
// previous chord's shape kept where it fits. Playback walks the segments,
// and the comping planner stabs where the player stabbed, or on the bar when
// comp is down. A learn press forgets everything and starts listening over.
//
// Ported from downspout plugins/cadence (MIT, danja). Three deliberate
// deviations, each marked where it happens: vary and comp are 0 to 1
// controls rather than the wrapper's 0 to 100 display scalings; the mutation
// interval uses the square where the original raises to 2.5, because core
// has no pow; and the dynamic programming tables live in the engine state
// rather than the stack, a hundred kilobytes the WebAssembly stack cannot
// hold. The beat clock flywheels between transport messages, the same
// flywheel the generator ports carry.
//
// The same real-time rules as the sibling generators, visible the same way:
// no_std, no allocator, fixed arrays, no transcendental functions. Fitting
// and planning run at cycle boundaries and on parameter writes, both
// bounded, and jig_process only ever reads state and appends to fixed
// buffers.

#![no_std]

mod comping;
mod harmony;
mod rng;
mod variation;

use core::cell::UnsafeCell;

use comping::{CompState, clear_release, next_hit_beat, plan_segment, set_release, sync_to_position as comp_sync, take_due_hit, TIMING_BINS};
use harmony::{
    build_progression_from_capture, clamp_controls, copy_capture, copy_progression, clear_capture,
    clear_progression, harmony_matches, revoice_progression, BuildOptions, ChordSlot,
    Controls, DpScratch, SegmentCapture,
};
use variation::{apply_cycle_variation, Variation};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const MAX_SEGMENTS: usize = 32;
const MAX_CHORD_NOTES: usize = 6;
const MIDI_IN_CAPACITY: usize = 64;
const MIDI_OUT_CAPACITY: usize = 2048;
const BEAT_EPSILON: f64 = 0.000001;

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

fn floor_i64(v: f64) -> i64 {
    let t = v as i64;
    if v < 0.0 && (t as f64) != v { t - 1 } else { t }
}

/// Round half away from zero, for the beat indices downspout llrounds.
fn round_i64(v: f64) -> i64 {
    if v >= 0.0 { (v + 0.5) as i64 } else { (v - 0.5) as i64 }
}

/// Ceiling without libm: the cursor's first boundary is the next one at or
/// after the block start, never the one just passed. Rounding there
/// re-fires every past boundary in every block, which is how the harmony
/// came to retrigger once per quantum.
fn ceil_i64(v: f64) -> i64 {
    let t = v as i64;
    if v > 0.0 && (t as f64) != v { t + 1 } else { t }
}

/// lround for the non-negative values this file rounds.
fn lround(v: f64) -> i32 {
    (v + 0.5) as i32
}

struct State {
    sample_rate: f64,
    controls: Controls,
    previous: Controls,
    controls_init: bool,
    trig_level: f32,
    capture: [SegmentCapture; MAX_SEGMENTS],
    learned_capture: [SegmentCapture; MAX_SEGMENTS],
    learned_count: i32,
    have_learned: bool,
    base_prog: [ChordSlot; MAX_SEGMENTS],
    base_count: i32,
    playback: [ChordSlot; MAX_SEGMENTS],
    playback_count: i32,
    ready: bool,
    held_notes: [bool; 128],
    held_velocity: [u8; 128],
    active_notes: [u8; MAX_CHORD_NOTES],
    active_count: usize,
    active_channel: i32,
    last_input_channel: i32,
    off_pending: bool,
    pending_off_beat: f64,
    arpeggio_step: u32,
    comp: CompState,
    variation: Variation,
    was_playing: bool,
    last_abs_beats: f64,
    clock_beat: f64,
    clock_on: bool,
    last_t: f64,
    pending_panic: bool,
    scratch: DpScratch,
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
            controls_init: false,
            trig_level: 0.0,
            capture: [SegmentCapture::empty(); MAX_SEGMENTS],
            learned_capture: [SegmentCapture::empty(); MAX_SEGMENTS],
            learned_count: 0,
            have_learned: false,
            base_prog: [ChordSlot::empty(); MAX_SEGMENTS],
            base_count: 0,
            playback: [ChordSlot::empty(); MAX_SEGMENTS],
            playback_count: 0,
            ready: false,
            held_notes: [false; 128],
            held_velocity: [0; 128],
            active_notes: [0; MAX_CHORD_NOTES],
            active_count: 0,
            active_channel: 1,
            last_input_channel: 1,
            off_pending: false,
            pending_off_beat: 0.0,
            arpeggio_step: 0,
            comp: CompState::new(),
            variation: Variation::new(),
            was_playing: false,
            last_abs_beats: 0.0,
            clock_beat: 0.0,
            clock_on: false,
            last_t: 0.0,
            pending_panic: false,
            scratch: DpScratch::empty(),
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

fn cycle_beats(c: &Controls, beats_per_bar: f64) -> f64 {
    (c.cycle_bars as f64 * beats_per_bar).clamp(1.0, MAX_SEGMENTS as f64 * beats_per_bar)
}

fn segment_beats(c: &Controls, beats_per_bar: f64) -> f64 {
    match c.granularity {
        0 => 1.0,
        1 => {
            let half = beats_per_bar * 0.5;
            if half > 0.5 { half } else { 0.5 }
        }
        _ => {
            if beats_per_bar > 1.0 { beats_per_bar } else { 1.0 }
        }
    }
}

fn segment_count(c: &Controls, beats_per_bar: f64) -> i32 {
    lround(cycle_beats(c, beats_per_bar) / segment_beats(c, beats_per_bar)).clamp(1, MAX_SEGMENTS as i32)
}

fn wrapped_cycle_position(abs_beats: f64, c: &Controls, beats_per_bar: f64) -> f64 {
    let cycle = cycle_beats(c, beats_per_bar);
    let mut local = abs_beats % cycle;
    if local < 0.0 {
        local += cycle;
    }
    local
}

fn segment_index_for_time(c: &Controls, beats_per_bar: f64, count: i32, abs_beats: f64) -> i32 {
    let cycle_pos = wrapped_cycle_position(abs_beats, c, beats_per_bar);
    let seg_beats = segment_beats(c, beats_per_bar);
    let mut index = floor_i64((cycle_pos + BEAT_EPSILON) / seg_beats) as i32;
    if index >= count {
        index = count - 1;
    }
    index.clamp(0, count - 1)
}

fn frame_for_beat(abs_start: f64, abs_end: f64, frames: u32, target: f64) -> u32 {
    if frames == 0 || abs_end <= abs_start + 1e-12 {
        return 0;
    }
    let t = ((target - abs_start) / (abs_end - abs_start)).clamp(0.0, 1.0);
    lround(t * frames as f64).clamp(0, frames as i32) as u32
}

impl State {
    fn emit(&mut self, frame: u32, status: u8, a: u8, b: u8) {
        if (self.midi_out_count as usize) >= MIDI_OUT_CAPACITY {
            return;
        }
        self.midi_out[self.midi_out_count as usize] =
            MidiEvent { frame, size: 3, data: [status, a, b] };
        self.midi_out_count += 1;
    }

    fn output_channel(&self) -> i32 {
        if self.controls.output_channel == 0 {
            self.last_input_channel.clamp(1, 16)
        } else {
            self.controls.output_channel.clamp(1, 16)
        }
    }

    fn emit_note_on(&mut self, frame: u32, note: i32, velocity: i32) {
        let status = 0x90 | ((self.output_channel() - 1) as u8);
        self.emit(frame, status, note.clamp(0, 127) as u8, velocity.clamp(1, 127) as u8);
    }

    fn emit_note_off(&mut self, frame: u32, note: i32) {
        let status = 0x80 | ((self.output_channel() - 1) as u8);
        self.emit(frame, status, note.clamp(0, 127) as u8, 0);
    }

    fn emit_cc(&mut self, frame: u32, controller: i32, value: i32, channel: i32) {
        let status = 0xB0 | ((channel.clamp(1, 16) - 1) as u8);
        self.emit(frame, status, controller.clamp(0, 127) as u8, value.clamp(0, 127) as u8);
    }

    /// Render one slot through the arpeggio rotation, sounding only the
    /// rotating window of its chord tones. Sorted ascending, as played.
    fn render_slot(&mut self, slot: &ChordSlot, advance: bool, out: &mut ChordSlot) {
        *out = ChordSlot::empty();
        if !slot.valid {
            return;
        }
        *out = *slot;
        let arpeggio = self.controls.arpeggio.clamp(0.0, 1.0);
        if arpeggio <= 0.0001 || slot.note_count <= 1 {
            return;
        }
        let source_count = (slot.note_count as i32).clamp(1, MAX_CHORD_NOTES as i32) as usize;
        let emit_count = (lround(1.0 + (1.0 - arpeggio as f64) * (source_count - 1) as f64)
            .clamp(1, source_count as i32)) as usize;
        let start = (self.arpeggio_step as usize) % source_count;
        out.note_count = emit_count as u8;
        out.notes = [0; MAX_CHORD_NOTES];
        for i in 0..emit_count {
            out.notes[i] = slot.notes[(start + i) % source_count];
        }
        let (head, _) = out.notes.split_at_mut(emit_count);
        for i in 1..emit_count {
            let mut j = i;
            while j > 0 && head[j - 1] > head[j] {
                head.swap(j - 1, j);
                j -= 1;
            }
        }
        if advance {
            self.arpeggio_step += 1;
        }
    }

    fn transition_to_slot(&mut self, frame: u32, slot: Option<ChordSlot>, retrigger: bool, advance: bool) {
        let mut rendered = ChordSlot::empty();
        if let Some(source) = slot {
            let mut tmp = ChordSlot::empty();
            self.render_slot(&source, advance, &mut tmp);
            rendered = tmp;
        }
        let effective = if rendered.valid { Some(rendered) } else { None };
        let next_count = effective.map(|s| s.note_count as usize).unwrap_or(0);
        let channel = self.output_channel();

        if retrigger {
            if let Some(slot) = effective {
                for i in 0..self.active_count {
                    let note = self.active_notes[i];
                    self.emit_note_off(frame, note as i32);
                }
                // The channel follows the new notes, not the old ones.
                for i in 0..slot.note_count as usize {
                    let note = slot.notes[i];
                    let status = 0x90 | ((channel - 1) as u8);
                    self.emit(frame, status, note, slot.velocity);
                }
                self.active_count = slot.note_count as usize;
                self.active_channel = channel;
                for i in 0..slot.note_count as usize {
                    self.active_notes[i] = slot.notes[i];
                }
                return;
            }
        }

        for i in 0..self.active_count {
            let note = self.active_notes[i];
            let mut held = false;
            if let Some(slot) = effective {
                for j in 0..next_count {
                    if slot.notes[j] == note {
                        held = true;
                        break;
                    }
                }
            }
            if !held {
                let status = 0x80 | ((self.active_channel - 1).max(0) as u8);
                self.emit(frame, status, note, 0);
            }
        }
        if let Some(slot) = effective {
            for i in 0..slot.note_count as usize {
                let note = slot.notes[i];
                if !self.active_notes[..self.active_count].contains(&note) {
                    let status = 0x90 | ((channel - 1) as u8);
                    self.emit(frame, status, note, slot.velocity);
                }
            }
            self.active_channel = channel;
        }
        self.active_count = next_count;
        if let Some(slot) = effective {
            for i in 0..next_count {
                self.active_notes[i] = slot.notes[i];
            }
        }
    }

    fn silence_harmony(&mut self, frame: u32) {
        self.clear_pending_off();
        self.transition_to_slot(frame, None, false, false);
    }

    /// All notes off, out the MIDI port: every held harmony note plus CC 123
    /// and 120 on both the sounding channel and the configured one, so a
    /// stuck note has nowhere to hide.
    fn panic_harmony(&mut self, frame: u32) {
        for i in 0..self.active_count {
            let status = 0x80 | ((self.active_channel - 1).max(0) as u8);
            self.emit(frame, status, self.active_notes[i], 0);
        }
        let current = self.active_channel.clamp(1, 16);
        self.emit_cc(frame, 123, 0, current);
        self.emit_cc(frame, 120, 0, current);
        let configured = self.output_channel();
        if configured != current {
            self.emit_cc(frame, 123, 0, configured);
            self.emit_cc(frame, 120, 0, configured);
        }
        self.active_count = 0;
        self.clear_pending_off();
    }
}

impl State {
    fn meter_beats_per_bar(&self) -> f64 {
        if (self.transport.valid & VALID_METER) != 0 && self.transport.numerator > 0 {
            self.transport.numerator as f64
        } else {
            4.0
        }
    }

    fn playing(&self) -> bool {
        self.transport.playing != 0
            && (self.transport.valid & VALID_BEAT) != 0
            && (self.transport.valid & VALID_BPM) != 0
            && self.transport.bpm > 0.0
            && self.meter_beats_per_bar() > 0.0
    }

    /// Accumulate how long the held notes sound through an interval, into
    /// the segment the interval starts in. Duration is what teaches the
    /// harmony which pitch classes matter.
    fn capture_interval(&mut self, beats_per_bar: f64, segment_count: i32, abs_start: f64, abs_end: f64) {
        if abs_end <= abs_start + 1e-12 || segment_count <= 0 {
            return;
        }
        let segment = segment_index_for_time(&self.controls, beats_per_bar, segment_count, abs_start + BEAT_EPSILON);
        let length = abs_end - abs_start;
        for note in 0..128 {
            if self.held_notes[note] {
                self.capture[segment as usize].duration[note % 12] += length;
            }
        }
    }

    /// An onset teaches more than duration alone: a struck note counts extra,
    /// struck on the bar more extra still, and its timing bin feeds comping.
    fn capture_onset(&mut self, beats_per_bar: f64, segment_count: i32, abs_beats: f64, note: u8, velocity: u8) {
        if segment_count <= 0 {
            return;
        }
        let segment =
            segment_index_for_time(&self.controls, beats_per_bar, segment_count, abs_beats + BEAT_EPSILON) as usize;
        let seg_beats = segment_beats(&self.controls, beats_per_bar);
        let cycle_pos = wrapped_cycle_position(abs_beats, &self.controls, beats_per_bar);
        let segment_pos = cycle_pos % seg_beats;
        let mut bonus = 0.35 + (velocity as f64 / 127.0) * 0.65;
        if segment_pos < 0.12f64.max(seg_beats * 0.15) {
            bonus *= 1.15;
        }
        let capture = &mut self.capture[segment];
        capture.onset[note as usize % 12] += bonus;
        if seg_beats > 0.0 && bonus > 0.0001 {
            let rel = (segment_pos / seg_beats).clamp(0.0, 0.999999);
            let mut bin = (rel * TIMING_BINS as f64) as usize;
            if bin >= TIMING_BINS {
                bin = TIMING_BINS - 1;
            }
            capture.timing_bins[bin] += bonus;
            capture.onset_total += bonus;
        }
    }

    /// Fit the capture to chords at a cycle boundary, keeping the learned
    /// material for variation to work from. True when the base moved.
    fn update_base_from_capture(&mut self, segment_count: i32) -> bool {
        let mut built = [ChordSlot::empty(); MAX_SEGMENTS];
        let options = BuildOptions::plain();
        if !build_progression_from_capture(
            &self.capture,
            segment_count as usize,
            &self.controls,
            None,
            &options,
            &mut built,
            &mut self.scratch,
        ) {
            return false;
        }
        clear_progression(&mut self.base_prog);
        copy_progression(&mut self.base_prog, &built, segment_count as usize);
        self.base_count = segment_count;
        self.ready = true;
        clear_capture(&mut self.learned_capture);
        copy_capture(&mut self.learned_capture, &self.capture, segment_count as usize);
        self.learned_count = segment_count;
        self.have_learned = true;
        true
    }

    /// Refit the playback progression from learned material, falling back to
    /// revoicing the base when there is nothing learned to fit. True when the
    /// base moved.
    fn rebuild_from_learned(&mut self) -> bool {
        if !(self.have_learned && self.learned_count > 0) {
            return false;
        }
        let mut rebuilt = [ChordSlot::empty(); MAX_SEGMENTS];
        let options = BuildOptions::plain();
        let learned_count = self.learned_count;
        let learned = self.learned_capture;
        let base = self.base_prog;
        let base_count = self.base_count;
        if build_progression_from_capture(
            &learned,
            learned_count as usize,
            &self.controls,
            Some((&base, base_count as usize)),
            &options,
            &mut rebuilt,
            &mut self.scratch,
        ) {
            clear_progression(&mut self.base_prog);
            copy_progression(&mut self.base_prog, &rebuilt, learned_count as usize);
            self.base_count = learned_count;
            self.adopt_base();
            self.ready = true;
            return true;
        }
        let segment_count = if self.base_count > 0 { self.base_count } else { self.playback_count };
        let source = if self.base_count > 0 {
            self.base_prog
        } else {
            self.playback
        };
        if self.ready && segment_count > 0 {
            let mut revoiced = [ChordSlot::empty(); MAX_SEGMENTS];
            if revoice_progression(&source, segment_count as usize, &self.controls, &options, &mut revoiced) {
                clear_progression(&mut self.base_prog);
                copy_progression(&mut self.base_prog, &revoiced, segment_count as usize);
                self.base_count = segment_count;
                self.adopt_base();
                self.ready = true;
                return true;
            }
        }
        false
    }

    fn adopt_base(&mut self) {
        clear_progression(&mut self.playback);
        copy_progression(&mut self.playback, &self.base_prog, self.base_count as usize);
        self.playback_count = self.base_count;
    }

    /// Plan this segment's comp hits: the bar, plus answers where the
    /// player played. Seeded by cycle, mutation serial, segment, root,
    /// quality and comp, so the same bar comps the same way twice.
    fn plan_comp(&mut self, segment: i32, segment_start: f64, segment_beats: f64) {
        if segment < 0 || segment >= self.playback_count {
            self.comp.reset();
            return;
        }
        let learned = if self.have_learned && segment < self.learned_count {
            Some(&self.learned_capture[segment as usize])
        } else {
            None
        };
        let slot = self.playback[segment as usize];
        let seed = (self.variation.completed_cycles as u32 & 0xffffffff)
            ^ ((self.variation.mutation_serial as u32 & 0x7fffffff).wrapping_mul(2246822519))
            ^ ((segment as u32).wrapping_mul(3266489917))
            ^ ((slot.root_pc as u32) << 10)
            ^ ((slot.quality as u32) << 18)
            ^ (lround(self.controls.comp as f64 * 1000.0) as u32);
        plan_segment(
            &mut self.comp,
            learned,
            &self.controls,
            slot.velocity,
            segment,
            segment_start,
            segment_beats,
            seed,
        );
    }

    /// Sound whatever covers a position, for restarts and seeks: plan the
    /// segment, ask the comp cursor what holds, and play it or stay silent.
    fn sync_to_position(&mut self, frame: u32, abs_beats: f64, beats_per_bar: f64, segment_count: i32) {
        if self.ready && self.playback_count == segment_count {
            let segment = segment_index_for_time(&self.controls, beats_per_bar, segment_count, abs_beats + BEAT_EPSILON);
            let seg_beats = segment_beats(&self.controls, beats_per_bar);
            let segment_start = (floor_i64((abs_beats + BEAT_EPSILON) / seg_beats) as f64) * seg_beats;
            self.plan_comp(segment, segment_start, seg_beats);
            let (should_sound, off_beat) = comp_sync(&mut self.comp, abs_beats);
            if should_sound {
                let slot = self.playback[segment as usize];
                self.transition_to_slot(frame, Some(slot), false, false);
                self.schedule_off(off_beat);
            } else {
                self.silence_harmony(frame);
            }
        } else {
            self.comp.reset();
            self.silence_harmony(frame);
        }
    }

    fn schedule_off(&mut self, abs_off_beat: f64) {
        self.clear_pending_off();
        if self.active_count == 0 || abs_off_beat <= 0.0 {
            return;
        }
        if self.controls.note_length.clamp(0.10, 1.0) >= 0.995 {
            return;
        }
        self.off_pending = true;
        self.pending_off_beat = abs_off_beat;
        set_release(&mut self.comp, abs_off_beat);
    }

    fn clear_pending_off(&mut self) {
        self.off_pending = false;
        self.pending_off_beat = 0.0;
        clear_release(&mut self.comp);
    }

    fn clear_held(&mut self) {
        self.held_notes = [false; 128];
        self.held_velocity = [0; 128];
    }

    fn clear_learning(&mut self) {
        clear_capture(&mut self.capture);
        clear_capture(&mut self.learned_capture);
        self.learned_count = 0;
        self.have_learned = false;
        clear_progression(&mut self.base_prog);
        self.base_count = 0;
        clear_progression(&mut self.playback);
        self.playback_count = 0;
        self.ready = false;
        self.clear_held();
        self.clear_pending_off();
        self.active_count = 0;
        self.active_channel = 1;
        self.last_input_channel = 1;
        self.arpeggio_step = 0;
        self.comp.reset();
        self.variation.reset();
    }

    fn is_note_message(size: u8, b0: u8) -> bool {
        if size < 2 {
            return false;
        }
        let kind = b0 & 0xf0;
        (kind == 0x80 || kind == 0x90) && size >= 3
    }

    fn forward_input(&mut self, event: &MidiEvent) {
        if self.controls.pass_input {
            self.push_forwarded(event);
        } else if !Self::is_note_message(event.size, event.data[0]) {
            self.push_forwarded(event);
        }
    }

    fn push_forwarded(&mut self, event: &MidiEvent) {
        if (self.midi_out_count as usize) >= MIDI_OUT_CAPACITY {
            return;
        }
        self.midi_out[self.midi_out_count as usize] = *event;
        self.midi_out_count += 1;
    }
}

struct Cursor {
    beats: f64,
    boundary_idx: i64,
    next_boundary: f64,
}

impl State {
    /// At a segment boundary: fold the finished cycle's capture into the
    /// base progression, mutate the playback for the new cycle, and plan
    /// this segment's comp. Silence first, so a changed chord never overlaps
    /// the one it replaces.
    fn handle_boundary(
        &mut self,
        frame: u32,
        abs_boundary_beat: f64,
        beats_per_bar: f64,
        segment_count: i32,
    ) {
        let seg_beats = segment_beats(&self.controls, beats_per_bar);
        let boundary_idx = round_i64(abs_boundary_beat / seg_beats);
        let cycle_boundary =
            segment_count > 0 && boundary_idx % segment_count as i64 == 0;

        if cycle_boundary {
            let base_updated = self.update_base_from_capture(segment_count);
            clear_capture(&mut self.capture);
            if self.ready && self.base_count == segment_count {
                let learned = if self.have_learned {
                    Some((&self.learned_capture[..], self.learned_count as usize))
                } else {
                    None
                };
                let mut varied = [ChordSlot::empty(); MAX_SEGMENTS];
                let base = self.base_prog;
                let base_count = self.base_count;
                let previous = self.playback;
                let previous_count = self.playback_count;
                let controls = self.controls;
                let mutated = apply_cycle_variation(
                    learned,
                    &controls,
                    &mut self.variation,
                    &base,
                    base_count as usize,
                    &previous,
                    previous_count as usize,
                    &mut varied,
                    &mut self.scratch,
                );
                if mutated {
                    clear_progression(&mut self.playback);
                    copy_progression(&mut self.playback, &varied, base_count as usize);
                    self.playback_count = base_count;
                } else if base_updated || self.playback_count != self.base_count {
                    self.adopt_base();
                }
            }
        }

        if self.ready && self.playback_count == segment_count {
            let segment = segment_index_for_time(
                &self.controls,
                beats_per_bar,
                segment_count,
                abs_boundary_beat + BEAT_EPSILON,
            );
            self.silence_harmony(frame);
            self.plan_comp(segment, abs_boundary_beat, seg_beats);
        } else {
            self.comp.reset();
            self.silence_harmony(frame);
        }
    }

    /// Walk the timeline to a target beat, handling whatever comes first at
    /// each marker: a segment boundary, a comp hit, or a scheduled release.
    /// Capture is folded in between markers, so held notes teach exactly the
    /// span they sound through.
    #[allow(clippy::too_many_arguments)]
    fn process_timeline_until(
        &mut self,
        nframes: u32,
        abs_start: f64,
        abs_end: f64,
        target: f64,
        beats_per_bar: f64,
        segment_count: i32,
        cursor: &mut Cursor,
    ) {
        let mut target = target;
        if target < cursor.beats {
            target = cursor.beats;
        }
        let seg_beats = segment_beats(&self.controls, beats_per_bar);
        loop {
            let boundary_due = cursor.next_boundary <= target + BEAT_EPSILON;
            let next_hit = next_hit_beat(&self.comp);
            let hit_due = next_hit <= target + BEAT_EPSILON;
            let off_due =
                self.off_pending && self.pending_off_beat <= target + BEAT_EPSILON;
            if !boundary_due && !hit_due && !off_due {
                break;
            }
            let marker: f64;
            let mut do_boundary = false;
            let mut do_hit = false;
            if boundary_due
                && (!hit_due || cursor.next_boundary <= next_hit + BEAT_EPSILON)
                && (!off_due || cursor.next_boundary <= self.pending_off_beat + BEAT_EPSILON)
            {
                marker = cursor.next_boundary;
                do_boundary = true;
            } else if hit_due && (!off_due || next_hit <= self.pending_off_beat + BEAT_EPSILON) {
                marker = next_hit;
                do_hit = true;
            } else {
                marker = self.pending_off_beat;
            }
            if marker > cursor.beats + 1e-12 {
                self.capture_interval(beats_per_bar, segment_count, cursor.beats, marker);
            }
            let frame = frame_for_beat(abs_start, abs_end, nframes, marker);
            if do_boundary {
                self.handle_boundary(frame, marker, beats_per_bar, segment_count);
                cursor.boundary_idx += 1;
                cursor.next_boundary = cursor.boundary_idx as f64 * seg_beats;
            } else if do_hit {
                if let Some(hit) = take_due_hit(&mut self.comp, marker) {
                    if self.comp.segment_index >= 0
                        && self.comp.segment_index < self.playback_count
                    {
                        let mut slot =
                            self.playback[self.comp.segment_index as usize];
                        slot.velocity = hit.velocity;
                        let advance = true;
                        self.transition_to_slot(frame, Some(slot), true, advance);
                        self.schedule_off(hit.off_beat);
                    }
                }
            } else {
                self.silence_harmony(frame);
            }
            cursor.beats = marker;
        }
        if target > cursor.beats + 1e-12 {
            self.capture_interval(beats_per_bar, segment_count, cursor.beats, target);
            cursor.beats = target;
        }
    }
}

impl State {
    fn take_input(&mut self) -> usize {
        let count = self.midi_in_count.min(MIDI_IN_CAPACITY as u32);
        self.midi_in_count = 0;
        count as usize
    }

    fn process(&mut self, frames: u32) {
        self.midi_out_count = 0;
        if self.pending_panic {
            self.pending_panic = false;
            self.panic_harmony(0);
            self.active_count = 0;
        }

        let clamped = clamp_controls(&self.controls);
        if !self.controls_init {
            self.previous = clamped;
            self.controls_init = true;
        }

        let learn_triggered = clamped.action_learn != self.previous.action_learn;
        let timing_changed =
            clamped.cycle_bars != self.previous.cycle_bars || clamped.granularity != self.previous.granularity;
        let params_changed = !harmony_matches(&clamped, &self.previous);
        let vary_changed = (clamped.vary - self.previous.vary).abs() >= 0.0001;
        let comp_changed = (clamped.comp - self.previous.comp).abs() >= 0.0001;
        let arpeggio_changed = (clamped.arpeggio - self.previous.arpeggio).abs() >= 0.0001;

        if learn_triggered || timing_changed {
            self.silence_harmony(0);
            self.clear_learning();
        } else if params_changed {
            self.silence_harmony(0);
            self.clear_pending_off();
            self.comp.reset();
            self.arpeggio_step = 0;
            if !self.rebuild_from_learned() {
                self.clear_learning();
            }
        } else if vary_changed {
            self.variation.reset();
        } else if comp_changed || arpeggio_changed {
            self.silence_harmony(0);
            self.clear_pending_off();
            self.comp.reset();
            if arpeggio_changed {
                self.arpeggio_step = 0;
            }
        }
        self.controls = clamped;
        self.previous = clamped;

        let playing = self.playing();
        // Snapshot the input queue: the timeline below consumes it in beat
        // order while the count is reset for the next block.
        let mut input = [MidiEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_IN_CAPACITY];
        let input_count = self.take_input().min(MIDI_IN_CAPACITY as usize);
        for i in 0..input_count {
            input[i] = self.midi_in[i];
        }

        if !playing {
            if self.was_playing || self.active_count > 0 || self.off_pending {
                self.panic_harmony(0);
            } else {
                self.silence_harmony(0);
            }
            self.clear_held();
            self.was_playing = false;
            self.clock_on = false;
            for i in 0..input_count {
                self.forward_input(&input[i]);
            }
            return;
        }

        let beats_per_bar = self.meter_beats_per_bar();
        let segment_count = segment_count(&self.controls, beats_per_bar);
        let mismatch = (self.playback_count > 0 && self.playback_count != segment_count)
            || (self.base_count > 0 && self.base_count != segment_count);
        if mismatch {
            self.silence_harmony(0);
            clear_capture(&mut self.capture);
            clear_capture(&mut self.learned_capture);
            clear_progression(&mut self.base_prog);
            clear_progression(&mut self.playback);
            self.base_count = 0;
            self.playback_count = 0;
            self.ready = false;
            self.have_learned = false;
            self.learned_count = 0;
            self.arpeggio_step = 0;
            self.comp.reset();
            self.variation.reset();
        }

        // The beat clock flywheels between transport messages: see drumgen.
        let beats_step = (frames as f64 * self.transport.bpm) / (60.0 * self.sample_rate);
        let t_beat = self.transport.beat;
        let base = if !self.was_playing || !self.clock_on {
            self.clock_on = true;
            self.last_t = t_beat;
            t_beat
        } else if t_beat != self.last_t {
            self.last_t = t_beat;
            if t_beat < self.clock_beat - 1.0 || t_beat > self.clock_beat + 1.0 {
                t_beat
            } else {
                self.clock_beat
            }
        } else {
            self.clock_beat
        };
        let abs_end = base + beats_step;

        let seg_beats = segment_beats(&self.controls, beats_per_bar);
        let restart = !self.was_playing || base + BEAT_EPSILON < self.last_abs_beats;
        let phase = base % seg_beats;
        let phase = if phase < 0.0 { phase + seg_beats } else { phase };
        let on_boundary = phase < BEAT_EPSILON || (phase - seg_beats).abs() < BEAT_EPSILON;
        if restart && !on_boundary {
            self.sync_to_position(0, base, beats_per_bar, segment_count);
        }

        let mut cursor = Cursor {
            beats: base,
            boundary_idx: ceil_i64((base - BEAT_EPSILON) / seg_beats),
            next_boundary: 0.0,
        };
        cursor.next_boundary = cursor.boundary_idx as f64 * seg_beats;

        let frames_nz = frames.max(1);
        for i in 0..input_count {
            let event = &input[i];
            if event.size < 2 {
                continue;
            }
            if (event.data[0] & 0xf0) != 0xf0 {
                self.last_input_channel = (event.data[0] & 0x0f) as i32 + 1;
            }
            let event_beats =
                base + (event.frame.min(frames_nz - 1) as f64 / frames_nz as f64) * beats_step;
            self.process_timeline_until(
                frames, base, abs_end, event_beats, beats_per_bar, segment_count, &mut cursor,
            );
            self.forward_input(event);
            let kind = event.data[0] & 0xf0;
            if (kind == 0x90 || kind == 0x80) && event.size >= 3 {
                let note = (event.data[1] & 0x7f) as usize;
                let velocity = (event.data[2] & 0x7f) as u8;
                if kind == 0x90 && velocity > 0 {
                    self.held_notes[note] = true;
                    self.held_velocity[note] = velocity;
                    self.capture_onset(beats_per_bar, segment_count, event_beats, note as u8, velocity);
                } else {
                    self.held_notes[note] = false;
                    self.held_velocity[note] = 0;
                }
            }
        }
        self.process_timeline_until(frames, base, abs_end, abs_end, beats_per_bar, segment_count, &mut cursor);

        self.was_playing = true;
        self.last_abs_beats = base;
        self.clock_beat = abs_end;
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
    s.controls = Controls::new();
    s.previous = s.controls;
    s.controls_init = true;
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 {
    MAX_FRAMES as u32
}

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    match index {
        0 => s.controls.key = value as i32,
        1 => s.controls.scale = value as i32,
        2 => s.controls.cycle_bars = value as i32,
        3 => s.controls.granularity = value as i32,
        4 => s.controls.complexity = value,
        5 => s.controls.movement = value,
        6 => s.controls.chord_size = value as i32,
        7 => s.controls.note_length = value,
        8 => s.controls.reg = value as i32,
        9 => s.controls.spread = value,
        10 => s.controls.pass_input = value >= 0.5,
        11 => s.controls.output_channel = value as i32,
        // The learn trigger fires on the rising edge: a held 1 is one
        // press, not a held button, and the counter is what the engine
        // compares.
        12 => {
            if value > 0.5 && s.trig_level <= 0.5 {
                s.controls.action_learn = s.controls.action_learn.wrapping_add(1);
            }
            s.trig_level = value;
            return;
        }
        13 => s.controls.vary = value,
        14 => s.controls.comp = value,
        15 => s.controls.color = value,
        16 => s.controls.arpeggio = value,
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
    state().pending_panic = true;
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    state().process(frames);
}
