// plugins/cadence/src/harmony.rs
//
// What chord each segment wants: candidates scored against what was played,
// transitions scored against what came before, the best path found by
// dynamic programming, and each winner voiced near the middle with smooth
// voice leading. A direct port of downspout's cadence_harmony command set,
// keeping its tables, its scoring and its tie-breaks.
//
// The dynamic programming tables live in DpScratch, held by the engine
// state: 32 segments by 192 candidates of doubles is a hundred kilobytes
// the WebAssembly stack cannot hold as locals, so they are state rather
// than stack, zeroed on every use.

use crate::rng::{mix_u32, signed_jitter};

pub const MAX_SEGMENTS: usize = 32;
pub const MAX_CHORD_NOTES: usize = 6;
pub const MAX_CANDIDATES: usize = 192;

// Qualities, in port order for nothing in particular: they are what the
// voicing tables below are keyed by, and the order is downspout's own.
pub const POWER: u8 = 0;
pub const MAJOR: u8 = 1;
pub const MINOR: u8 = 2;
pub const SUS2: u8 = 3;
pub const SUS4: u8 = 4;
pub const DIM: u8 = 5;
pub const DOM7: u8 = 6;
pub const MAJ7: u8 = 7;
pub const MIN7: u8 = 8;
pub const DOM9: u8 = 9;
pub const MAJ9: u8 = 10;
pub const MIN9: u8 = 11;
pub const DOM13: u8 = 12;
pub const MAJ13: u8 = 13;
pub const MIN11: u8 = 14;

// Scales, in ScaleId order. Identical to the downspout table.
const SCALES: [(u8, [u8; 12]); 24] = [
    (12, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), // chromatic
    (7, [0, 2, 4, 5, 7, 9, 11, 0, 0, 0, 0, 0]),   // major
    (7, [0, 2, 4, 5, 7, 9, 11, 0, 0, 0, 0, 0]),   // ionian
    (7, [0, 2, 3, 5, 7, 8, 10, 0, 0, 0, 0, 0]),   // natural minor
    (7, [0, 2, 3, 5, 7, 8, 11, 0, 0, 0, 0, 0]),   // harmonic minor
    (7, [0, 2, 3, 5, 7, 9, 11, 0, 0, 0, 0, 0]),   // melodic minor
    (7, [0, 2, 3, 5, 7, 9, 10, 0, 0, 0, 0, 0]),   // dorian
    (7, [0, 1, 3, 5, 7, 8, 10, 0, 0, 0, 0, 0]),   // phrygian
    (7, [0, 2, 4, 6, 7, 9, 11, 0, 0, 0, 0, 0]),   // lydian
    (7, [0, 2, 4, 5, 7, 9, 10, 0, 0, 0, 0, 0]),   // mixolydian
    (7, [0, 1, 3, 5, 6, 8, 10, 0, 0, 0, 0, 0]),   // locrian
    (7, [0, 1, 4, 5, 7, 8, 10, 0, 0, 0, 0, 0]),   // phrygian dominant
    (7, [0, 1, 4, 5, 7, 9, 11, 0, 0, 0, 0, 0]),   // neo major
    (7, [0, 1, 3, 5, 7, 8, 10, 0, 0, 0, 0, 0]),   // neo minor
    (5, [0, 2, 4, 7, 9, 0, 0, 0, 0, 0, 0, 0]),    // pent major
    (5, [0, 3, 5, 7, 10, 0, 0, 0, 0, 0, 0, 0]),   // pent minor
    (6, [0, 3, 5, 6, 7, 10, 0, 0, 0, 0, 0, 0]),   // blues
    (6, [0, 2, 4, 6, 8, 10, 0, 0, 0, 0, 0, 0]),   // whole tone
    (7, [0, 1, 3, 4, 6, 8, 10, 0, 0, 0, 0, 0]),   // altered
    (8, [0, 1, 3, 4, 6, 7, 9, 10, 0, 0, 0, 0]),   // half whole diminished
    (8, [0, 2, 3, 5, 6, 8, 9, 11, 0, 0, 0, 0]),   // whole half diminished
    (8, [0, 2, 4, 5, 7, 9, 10, 11, 0, 0, 0, 0]),  // bebop dominant
    (8, [0, 2, 4, 5, 7, 8, 9, 11, 0, 0, 0, 0]),   // bebop major
    (8, [0, 2, 3, 4, 5, 7, 9, 10, 0, 0, 0, 0]),   // bebop minor
];

fn wrap12(value: i32) -> i32 {
    value.rem_euclid(12)
}

/// lround for the non-negative values this file rounds: velocities, counts,
/// seeds. Nothing here rounds a negative.
fn lround(v: f64) -> i32 {
    (v + 0.5) as i32
}

#[derive(Clone, Copy, Default)]
pub struct SegmentCapture {
    pub duration: [f64; 12],
    pub onset: [f64; 12],
    pub timing_bins: [f64; 8],
    pub onset_total: f64,
}

impl SegmentCapture {
    pub const fn empty() -> Self {
        SegmentCapture {
            duration: [0.0; 12],
            onset: [0.0; 12],
            timing_bins: [0.0; 8],
            onset_total: 0.0,
        }
    }
}

#[derive(Clone, Copy, Default)]
pub struct ChordSlot {
    pub valid: bool,
    pub root_pc: u8,
    pub quality: u8,
    pub note_count: u8,
    pub velocity: u8,
    pub notes: [u8; MAX_CHORD_NOTES],
}

