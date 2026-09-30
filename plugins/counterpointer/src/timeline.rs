// plugins/counterpointer/src/timeline.rs
//
// Playback and block processing, ported from downspout's
// counterpointer_engine.cpp: the learned phrase walks the segment grid,
// note-ons and note-offs schedule against absolute beats, held input notes
// teach the capture between markers, and segment boundaries rebuild the
// phrase from the finished cycle's capture.

use crate::phrase::{
    build_phrase_from_capture, clamp_controls, frame_for_beat,
    phrase_matches, segment_beats, segment_count, segment_index_for_time,
    wrapped_cycle_position, maybe_vary_phrase, Controls, PhraseHit, PhraseState,
    SegmentCapture, Variation, BEAT_EPSILON, MAX_HITS_PER_SEGMENT, MAX_SEGMENTS, TIMING_BINS,
};

pub const MIDI_OUT_CAPACITY: usize = 2048;

/// One scheduled MIDI event: an absolute frame offset plus three bytes.
/// The fourth byte the VST core carries never reaches the wire here.
#[derive(Clone, Copy, Default)]
pub struct EngineEvent {
    pub frame: u32,
    pub size: u8,
    pub data: [u8; 3],
}

/// The produced events, borrowed from the static state: a 2048 entry buffer
/// does not fit the WebAssembly stack, so it lives in the state and this is
/// only the cursor over it.
pub struct EngineOut<'a> {
    pub buf: &'a mut [EngineEvent],
    pub count: usize,
}

impl<'a> EngineOut<'a> {
    pub fn push(&mut self, event: EngineEvent) {
        if self.count < self.buf.len() {
            self.buf[self.count] = event;
            self.count += 1;
        }
    }

    pub fn push_bytes(&mut self, frame: u32, size: u8, b0: u8, b1: u8, b2: u8) {
        self.push(EngineEvent { frame, size, data: [b0, b1, b2] });
    }
}

pub struct EngineState {
    pub controls: Controls,
    pub previous: Controls,
    pub controls_init: bool,
    pub capture: [SegmentCapture; MAX_SEGMENTS],
    pub base_phrase: PhraseState,
    pub playback: PhraseState,
    pub variation: Variation,
    pub held_notes: [bool; 128],
    pub held_velocity: [u8; 128],
    pub was_playing: bool,
    pub last_abs_beats: f64,
    pub last_input_channel: i32,
    pub active_output: bool,
    pub active_output_note: u8,
    pub active_output_channel: i32,
    pub note_off_pending: bool,
    pub pending_off_beat: f64,
    pub note_on_pending: bool,
    pub pending_hit_active: [bool; MAX_HITS_PER_SEGMENT],
    pub pending_hit_beat: [f64; MAX_HITS_PER_SEGMENT],
    pub pending_hits: [PhraseHit; MAX_HITS_PER_SEGMENT],
}

impl EngineState {
    pub const fn new() -> Self {
        EngineState {
            controls: Controls::new(),
            previous: Controls::new(),
            controls_init: false,
            capture: [SegmentCapture::empty(); MAX_SEGMENTS],
            base_phrase: PhraseState::empty(),
            playback: PhraseState::empty(),
            variation: Variation::new(),
            held_notes: [false; 128],
            held_velocity: [0; 128],
            was_playing: false,
            last_abs_beats: 0.0,
            last_input_channel: 1,
            active_output: false,
            active_output_note: 60,
            active_output_channel: 1,
            note_off_pending: false,
            pending_off_beat: 0.0,
            note_on_pending: false,
            pending_hit_active: [false; MAX_HITS_PER_SEGMENT],
            pending_hit_beat: [0.0; MAX_HITS_PER_SEGMENT],
            pending_hits: [PhraseHit {
                active: false,
                note: 60,
                velocity: 96,
                onset: 0.0,
                gate: 0.7,
            }; MAX_HITS_PER_SEGMENT],
        }
    }

    fn clear_capture(&mut self) {
        self.capture = [SegmentCapture::empty(); MAX_SEGMENTS];
    }

    fn clear_held(&mut self) {
        self.held_notes = [false; 128];
        self.held_velocity = [0; 128];
    }

    fn reset_learned(&mut self) {
        self.clear_capture();
        self.base_phrase = PhraseState::empty();
        self.playback = PhraseState::empty();
        self.variation.reset();
    }

    fn resolve_output_channel(&self, configured: i32) -> i32 {
        if configured == 0 {
            self.last_input_channel.clamp(1, 16)
        } else {
            configured.clamp(1, 16)
        }
    }

