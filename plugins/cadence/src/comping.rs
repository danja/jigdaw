// plugins/cadence/src/comping.rs
//
// The comping planner: where in each segment the chord stabs fall. With comp
// down it is one hit on the bar; turned up it answers the learned timing,
// placing hits where the player played and filling the largest gap left.
// A direct port of downspout's cadence_comping, keeping its candidates,
// jitter, spacing rule and gate fractions.

use crate::harmony::{Controls, SegmentCapture};

pub const MAX_COMP_HITS: usize = 4;
pub const TIMING_BINS: usize = 8;
const BEAT_EPSILON: f64 = 0.000001;

#[derive(Clone, Copy, Default)]
pub struct CompHit {
    pub active: bool,
    pub beat: f64,
    pub off_beat: f64,
    pub velocity: u8,
}

#[derive(Clone, Copy)]
pub struct CompState {
    pub segment_index: i32,
    pub segment_start: f64,
    pub segment_end: f64,
    pub hits: [CompHit; MAX_COMP_HITS],
    pub hit_count: i32,
    pub next_hit: i32,
    pub release_pending: bool,
    pub release_beat: f64,
    pub last_hit_beat: f64,
}

impl CompState {
    pub const fn new() -> Self {
        CompState {
            segment_index: -1,
            segment_start: 0.0,
            segment_end: 0.0,
            hits: [CompHit { active: false, beat: 0.0, off_beat: 0.0, velocity: 96 }; MAX_COMP_HITS],
            hit_count: 0,
            next_hit: 0,
            release_pending: false,
            release_beat: 0.0,
            last_hit_beat: -1.0,
        }
    }

    pub fn reset(&mut self) {
        *self = CompState::new();
    }
}

fn floor_i64(v: f64) -> i64 {
    let t = v as i64;
    if v < 0.0 && (t as f64) != v { t - 1 } else { t }
}

/// lround for the non-negative values this file rounds.
fn lround(v: f32) -> i32 {
    (v + 0.5) as i32
}

pub fn note_length_fraction(c: &Controls) -> f64 {
    c.note_length.clamp(0.10, 1.0) as f64
}

fn gate_fraction(c: &Controls, comp: f32, hit: i32, hits: i32, activity: f64) -> f64 {
    let max_gate = note_length_fraction(c);
    if comp <= 0.02 {
        return max_gate;
    }
    let mut gate = max_gate * (0.82 - comp as f64 * 0.40);
    gate *= 0.94 - activity * 0.28;
    if hits > 1 {
        gate *= if hit == hits - 1 { 0.92 } else { 0.60 };
    }
    gate.clamp(0.08, max_gate)
}

fn largest_gap_center(segment: Option<&SegmentCapture>) -> f64 {
    let Some(segment) = segment else {
        return 0.5;
    };
    if segment.onset_total <= 0.0001 {
        return 0.5;
    }
    let mut max_bin = 0.0f64;
    for b in 0..TIMING_BINS {
        max_bin = max_bin.max(segment.timing_bins[b]);
    }
    let mut active = [0i32; TIMING_BINS];
    let mut active_count = 0;
    let threshold = max_bin * 0.20;
    for b in 0..TIMING_BINS {
        if segment.timing_bins[b] >= threshold && threshold > 0.0 {
            active[active_count] = b as i32;
            active_count += 1;
        }
    }
    if active_count == 0 {
        return 0.5;
    }
    let mut best_gap = -1.0f64;
    let mut best_center = 0.5f64;
    let mut previous = 0.0f64;
    for i in 0..active_count {
        let position = (active[i] as f64 + 0.5) / TIMING_BINS as f64;
        let gap = position - previous;
        if gap > best_gap {
            best_gap = gap;
            best_center = previous + gap * 0.58;
        }
        previous = position;
    }
    let tail = 1.0 - previous;
    if tail > best_gap {
        best_center = previous + tail * 0.55;
    }
    best_center.clamp(0.08, 0.92)
}

