// plugins/counterpointer/src/phrase.rs
//
// Capture and phrase building, ported from downspout's
// counterpointer_engine.cpp: per-segment onset, pitch, velocity and timing
// capture across a transport-synced cycle, fitted at each cycle boundary to
// a monophonic counter-phrase by scoring candidates over scale membership,
// register fit, consonance, voice leading and follow/counter motion, with a
// strict fugal answering path and a Bass Descend response mode.
//
// One deliberate deviation, marked where it happens: the mutation interval
// uses the square where the original raises to 2.5, because core has no pow;
// the cadence port carries the same substitution.

use crate::rng::{mix_u32, Rng};
use crate::scales::{is_jazz_scale, nearest_scale_note, scale_contains, wrap12, SCALE_COUNT};

pub const MAX_SEGMENTS: usize = 32;
pub const TIMING_BINS: usize = 8;
pub const MAX_HITS_PER_SEGMENT: usize = 3;
pub const BEAT_EPSILON: f64 = 0.000001;

pub const RESPONSE_COUNTERPOINT: i32 = 0;
pub const RESPONSE_BASS_DESCEND: i32 = 1;

#[derive(Clone, Copy)]
pub struct Controls {
    pub key: i32,
    pub scale: i32,
    pub cycle_bars: i32,
    pub granularity: i32,
    pub follow: f32,
    pub counter: f32,
    pub short_random: f32,
    pub long_random: f32,
    pub density: f32,
    pub rhythm_follow: f32,
    pub syncopation: f32,
    pub consonance: f32,
    pub color: f32,
    pub embellish: f32,
    pub regularity: f32,
    pub reg: i32,
    pub span: f32,
    pub gate: f32,
    pub velocity_follow: f32,
    pub pass_input: bool,
    pub output_channel: i32,
    pub action_learn: u32,
    pub freeze: bool,
    pub response_mode: i32,
}

impl Controls {
    pub const fn new() -> Self {
        Controls {
            key: 0,
            scale: 3,
            cycle_bars: 2,
            granularity: 0,
            follow: 0.55,
            counter: 0.55,
            short_random: 0.15,
            long_random: 0.0,
            density: 0.78,
            rhythm_follow: 0.65,
            syncopation: 0.25,
            consonance: 0.75,
            color: 0.0,
            embellish: 0.25,
            regularity: 0.65,
            reg: 1,
            span: 0.55,
            gate: 0.72,
            velocity_follow: 0.65,
            pass_input: true,
            output_channel: 0,
            action_learn: 0,
            freeze: false,
            response_mode: RESPONSE_COUNTERPOINT,
        }
    }
}

pub fn clamp_controls(raw: &Controls) -> Controls {
    let mut c = *raw;
    c.key = c.key.clamp(0, 11);
    c.scale = c.scale.clamp(0, SCALE_COUNT as i32 - 1);
    c.cycle_bars = c.cycle_bars.clamp(1, 8);
    c.granularity = c.granularity.clamp(0, 2);
    c.follow = c.follow.clamp(0.0, 1.0);
    c.counter = c.counter.clamp(0.0, 1.0);
    c.short_random = c.short_random.clamp(0.0, 1.0);
    c.long_random = c.long_random.clamp(0.0, 1.0);
    c.density = c.density.clamp(0.0, 1.0);
    c.rhythm_follow = c.rhythm_follow.clamp(0.0, 1.0);
    c.syncopation = c.syncopation.clamp(0.0, 1.0);
    c.consonance = c.consonance.clamp(0.0, 1.0);
    c.color = c.color.clamp(0.0, 1.0);
    c.embellish = c.embellish.clamp(0.0, 1.0);
    c.regularity = c.regularity.clamp(0.0, 1.0);
    c.reg = c.reg.clamp(0, 2);
    c.span = c.span.clamp(0.0, 1.0);
    c.gate = c.gate.clamp(0.10, 1.0);
    c.velocity_follow = c.velocity_follow.clamp(0.0, 1.0);
    c.output_channel = c.output_channel.clamp(0, 16);
    c.response_mode = c.response_mode.clamp(0, 1);
    c
}