    fn emit_note_on(&mut self, out: &mut EngineOut, frame: u32, note: i32, velocity: i32, channel: i32) {
        let status = 0x90 | ((channel.clamp(1, 16) - 1) as u8);
        out.push_bytes(frame, 3, status, note.clamp(0, 127) as u8, velocity.clamp(1, 127) as u8);
    }

    fn emit_note_off(&mut self, out: &mut EngineOut, frame: u32, note: i32, channel: i32) {
        let status = 0x80 | ((channel.clamp(1, 16) - 1) as u8);
        out.push_bytes(frame, 3, status, note.clamp(0, 127) as u8, 0);
    }

    pub fn silence_output(&mut self, out: &mut EngineOut, frame: u32) {
        if self.active_output {
            let note = self.active_output_note;
            let channel = self.active_output_channel;
            self.emit_note_off(out, frame, note as i32, channel);
        }
        self.active_output = false;
        self.note_off_pending = false;
        self.note_on_pending = false;
        self.pending_hit_active = [false; MAX_HITS_PER_SEGMENT];
    }

    fn capture_interval(&mut self, beats_per_bar: f64, count: i32, abs_start: f64, abs_end: f64) {
        if abs_end <= abs_start + 1e-12 || count <= 0 {
            return;
        }
        let segment = segment_index_for_time(&self.controls, beats_per_bar, count, abs_start + BEAT_EPSILON);
        for note in 0..128 {
            if !self.held_notes[note] {
                continue;
            }
            self.capture[segment as usize].duration[note % 12] += abs_end - abs_start;
        }
    }

    fn capture_onset(&mut self, beats_per_bar: f64, count: i32, abs_beats: f64, note: u8, velocity: u8) {
        if count <= 0 {
            return;
        }
        let segment = segment_index_for_time(&self.controls, beats_per_bar, count, abs_beats + BEAT_EPSILON);
        let seg_beats = segment_beats(&self.controls, beats_per_bar);
        let cycle_pos = wrapped_cycle_position(abs_beats, &self.controls, beats_per_bar);
        let mut segment_pos = cycle_pos % seg_beats;
        if segment_pos < 0.0 {
            segment_pos += seg_beats;
        }
        let rel = (segment_pos / seg_beats).clamp(0.0, 0.999999);
        let bin = ((rel * TIMING_BINS as f64) as usize).clamp(0, TIMING_BINS - 1);
        let weight = 0.35 + (velocity as f64 / 127.0) * 0.65;
        let capture = &mut self.capture[segment as usize];
        capture.onset_weight += weight;
        capture.note_sum += note as f64 * weight;
        capture.velocity_sum += velocity as f64 * weight;
        capture.timing_bins[bin] += weight;
    }

    fn schedule_segment(&mut self, segment_start_beat: f64, seg_beats: f64, segment_index: i32) {
        self.note_on_pending = false;
        if !self.playback.ready
            || segment_index < 0
            || segment_index >= self.playback.segment_count
        {
            return;
        }
        let step = self.playback.steps[segment_index as usize];
        if !step.active {
            return;
        }
        self.pending_hit_active = [false; MAX_HITS_PER_SEGMENT];
        self.note_on_pending = false;
        for i in 0..step.hit_count as usize {
            let hit = step.hits[i];
            if !hit.active {
                continue;
            }
            self.pending_hits[i] = hit;
            self.pending_hit_beat[i] = segment_start_beat + hit.onset * seg_beats;
            self.pending_hit_active[i] = true;
            self.note_on_pending = true;
        }
    }

    /// Round half away from zero, for the beat indices downspout llrounds.
    fn round_i64(v: f64) -> i64 {
        if v >= 0.0 { (v + 0.5) as i64 } else { (v - 0.5) as i64 }
    }

    fn handle_boundary(
        &mut self,
        out: &mut EngineOut,
        frame: u32,
        abs_boundary_beat: f64,
        beats_per_bar: f64,
        count: i32,
    ) {
        let seg_beats = segment_beats(&self.controls, beats_per_bar);
        let boundary_index = Self::round_i64(abs_boundary_beat / seg_beats);
        let cycle_boundary = count > 0 && boundary_index % count as i64 == 0;

        if cycle_boundary {
            if !self.controls.freeze {
                let mut built = PhraseState::empty();
                let controls = self.controls;
                if build_phrase_from_capture(&self.capture, count, &controls, &self.variation, &mut built) {
                    self.base_phrase = built;
                    self.playback = built;
                }
            }
            self.clear_capture();
            if self.variation.completed_cycles < i64::MAX {
                self.variation.completed_cycles += 1;
            }
            let controls = self.controls;
            maybe_vary_phrase(&controls, &mut self.variation, &mut self.playback);
        }

        if self.playback.ready && self.playback.segment_count == count {
            let segment = segment_index_for_time(&self.controls, beats_per_bar, count, abs_boundary_beat + BEAT_EPSILON);
            self.schedule_segment(abs_boundary_beat, seg_beats, segment);
        } else {
            self.silence_output(out, frame);
        }
    }

