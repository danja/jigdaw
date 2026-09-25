// plugins/ground/src/generate.rs
//
// Phrase event generation: style onset grids, durations, legato shaping and
// the per-phrase builder, plus the in-place form surgery (regenerate one
// form, refresh or mutate one phrase, force one role) that the engine drives.

use crate::meter::Meter;
use crate::pattern::{
    clamp_controls, clamp_i, floor_i32, lround, note_from_degree, seed_mix,
    color_amount, constrain_to_lane, next_serial, normalize_form_bars, normalize_phrase_bars,
    role_base_degree, role_intensity, role_motion_bias, phrase_reg_offset,
    structured_plan, blues_plan, choose_role, fugal_mode, blues_mode, shaped_mode,
    fugal_role, fugal_root, scaled_step, Controls, Form, PhrasePlan, NoteEvent,
    ANSWER, BREAKDOWN, CADENCE, CLIMB_R, PEDAL, RELEASE, STATEMENT,
    CLIMB, DUB, JAZZ, ROCK, ASCEND, DESCEND, DRONE, GROUNDED, MARCH, OSTINATO, PULSE,
    MAX_EVENTS, MAX_PHRASES, MAX_STEPS,
};
use crate::rng::Rng;

pub const GRID: usize = 512;

fn add_syncopation(
    onset: &mut [bool; GRID],
    c: &Controls,
    plan: &PhrasePlan,
    rng: &mut Rng,
    bar: i32,
    phrase_bars: i32,
    bar_start: i32,
    steps_per_bar: i32,
    density: f32,
    motion: f32,
) {
    match plan.role {
        STATEMENT => {
            if bar > 0 && density > 0.34 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, if bar % 2 == 0 && motion > 0.38 { 15 } else { 7 }));
            }
        }
        ANSWER => {
            if density > 0.28 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, if bar % 2 == 0 { 10 } else { 15 }));
            }
        }
        CLIMB_R => {
            if motion > 0.32 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, if bar % 2 == 0 { 6 } else { 14 }));
            }
            maybe_onset(onset, rng, density * (0.20 + motion * 0.30), bar_start + scaled_step(steps_per_bar, 15));
        }
        PEDAL => {
            if density > 0.64 && bar < phrase_bars - 1 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 15));
            }
        }
        BREAKDOWN => {
            maybe_onset(onset, rng, density * 0.18, bar_start + scaled_step(steps_per_bar, 11));
        }
        CADENCE => {
            if bar == phrase_bars - 1 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 10));
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 14));
            } else if density > 0.30 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 7));
            }
        }
        RELEASE => {
            if bar < phrase_bars - 1 && density > 0.24 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, if bar % 2 == 0 { 7 } else { 15 }));
            }
        }
        _ => {}
    }

    if c.style == GROUNDED && motion > 0.52 {
        onset_at(onset, bar_start + scaled_step(steps_per_bar, if bar % 2 == 0 { 10 } else { 15 }));
    } else if c.style == PULSE && density > 0.38 {
        onset_at(onset, bar_start + scaled_step(steps_per_bar, if bar % 2 == 0 { 6 } else { 14 }));
    } else if c.style == MARCH && motion > 0.46 {
        maybe_onset(onset, rng, 0.40 + density * 0.20, bar_start + scaled_step(steps_per_bar, 10));
    } else if c.style == DUB {
        maybe_onset(onset, rng, density * 0.36, bar_start + scaled_step(steps_per_bar, 15));
    } else if c.style == JAZZ {
        maybe_onset(onset, rng, density * 0.34 + motion * 0.20, bar_start + scaled_step(steps_per_bar, 14));
    } else if c.style == ROCK {
        onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
    }
}

fn onset_at(onset: &mut [bool; GRID], step: i32) {
    if step >= 0 && (step as usize) < GRID {
        onset[step as usize] = true;
    }
}

fn maybe_onset(onset: &mut [bool; GRID], rng: &mut Rng, probability: f32, step: i32) {
    if probability > 0.0 && rng.next_float() < probability {
        onset_at(onset, step);
    }
}