/// The controls a phrase rebuild listens to. Pass-through, output channel,
/// freeze, learn and long random are routing and lifecycle, not phrasing, so
/// changing one alone does not throw the learned phrase away.
pub fn phrase_matches(a: &Controls, b: &Controls) -> bool {
    a.key == b.key
        && a.scale == b.scale
        && a.cycle_bars == b.cycle_bars
        && a.granularity == b.granularity
        && a.reg == b.reg
        && (a.follow - b.follow).abs() < 0.0001
        && (a.counter - b.counter).abs() < 0.0001
        && (a.short_random - b.short_random).abs() < 0.0001
        && (a.density - b.density).abs() < 0.0001
        && (a.rhythm_follow - b.rhythm_follow).abs() < 0.0001
        && (a.syncopation - b.syncopation).abs() < 0.0001
        && (a.consonance - b.consonance).abs() < 0.0001
        && (a.color - b.color).abs() < 0.0001
        && (a.embellish - b.embellish).abs() < 0.0001
        && (a.regularity - b.regularity).abs() < 0.0001
        && (a.span - b.span).abs() < 0.0001
        && (a.gate - b.gate).abs() < 0.0001
        && (a.velocity_follow - b.velocity_follow).abs() < 0.0001
        && a.response_mode == b.response_mode
}

#[derive(Clone, Copy)]
pub struct SegmentCapture {
    pub onset_weight: f64,
    pub note_sum: f64,
    pub velocity_sum: f64,
    pub duration: [f64; 12],
    pub timing_bins: [f64; TIMING_BINS],
}

impl SegmentCapture {
    pub const fn empty() -> Self {
        SegmentCapture {
            onset_weight: 0.0,
            note_sum: 0.0,
            velocity_sum: 0.0,
            duration: [0.0; 12],
            timing_bins: [0.0; TIMING_BINS],
        }
    }
}

#[derive(Clone, Copy)]
pub struct PhraseHit {
    pub active: bool,
    pub note: u8,
    pub velocity: u8,
    pub onset: f64,
    pub gate: f64,
}

impl PhraseHit {
    pub const fn empty() -> Self {
        PhraseHit { active: false, note: 60, velocity: 96, onset: 0.0, gate: 0.7 }
    }
}

#[derive(Clone, Copy)]
pub struct PhraseStep {
    pub active: bool,
    pub note: u8,
    pub velocity: u8,
    pub onset: f64,
    pub gate: f64,
    pub hit_count: i32,
    pub hits: [PhraseHit; MAX_HITS_PER_SEGMENT],
}

impl PhraseStep {
    pub const fn empty() -> Self {
        PhraseStep {
            active: false,
            note: 60,
            velocity: 96,
            onset: 0.0,
            gate: 0.7,
            hit_count: 0,
            hits: [PhraseHit::empty(); MAX_HITS_PER_SEGMENT],
        }
    }
}

#[derive(Clone, Copy)]
pub struct PhraseState {
    pub segment_count: i32,
    pub ready: bool,
    pub steps: [PhraseStep; MAX_SEGMENTS],
}

impl PhraseState {
    pub const fn empty() -> Self {
        PhraseState { segment_count: 0, ready: false, steps: [PhraseStep::empty(); MAX_SEGMENTS] }
    }
}

#[derive(Clone, Copy)]
pub struct Variation {
    pub completed_cycles: i64,
    pub last_mutation_cycle: i64,
    pub mutation_serial: i32,
}

impl Variation {
    pub const fn new() -> Self {
        Variation { completed_cycles: 0, last_mutation_cycle: 0, mutation_serial: 0 }
    }

    pub fn reset(&mut self) {
        *self = Variation::new();
    }
}