/// Plan this segment's hits: always the bar, plus answers where the player
/// played and one in the largest gap they left, spaced apart and gated.
pub fn plan_segment(
    state: &mut CompState,
    learned: Option<&SegmentCapture>,
    c: &Controls,
    slot_velocity: u8,
    segment_index: i32,
    segment_start: f64,
    segment_beats: f64,
    seed: u32,
) {
    *state = CompState::new();
    state.segment_index = segment_index;
    state.segment_start = segment_start;
    state.segment_end = segment_start + segment_beats;
    if segment_beats <= 0.0 {
        return;
    }
    let comp = c.comp.clamp(0.0, 1.0);
    let vary = c.vary.clamp(0.0, 1.0);

    if comp <= 0.02 {
        state.hits[0] = CompHit {
            active: true,
            beat: segment_start,
            off_beat: segment_start + segment_beats * note_length_fraction(c),
            velocity: slot_velocity,
        };
        state.hit_count = 1;
        return;
    }

    let onset_total = learned.map(|s| s.onset_total).unwrap_or(0.0);
    let activity = (onset_total / 2.4).clamp(0.0, 1.0);
    let mut target = 1 + floor_i64(comp as f64 * 2.8) as i32;
    if activity > 0.72 && target > 1 {
        target -= 1;
    }
    target = target.clamp(1, MAX_COMP_HITS as i32);

    // Up to 24 candidates by relative position, weight and accent.
    let mut rel = [0.0f64; 24];
    let mut weight = [0.0f64; 24];
    let mut accent = [0.8f64; 24];
    let mut candidate_count = 0;
    let mut add = |r: f64, w: f64, a: f64| {
        if candidate_count < 24 && w > 0.0001 {
            rel[candidate_count] = r.clamp(0.0, 0.98);
            weight[candidate_count] = w;
            accent[candidate_count] = a.clamp(0.55, 1.15);
            candidate_count += 1;
        }
    };
    add(0.0, 0.58 + (1.0 - comp as f64) * 0.30 + learned.map(|s| s.timing_bins[0] * 0.18).unwrap_or(0.0), 0.94);
    if let Some(segment) = learned {
        if segment.onset_total > 0.0001 {
            for b in 0..TIMING_BINS {
                let bin_weight = segment.timing_bins[b];
                if bin_weight <= 0.0001 {
                    continue;
                }
                let center = (b as f64 + 0.5) / TIMING_BINS as f64;
                let shift = if b == 0 { 0.0 } else { 0.04 + comp as f64 * 0.05 };
                add(
                    (center + shift).clamp(0.0, 0.96),
                    bin_weight * (0.50 + comp as f64 * 0.85),
                    if b == 0 { 0.98 } else { 0.72 + (bin_weight * 0.08).min(0.26) },
                );
            }
            add(
                largest_gap_center(learned),
                (0.18 + comp as f64 * 0.44) * (1.0 + (1.0 - activity) * 0.7),
                0.82,
            );
            if comp > 0.32 {
                add(0.78 + comp as f64 * 0.08, 0.16 + comp as f64 * 0.40, 0.76);
            }
        }
    } else {
        add(0.24, 0.38 + comp as f64 * 0.34, 0.82);
        add(0.52, 0.32 + comp as f64 * 0.38, 0.78);
        add(0.80, 0.26 + comp as f64 * 0.44, 0.74);
    }

    for i in 0..candidate_count {
        weight[i] += crate::rng::signed_jitter(seed ^ ((i as u32).wrapping_mul(2246822519))) as f64
            * (0.04 + comp as f64 * 0.10 + vary as f64 * 0.06) as f64;
    }
    // Heaviest first.
    for i in 1..candidate_count {
        let mut j = i;
        while j > 0 && weight[j - 1] < weight[j] {
            weight.swap(j - 1, j);
            rel.swap(j - 1, j);
            accent.swap(j - 1, j);
            j -= 1;
        }
    }

    let min_spacing = segment_beats * (0.15 - comp as f64 * 0.04).clamp(0.08, 0.15);
    let mut chosen = 0;
    for i in 0..candidate_count {
        if chosen >= target as usize {
            break;
        }
        let beat = segment_start + rel[i] * segment_beats;
        let mut too_close = false;
        for j in 0..chosen {
            if (state.hits[j].beat - beat).abs() < min_spacing {
                too_close = true;
                break;
            }
        }
        if too_close {
            continue;
        }
        state.hits[chosen] = CompHit {
            active: true,
            beat,
            off_beat: beat,
            velocity: lround(slot_velocity as f32 * accent[i] as f32).clamp(54, 118) as u8,
        };
        chosen += 1;
    }
    if chosen == 0 {
        state.hits[0] = CompHit { active: true, beat: segment_start, off_beat: segment_start, velocity: slot_velocity };
        chosen = 1;
    }
    // Earliest first, for the playback cursor below.
    for i in 1..chosen {
        let mut j = i;
        while j > 0 && state.hits[j - 1].beat > state.hits[j].beat {
            state.hits.swap(j - 1, j);
            j -= 1;
        }
    }
    for i in 0..chosen {
        let gate = gate_fraction(c, comp, i as i32, chosen as i32, activity);
        let mut off = state.hits[i].beat + segment_beats * gate;
        if i + 1 < chosen {
            off = off.min(state.hits[i + 1].beat - segment_beats * 0.03);
        }
        off = off.min(segment_start + segment_beats * note_length_fraction(c));
        off = off.clamp(
            state.hits[i].beat + segment_beats * 0.04,
            segment_start + segment_beats * 0.995,
        );
        state.hits[i].off_beat = off;
    }
    state.hit_count = chosen as i32;
}

pub fn next_hit_beat(state: &CompState) -> f64 {
    if state.next_hit >= state.hit_count {
        return f64::INFINITY;
    }
    state.hits[state.next_hit as usize].beat
}

pub fn take_due_hit(state: &mut CompState, target_beat: f64) -> Option<CompHit> {
    if state.next_hit >= state.hit_count {
        return None;
    }
    let hit = state.hits[state.next_hit as usize];
    if !hit.active || hit.beat > target_beat + 0.000001 {
        return None;
    }
    state.last_hit_beat = hit.beat;
    state.next_hit += 1;
    Some(hit)
}

pub fn set_release(state: &mut CompState, beat: f64) {
    state.release_pending = true;
    state.release_beat = beat;
}

pub fn clear_release(state: &mut CompState) {
    state.release_pending = false;
    state.release_beat = 0.0;
}

pub fn release_beat(state: &CompState) -> f64 {
    if !state.release_pending {
        f64::INFINITY
    } else {
        state.release_beat
    }
}

/// Move the cursor to a position, reporting whether a hit covers it. Past
/// hits are skipped, future ones wait: seeking never replays the bar.
pub fn sync_to_position(state: &mut CompState, abs_beats: f64) -> (bool, f64) {
    clear_release(state);
    state.next_hit = state.hit_count;
    let mut sounding = -1;
    for i in 0..state.hit_count as usize {
        if !state.hits[i].active {
            continue;
        }
        if state.hits[i].beat <= abs_beats + 0.000001 {
            if state.hits[i].off_beat > abs_beats + 0.000001 {
                sounding = i as i32;
            }
            state.next_hit = i as i32 + 1;
        } else {
            state.next_hit = i as i32;
            break;
        }
    }
    if sounding >= 0 {
        set_release(state, state.hits[sounding as usize].off_beat);
        (true, state.hits[sounding as usize].off_beat)
    } else {
        (false, 0.0)
    }
}