fn build_bar_onsets(
    onset: &mut [bool; GRID],
    c: &Controls,
    plan: &PhrasePlan,
    rng: &mut Rng,
    bar: i32,
    phrase_bars: i32,
    bar_start: i32,
    steps_per_bar: i32,
) {
    let density = (c.density * plan.intensity).clamp(0.05, 1.0);
    let motion = (plan.motion_bias + color_amount(c) * 0.16).clamp(0.0, 1.0);

    if plan.role == PEDAL || c.style == DRONE {
        onset_at(onset, bar_start);
        if density > 0.72 && bar % 2 == 1 {
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
        }
        return;
    }

    if plan.role == BREAKDOWN {
        if bar == 0 || rng.next_float() < density * 0.40 {
            onset_at(onset, bar_start);
        }
        if bar == phrase_bars - 1 && rng.next_float() < 0.35 {
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
        }
        return;
    }

    match c.style {
        GROUNDED => {
            onset_at(onset, bar_start);
            if rng.next_float() < density * 0.72 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
            }
            if rng.next_float() < density * 0.38 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
            }
        }
        OSTINATO => {
            onset_at(onset, bar_start);
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 3));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 11));
            if rng.next_float() < density * 0.45 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 14));
            }
        }
        MARCH => {
            onset_at(onset, bar_start);
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 4));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
            if rng.next_float() < density * 0.25 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 14));
            }
        }
        PULSE => {
            onset_at(onset, bar_start);
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
            if rng.next_float() < density * 0.40 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
            }
        }
        DRONE => {
            onset_at(onset, bar_start);
        }
        CLIMB => {
            onset_at(onset, bar_start);
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 4));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
            if rng.next_float() < density * 0.65 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 2));
            }
            if rng.next_float() < density * (0.35 + motion * 0.55) {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 10));
            }
            if rng.next_float() < density * motion * 0.45 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 14));
            }
        }
        DUB => {
            onset_at(onset, bar_start);
            if rng.next_float() < density * 0.42 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 7));
            }
            if rng.next_float() < density * 0.66 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
            }
        }
        JAZZ => {
            onset_at(onset, bar_start);
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 4));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
            if rng.next_float() < density * (0.28 + motion * 0.24) {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 14));
            }
        }
        ROCK => {
            onset_at(onset, bar_start);
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 4));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
            if rng.next_float() < density * 0.32 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 14));
            }
        }
        ASCEND | DESCEND => {
            onset_at(onset, bar_start);
            onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
            if motion > 0.36 || plan.role == CADENCE {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
            }
            if rng.next_float() < density * (0.20 + motion * 0.28) {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 4));
            }
            if (plan.role == CADENCE || color_amount(c) > 0.35) && rng.next_float() < density * 0.45 {
                onset_at(onset, bar_start + scaled_step(steps_per_bar, 14));
            }
        }
        _ => {}
    }

    if plan.role == CADENCE && bar == phrase_bars - 1 {
        onset_at(onset, bar_start);
        onset_at(onset, bar_start + scaled_step(steps_per_bar, 12));
    } else if plan.role == CLIMB_R && rng.next_float() < density * 0.45 {
        onset_at(onset, bar_start + scaled_step(steps_per_bar, 6));
    } else if plan.role == RELEASE && rng.next_float() < density * 0.22 {
        onset_at(onset, bar_start + scaled_step(steps_per_bar, 8));
    }

    add_syncopation(onset, c, plan, rng, bar, phrase_bars, bar_start, steps_per_bar, density, motion);
}