fn lround_f32(v: f32) -> i32 {
    (v + 0.5) as i32
}

fn lround_f64(v: f64) -> i32 {
    (v + 0.5) as i32
}

fn floor_i64(v: f64) -> i64 {
    let t = v as i64;
    if v < 0.0 && (t as f64) != v { t - 1 } else { t }
}

fn controls_seed(c: &Controls) -> u32 {
    let mut seed = 0xC0217A3Du32;
    seed ^= (c.key & 0xFF) as u32;
    seed ^= ((c.scale & 0xFF) as u32) << 8;
    seed ^= ((c.cycle_bars & 0xFF) as u32) << 16;
    seed ^= ((c.granularity & 0xFF) as u32) << 24;
    seed ^= mix_u32(lround_f32(c.follow * 1000.0) as u32);
    seed ^= mix_u32((lround_f32(c.counter * 1000.0) as u32) << 1);
    seed ^= mix_u32((lround_f32(c.short_random * 1000.0) as u32) << 2);
    seed ^= mix_u32((lround_f32(c.long_random * 1000.0) as u32) << 3);
    seed ^= mix_u32((lround_f32(c.density * 1000.0) as u32) << 4);
    seed ^= mix_u32((lround_f32(c.embellish * 1000.0) as u32) << 5);
    seed ^= mix_u32((lround_f32(c.regularity * 1000.0) as u32) << 6);
    seed ^= mix_u32((lround_f32(c.color * 1000.0) as u32) << 7);
    seed
}

fn color_amount(c: &Controls) -> f32 {
    let color = c.color.clamp(0.0, 1.0);
    if is_jazz_scale(c.scale) { color } else { color * 0.45 }
}

fn effective_controls(raw: &Controls) -> Controls {
    let mut out = *raw;
    let irregularity = 1.0 - raw.regularity.clamp(0.0, 1.0);
    let color = color_amount(raw);
    out.short_random = (raw.short_random * (0.18 + irregularity * 1.25) + irregularity * 0.28 + color * 0.18).clamp(0.0, 1.0);
    out.long_random = (raw.long_random * (0.10 + irregularity * 1.15) + color * 0.08).clamp(0.0, 1.0);
    out.syncopation = (raw.syncopation * (0.35 + irregularity * 0.95) + irregularity * 0.18 + color * 0.12).clamp(0.0, 1.0);
    out.rhythm_follow = (raw.rhythm_follow * (0.55 + raw.regularity * 0.45)).clamp(0.0, 1.0);
    out.consonance = (raw.consonance * (0.65 + raw.regularity * 0.35) * (1.0 - color * 0.32)).clamp(0.0, 1.0);
    out.embellish = (raw.embellish + color * 0.24).clamp(0.0, 1.0);
    out.span = (raw.span + color * 0.18).clamp(0.0, 1.0);
    out.regularity = (raw.regularity - color * 0.14).clamp(0.0, 1.0);
    out
}

fn chromatic_approach_allowed(c: &Controls, note: i32, source: i32) -> bool {
    let color = color_amount(c);
    if color <= 0.0001 {
        return false;
    }
    if scale_contains(c.scale, c.key, note - 1) || scale_contains(c.scale, c.key, note + 1) {
        let mut distance = (wrap12(note - source)).abs();
        if distance > 6 {
            distance = 12 - distance;
        }
        return distance <= 2 || distance == 5 || distance == 6;
    }
    false
}

fn register_center(reg: i32) -> i32 {
    match reg {
        0 => 52,
        2 => 76,
        _ => 64,
    }
}

fn bass_register_center(c: &Controls) -> i32 {
    (register_center(c.reg) - 12).clamp(36, 64)
}

pub fn cycle_beats(c: &Controls, beats_per_bar: f64) -> f64 {
    ((c.cycle_bars as f64) * beats_per_bar).clamp(1.0, MAX_SEGMENTS as f64 * beats_per_bar)
}