impl ChordSlot {
    pub const fn empty() -> Self {
        ChordSlot {
            valid: false,
            root_pc: 0,
            quality: 0,
            note_count: 0,
            velocity: 96,
            notes: [0; MAX_CHORD_NOTES],
        }
    }
}

#[derive(Clone, Copy)]
pub struct Controls {
    pub key: i32,
    pub scale: i32,
    pub cycle_bars: i32,
    pub granularity: i32,
    pub complexity: f32,
    pub movement: f32,
    pub color: f32,
    pub chord_size: i32,
    pub note_length: f32,
    pub reg: i32,
    pub spread: f32,
    pub arpeggio: f32,
    pub pass_input: bool,
    pub output_channel: i32,
    pub action_learn: u32,
    pub vary: f32,
    pub comp: f32,
}

impl Controls {
    pub const fn new() -> Self {
        Controls {
            key: 0,
            scale: 3,
            cycle_bars: 2,
            granularity: 1,
            complexity: 0.45,
            movement: 0.65,
            color: 0.0,
            chord_size: 0,
            note_length: 1.0,
            reg: 1,
            spread: 0.0,
            arpeggio: 0.0,
            pass_input: true,
            output_channel: 0,
            action_learn: 0,
            vary: 0.0,
            comp: 0.0,
        }
    }
}

pub fn clamp_controls(raw: &Controls) -> Controls {
    let mut c = *raw;
    c.key = c.key.clamp(0, 11);
    c.scale = c.scale.clamp(0, 23);
    c.cycle_bars = c.cycle_bars.clamp(1, 8);
    c.granularity = c.granularity.clamp(0, 2);
    c.complexity = c.complexity.clamp(0.0, 1.0);
    c.movement = c.movement.clamp(0.0, 1.0);
    c.color = c.color.clamp(0.0, 1.0);
    c.chord_size = c.chord_size.clamp(0, 2);
    c.note_length = c.note_length.clamp(0.10, 1.0);
    c.reg = c.reg.clamp(0, 2);
    c.spread = c.spread.clamp(0.0, 1.0);
    c.arpeggio = c.arpeggio.clamp(0.0, 1.0);
    c.output_channel = c.output_channel.clamp(0, 16);
    c.vary = c.vary.clamp(0.0, 1.0);
    c.comp = c.comp.clamp(0.0, 1.0);
    c
}

/// The harmony knobs: key, scale, cycle, granularity, complexity, movement,
/// color, size, register and spread. Timing, outputs, actions and amounts
/// outside the harmony live elsewhere.
pub fn harmony_matches(a: &Controls, b: &Controls) -> bool {
    a.key == b.key
        && a.scale == b.scale
        && a.cycle_bars == b.cycle_bars
        && a.granularity == b.granularity
        && (a.complexity - b.complexity).abs() < 0.0001
        && (a.movement - b.movement).abs() < 0.0001
        && (a.color - b.color).abs() < 0.0001
        && a.chord_size == b.chord_size
        && a.reg == b.reg
        && (a.spread - b.spread).abs() < 0.0001
}

#[derive(Clone, Copy, Default)]
pub struct BuildOptions {
    pub local_jitter: f32,
    pub transition_jitter: f32,
    pub voicing_jitter: f32,
    pub continuity: f32,
    pub anchor_endpoints: bool,
    pub seed: u32,
}

impl BuildOptions {
    pub fn plain() -> Self {
        BuildOptions {
            local_jitter: 0.0,
            transition_jitter: 0.0,
            voicing_jitter: 0.0,
            continuity: 0.0,
            anchor_endpoints: true,
            seed: 1,
        }
    }
}

/// The dynamic programming tables, held by the engine state rather than the
/// stack: 32 by 192 doubles three times over is more stack than a
/// WebAssembly module is given.
#[derive(Clone, Copy)]
pub struct DpScratch {
    pub local: [[f64; MAX_CANDIDATES]; MAX_SEGMENTS],
    pub dp: [[f64; MAX_CANDIDATES]; MAX_SEGMENTS],
    pub trace: [[i32; MAX_CANDIDATES]; MAX_SEGMENTS],
}