fn apply_color_to_note(
    c: &Controls,
    rng: &mut Rng,
    note: i32,
    local_step: i32,
    steps_per_beat: i32,
    role: i32,
    phrase_steps: i32,
) -> i32 {
    let color = color_amount(c);
    if color <= 0.0001 {
        return note;
    }
    let strong = if steps_per_beat > 0 { local_step % steps_per_beat == 0 } else { true };
    let final_cadence = role == CADENCE && local_step + steps_per_beat >= phrase_steps;
    if strong || final_cadence || rng.next_float() >= color * 0.18 {
        return note;
    }
    clamp_i(note + (if rng.next_float() < 0.5 { -1 } else { 1 }), 0, 127)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn choose_degree(
    plan_role: i32,
    plan_root: i32,
    c: &Controls,
    rng: &mut Rng,
    ordinal: i32,
    local_step: i32,
    phrase_steps: i32,
    steps_per_beat: i32,
    previous: i32,
) -> i32 {
    let strong = if steps_per_beat > 0 { local_step % steps_per_beat == 0 } else { true };
    let base = plan_root;
    let color = color_amount(c);

    if ordinal == 0 && local_step == 0 {
        return base;
    }

    if c.style == DESCEND || c.style == ASCEND {
        let scale_span = crate::pattern::scale_count(c.scale);
        let progress = local_step as f32 / (phrase_steps - 1).max(1) as f32;
        let mut distance = floor_i32(progress * (3.0 + c.motion * 3.0 + color * 1.5));
        if strong {
            distance = distance.max(ordinal / 2);
        }
        let direction = if c.style == ASCEND { 1 } else { -1 };
        let mut degree = match plan_role {
            STATEMENT => base + direction * distance,
            ANSWER => base - direction * 2 + direction * distance,
            CLIMB_R => {
                let lift = floor_i32((1.0 - progress) * (1.0 + c.tension * 3.0));
                base - direction * lift + direction * (distance - 1).max(0)
            }
            PEDAL => {
                if rng.next_float() < 0.86 { base } else { base + direction }
            }
            BREAKDOWN => base + direction * distance.min(2),
            CADENCE => {
                if local_step + steps_per_beat >= phrase_steps {
                    if direction > 0 { scale_span } else { 0 }
                } else if ordinal >= (12 - 2).max(1) {
                    (scale_span - 1).max(0)
                } else {
                    base - direction + direction * distance
                }
            }
            RELEASE => base + direction * distance + direction * (ordinal / 3).max(0),
            _ => base + direction * distance,
        };
        if !strong && rng.next_float() < color * 0.25 {
            degree += if rng.next_float() < 0.5 { -1 } else { 1 };
        }
        return clamp_i(degree, -scale_span, scale_span * 2);
    }

    match plan_role {
        STATEMENT => {
            if c.style == DUB {
                return if rng.next_float() < 0.72 { base } else { base + 4 };
            }
            if c.style == JAZZ {
                if strong {
                    return if rng.next_float() < 0.50 { base } else { base + rng.next_int(1, 4) };
                }
                return clamp_i(
                    previous + rng.next_int(-1, 1)
                        + (if rng.next_float() < 0.25 + color * 0.20 { 1 } else { 0 }),
                    base - 2,
                    base + 5,
                );
            }
            if strong {
                return if rng.next_float() < 0.72 { base } else { base + 2 };
            }
            clamp_i(
                previous + rng.next_int(-1, 1)
                    + (if rng.next_float() < color * 0.20 { rng.next_int(-1, 1) } else { 0 }),
                base - 2,
                base + 4,
            )
        }
        ANSWER => {
            if c.style == DUB {
                return if rng.next_float() < 0.76 { base } else { base - 1 };
            }
            if c.style == JAZZ {
                return clamp_i(previous + rng.next_int(-1, 2), base - 3, base + 4);
            }
            if strong && rng.next_float() < 0.60 {
                return base;
            }
            clamp_i(previous + rng.next_int(-2, if color > 0.55 { 1 } else { 0 }), base - 3, base + 3)
        }
        CLIMB_R => {
            let progress = ordinal as f32 / 11.0;
            let rise = floor_i32(progress * (2.0 + c.motion * 4.0 + color * 2.0));
            clamp_i(base + rise + rng.next_int(0, 1), base, base + 6)
        }
        PEDAL => {
            if rng.next_float() < 0.82 { base } else { base + 1 }
        }
        BREAKDOWN => {
            if rng.next_float() < 0.70 { base } else { base - 1 }
        }
        CADENCE => {
            if local_step + 4 >= phrase_steps {
                0
            } else if ordinal >= (12 - 2).max(1) {
                if rng.next_float() < color * 0.35 {
                    6
                } else if rng.next_float() < 0.60 {
                    4
                } else {
                    6
                }
            } else {
                clamp_i(base + rng.next_int(0, if color > 0.60 { 3 } else { 2 }), base, base + 4)
            }
        }
        RELEASE => clamp_i(base - ordinal / 2 + rng.next_int(-1, 0), 0, (base + 1).max(0)),
        _ => base,
    }
}

fn choose_duration(
    c: &Controls,
    plan: &PhrasePlan,
    rng: &mut Rng,
    available: i32,
    local_step: i32,
    phrase_steps: i32,
) -> i32 {
    if available <= 1 {
        return 1;
    }
    let mut desired = 4;
    match c.style {
        GROUNDED => desired = 8,
        OSTINATO => desired = 3,
        MARCH => desired = 4,
        PULSE => desired = 8,
        DRONE => desired = 16,
        CLIMB => desired = 4,
        DUB => desired = 10,
        JAZZ => desired = 4,
        ROCK => desired = 4,
        DESCEND => desired = 8,
        ASCEND => desired = 8,
        _ => {}
    }
    match plan.role {
        PEDAL => desired = desired.max(12),
        BREAKDOWN => desired = 4,
        CADENCE => {
            if local_step + 4 >= phrase_steps {
                desired = desired.max(available);
            } else {
                desired = desired.max(6);
            }
        }
        RELEASE => desired = desired.max(6),
        _ => {}
    }
    let length = c.note_length.clamp(0.0, 1.0);
    let variation = c.note_length_var.clamp(0.0, 1.0);
    let length_cap = clamp_i(floor_i32(1.0 + length * (available - 1) as f32), 1, available);
    let center = clamp_i(desired, 1, length_cap);
    if variation <= 0.0001 || length_cap <= 1 {
        return center;
    }
    let spread = clamp_i(lround((length_cap - 1) as f32 * variation), 0, length_cap - 1);
    rng.next_int((1).max(center - spread), (length_cap).min(center + spread))
}

fn legato_amount(c: &Controls, plan: &PhrasePlan) -> f32 {
    let density = (c.density * plan.intensity).clamp(0.0, 1.0);
    let mut legato = 0.48 + (1.0 - density) * 0.18 + c.sequence * 0.08;
    match c.style {
        GROUNDED => legato += 0.14,
        PULSE => legato += 0.10,
        DRONE => legato += 0.30,
        OSTINATO => legato -= 0.18,
        MARCH => legato -= 0.10,
        CLIMB => legato += 0.02,
        DUB => legato += 0.22,
        JAZZ => legato -= 0.02,
        ROCK => legato -= 0.16,
        DESCEND => legato += 0.18,
        ASCEND => legato += 0.18,
        _ => {}
    }
    match plan.role {
        STATEMENT => legato += 0.06,
        ANSWER => legato += 0.04,
        CLIMB_R => legato -= 0.06,
        PEDAL => legato += 0.24,
        BREAKDOWN => legato -= 0.24,
        CADENCE => legato += 0.12,
        RELEASE => legato += 0.18,
        _ => {}
    }
    legato.clamp(0.0, 1.0)
}

fn apply_legato(list: &mut [NoteEvent], count: &mut i32, c: &Controls, plan: &PhrasePlan, rng: &mut Rng) {
    if *count <= 0 {
        return;
    }
    let length = c.note_length.clamp(0.0, 1.0);
    let variation = c.note_length_var.clamp(0.0, 1.0);
    let legato = legato_amount(c, plan) * (0.25 + length * 0.75);
    let phrase_end = plan.start_step + plan.step_count;
    for i in 0..*count as usize {
        let next_start = if i + 1 < *count as usize { list[i + 1].start } else { phrase_end };
        let max_duration = clamp_i(next_start - list[i].start, 1, phrase_end - list[i].start);
        let gap: i32;
        if i + 1 >= *count as usize {
            gap = if legato >= 0.66 { 0 } else { 1 };
        } else if legato >= 0.82 {
            gap = 0;
        } else if legato >= 0.60 {
            gap = if rng.next_float() < 0.65 * variation { 0 } else { 1 };
        } else if legato >= 0.42 {
            gap = 1;
        } else {
            gap = 1 + (if rng.next_float() < 0.35 * variation { 1 } else { 0 });
        }
        let length_cap = clamp_i(floor_i32(1.0 + length * (max_duration - 1) as f32), 1, max_duration);
        let stretched = clamp_i(max_duration - gap, 1, max_duration);
        list[i].duration = list[i].duration.max(stretched.min(length_cap));
    }
}

fn merge_repeats(list: &mut [NoteEvent], count: &mut i32, phrase_end: i32) {
    if *count <= 1 {
        return;
    }
    let mut merged = 0usize;
    for i in 0..*count as usize {
        let current = list[i];
        if merged > 0 {
            let previous_end = list[merged - 1].start + list[merged - 1].duration;
            let current_end = current.start + current.duration;
            if list[merged - 1].note == current.note && current.start <= previous_end {
                list[merged - 1].duration =
                    clamp_i((previous_end.max(current_end)) - list[merged - 1].start, 1, phrase_end - list[merged - 1].start);
                list[merged - 1].velocity = list[merged - 1].velocity.max(current.velocity);
                continue;
            }
        }
        list[merged] = current;
        merged += 1;
    }
    *count = merged as i32;
}

fn sort_by_start(list: &mut [NoteEvent], count: i32) {
    for i in 1..count as usize {
        let mut j = i;
        while j > 0 && list[j - 1].start > list[j].start {
            list.swap(j - 1, j);
            j -= 1;
        }
    }
}

/// Build one phrase's events into the workspace. Sequence mode re-voices the
/// previous phrase's events at this phrase's root instead of generating
/// fresh, with jitter scaled by the mutation strength.
#[allow(clippy::too_many_arguments)]
fn generate_phrase_events(
    out: &mut [NoteEvent; GRID],
    out_count: &mut i32,
    plan: &PhrasePlan,
    c: &Controls,
    steps_per_beat: i32,
    steps_per_bar: i32,
    prev_plan: Option<&PhrasePlan>,
    prev_events: Option<(&[NoteEvent], i32)>,
    use_sequence: bool,
    mutation: f32,
    rng: &mut Rng,
) {
    *out_count = 0;
    if use_sequence {
        if let (Some(pp), Some((pe, pn))) = (prev_plan, prev_events) {
            let shift = note_from_degree(c, plan.root_degree, plan.reg_offset)
                - note_from_degree(c, pp.root_degree, pp.reg_offset);
            for i in 0..pn as usize {
                if *out_count as usize >= GRID {
                    break;
                }
                let mut event = pe[i];
                let local = event.start - pp.start_step;
                let mut jitter = 0;
                if mutation > 0.25 {
                    jitter = rng.next_int(-2, 2);
                } else if rng.next_float()
                    < 0.10 + c.motion * 0.12 + c.tension * 0.08 + color_amount(c) * 0.10
                {
                    jitter = if rng.next_float() < 0.5 { -1 } else { 1 };
                }
                event.start = clamp_i(
                    plan.start_step + local + jitter,
                    plan.start_step,
                    plan.start_step + plan.step_count - 1,
                );
                event.duration = clamp_i(
                    event.duration + (if mutation > 0.30 { rng.next_int(-1, 1) } else { 0 }),
                    1,
                    plan.start_step + plan.step_count - event.start,
                );
                event.note = constrain_to_lane(
                    c,
                    apply_color_to_note(
                        c,
                        rng,
                        clamp_i(event.note + shift, 0, 127),
                        local,
                        steps_per_beat,
                        plan.role,
                        plan.step_count,
                    ),
                );
                event.velocity = clamp_i(event.velocity + rng.next_int(-4, 4), 52, 124);
                out[*out_count as usize] = event;
                *out_count += 1;
            }
            sort_by_start(out, *out_count);
            apply_legato(out, out_count, c, plan, rng);
            merge_repeats(out, out_count, plan.start_step + plan.step_count);
            return;
        }
    }

    let mut onset = [false; GRID];
    let phrase_steps = clamp_i(plan.step_count, 1, GRID as i32);
    let phrase_bars = plan.bars.max(1);
    for bar in 0..phrase_bars {
        build_bar_onsets(&mut onset, c, plan, rng, bar, phrase_bars, bar * steps_per_bar, steps_per_bar);
    }
    onset[0] = true;
    if plan.role == CADENCE {
        onset[(phrase_steps - steps_per_beat).max(0) as usize] = true;
    }

    let mut previous_degree = plan.root_degree;
    let mut ordinal = 0;
    for step in 0..phrase_steps {
        if !onset[step as usize] {
            continue;
        }
        if *out_count as usize >= GRID {
            break;
        }
        let mut next = phrase_steps;
        for s in step + 1..phrase_steps {
            if onset[s as usize] {
                next = s;
                break;
            }
        }
        let available = clamp_i(next - step, 1, phrase_steps - step);
        let degree = choose_degree(
            plan.role, plan.root_degree, c, rng, ordinal, step, phrase_steps, steps_per_beat, previous_degree,
        );
        previous_degree = degree;
        let duration = choose_duration(c, plan, rng, available, step, phrase_steps);
        let note = constrain_to_lane(
            c,
            apply_color_to_note(
                c, rng, note_from_degree(c, degree, plan.reg_offset),
                step, steps_per_beat, plan.role, phrase_steps,
            ),
        );
        let velocity = clamp_i(
            78 + lround(plan.intensity * 28.0)
                + (if step % steps_per_bar == 0 { 10 } else { 0 })
                + rng.next_int(-6, 6),
            48,
            124,
        );
        out[*out_count as usize] = NoteEvent { start: plan.start_step + step, duration, note, velocity };
        *out_count += 1;
        ordinal += 1;
    }

    if *out_count == 0 {
        out[0] = NoteEvent {
            start: plan.start_step,
            duration: plan.step_count.max(1),
            note: constrain_to_lane(c, note_from_degree(c, plan.root_degree, plan.reg_offset)),
            velocity: 84,
        };
        *out_count = 1;
    }

    sort_by_start(out, *out_count);
    apply_legato(out, out_count, c, plan, rng);
    merge_repeats(out, out_count, plan.start_step + plan.step_count);
}


fn degree_for_semitone(c: &Controls, target_semi: i32) -> i32 {
    let (count, table) = crate::pattern::scale_table(c.scale);
    let target = target_semi.rem_euclid(12);
    let mut best: i32 = 0;
    let mut best_distance = i32::MAX;
    for octave in -1..=1 {
        for degree in 0..count {
            let index = degree + octave * count;
            let semi = table[degree as usize] as i32 + octave * 12;
            let distance = (semi - target).abs();
            if distance < best_distance || (distance == best_distance && index.abs() < best.abs()) {
                best = index;
                best_distance = distance;
            }
        }
    }
    best
}

fn build_phrase_plan(form: &mut Form, c: &Controls, meter: Meter) {
    form.form_bars = if shaped_mode(c) {
        match c.form_shape {
            11 => 8,
            1 | 2 | 3 | 4 => 12,
            5 | 6 | 9 | 10 => 16,
            7 | 8 | 12 => 32,
            _ => 16,
        }
    } else {
        normalize_form_bars(c.form_bars)
    };
    form.phrase_bars = if shaped_mode(c) {
        match c.form_shape {
            1 | 2 | 3 | 4 => 1,
            6 | 11 => 2,
            _ => 4,
        }
    } else {
        normalize_phrase_bars(c.phrase_bars, form.form_bars)
    };
    form.meter = meter;
    form.steps_per_beat = 4;
    form.steps_per_bar = meter.steps_per_bar(4);
    form.pattern_steps = clamp_i(form.form_bars * form.steps_per_bar, 1, MAX_STEPS as i32);
    form.phrase_count = clamp_i(form.form_bars / form.phrase_bars.max(1), 1, MAX_PHRASES as i32);

    let mut planner = Rng::new(seed_mix(c, form.serial, -1, 0x2c9277b5));
    let peak = clamp_i(
        lround((form.phrase_count - 1) as f32 * (0.35 + (c.tension + color_amount(c) * 0.12).clamp(0.0, 1.0) * 0.40)),
        1,
        (form.phrase_count - 1).max(1),
    );
    for index in 0..form.phrase_count as usize {
        let start_bar = index as i32 * form.phrase_bars;
        let plan = &mut form.phrases[index];
        plan.start_bar = start_bar;
        plan.bars = form.phrase_bars;
        plan.start_step = start_bar * form.steps_per_bar;
        plan.step_count = form.phrase_bars * form.steps_per_bar;
        plan_one_phrase_inner(plan, c, index as i32, form.phrase_count, peak, &mut planner);
    }
}

/// Remove one phrase's event slice from the form, closing the gap, so a
/// regenerated phrase can be spliced back in. All surgery happens in place
/// on the form itself: no whole-form scratch buffer, which is what keeps
/// this off the WebAssembly stack.
fn remove_phrase_slice(form: &mut Form, phrase: usize) {
    let start = form.phrases[phrase].event_start;
    let count = form.phrases[phrase].event_count;
    if count <= 0 {
        return;
    }
    let total = form.event_count as usize;
    let from = (start + count) as usize;
    for i in from..total {
        form.events[i - count as usize] = form.events[i];
    }
    form.event_count -= count;
    form.phrases[phrase].event_start = start;
    form.phrases[phrase].event_count = 0;
    for p in phrase + 1..form.phrase_count as usize {
        form.phrases[p].event_start -= count;
    }
}

fn insert_phrase_slice(form: &mut Form, phrase: usize, events: &[NoteEvent], count: i32) {
    let at = form.phrases[phrase].event_start;
    let room = (MAX_EVENTS as i32 - form.event_count).min(count).max(0) as usize;
    let total = form.event_count as usize;
    let dest = at as usize;
    for i in (dest..total).rev() {
        if i + room < MAX_EVENTS {
            form.events[i + room] = form.events[i];
        }
    }
    for i in 0..room {
        form.events[dest + i] = events[i];
    }
    form.event_count += room as i32;
    form.phrases[phrase].event_count = room as i32;
    for p in phrase + 1..form.phrase_count as usize {
        form.phrases[p].event_start += room as i32;
    }
}

fn rebuild_phrase_events(
    form: &mut Form,
    c: &Controls,
    phrase: usize,
    use_sequence: bool,
    mutation: f32,
    salt: u32,
) {
    let mut rng = Rng::new(seed_mix(c, form.serial, phrase as i32, salt));
    // The previous phrase's events are copied out before this phrase's
    // slice is removed, so sequencing never reads half-moved data.
    let prev_copy: Option<(PhrasePlan, [NoteEvent; GRID], i32)> = if phrase > 0 {
        let pp = form.phrases[phrase - 1];
        let n = pp.event_count.min(GRID as i32).max(0) as usize;
        let mut buf = [NoteEvent { start: 0, duration: 0, note: 0, velocity: 0 }; GRID];
        for i in 0..n {
            buf[i] = form.events[(pp.event_start as usize) + i];
        }
        Some((pp, buf, n as i32))
    } else {
        None
    };
    remove_phrase_slice(form, phrase);
    let plan = form.phrases[phrase];
    let mut workspace = [NoteEvent { start: 0, duration: 0, note: 0, velocity: 0 }; GRID];
    let mut count = 0;
    generate_phrase_events(
        &mut workspace, &mut count, &plan, c,
        form.steps_per_beat, form.steps_per_bar,
        prev_copy.as_ref().map(|(pp, _, _)| pp),
        prev_copy.as_ref().map(|(_, buf, n)| (&buf[..], *n)),
        use_sequence && prev_copy.is_some(), mutation, &mut rng,
    );
    insert_phrase_slice(form, phrase, &workspace, count);
}

pub fn regenerate_form(form: &mut Form, raw: &Controls, meter: Meter) {
    let c = clamp_controls(raw);
    let previous_serial = form.serial;
    *form = Form::empty();
    form.serial = next_serial(previous_serial);
    build_phrase_plan(form, &c, meter);
    for phrase in 0..form.phrase_count as usize {
        let role = form.phrases[phrase].role;
        let use_sequence = phrase > 0
            && (role == ANSWER || role == RELEASE)
            && (fugal_mode(&c) || c.sequence > 0.35);
        rebuild_phrase_events(form, &c, phrase, use_sequence, 0.0, 0xa511e9b3);
    }
    constrain_lane(form, &c);
}

pub fn refresh_phrase(form: &mut Form, raw: &Controls, phrase: i32) {
    let c = clamp_controls(raw);
    if form.phrase_count <= 0 || form.pattern_steps <= 0 {
        regenerate_form(form, &c, form.meter);
        return;
    }
    let at = phrase.clamp(0, form.phrase_count - 1) as usize;
    form.serial = next_serial(form.serial);
    regenerate_single_plan(&mut form.phrases[at], &c, at as i32, form.phrase_count, form.serial);
    let role = form.phrases[at].role;
    let use_sequence = at > 0
        && (role == ANSWER || role == RELEASE)
        && (fugal_mode(&c) || c.sequence > 0.35);
    rebuild_phrase_events(form, &c, at, use_sequence, 0.12, 0xc1426ba3);
    constrain_lane(form, &c);
}

pub fn mutate_cell(form: &mut Form, raw: &Controls, phrase: i32, strength: f32) {
    let c = clamp_controls(raw);
    if form.phrase_count <= 0 || form.pattern_steps <= 0 {
        regenerate_form(form, &c, form.meter);
        return;
    }
    let at = phrase.clamp(0, form.phrase_count - 1) as usize;
    form.serial = next_serial(form.serial);
    rebuild_phrase_events(form, &c, at, false, strength.clamp(0.0, 1.0), 0x91f4b3d1);
    constrain_lane(form, &c);
}

pub fn set_phrase_role(form: &mut Form, raw: &Controls, phrase: i32, role: i32) {
    let c = clamp_controls(raw);
    if form.phrase_count <= 0 || form.pattern_steps <= 0 {
        regenerate_form(form, &c, form.meter);
    }
    let at = phrase.clamp(0, form.phrase_count - 1) as usize;
    form.serial = next_serial(form.serial);
    {
        let mut rng = Rng::new(seed_mix(&c, form.serial, at as i32, 0x3e58c2d7));
        let plan = &mut form.phrases[at];
        plan.role = role.clamp(0, 6);
        plan.root_degree = role_base_degree(plan.role, &mut rng);
        plan.reg_offset = phrase_reg_offset(&c, plan.role, at as i32, form.phrase_count);
        plan.intensity = role_intensity(plan.role);
        plan.motion_bias =
            role_motion_bias(plan.role, (c.motion + color_amount(&c) * 0.15).clamp(0.0, 1.0));
    }
    let role = form.phrases[at].role;
    let use_sequence = at > 0
        && (role == ANSWER || role == RELEASE)
        && (fugal_mode(&c) || c.sequence > 0.35);
    rebuild_phrase_events(form, &c, at, use_sequence, 0.08, 0x6af19b4d);
    constrain_lane(form, &c);
}

fn regenerate_single_plan(
    plan: &mut PhrasePlan,
    c: &Controls,
    phrase: i32,
    count: i32,
    serial: i32,
) {
    let mut rng = Rng::new(seed_mix(c, serial, phrase, 0x7f4a7c15));
    let peak = clamp_i(
        lround((count - 1) as f32 * (0.35 + (c.tension + color_amount(c) * 0.12).clamp(0.0, 1.0) * 0.40)),
        1,
        (count - 1).max(1),
    );
    plan_one_phrase_inner(plan, c, phrase, count, peak, &mut rng);
}

fn plan_one_phrase_inner(
    plan: &mut PhrasePlan,
    c: &Controls,
    phrase: i32,
    count: i32,
    peak: i32,
    rng: &mut Rng,
) {
    if blues_mode(c) {
        let (semi, role) = blues_plan(c.form_shape, phrase);
        plan.role = role;
        plan.root_degree = degree_for_semitone(c, semi);
    } else if shaped_mode(c) {
        let (semi, role) = structured_plan(c.form_shape, phrase);
        plan.role = role;
        plan.root_degree = degree_for_semitone(c, semi);
    } else if fugal_mode(c) {
        plan.role = fugal_role(phrase, count);
        plan.root_degree = fugal_root(plan.role, phrase);
    } else {
        plan.role = choose_role(c, rng, phrase, count, peak);
        plan.root_degree = role_base_degree(plan.role, rng);
    }
    plan.reg_offset = phrase_reg_offset(c, plan.role, phrase, count);
    plan.intensity = role_intensity(plan.role);
    plan.motion_bias =
        role_motion_bias(plan.role, (c.motion + color_amount(c) * 0.15).clamp(0.0, 1.0));
}

fn constrain_lane(form: &mut Form, c: &Controls) {
    for i in 0..form.event_count as usize {
        form.events[i].note = constrain_to_lane(c, form.events[i].note);
    }
}