pub fn segment_beats(c: &Controls, beats_per_bar: f64) -> f64 {
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

pub fn segment_count(c: &Controls, beats_per_bar: f64) -> i32 {
    lround_f64(cycle_beats(c, beats_per_bar) / segment_beats(c, beats_per_bar)).clamp(1, MAX_SEGMENTS as i32)
}

pub fn wrapped_cycle_position(abs_beats: f64, c: &Controls, beats_per_bar: f64) -> f64 {
    let cycle = cycle_beats(c, beats_per_bar);
    let mut local = abs_beats % cycle;
    if local < 0.0 {
        local += cycle;
    }
    local
}

pub fn segment_index_for_time(c: &Controls, beats_per_bar: f64, count: i32, abs_beats: f64) -> i32 {
    let cycle_pos = wrapped_cycle_position(abs_beats, c, beats_per_bar);
    let seg_beats = segment_beats(c, beats_per_bar);
    let mut index = floor_i64((cycle_pos + BEAT_EPSILON) / seg_beats) as i32;
    if index >= count {
        index = count - 1;
    }
    index.clamp(0, count - 1)
}

pub fn frame_for_beat(abs_start: f64, abs_end: f64, frames: u32, target: f64) -> u32 {
    if frames == 0 || abs_end <= abs_start + 1e-12 {
        return 0;
    }
    let t = ((target - abs_start) / (abs_end - abs_start)).clamp(0.0, 1.0);
    lround_f64(t * frames as f64).clamp(0, frames as i32) as u32
}

fn timing_center(capture: &SegmentCapture) -> f64 {
    let mut best = -1.0;
    let mut best_index = 0;
    for i in 0..TIMING_BINS {
        if capture.timing_bins[i] > best {
            best = capture.timing_bins[i];
            best_index = i;
        }
    }
    if best <= 0.0001 {
        return 0.0;
    }
    (best_index as f64 + 0.5) / TIMING_BINS as f64
}

fn answer_position(input_onset: f64, c: &Controls) -> f64 {
    // fmod without libm: the shifted onset is non-negative, so truncation
    // is the quotient and the remainder is what is left over.
    let shifted = input_onset + 0.5 + c.syncopation as f64 * 0.18;
    let mut v = shifted - (shifted as i64) as f64;
    if v < 0.0 {
        v += 1.0;
    }
    v.clamp(0.0, 0.94)
}

fn embellish_position(input_onset: f64, hit_index: i32, c: &Controls) -> f64 {
    let base = if hit_index == 1 { 0.25 } else { 0.75 };
    let pull = c.regularity as f64 * 0.22;
    let answer = answer_position(input_onset, c);
    (base * (0.65 + pull) + answer * (0.35 - pull)).clamp(0.04, 0.92)
}

fn interval_class(a: i32, b: i32) -> i32 {
    let mut distance = wrap12(a - b).abs();
    if distance > 6 {
        distance = 12 - distance;
    }
    distance
}

fn consonance_score(candidate: i32, source: i32, consonance: f32) -> f64 {
    let score = match interval_class(candidate, source) {
        0 => -0.4,
        3 | 4 | 5 | 7 | 8 | 9 => 1.0,
        2 => 0.15,
        _ => -0.65,
    };
    score * consonance as f64
}

fn strict_fugue_mode(c: &Controls) -> bool {
    c.regularity >= 0.88 && c.counter >= 0.72 && c.short_random <= 0.18 && c.long_random <= 0.12
}

pub fn capture_has_material(capture: &[SegmentCapture], count: i32) -> bool {
    for i in 0..count.max(0) as usize {
        let segment = &capture[i];
        if segment.onset_weight > 0.0001 {
            return true;
        }
        for v in segment.duration {
            if v > 0.0001 {
                return true;
            }
        }
    }
    false
}

fn source_note_for_segment(capture: &[SegmentCapture], segment: usize, fallback: i32) -> i32 {
    let direct = &capture[segment];
    if direct.onset_weight > 0.0001 {
        return lround_f64(direct.note_sum / direct.onset_weight).clamp(0, 127);
    }
    let mut best = 0.0;
    let mut best_pc = -1;
    for pc in 0..12 {
        if direct.duration[pc] > best {
            best = direct.duration[pc];
            best_pc = pc as i32;
        }
    }
    if best_pc >= 0 {
        return fallback + wrap12(best_pc - fallback);
    }
    fallback
}

fn source_velocity_for_segment(capture: &SegmentCapture) -> i32 {
    if capture.onset_weight > 0.0001 {
        return lround_f64(capture.velocity_sum / capture.onset_weight).clamp(1, 127);
    }
    92
}

#[allow(clippy::too_many_arguments)]
fn choose_output_note(
    c: &Controls,
    source: i32,
    previous_source: i32,
    previous_output: i32,
    segment_index: i32,
    rng: &mut Rng,
) -> i32 {
    let center = register_center(c.reg);
    let min_note = (center - 18).clamp(0, 127);
    let max_note = (center + 18).clamp(0, 127);
    let source_delta = (source - previous_source).clamp(-12, 12);
    let max_leap = 2 + lround_f32(10.0 * c.span);
    let mut best_score = f64::NEG_INFINITY;
    let mut best_note = nearest_scale_note(c.key, c.scale, center, min_note, max_note);

    let mut note = min_note;
    while note <= max_note {
        let in_scale = scale_contains(c.scale, c.key, note);
        let chromatic_approach = !in_scale && chromatic_approach_allowed(c, note, source);
        if in_scale || chromatic_approach {
            let output_delta = (note - previous_output).clamp(-12, 12);
            let mut score = 0.0;
            score -= (note - center).abs() as f64 * 0.035;
            score -= (0).max((note - previous_output).abs() - max_leap) as f64 * 0.35;
            score += consonance_score(note, source, c.consonance);
            if chromatic_approach {
                score += color_amount(c) as f64 * 0.32;
                score -= 0.26;
            }
            if source_delta != 0 {
                if (output_delta > 0 && source_delta > 0) || (output_delta < 0 && source_delta < 0) {
                    score += c.follow as f64 * 0.9;
                }
                if (output_delta > 0 && source_delta < 0) || (output_delta < 0 && source_delta > 0) {
                    score += c.counter as f64 * 1.25;
                }
                score -= ((output_delta.abs() - source_delta.abs()).abs() as f64)
                    * c.follow as f64
                    * 0.08;
            } else {
                score += (if output_delta == 0 { 0.25 } else { 0.0 }) * c.follow as f64;
                score += (if output_delta.abs() <= 2 { 0.15 } else { 0.0 }) * c.counter as f64;
            }
            score += (rng.next_float() as f64 - 0.5) * c.short_random as f64 * 1.8;
            score += color_amount(c) as f64 * (if output_delta.abs() > 2 { 0.10 } else { -0.02 });
            score += (if segment_index % 2 == 0 { 1.0 } else { -1.0 }) * c.syncopation as f64 * 0.04;

            if score > best_score {
                best_score = score;
                best_note = note;
            }
        }
        note += 1;
    }
    best_note
}

#[allow(clippy::too_many_arguments)]
fn choose_bass_descend_note(
    c: &Controls,
    source: i32,
    previous_source: i32,
    previous_output: i32,
    segment_index: i32,
    segment_total: i32,
    rng: &mut Rng,
) -> i32 {
    let center = bass_register_center(c);
    let min_note = (center - 16).clamp(24, 127);
    let max_note = (center + 14).clamp(0, 127);
    let progress = if segment_total > 1 {
        segment_index as f32 / (segment_total - 1) as f32
    } else {
        0.0
    };
    let descent = lround_f32(progress * (7.0 + c.span * 8.0));
    let target = nearest_scale_note(c.key, c.scale, center + 7 - descent, min_note, max_note);
    let source_delta = (source - previous_source).clamp(-12, 12);
    let max_leap = 3 + lround_f32(7.0 * c.span);

    let mut best_score = f64::NEG_INFINITY;
    let mut best_note = target;
    let mut note = min_note;
    while note <= max_note {
        let in_scale = scale_contains(c.scale, c.key, note);
        let chromatic_approach = !in_scale && chromatic_approach_allowed(c, note, source);
        if in_scale || chromatic_approach {
            let output_delta = (note - previous_output).clamp(-12, 12);
            let mut score = 0.0;
            score -= (note - target).abs() as f64 * 0.18;
            score -= (note - center).abs() as f64 * 0.018;
            score -= (0).max((note - previous_output).abs() - max_leap) as f64 * 0.42;
            score += consonance_score(note, source, c.consonance) * 1.10;
            if source_delta > 0 {
                score += if output_delta < 0 { 1.10 + c.counter as f64 * 1.20 } else { -0.55 };
            } else if source_delta < 0 {
                score += if output_delta <= 0 { 0.42 } else { -0.16 };
            } else {
                score += if output_delta <= 0 { 0.32 } else { -0.20 };
            }
            if output_delta == 0 && segment_index > 0 {
                score -= 0.12;
            }
            if chromatic_approach {
                score += color_amount(c) as f64 * 0.24 - 0.22;
            }
            score += (rng.next_float() as f64 - 0.5) * c.short_random as f64 * 0.45;

            if score > best_score {
                best_score = score;
                best_note = note;
            }
        }
        note += 1;
    }
    best_note
}

fn sync_primary_from_hits(step: &mut PhraseStep) {
    step.hit_count = step.hit_count.clamp(0, MAX_HITS_PER_SEGMENT as i32);
    step.active = false;
    for i in 0..step.hit_count as usize {
        let hit = step.hits[i];
        if !hit.active {
            continue;
        }
        step.active = true;
        step.note = hit.note;
        step.velocity = hit.velocity;
        step.onset = hit.onset;
        step.gate = hit.gate;
        return;
    }
}

/// Insertion sort for at most three hits: std sort has no place on the
/// audio thread, and three elements need no more than this.
fn sort_hits_by_onset(hits: &mut [PhraseHit; MAX_HITS_PER_SEGMENT], count: usize) {
    for i in 1..count {
        let mut j = i;
        while j > 0 && hits[j - 1].onset > hits[j].onset {
            hits.swap(j - 1, j);
            j -= 1;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn make_hit(
    c: &Controls,
    source: i32,
    previous_source: i32,
    previous_output: i32,
    segment_total: i32,
    segment_index: i32,
    hit_index: i32,
    velocity: i32,
    onset: f64,
    rng: &mut Rng,
) -> PhraseHit {
    let bias = if hit_index == 0 { 0 } else if hit_index == 1 { 2 } else { -2 };
    let note = if c.response_mode == RESPONSE_BASS_DESCEND {
        choose_bass_descend_note(c, source + bias, previous_source, previous_output, segment_index, segment_total, rng)
    } else {
        choose_output_note(c, source + bias, previous_source, previous_output, segment_index + hit_index, rng)
    };
    PhraseHit {
        active: true,
        note: note.clamp(0, 127) as u8,
        velocity: (lround_f64(84.0 + (velocity - 84) as f64 * c.velocity_follow as f64) - hit_index * 8)
            .clamp(1, 127) as u8,
        onset,
        gate: (c.gate as f64 * (if hit_index == 0 { 1.0 } else { 0.58 }) * (0.92 - c.syncopation as f64 * 0.20))
            .clamp(0.08, 1.0),
    }
}

#[allow(clippy::too_many_arguments)]
fn make_fugue_hit(
    c: &Controls,
    source: i32,
    subject_root: i32,
    segment_index: i32,
    hit_index: i32,
    velocity: i32,
    input_onset: f64,
) -> PhraseHit {
    let dominant_root = subject_root + 7;
    let subject_interval = source - subject_root;
    let invert = color_amount(c) >= 0.55;
    let target = dominant_root + (if invert { -subject_interval } else { subject_interval });
    let center = register_center(c.reg);
    let min_note = (center - 20).clamp(0, 127);
    let max_note = (center + 20).clamp(0, 127);
    let ornament = if hit_index == 0 { 0 } else if hit_index == 1 { -1 } else { 1 };
    PhraseHit {
        active: true,
        note: nearest_scale_note(c.key, c.scale, target + ornament, min_note, max_note).clamp(0, 127) as u8,
        velocity: (lround_f64(78.0 + (velocity - 78) as f64 * c.velocity_follow as f64) - hit_index * 9)
            .clamp(1, 127) as u8,
        onset: if hit_index == 0 {
            (input_onset * 0.72 + 0.08).clamp(0.0, 0.62)
        } else {
            ((if hit_index == 1 { 0.48 } else { 0.74 }) + (segment_index % 2) as f64 * 0.04).clamp(0.04, 0.92)
        },
        gate: (c.gate as f64 * (if hit_index == 0 { 0.82 } else { 0.42 })).clamp(0.10, 0.92),
    }
}

pub fn build_phrase_from_capture(
    capture: &[SegmentCapture],
    segment_total: i32,
    raw: &Controls,
    variation: &Variation,
    out: &mut PhraseState,
) -> bool {
    if segment_total <= 0 || !capture_has_material(capture, segment_total) {
        return false;
    }
    let c = effective_controls(raw);
    let fugue = raw.response_mode == RESPONSE_COUNTERPOINT && strict_fugue_mode(raw);
    *out = PhraseState::empty();
    out.segment_count = segment_total;
    out.ready = true;

    let mut rng = Rng { state: 0 };
    rng.seed(
        controls_seed(&c)
            ^ mix_u32(variation.completed_cycles as u32)
            ^ mix_u32((variation.mutation_serial as u32).wrapping_mul(2246822519)),
    );

    let mut previous_source = 60 + c.key;
    let subject_root = source_note_for_segment(capture, 0, previous_source);
    let mut previous_output = nearest_scale_note(c.key, c.scale, register_center(c.reg), 0, 127);

    for i in 0..segment_total as usize {
        let segment = &capture[i];
        let source = source_note_for_segment(capture, i, previous_source);
        let velocity = source_velocity_for_segment(segment);
        let input_onset = timing_center(segment);
        let complementary = answer_position(input_onset, &c);
        let onset = (input_onset * c.rhythm_follow as f64 + complementary * (1.0 - c.rhythm_follow as f64))
            .clamp(0.0, 0.94);

        let activity = if segment.onset_weight > 0.0001 { 0.18 } else { 0.0 };
        let note_chance =
            (c.density as f64 + activity - c.counter as f64 * 0.08).clamp(0.0, 1.0);

        let mut step = PhraseStep::empty();
        if fugue {
            step.hits[0] = make_fugue_hit(&c, source, subject_root, i as i32, 0, velocity, input_onset);
            step.hit_count = 1;
        } else if rng.next_float() <= note_chance as f32 {
            step.hits[0] = make_hit(&c, source, previous_source, previous_output, segment_total, i as i32, 0, velocity, onset, &mut rng);
            step.hit_count = 1;
        }

        let first_extra_chance = if fugue {
            (c.embellish as f64 * 0.38).clamp(0.0, 0.44)
        } else if c.embellish >= 0.999 {
            1.0
        } else {
            (c.embellish as f64 * (0.45 + c.density as f64 * 0.50)).clamp(0.0, 1.0)
        };
        let second_extra_chance = if fugue {
            0.0
        } else {
            (c.embellish as f64 * c.embellish as f64 * (0.18 + (1.0 - c.regularity as f64) * 0.24))
                .clamp(0.0, 1.0)
        };
        if rng.next_float() as f64 <= first_extra_chance {
            let n = step.hit_count as usize;
            step.hits[n] = if fugue {
                make_fugue_hit(&c, source, subject_root, i as i32, 1, velocity, input_onset)
            } else {
                make_hit(&c, source, previous_source, previous_output, segment_total, i as i32, 1, velocity, embellish_position(input_onset, 1, &c), &mut rng)
            };
            step.hit_count += 1;
        }
        if step.hit_count < MAX_HITS_PER_SEGMENT as i32
            && rng.next_float() as f64 <= second_extra_chance
        {
            let n = step.hit_count as usize;
            step.hits[n] = make_hit(&c, source, previous_source, previous_output, segment_total, i as i32, 2, velocity, embellish_position(input_onset, 2, &c), &mut rng);
            step.hit_count += 1;
        }

        if c.long_random > 0.0001 && rng.next_float() < c.long_random * 0.18 {
            if step.hit_count <= 0 {
                step.hits[0] = make_hit(&c, source, previous_source, previous_output, segment_total, i as i32, 0, velocity, onset, &mut rng);
                step.hit_count = 1;
            } else {
                step.hits[0].active = !step.hits[0].active;
            }
        }

        sort_hits_by_onset(&mut step.hits, step.hit_count as usize);
        sync_primary_from_hits(&mut step);

        out.steps[i] = step;
        previous_source = source;
        previous_output = step.note as i32;
    }
    true
}

fn cycles_between_mutations(long_random: f32) -> i32 {
    // The square where the original raises to 2.5: core has no pow, and the
    // square keeps the same endpoints and direction, mutating only somewhat
    // earlier through the middle. Same substitution as the cadence port.
    let t = 1.0 - long_random;
    let target = 1.0 + 7.0 * t * t;
    let q = target - 0.000001;
    let whole = q as i32;
    (if q > 0.0 && whole as f32 != q { whole + 1 } else { whole }).clamp(1, 64)
}

pub fn maybe_vary_phrase(controls: &Controls, variation: &mut Variation, playback: &mut PhraseState) {
    let c = effective_controls(controls);
    let amount = c.long_random.clamp(0.0, 1.0);
    if amount <= 0.0001 || !playback.ready {
        return;
    }
    if variation.completed_cycles - variation.last_mutation_cycle < cycles_between_mutations(amount) as i64 {
        return;
    }
    variation.last_mutation_cycle = variation.completed_cycles;
    if variation.mutation_serial < i32::MAX {
        variation.mutation_serial += 1;
    }

    let mut rng = Rng { state: 0 };
    rng.seed(
        controls_seed(controls)
            ^ mix_u32(variation.completed_cycles as u32)
            ^ mix_u32((variation.mutation_serial as u32).wrapping_mul(3266489917)),
    );

    for i in 0..playback.segment_count.max(0) as usize {
        let step = &mut playback.steps[i];
        if step.hit_count <= 0 {
            continue;
        }
        if rng.next_float() < amount * 0.25 {
            step.hits[0].active = !step.hits[0].active;
        }
        for h in 0..step.hit_count as usize {
            let hit = &mut step.hits[h];
            if hit.active && rng.next_float() < amount * 0.40 {
                let direction = if rng.next_float() < 0.5 { -1 } else { 1 };
                hit.note = nearest_scale_note(c.key, c.scale, hit.note as i32 + direction * 2, 0, 127).clamp(0, 127) as u8;
            }
            if hit.active && rng.next_float() < amount * 0.25 {
                hit.onset = (hit.onset + (rng.next_float() as f64 - 0.5) * 0.18).clamp(0.0, 0.94);
            }
        }
        sort_hits_by_onset(&mut step.hits, step.hit_count as usize);
        sync_primary_from_hits(step);
    }
}