impl DpScratch {
    pub const fn empty() -> Self {
        DpScratch {
            local: [[0.0; MAX_CANDIDATES]; MAX_SEGMENTS],
            dp: [[0.0; MAX_CANDIDATES]; MAX_SEGMENTS],
            trace: [[0; MAX_CANDIDATES]; MAX_SEGMENTS],
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Candidate {
    root_pc: u8,
    quality: u8,
    note_count: u8,
    intervals: [u8; MAX_CHORD_NOTES],
    mask: u16,
}

fn quality_intervals(quality: u8) -> (u8, [u8; MAX_CHORD_NOTES]) {
    match quality {
        POWER => (2, [0, 7, 0, 0, 0, 0]),
        MAJOR => (3, [0, 4, 7, 0, 0, 0]),
        MINOR => (3, [0, 3, 7, 0, 0, 0]),
        SUS2 => (3, [0, 2, 7, 0, 0, 0]),
        SUS4 => (3, [0, 5, 7, 0, 0, 0]),
        DIM => (3, [0, 3, 6, 0, 0, 0]),
        DOM7 => (4, [0, 4, 7, 10, 0, 0]),
        MAJ7 => (4, [0, 4, 7, 11, 0, 0]),
        MIN7 => (4, [0, 3, 7, 10, 0, 0]),
        DOM9 => (5, [0, 4, 7, 10, 14, 0]),
        MAJ9 => (5, [0, 4, 7, 11, 14, 0]),
        MIN9 => (5, [0, 3, 7, 10, 14, 0]),
        DOM13 => (6, [0, 4, 7, 10, 14, 21]),
        MAJ13 => (6, [0, 4, 7, 11, 14, 21]),
        MIN11 => (6, [0, 3, 7, 10, 14, 17]),
        _ => (0, [0; MAX_CHORD_NOTES]),
    }
}

fn uses_seventh(quality: u8) -> bool {
    matches!(
        quality,
        DOM7 | MAJ7 | MIN7 | DOM9 | MAJ9 | MIN9 | DOM13 | MAJ13 | MIN11
    )
}

fn uses_extension(quality: u8) -> bool {
    matches!(quality, DOM9 | MAJ9 | MIN9 | DOM13 | MAJ13 | MIN11)
}

fn chord_mask(root_pc: u8, quality: u8) -> u16 {
    let (count, intervals) = quality_intervals(quality);
    let mut mask = 0u16;
    for i in 0..count as usize {
        mask |= 1u16 << wrap12(root_pc as i32 + intervals[i] as i32);
    }
    mask
}

fn is_jazz_scale(scale: i32) -> bool {
    matches!(scale, 1 | 5 | 6 | 8 | 9 | 18 | 19 | 20 | 21 | 22 | 23)
}

fn color_amount(c: &Controls) -> f64 {
    let color = c.color.clamp(0.0, 1.0) as f64;
    if is_jazz_scale(c.scale) { color } else { color * 0.45 }
}

fn classical_amount(c: &Controls) -> f64 {
    let color = c.color.clamp(0.0, 1.0) as f64;
    match c.scale {
        1 | 3 | 4 | 6 | 7 | 11 => color,
        _ => 0.0,
    }
}

fn scale_contains(scale: i32, key: i32, pc: i32) -> bool {
    let (count, table) = SCALES[scale.clamp(0, 23) as usize];
    let rel = wrap12(pc - key);
    for i in 0..count as usize {
        if table[i] as i32 == rel {
            return true;
        }
    }
    false
}

fn sort_u8(notes: &mut [u8], count: usize) {
    for i in 1..count {
        let mut j = i;
        while j > 0 && notes[j - 1] > notes[j] {
            notes.swap(j - 1, j);
            j -= 1;
        }
    }
}

fn sort_i32(notes: &mut [i32], count: usize) {
    for i in 1..count {
        let mut j = i;
        while j > 0 && notes[j - 1] > notes[j] {
            notes.swap(j - 1, j);
            j -= 1;
        }
    }
}

fn dominant_pc(segment: &SegmentCapture) -> (i32, f64, f64) {
    let mut best_pc = 0;
    let mut best_weight = -1.0f64;
    let mut total = 0.0f64;
    for pc in 0..12 {
        let weight = segment.duration[pc] + segment.onset[pc] * 1.6;
        total += weight;
        if weight > best_weight {
            best_weight = weight;
            best_pc = pc;
        }
    }
    (best_pc as i32, if best_weight > 0.0 { best_weight } else { 0.0 }, total)
}

struct RootPref {
    mask: u16,
    primary_pc: i32,
    primary_ratio: f64,
}

fn preferred_roots(segment: &SegmentCapture) -> RootPref {
    let mut weights = [0.0f64; 12];
    let mut total = 0.0f64;
    for pc in 0..12 {
        weights[pc] = segment.duration[pc] + segment.onset[pc] * 1.8;
        total += weights[pc];
    }
    if total < 0.02 {
        return RootPref { mask: 0x0FFF, primary_pc: 0, primary_ratio: 0.0 };
    }
    let mut ranked = [0i32; 3];
    let mut ranked_weight = [-1.0f64; 3];
    for pc in 0..12 {
        let weight = weights[pc];
        for slot in 0..3 {
            if weight > ranked_weight[slot] {
                for m in (slot + 1..3).rev() {
                    ranked_weight[m] = ranked_weight[m - 1];
                    ranked[m] = ranked[m - 1];
                }
                ranked_weight[slot] = weight;
                ranked[slot] = pc as i32;
                break;
            }
        }
    }
    let mut mask = 1u16 << ranked[0];
    let primary_ratio = ranked_weight[0] / total;
    if ranked_weight[1] > total * 0.14 || primary_ratio < 0.74 {
        mask |= 1u16 << ranked[1];
    }
    if ranked_weight[2] > total * 0.20 || primary_ratio < 0.54 {
        mask |= 1u16 << ranked[2];
    }
    RootPref { mask, primary_pc: ranked[0], primary_ratio }
}

fn register_center(reg: i32) -> i32 {
    match reg {
        0 => 52,
        2 => 76,
        _ => 64,
    }
}

fn nearest_midi_for_pc(pc: i32, target: i32) -> i32 {
    let mut best = 60 + pc;
    let mut best_distance = 999;
    for octave in -1..=10 {
        let candidate = octave * 12 + pc;
        if !(0..=127).contains(&candidate) {
            continue;
        }
        let distance = (candidate - target).abs();
        if distance < best_distance {
            best_distance = distance;
            best = candidate;
        }
    }
    best
}

fn apply_spread(notes: &mut [i32], count: usize, spread: f32) {
    if count < 3 {
        return;
    }
    sort_i32(notes, count);
    let amount = spread.clamp(0.0, 1.0);
    let target_range = 8 + (amount * 24.0 + 0.5) as i32;
    let mut guard = 0;
    while notes[count - 1] - notes[0] < target_range && guard < (count * 2) as i32 {
        let voice = (count as i32 - 1 - (guard % (count as i32 - 1).max(1))).clamp(1, count as i32 - 1) as usize;
        notes[voice] += 12;
        sort_i32(notes, count);
        guard += 1;
    }
}

fn voicing_cost(
    notes: &[i32],
    count: usize,
    previous: Option<(&[u8], usize)>,
    center: i32,
) -> f64 {
    if count == 0 {
        return 0.0;
    }
    let mut cost = 0.0f64;
    if let Some((prev_notes, prev_count)) = previous {
        if prev_count > 0 {
            for i in 0..count {
                let target = (i * prev_count / count).min(prev_count - 1);
                cost += (notes[i] - prev_notes[target] as i32).abs() as f64 * 0.18;
            }
        }
    }
    let sum: i32 = notes[..count].iter().sum();
    let average = sum as f64 / count as f64;
    cost += (average - center as f64).abs() * 0.08;
    let range = notes[count - 1] - notes[0];
    if range > 20 {
        cost += (range - 20) as f64 * 0.07;
    }
    if notes[0] < 36 {
        cost += (36 - notes[0]) as f64 * 0.12;
    }
    if notes[count - 1] > 100 {
        cost += (notes[count - 1] - 100) as f64 * 0.12;
    }
    cost
}

fn candidate_from_slot(slot: &ChordSlot) -> Option<Candidate> {
    if !slot.valid {
        return None;
    }
    let (count, intervals) = quality_intervals(slot.quality);
    if count == 0 {
        return None;
    }
    // A stored slot with no count takes the quality's own, exactly as upstream.
    let note_count = if slot.note_count > 0 { slot.note_count.min(count) } else { count };
    if note_count == 0 {
        return None;
    }
    let mut candidate = Candidate {
        root_pc: slot.root_pc,
        quality: slot.quality,
        note_count,
        intervals,
        mask: 0,
    };
    for i in 0..note_count as usize {
        candidate.mask |= 1u16 << wrap12(candidate.root_pc as i32 + candidate.intervals[i] as i32);
    }
    Some(candidate)
}

fn continuity_bonus(candidate: &Candidate, reference: &ChordSlot, continuity: f32, anchored: bool) -> f64 {
    if !reference.valid || continuity <= 0.0001 {
        return 0.0;
    }
    let reference_mask = chord_mask(reference.root_pc, reference.quality);
    let interval = wrap12(candidate.root_pc as i32 - reference.root_pc as i32);
    let step = interval.min(12 - interval);
    let mut bonus = 0.0f64;
    if candidate.root_pc == reference.root_pc {
        bonus += 0.06 + continuity as f64 * 0.24;
    } else if step <= 2 {
        bonus += 0.02 + continuity as f64 * 0.08;
    }
    if candidate.quality == reference.quality {
        bonus += 0.04 + continuity as f64 * 0.12;
    }
    bonus += (candidate.mask & reference_mask).count_ones() as f64 * (0.01 + continuity as f64 * 0.02);
    if anchored {
        bonus * 1.35
    } else {
        bonus
    }
}

fn build_candidates(c: &Controls, out: &mut [Candidate; MAX_CANDIDATES]) -> usize {
    let mut count = 0;
    for root in 0..12 {
        for quality in POWER..=MIN11 {
            if c.chord_size == 0 && uses_seventh(quality) {
                continue;
            }
            if c.chord_size == 1 && uses_extension(quality) {
                continue;
            }
            let (note_count, intervals) = quality_intervals(quality);
            if note_count == 0 {
                continue;
            }
            let mut mask = 0u16;
            for i in 0..note_count as usize {
                mask |= 1u16 << wrap12(root + intervals[i] as i32);
            }
            let candidate = Candidate { root_pc: root as u8, quality, note_count, intervals, mask };
            if out_of_scale_count(&candidate, c) > 0 && !scale_free(c) {
                continue;
            }
            if count < MAX_CANDIDATES {
                out[count] = candidate;
                count += 1;
            }
        }
    }
    count
}

/// True when the complexity plus color lets any candidate through regardless
/// of the scale, matching candidate_allowed_by_scale.
fn scale_free(c: &Controls) -> bool {
    c.complexity + c.color.clamp(0.0, 1.0) * 0.28 >= 0.78
}

fn out_of_scale_count(candidate: &Candidate, c: &Controls) -> i32 {
    if c.scale == 0 {
        return 0;
    }
    let mut count = 0;
    for i in 0..candidate.note_count as usize {
        if !scale_contains(c.scale, c.key, wrap12(candidate.root_pc as i32 + candidate.intervals[i] as i32)) {
            count += 1;
        }
    }
    count
}

fn jazz_role_bonus(candidate: &Candidate, c: &Controls) -> f64 {
    let color = color_amount(c);
    if color <= 0.0001 {
        return 0.0;
    }
    let rel = wrap12(candidate.root_pc as i32 - c.key);
    let mut score = 0.0f64;
    if rel == 2 && (candidate.quality == MINOR || candidate.quality == MIN7) {
        score += 0.22 + color * 0.42;
        if candidate.quality == MIN7 {
            score += color * 0.26;
        }
    } else if rel == 7 && candidate.quality == DOM7 {
        score += 0.28 + color * 0.62;
    } else if rel == 0 && (candidate.quality == MAJOR || candidate.quality == MAJ7) {
        score += 0.16 + color * 0.34;
        if candidate.quality == MAJ7 {
            score += color * 0.24;
        }
    } else if rel == 11 && candidate.quality == DIM {
        score += color * 0.42;
    } else if rel == 1 && candidate.quality == DOM7 {
        score += color * 0.30;
    } else if rel == 10 && candidate.quality == DOM7 {
        score += color * 0.22;
    }
    if uses_seventh(candidate.quality) {
        score += color * 0.16;
    }
    score
}

fn classical_role_bonus(candidate: &Candidate, c: &Controls) -> f64 {
    let amount = classical_amount(c);
    if amount <= 0.0001 {
        return 0.0;
    }
    let rel = wrap12(candidate.root_pc as i32 - c.key);
    let mut score = 0.0f64;
    if rel == 0 && (candidate.quality == MAJOR || candidate.quality == MINOR || candidate.quality == MAJ7) {
        score += 0.12 + amount * 0.26;
    } else if rel == 7
        && (candidate.quality == SUS4 || candidate.quality == DOM7 || candidate.quality == MAJOR)
    {
        score += 0.14 + amount * 0.34;
        if candidate.quality == SUS4 {
            score += amount * 0.28;
        }
    } else if (rel == 2 || rel == 9) && (candidate.quality == MINOR || candidate.quality == MIN7) {
        score += 0.10 + amount * 0.22;
    } else if rel == 5 && (candidate.quality == MAJOR || candidate.quality == SUS4) {
        score += amount * 0.16;
    }
    score
}

fn jazz_cadence_bonus(candidate: &Candidate, c: &Controls, segment: usize, count: usize) -> f64 {
    let color = color_amount(c);
    if color <= 0.0001 || count < 3 {
        return 0.0;
    }
    let rel = wrap12(candidate.root_pc as i32 - c.key);
    let from_end = (count - 1 - segment) as i32;
    let mut score = 0.0f64;
    if from_end == 0 && rel == 0 {
        score += 0.45 + color * 0.80;
        if candidate.quality == MAJOR || candidate.quality == MAJ7 {
            score += color * 0.34;
        }
    } else if from_end == 1 && rel == 7 {
        score += 0.36 + color * 0.72;
        if candidate.quality == DOM7 {
            score += color * 0.46;
        }
    } else if from_end == 2 && rel == 2 {
        score += 0.30 + color * 0.58;
        if candidate.quality == MINOR || candidate.quality == MIN7 {
            score += color * 0.34;
        }
    } else if from_end == 1 && rel == 1 && candidate.quality == DOM7 {
        score += color * 0.34;
    }
    score
}

fn classical_cadence_bonus(candidate: &Candidate, c: &Controls, segment: usize, count: usize) -> f64 {
    let amount = classical_amount(c);
    if amount <= 0.0001 || count < 3 {
        return 0.0;
    }
    let rel = wrap12(candidate.root_pc as i32 - c.key);
    let from_end = (count - 1 - segment) as i32;
    let circle = wrap12(-5 * from_end);
    let mut score = 0.0f64;
    if rel == circle {
        score += 0.36 + amount * 0.76;
    }
    if from_end == 0 && rel == 0 {
        score += 0.32 + amount * 0.70;
        if candidate.quality == MAJOR || candidate.quality == MINOR || candidate.quality == MAJ7 {
            score += amount * 0.34;
        }
    } else if from_end == 1 && rel == 7 {
        score += 0.28 + amount * 0.62;
        if candidate.quality == SUS4 {
            score += 0.24 + amount * 0.88;
        } else if candidate.quality == DOM7 {
            score += amount * 0.54;
        }
    } else if (from_end == 2 && rel == 2) || (from_end == 3 && rel == 9) {
        if candidate.quality == MINOR || candidate.quality == MIN7 {
            score += 0.18 + amount * 0.48;
        }
    }
    score
}

fn score_candidate(segment: &SegmentCapture, candidate: &Candidate, c: &Controls) -> f64 {
    let movement = c.movement.clamp(0.0, 1.0) as f64;
    let complexity = c.complexity.clamp(0.0, 1.0) as f64;
    let mut weights = [0.0f64; 12];
    let mut total = 0.0f64;
    for pc in 0..12 {
        weights[pc] = segment.duration[pc] + segment.onset[pc] * 1.35;
        total += weights[pc];
    }
    if total < 0.02 {
        return 0.0;
    }
    let (dominant_pc, dominant_weight, dominant_total) = dominant_pc(segment);
    let dominant_ratio = if dominant_total > 1e-9 { dominant_weight / dominant_total } else { 0.0 };
    let root_pref = preferred_roots(segment);

    let mut chord_pcs = [false; 12];
    let mut score = 0.0f64;
    for i in 0..candidate.note_count as usize {
        let pc = wrap12(candidate.root_pc as i32 + candidate.intervals[i] as i32) as usize;
        chord_pcs[pc] = true;
        let role_weight = match i {
            0 => 1.45,
            1 => 1.12,
            2 => 0.92,
            _ => 0.72,
        };
        score += weights[pc] * role_weight;
        if !scale_contains(c.scale, c.key, pc as i32) {
            score -= 0.72 + (1.0 - complexity) * 0.90;
        }
    }
    for pc in 0..12 {
        if !chord_pcs[pc] {
            score -= weights[pc] * 0.66;
        }
    }
    score += segment.onset[candidate.root_pc as usize] * 0.95;
    score += segment.duration[candidate.root_pc as usize] * 0.45;

    if candidate.root_pc as i32 == root_pref.primary_pc {
        score += 0.38 + movement * 0.96 + root_pref.primary_ratio * (0.28 + movement * 0.96);
    } else if root_pref.mask & (1u16 << candidate.root_pc) != 0 {
        score += 0.10 + movement * 0.28;
    } else {
        score -= 0.24 + movement * 1.12 + root_pref.primary_ratio * (0.14 + movement * 0.82);
    }

    if candidate.root_pc as i32 == dominant_pc {
        score += 0.10 + movement * 0.76 + dominant_ratio * (0.14 + movement * 0.58);
    } else if chord_pcs[dominant_pc as usize] {
        score += 0.05 + movement * 0.12 + dominant_ratio * (0.06 + movement * 0.18);
    } else {
        score -= 0.06 + movement * 0.34 + dominant_ratio * (0.12 + movement * 0.38);
    }

    if scale_contains(c.scale, c.key, candidate.root_pc as i32) {
        score += 0.22 + (1.0 - complexity) * 0.06;
    } else {
        score -= 1.10 - complexity * 0.28;
    }

    match candidate.quality {
        POWER => {
            score -= 0.58 + (1.0 - complexity) * 0.72;
        }
        SUS2 => {
            let sus = weights[wrap12(candidate.root_pc as i32 + 2) as usize];
            score -= 0.28 + (1.0 - complexity) * 0.34;
            score += sus / (total + 1e-9) * 0.50;
            score += if weights[wrap12(candidate.root_pc as i32 + 4) as usize] + weights[wrap12(candidate.root_pc as i32 + 3) as usize] < total * 0.18 { 0.14 } else { -0.08 };
        }
        SUS4 => {
            let sus = weights[wrap12(candidate.root_pc as i32 + 5) as usize];
            score -= 0.28 + (1.0 - complexity) * 0.34;
            score += sus / (total + 1e-9) * 0.50;
            score += if weights[wrap12(candidate.root_pc as i32 + 4) as usize] + weights[wrap12(candidate.root_pc as i32 + 3) as usize] < total * 0.18 { 0.14 } else { -0.08 };
        }
        DIM => {
            score -= 0.24 + (1.0 - complexity) * 0.16;
            score += color_amount(c) * 0.20;
            score += weights[wrap12(candidate.root_pc as i32 + 6) as usize] / (total + 1e-9) * 0.32;
        }
        DOM7 | MAJ7 | MIN7 | DOM9 | MAJ9 | MIN9 | DOM13 | MAJ13 | MIN11 => {
            let seventh = wrap12(candidate.root_pc as i32 + candidate.intervals[3] as i32) as usize;
            score -= 0.12 + (1.0 - complexity) * 0.24;
            score += color_amount(c) * 0.28;
            score += weights[seventh] / (total + 1e-9) * 0.36;
            if uses_extension(candidate.quality) {
                let ninth = wrap12(candidate.root_pc as i32 + candidate.intervals[4] as i32) as usize;
                score += weights[ninth] / (total + 1e-9) * 0.24;
                score += color_amount(c) * 0.38 + complexity * 0.16;
                if candidate.note_count > 5 {
                    let color_pc = wrap12(candidate.root_pc as i32 + candidate.intervals[5] as i32) as usize;
                    score += weights[color_pc] / (total + 1e-9) * 0.18;
                    score += color_amount(c) * 0.18;
                }
            }
        }
        MAJOR => {
            score += weights[wrap12(candidate.root_pc as i32 + 4) as usize] / (total + 1e-9) * 0.22;
        }
        MINOR => {
            score += weights[wrap12(candidate.root_pc as i32 + 3) as usize] / (total + 1e-9) * 0.22;
        }
        _ => {}
    }

    score += jazz_role_bonus(candidate, c);
    score += classical_role_bonus(candidate, c);
    score / (total + 1e-9)
}

fn transition_score(previous: &Candidate, next: &Candidate, c: &Controls, segment: usize, count: usize) -> f64 {
    let movement = c.movement.clamp(0.0, 1.0) as f64;
    let interval = wrap12(next.root_pc as i32 - previous.root_pc as i32);
    let step = interval.min(12 - interval);
    let mut score = 0.0f64;
    if interval == 0 && previous.quality == next.quality {
        score -= 0.10 + movement * 0.54;
    } else if interval == 0 {
        score -= 0.04 + movement * 0.22;
    } else if interval == 5 || interval == 7 {
        score += 0.18 + movement * 0.10;
    } else if interval == 2 || interval == 10 {
        score += 0.08 + movement * 0.06;
    } else if step == 1 {
        score += 0.03 + movement * 0.06;
    } else if step == 6 {
        score -= 0.08 + movement * 0.12;
    } else {
        score += 0.02;
    }
    score += (previous.mask & next.mask).count_ones() as f64 * (0.14 - movement * 0.08);
    if segment == count - 1 && next.root_pc as i32 == c.key {
        score += 0.18 + (1.0 - movement) * 0.08;
    }
    if segment == 0 && next.root_pc as i32 == c.key {
        score += 0.08 + (1.0 - movement) * 0.08;
    }
    if next.quality == DIM {
        score -= 0.08 - color_amount(c) * 0.12;
    }
    let color = color_amount(c);
    if color > 0.0001 {
        let prev_rel = wrap12(previous.root_pc as i32 - c.key);
        let next_rel = wrap12(next.root_pc as i32 - c.key);
        if prev_rel == 2 && next_rel == 7 {
            score += color * 0.52;
        }
        if prev_rel == 7 && next_rel == 0 {
            score += color * 0.68;
            if previous.quality == DOM7 {
                score += color * 0.18;
            }
        }
        if prev_rel == 1 && previous.quality == DOM7 && next_rel == 0 {
            score += color * 0.38;
        }
    }
    let classical = classical_amount(c);
    if classical > 0.0001 {
        let prev_rel = wrap12(previous.root_pc as i32 - c.key);
        let next_rel = wrap12(next.root_pc as i32 - c.key);
        if interval == 5 {
            score += classical * (0.34 + movement * 0.20);
        }
        if prev_rel == 9 && next_rel == 2 {
            score += classical * 0.34;
        }
        if prev_rel == 2 && next_rel == 7 {
            score += classical * 0.42;
        }
        if prev_rel == 7 && next_rel == 0 {
            score += classical * 0.54;
            if previous.quality == SUS4 {
                score += classical * 0.34;
            }
        }
    }
    score
}

fn build_voicing(
    candidate: &Candidate,
    c: &Controls,
    previous: Option<(&[u8], usize)>,
    velocity: u8,
    segment: usize,
    options: &BuildOptions,
    out: &mut ChordSlot,
) {
    *out = ChordSlot {
        valid: false,
        root_pc: candidate.root_pc,
        quality: candidate.quality,
        note_count: candidate.note_count,
        velocity,
        notes: [0; MAX_CHORD_NOTES],
    };
    if candidate.note_count == 0 {
        return;
    }
    let center = register_center(c.reg);
    let base_root = nearest_midi_for_pc(candidate.root_pc as i32, center - 7);
    let mut base = [0i32; MAX_CHORD_NOTES];
    for i in 0..candidate.note_count as usize {
        base[i] = base_root + candidate.intervals[i] as i32;
    }
    let mut option_notes = [[0i32; MAX_CHORD_NOTES]; MAX_CHORD_NOTES * 3];
    let mut option_costs = [0.0f64; MAX_CHORD_NOTES * 3];
    let mut option_count = 0;
    for inversion in 0..candidate.note_count as usize {
        let mut notes = base;
        for i in 0..inversion {
            notes[i] += 12;
        }
        sort_i32(&mut notes, candidate.note_count as usize);
        apply_spread(&mut notes, candidate.note_count as usize, c.spread);
        for shift in -1..=1 {
            let mut shifted = [0i32; MAX_CHORD_NOTES];
            let mut valid = true;
            for i in 0..candidate.note_count as usize {
                shifted[i] = notes[i] + shift * 12;
                if !(0..=127).contains(&shifted[i]) {
                    valid = false;
                    break;
                }
            }
            if !valid || option_count >= option_notes.len() {
                continue;
            }
            sort_i32(&mut shifted, candidate.note_count as usize);
            option_notes[option_count] = shifted;
            option_costs[option_count] =
                voicing_cost(&shifted, candidate.note_count as usize, previous, center);
            option_count += 1;
        }
    }
    if option_count == 0 {
        return;
    }
    // Cheapest first; the jitter window below may still pick a neighbour.
    for i in 1..option_count {
        let mut j = i;
        while j > 0 && option_costs[j - 1] > option_costs[j] {
            option_costs.swap(j - 1, j);
            option_notes.swap(j - 1, j);
            j -= 1;
        }
    }
    let mut chosen = 0;
    if options.voicing_jitter > 0.0001 && option_count > 1 {
        let best = option_costs[0];
        let window = 0.35 + options.voicing_jitter.clamp(0.0, 1.0) as f64 * 1.40;
        let mut eligible = 1;
        while eligible < option_count && option_costs[eligible] <= best + window {
            eligible += 1;
        }
        if eligible > 1 {
            let seed = options.seed
                ^ ((segment as u32).wrapping_mul(2246822519))
                ^ ((candidate.root_pc as u32).wrapping_mul(3266489917))
                ^ ((candidate.quality as u32).wrapping_mul(668265263));
            chosen = (mix_u32(seed) % eligible as u32) as usize;
        }
    }
    for i in 0..candidate.note_count as usize {
        out.notes[i] = option_notes[chosen][i].clamp(0, 127) as u8;
    }
    let mut sorted = out.notes;
    sort_u8(&mut sorted, candidate.note_count as usize);
    out.notes = sorted;
    out.valid = true;
}

pub fn clear_capture(slots: &mut [SegmentCapture]) {
    for slot in slots.iter_mut() {
        *slot = SegmentCapture::default();
    }
}

pub fn copy_capture(dst: &mut [SegmentCapture], src: &[SegmentCapture], count: usize) {
    let n = count.min(dst.len()).min(src.len());
    dst[..n].copy_from_slice(&src[..n]);
}

pub fn clear_progression(slots: &mut [ChordSlot]) {
    for slot in slots.iter_mut() {
        *slot = ChordSlot::default();
    }
}

pub fn copy_progression(dst: &mut [ChordSlot], src: &[ChordSlot], count: usize) {
    let n = count.min(dst.len()).min(src.len());
    dst[..n].copy_from_slice(&src[..n]);
}

pub fn segment_activity(segment: &SegmentCapture) -> f64 {
    let mut total = 0.0f64;
    for pc in 0..12 {
        total += segment.duration[pc] + segment.onset[pc] * 1.35;
    }
    total
}

fn seed_jitter(seed: u32, segment: usize, candidate: usize, amount: f32, anchored: bool) -> f64 {
    if amount <= 0.0001 {
        return 0.0;
    }
    let scale = if anchored { amount * 0.35 } else { amount };
    signed_jitter(
        seed ^ ((segment as u32).wrapping_mul(2246822519)) ^ ((candidate as u32).wrapping_mul(3266489917)),
    ) as f64 * scale as f64
}

fn transition_jitter(seed: u32, segment: usize, previous: usize, candidate: usize, amount: f32, anchored: bool) -> f64 {
    if amount <= 0.0001 {
        return 0.0;
    }
    let scale = if anchored { amount * 0.45 } else { amount };
    signed_jitter(
        seed
            ^ 0x9E3779B9u32
            ^ ((segment as u32).wrapping_mul(1597334677))
            ^ ((previous as u32).wrapping_mul(3812015801))
            ^ ((candidate as u32).wrapping_mul(958689277)),
    ) as f64 * scale as f64
}

/// Fit one chord per segment to what was played, with smooth motion between
/// segments chosen by dynamic programming over the candidate scores.
#[allow(clippy::too_many_arguments)]
pub fn build_progression_from_capture(
    capture: &[SegmentCapture],
    segment_count: usize,
    c: &Controls,
    reference: Option<(&[ChordSlot], usize)>,
    options: &BuildOptions,
    out_slots: &mut [ChordSlot],
    scratch: &mut DpScratch,
) -> bool {
    if segment_count == 0 || segment_count > MAX_SEGMENTS {
        return false;
    }
    let mut total_activity = 0.0f64;
    for s in 0..segment_count {
        total_activity += segment_activity(&capture[s]);
    }
    if total_activity < 0.2 {
        return false;
    }
    let mut candidates = [Candidate::default(); MAX_CANDIDATES];
    let candidate_count = build_candidates(c, &mut candidates);
    if candidate_count == 0 {
        return false;
    }

    for s in 0..segment_count {
        for ci in 0..candidate_count {
            let anchored = options.anchor_endpoints && (s == 0 || s == segment_count - 1);
            let mut score = score_candidate(&capture[s], &candidates[ci], c);
            score += jazz_cadence_bonus(&candidates[ci], c, s, segment_count);
            score += classical_cadence_bonus(&candidates[ci], c, s, segment_count);
            if let Some((ref_slots, ref_count)) = reference {
                if s < ref_count {
                    score += continuity_bonus(
                        &candidates[ci],
                        &ref_slots[s],
                        options.continuity,
                        anchored,
                    );
                }
            }
            score += seed_jitter(options.seed, s, ci, options.local_jitter, anchored);
            scratch.local[s][ci] = score;
            scratch.dp[s][ci] = -1.0e9;
            scratch.trace[s][ci] = -1;
        }
    }

    for ci in 0..candidate_count {
        let mut start_bonus = 0.0f64;
        if candidates[ci].root_pc as i32 == c.key {
            start_bonus += 0.10;
        }
        scratch.dp[0][ci] = scratch.local[0][ci] + start_bonus;
    }

    for s in 1..segment_count {
        let anchored = options.anchor_endpoints && (s == 0 || s == segment_count - 1);
        for ci in 0..candidate_count {
            for p in 0..candidate_count {
                let mut candidate_score = scratch.dp[s - 1][p]
                    + scratch.local[s][ci]
                    + transition_score(&candidates[p], &candidates[ci], c, s, segment_count);
                candidate_score +=
                    transition_jitter(options.seed, s, p, ci, options.transition_jitter, anchored);
                if candidate_score > scratch.dp[s][ci] {
                    scratch.dp[s][ci] = candidate_score;
                    scratch.trace[s][ci] = p as i32;
                }
            }
        }
    }

    let mut best_index = 0;
    let mut best_score = scratch.dp[segment_count - 1][0];
    for ci in 1..candidate_count {
        if scratch.dp[segment_count - 1][ci] > best_score {
            best_score = scratch.dp[segment_count - 1][ci];
            best_index = ci;
        }
    }

    let mut chosen = [0usize; MAX_SEGMENTS];
    chosen[segment_count - 1] = best_index;
    for s in (1..segment_count).rev() {
        let prev = scratch.trace[s][chosen[s]];
        chosen[s - 1] = if prev >= 0 { prev as usize } else { 0 };
    }

    clear_progression_in(out_slots, segment_count);
    let mut previous = ChordSlot::default();
    for s in 0..segment_count {
        let candidate = &candidates[chosen[s]];
        let activity = segment_activity(&capture[s]);
        let velocity = lround(76.0 + (activity * 12.0).min(28.0)).clamp(60, 110) as u8;
        let prev = if previous.valid {
            Some((&previous.notes[..], previous.note_count as usize))
        } else {
            None
        };
        build_voicing(candidate, c, prev, velocity, s, options, &mut out_slots[s]);
        previous = out_slots[s];
    }
    true
}

fn clear_progression_in(out_slots: &mut [ChordSlot], segment_count: usize) {
    for s in 0..segment_count.min(out_slots.len()) {
        out_slots[s] = ChordSlot::default();
    }
}

/// Re-voice existing slots under new controls without re-fitting: same
/// roots, fresh octaves and inversions.
pub fn revoice_progression(
    source: &[ChordSlot],
    segment_count: usize,
    c: &Controls,
    options: &BuildOptions,
    out_slots: &mut [ChordSlot],
) -> bool {
    if segment_count == 0 || segment_count > MAX_SEGMENTS {
        return false;
    }
    clear_progression_in(out_slots, segment_count);
    let mut previous = ChordSlot::default();
    let mut any_valid = false;
    for s in 0..segment_count {
        if !source[s].valid {
            continue;
        }
        let Some(candidate) = candidate_from_slot(&source[s]) else {
            continue;
        };
        let prev = if previous.valid {
            Some((&previous.notes[..], previous.note_count as usize))
        } else {
            None
        };
        build_voicing(&candidate, c, prev, source[s].velocity, s, options, &mut out_slots[s]);
        previous = out_slots[s];
        any_valid = any_valid || out_slots[s].valid;
    }
    any_valid
}