    fn is_note_message(size: u8, b0: u8) -> bool {
        if size < 2 {
            return false;
        }
        let kind = b0 & 0xf0;
        (kind == 0x80 || kind == 0x90) && size >= 3
    }

    fn forward_input(&self, out: &mut EngineOut, event: &EngineEvent) {
        if self.controls.pass_input {
            out.push(*event);
        } else if !Self::is_note_message(event.size, event.data[0]) {
            out.push(*event);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn process_timeline_until(
        &mut self,
        out: &mut EngineOut,
        nframes: u32,
        abs_start: f64,
        abs_end: f64,
        target: f64,
        beats_per_bar: f64,
        count: i32,
        cursor: &mut f64,
        boundary_index: &mut i64,
        next_boundary: &mut f64,
    ) {
        let mut target = target;
        if target < *cursor {
            target = *cursor;
        }
        let seg_beats = segment_beats(&self.controls, beats_per_bar);
        loop {
            let boundary_due = *next_boundary <= target + BEAT_EPSILON;
            let mut note_on_due = false;
            let mut note_on_index = 0usize;
            let mut note_on_beat = target;
            for i in 0..MAX_HITS_PER_SEGMENT {
                if !self.pending_hit_active[i] {
                    continue;
                }
                let hit_beat = self.pending_hit_beat[i];
                if hit_beat <= target + BEAT_EPSILON && (!note_on_due || hit_beat < note_on_beat) {
                    note_on_due = true;
                    note_on_index = i;
                    note_on_beat = hit_beat;
                }
            }
            self.note_on_pending = note_on_due;
            let note_off_due = self.note_off_pending && self.pending_off_beat <= target + BEAT_EPSILON;
            if !boundary_due && !note_on_due && !note_off_due {
                break;
            }
            // Earliest marker wins; a boundary at the same beat as a note
            // event rebuilds first, so the event plays the new phrase.
            let marker;
            let mut do_boundary = false;
            let mut do_note_on = false;
            if boundary_due
                && (!note_on_due || *next_boundary <= note_on_beat + BEAT_EPSILON)
                && (!note_off_due || *next_boundary <= self.pending_off_beat + BEAT_EPSILON)
            {
                marker = *next_boundary;
                do_boundary = true;
            } else if note_on_due && (!note_off_due || note_on_beat <= self.pending_off_beat + BEAT_EPSILON) {
                marker = note_on_beat;
                do_note_on = true;
            } else {
                marker = self.pending_off_beat;
            }

            if marker > *cursor + 1e-12 {
                self.capture_interval(beats_per_bar, count, *cursor, marker);
            }
            let frame = frame_for_beat(abs_start, abs_end, nframes, marker);
            if do_boundary {
                self.handle_boundary(out, frame, marker, beats_per_bar, count);
                *boundary_index += 1;
                *next_boundary = *boundary_index as f64 * seg_beats;
            } else if do_note_on {
                if self.active_output {
                    let note = self.active_output_note;
                    let channel = self.active_output_channel;
                    self.emit_note_off(out, frame, note as i32, channel);
                }
                let channel = self.resolve_output_channel(self.controls.output_channel);
                let hit = self.pending_hits[note_on_index];
                self.emit_note_on(out, frame, hit.note as i32, hit.velocity as i32, channel);
                self.active_output = true;
                self.active_output_note = hit.note;
                self.active_output_channel = channel;
                self.pending_hit_active[note_on_index] = false;
                self.note_on_pending = false;
                for active in self.pending_hit_active {
                    self.note_on_pending = self.note_on_pending || active;
                }
                self.pending_off_beat = marker + hit.gate * seg_beats;
                self.note_off_pending = true;
            } else {
                self.silence_output(out, frame);
            }
            *cursor = marker;
        }
        if target > *cursor + 1e-12 {
            self.capture_interval(beats_per_bar, count, *cursor, target);
            *cursor = target;
        }
    }
}

/// Ceiling without libm: the cursor's first boundary is the next one at or
/// after the block start, never the one just passed.
fn ceil_i64(v: f64) -> i64 {
    let t = v as i64;
    if v > 0.0 && (t as f64) != v { t + 1 } else { t }
}

pub struct BlockTransport {
    pub valid: bool,
    pub playing: bool,
    pub bpm: f64,
    pub beats_per_bar: f64,
    pub abs_start: f64,
    pub abs_end: f64,
}

/// One block through the engine. Stopped transport forwards input and holds
/// silence; rolling transport walks the timeline from the block start to its
/// end, folding held notes into the capture between markers.
pub fn process_block(
    s: &mut EngineState,
    raw: &Controls,
    t: &BlockTransport,
    nframes: u32,
    sample_rate: f64,
    input: &[EngineEvent],
    out: &mut EngineOut,
) {
    s.controls = clamp_controls(raw);
    if !s.controls_init {
        s.previous = s.controls;
        s.controls_init = true;
    }

    let learn_triggered = s.controls.action_learn != s.previous.action_learn;
    let params_changed = !phrase_matches(&s.controls, &s.previous);
    let long_random_changed = (s.controls.long_random - s.previous.long_random).abs() >= 0.0001;
    if learn_triggered || params_changed {
        s.silence_output(out, 0);
        s.reset_learned();
    } else if long_random_changed {
        s.variation.reset();
    }
    s.previous = s.controls;

    if !t.valid || !t.playing || t.bpm <= 0.0 || t.beats_per_bar <= 0.0 || sample_rate <= 0.0 {
        if s.was_playing || s.active_output || s.note_off_pending || s.note_on_pending {
            s.silence_output(out, 0);
        }
        s.clear_held();
        s.was_playing = false;
        for event in input {
            s.forward_input(out, event);
        }
        return;
    }

    let count = segment_count(&s.controls, t.beats_per_bar);
    if (s.playback.ready && s.playback.segment_count != count)
        || (s.base_phrase.ready && s.base_phrase.segment_count != count)
    {
        s.silence_output(out, 0);
        s.reset_learned();
    }

    let seg_beats = segment_beats(&s.controls, t.beats_per_bar);
    let restart = !s.was_playing || t.abs_start + BEAT_EPSILON < s.last_abs_beats;
    if restart {
        // A restart lands mid-phrase with stale pending hits; silence and
        // let the next boundary schedule fresh ones, the way the VST does.
        s.note_on_pending = false;
        s.note_off_pending = false;
        if s.active_output {
            let (note, channel) = (s.active_output_note, s.active_output_channel);
            s.emit_note_off(out, 0, note as i32, channel);
        }
        s.active_output = false;
        s.pending_hit_active = [false; MAX_HITS_PER_SEGMENT];
    }

    let mut boundary_index = ceil_i64((t.abs_start - BEAT_EPSILON) / seg_beats);
    let mut next_boundary = boundary_index as f64 * seg_beats;
    let mut cursor = t.abs_start;

    let frames_nz = nframes.max(1);
    let beats_step = t.abs_end - t.abs_start;
    for event in input {
        if event.size < 2 {
            continue;
        }
        if (event.data[0] & 0xf0) != 0xf0 {
            s.last_input_channel = (event.data[0] & 0x0f) as i32 + 1;
        }
        let event_beats = t.abs_start
            + (event.frame.min(frames_nz - 1) as f64 / frames_nz as f64) * beats_step;
        s.process_timeline_until(
            out,
            nframes,
            t.abs_start,
            t.abs_end,
            event_beats,
            t.beats_per_bar,
            count,
            &mut cursor,
            &mut boundary_index,
            &mut next_boundary,
        );
        s.forward_input(out, event);

        let kind = event.data[0] & 0xf0;
        if (kind == 0x90 || kind == 0x80) && event.size >= 3 {
            let note = (event.data[1] & 0x7f) as usize;
            let velocity = event.data[2] & 0x7f;
            if kind == 0x90 && velocity > 0 {
                s.held_notes[note] = true;
                s.held_velocity[note] = velocity;
                s.capture_onset(t.beats_per_bar, count, event_beats, note as u8, velocity);
            } else {
                s.held_notes[note] = false;
                s.held_velocity[note] = 0;
            }
        }
    }
    s.process_timeline_until(
        out,
        nframes,
        t.abs_start,
        t.abs_end,
        t.abs_end,
        t.beats_per_bar,
        count,
        &mut cursor,
        &mut boundary_index,
        &mut next_boundary,
    );

    s.was_playing = true;
    s.last_abs_beats = t.abs_start;
}
