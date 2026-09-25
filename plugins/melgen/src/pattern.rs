// plugins/melgen/src/pattern.rs
//
// The phrase-aware melody pattern: scale-degree motifs grown per phrase,
// derived across periods, realised to notes with cadence and color. A direct
// port of downspout's melgen_pattern command set, keeping its tables, its
// seeded derivations and its question/answer structure rather than
// reimagining any of them.

use crate::meter::Meter;
use crate::rng::Rng;

pub const MIN_LENGTH_BEATS: i32 = 4;
pub const MAX_LENGTH_BEATS: i32 = 64;
pub const MAX_STEPS: usize = 384;
pub const MAX_EVENTS: usize = 256;
pub const MAX_PHRASES: usize = 16;
const MOTIF_CAP: usize = 64;

// Periods, contours and answers, in jig:paramIndex order for their ports.
pub const FREE: i32 = 0;
pub const AA: i32 = 1;
pub const AB: i32 = 2;
pub const AA_PRIME: i32 = 3;
pub const CALL_ANSWER: i32 = 4;
pub const ABA: i32 = 5;

pub const WANDERING: i32 = 0;
pub const FLAT: i32 = 1;
pub const RISING: i32 = 2;
pub const FALLING: i32 = 3;
pub const ARCH: i32 = 4;
pub const INV_ARCH: i32 = 5;

pub const RELATED: i32 = 0;
// Same is the identity transform: no branch tests for it because there is
// nothing to do, but the answer table would be a lie without it.
#[allow(dead_code)]
pub const SAME: i32 = 1;
pub const TRANSPOSE: i32 = 2;
pub const INVERT: i32 = 3;
pub const COMPRESS: i32 = 4;
pub const EXPAND: i32 = 5;

pub const ROLE_FREE: i32 = 0;
pub const ROLE_CALL: i32 = 1;
pub const ROLE_ANSWER: i32 = 2;
pub const ROLE_REPEAT: i32 = 3;
pub const ROLE_VARIATION: i32 = 4;
pub const ROLE_CONTRAST: i32 = 5;
pub const ROLE_CADENCE: i32 = 6;

/// The 23 scales, in ScaleId order: (degrees in the octave, intervals).
/// Identical to the downspout table, because a scale is a fact rather than
/// an implementation choice.
const SCALES: [(u8, [u8; 8]); 23] = [
    (7, [0, 2, 4, 5, 7, 9, 11, 0]), // major
    (7, [0, 2, 4, 5, 7, 9, 11, 0]), // ionian
    (7, [0, 2, 3, 5, 7, 8, 10, 0]), // minor
    (7, [0, 2, 3, 5, 7, 8, 11, 0]), // harmonic minor
    (7, [0, 2, 3, 5, 7, 9, 11, 0]), // melodic minor
    (7, [0, 2, 3, 5, 7, 9, 10, 0]), // dorian
    (7, [0, 1, 3, 5, 7, 8, 10, 0]), // phrygian
    (7, [0, 2, 4, 6, 7, 9, 11, 0]), // lydian
    (7, [0, 2, 4, 5, 7, 9, 10, 0]), // mixolydian
    (7, [0, 1, 3, 5, 6, 8, 10, 0]), // locrian
    (7, [0, 1, 4, 5, 7, 8, 10, 0]), // phrygian dominant
    (7, [0, 1, 4, 5, 7, 9, 11, 0]), // neapolitan major
    (7, [0, 1, 3, 5, 7, 8, 11, 0]), // neapolitan minor
    (5, [0, 2, 4, 7, 9, 0, 0, 0]),  // pentatonic major
    (5, [0, 3, 5, 7, 10, 0, 0, 0]), // pentatonic minor
    (6, [0, 3, 5, 6, 7, 10, 0, 0]), // blues
    (6, [0, 2, 4, 6, 8, 10, 0, 0]), // whole tone
    (7, [0, 1, 3, 4, 6, 8, 10, 0]), // altered
    (8, [0, 1, 3, 4, 6, 7, 9, 10]), // half whole diminished
    (8, [0, 2, 3, 5, 6, 8, 9, 11]), // whole half diminished
    (8, [0, 2, 4, 5, 7, 9, 10, 11]), // bebop dominant
    (8, [0, 2, 4, 5, 7, 8, 9, 11]), // bebop major
    (8, [0, 2, 3, 4, 5, 7, 9, 10]), // bebop minor
];

fn clamp_i(v: i32, lo: i32, hi: i32) -> i32 {
    v.clamp(lo, hi)
}

/// lround for the non-negative values the generator rounds: degrees,
/// durations, accent bumps. Nothing here rounds a negative.
fn lround(v: f32) -> i32 {
    if v >= 0.0 { (v + 0.5) as i32 } else { (v - 0.5) as i32 }
}

fn fabs(v: f32) -> f32 {
    if v < 0.0 { -v } else { v }
}

/// Every control, by jig:paramIndex. Defaults match the downspout wrapper, so
/// a project moving between the two starts from the same line.
#[derive(Clone, Copy)]
pub struct Controls {
    pub root_note: i32,
    pub scale: i32,
    pub channel: i32,
    pub length_beats: i32,
    pub phrase_bars: i32,
    pub subdivision: i32,
    pub period: i32,
    pub contour: i32,
    pub answer: i32,
    pub density: f32,
    pub reg: i32,
    pub hold: f32,
    pub accent: f32,
    pub structure: f32,
    pub range: f32,
    pub leap: f32,
    pub rest: f32,
    pub cadence: f32,
    pub seed: u32,
    pub vary: f32,
    pub action_new: u32,
    pub action_notes: u32,
    pub action_rhythm: u32,
    pub follow: f32,
    pub color: f32,
    pub conductor_ch: i32,
}

impl Controls {
    pub const fn new() -> Self {
        Controls {
            root_note: 60,
            scale: 0,
            channel: 1,
            length_beats: 16,
            phrase_bars: 2,
            subdivision: 1,
            period: CALL_ANSWER,
            contour: ARCH,
            answer: RELATED,
            density: 0.48,
            reg: 1,
            hold: 0.42,
            accent: 0.45,
            structure: 0.62,
            range: 0.45,
            leap: 0.28,
            rest: 0.24,
            cadence: 0.55,
            seed: 1,
            vary: 0.0,
            action_new: 0,
            action_notes: 0,
            action_rhythm: 0,
            follow: 0.0,
            color: 0.5,
            conductor_ch: 0,
        }
    }
}

pub fn clamp_controls(raw: &Controls) -> Controls {
    let mut c = *raw;
    c.root_note = clamp_i(c.root_note, 0, 127);
    c.scale = clamp_i(c.scale, 0, 22);
    c.channel = clamp_i(c.channel, 1, 16);
    c.length_beats = clamp_i(c.length_beats, MIN_LENGTH_BEATS, MAX_LENGTH_BEATS);
    c.phrase_bars = clamp_i(c.phrase_bars, 1, 8);
    c.subdivision = clamp_i(c.subdivision, 0, 3);
    c.period = clamp_i(c.period, 0, 5);
    c.contour = clamp_i(c.contour, 0, 5);
    c.answer = clamp_i(c.answer, 0, 5);
    c.density = c.density.clamp(0.0, 1.0);
    c.reg = clamp_i(c.reg, 0, 4);
    c.hold = c.hold.clamp(0.0, 1.0);
    c.accent = c.accent.clamp(0.0, 1.0);
    c.structure = c.structure.clamp(0.0, 1.0);
    c.range = c.range.clamp(0.0, 1.0);
    c.leap = c.leap.clamp(0.0, 1.0);
    c.rest = c.rest.clamp(0.0, 1.0);
    c.cadence = c.cadence.clamp(0.0, 1.0);
    c.color = c.color.clamp(0.0, 1.0);
    c.vary = c.vary.clamp(0.0, 1.0);
    c.follow = c.follow.clamp(0.0, 1.0);
    if c.seed == 0 {
        c.seed = 1;
    }
    c.conductor_ch = clamp_i(c.conductor_ch, 0, 16);
    c
}

/// Whether the pattern has to be rebuilt. Vary and follow only steer what
/// already exists, and the action counters are handled where they fire.
pub fn structural_changed(a: &Controls, b: &Controls) -> bool {
    a.root_note != b.root_note
        || a.scale != b.scale
        || a.length_beats != b.length_beats
        || a.phrase_bars != b.phrase_bars
        || a.subdivision != b.subdivision
        || a.period != b.period
        || a.contour != b.contour
        || a.answer != b.answer
        || (a.density - b.density).abs() >= 0.0001
        || a.reg != b.reg
        || (a.hold - b.hold).abs() >= 0.0001
        || (a.accent - b.accent).abs() >= 0.0001
        || (a.structure - b.structure).abs() >= 0.0001
        || (a.range - b.range).abs() >= 0.0001
        || (a.leap - b.leap).abs() >= 0.0001
        || (a.rest - b.rest).abs() >= 0.0001
        || (a.cadence - b.cadence).abs() >= 0.0001
        || (a.color - b.color).abs() >= 0.0001
        || a.seed != b.seed
}

pub fn steps_per_beat(subdivision: i32) -> i32 {
    match subdivision {
        3 => 1,
        0 => 2,
        2 => 6,
        _ => 4,
    }
}

pub fn register_offset(reg: i32) -> i32 {
    (reg.clamp(0, 4) - 1) * 12
}

#[derive(Clone, Copy)]
pub struct NoteEvent {
    pub start: i32,
    pub duration: i32,
    pub note: i32,
    pub velocity: i32,
}

#[derive(Clone, Copy)]
pub struct PhraseInfo {
    pub start: i32,
    // Length, role and source are phrase metadata: written by regen, carried
    // in the pattern for state and interface surfaces to read. The engine
    // recomputes roles from the period rather than reading them back.
    #[allow(dead_code)]
    pub length: i32,
    #[allow(dead_code)]
    pub role: i32,
    #[allow(dead_code)]
    pub source: i32,
}

#[derive(Clone, Copy)]
pub struct Pattern {
    pub steps_per_beat: i32,
    pub steps_per_bar: i32,
    pub pattern_steps: i32,
    pub event_count: i32,
    pub phrase_count: i32,
    pub serial: i32,
    pub meter: Meter,
    pub events: [NoteEvent; MAX_EVENTS],
    pub phrases: [PhraseInfo; MAX_PHRASES],
}

impl Pattern {
    pub const fn empty() -> Self {
        Pattern {
            steps_per_beat: 4,
            steps_per_bar: 16,
            pattern_steps: 0,
            event_count: 0,
            phrase_count: 0,
            serial: 0,
            meter: Meter::new(4, 4),
            events: [NoteEvent { start: 0, duration: 0, note: 0, velocity: 0 }; MAX_EVENTS],
            phrases: [PhraseInfo { start: 0, length: 0, role: 0, source: -1 }; MAX_PHRASES],
        }
    }
}

fn next_serial(current: i32) -> i32 {
    if current >= i32::MAX { 1 } else { current + 1 }
}

fn seed_mix(c: &Controls, serial: i32) -> u32 {
    c.seed
        ^ (((c.period + 1) as u32).wrapping_mul(2246822519))
        ^ (((c.contour + 3) as u32).wrapping_mul(3266489917))
        ^ ((serial as u32).wrapping_mul(2654435761))
}

fn contour_target(c: &Controls, progress: f32, max_degree: i32) -> i32 {
    let mid = max_degree / 2;
    match c.contour {
        FLAT | WANDERING => mid,
        RISING => lround(progress * max_degree as f32),
        FALLING => lround((1.0 - progress) * max_degree as f32),
        ARCH => lround((1.0 - fabs(progress * 2.0 - 1.0)) * max_degree as f32),
        INV_ARCH => lround(fabs(progress * 2.0 - 1.0) * max_degree as f32),
        _ => mid,
    }
}

fn note_from_degree(c: &Controls, degree_index: i32) -> i32 {
    let (count, table) = SCALES[c.scale.clamp(0, 22) as usize];
    let clamped = degree_index.clamp(0, count as i32 * 5 - 1);
    let octave = clamped / count as i32;
    let degree = (clamped % count as i32) as usize;
    clamp_i(c.root_note + register_offset(c.reg) + table[degree] as i32 + 12 * octave, 0, 127)
}

/// The strict region: call-and-answer period, high structure, low leap and
/// rest. There a tonic subject gets a dominant answer without any genre
/// selector, which is what makes the Fugue end of the range work.
fn strict_fugue(c: &Controls) -> bool {
    c.period == CALL_ANSWER && c.structure >= 0.88 && c.leap <= 0.22 && c.rest <= 0.25
}

fn is_jazz_color_scale(scale: i32) -> bool {
    matches!(scale, 5 | 8 | 7 | 4 | 17 | 18 | 19 | 20 | 21 | 22)
}

/// Color pulls a realised note toward its neighbour: chromatic approaches
/// and enclosures on weak steps, wider the higher it runs. Cadence endings
/// are protected, so tension never lands on the resolution itself.
fn apply_color(
    rng: &mut Rng,
    c: &Controls,
    steps_per_beat: i32,
    start_step: i32,
    base_note: i32,
    next_note: i32,
    protect_cadence: bool,
) -> i32 {
    let color = c.color.clamp(0.0, 1.0);
    if color <= 0.001 || protect_cadence {
        return base_note;
    }
    let weak = (start_step % steps_per_beat.max(1)) != 0;
    let mut chance = color * (if weak { 0.34 } else { 0.07 });
    if next_note >= 0 {
        chance += color * 0.16;
    }
    if is_jazz_color_scale(c.scale) {
        chance += color * 0.08;
    }
    if rng.next_float() >= chance.clamp(0.0, 0.82) {
        return base_note;
    }
    let mut note = base_note;
    if next_note >= 0 && color > 0.40 {
        if base_note < next_note {
            note = next_note - 1;
        } else if base_note > next_note {
            note = next_note + 1;
        } else {
            note = next_note + (if rng.next_float() < 0.5 { -1 } else { 1 });
        }
        if color > 0.78 && weak && rng.next_float() < 0.35 {
            note = next_note + (if note < next_note { 1 } else { -1 });
        }
    } else {
        note += if rng.next_float() < 0.5 { -1 } else { 1 };
    }
    clamp_i(note, 0, 127)
}

fn phrase_length_steps(c: &Controls, p: &Pattern) -> i32 {
    let bars = clamp_i(c.phrase_bars, 1, 8);
    clamp_i(bars * p.steps_per_bar, p.steps_per_beat, p.pattern_steps)
}

fn role_for_phrase(period: i32, phrase: i32) -> i32 {
    match period {
        AA => {
            if phrase == 0 { ROLE_CALL } else { ROLE_REPEAT }
        }
        AB => {
            if phrase % 2 == 0 { ROLE_CALL } else { ROLE_CONTRAST }
        }
        AA_PRIME => {
            if phrase == 0 { ROLE_CALL } else { ROLE_VARIATION }
        }
        CALL_ANSWER => {
            if phrase % 2 == 0 { ROLE_CALL } else { ROLE_ANSWER }
        }
        ABA => {
            if phrase % 3 == 0 {
                ROLE_CALL
            } else if phrase % 3 == 1 {
                ROLE_CONTRAST
            } else {
                ROLE_VARIATION
            }
        }
        _ => ROLE_FREE,
    }
}

fn source_for_phrase(period: i32, phrase: i32) -> i32 {
    if phrase <= 0 || period == FREE {
        return -1;
    }
    match role_for_phrase(period, phrase) {
        ROLE_REPEAT | ROLE_VARIATION | ROLE_ANSWER => phrase - 1,
        _ => -1,
    }
}

fn max_degree(c: &Controls) -> i32 {
    let (count, _) = SCALES[c.scale.clamp(0, 22) as usize];
    clamp_i(count as i32 - 1 + lround(c.range * 17.0), 3, count as i32 * 4 - 1)
}

fn choose_duration(rng: &mut Rng, c: &Controls, spb: i32) -> i32 {
    let short = (spb / 2).max(1);
    let beat = spb.max(1);
    if rng.next_float() < c.hold {
        if rng.next_float() < 0.35 { beat * 2 } else { beat }
    } else {
        short
    }
}

fn choose_next_degree(rng: &mut Rng, c: &Controls, previous: i32, target: i32, max_deg: i32) -> i32 {
    let structure = c.structure.clamp(0.0, 1.0);
    let color = c.color.clamp(0.0, 1.0);
    let leap_chance = (c.leap * (1.15 - structure * 0.55) + color * 0.08).clamp(0.0, 1.0);
    let mut degree = previous;
    if rng.next_float() < leap_chance {
        let jump = rng.next_int(2, (2 + lround(c.range * 7.0)).max(2));
        degree += if rng.next_float() < 0.5 { -jump } else { jump };
    } else {
        let direction = if target > previous { 1 } else if target < previous { -1 } else { 0 };
        let wander = rng.next_int(-1, 1);
        if rng.next_float() < color * 0.18 {
            degree += if rng.next_float() < 0.5 { -1 } else { 1 };
        } else {
            degree += if rng.next_float() < structure { direction } else { wander };
        }
    }
    if rng.next_float() < structure * 0.35 {
        degree = lround(degree as f32 * 0.7 + target as f32 * 0.3);
    }
    if rng.next_float() < color * (1.0 - structure) * 0.20 {
        degree += rng.next_int(-2, 2);
    }
    clamp_i(degree, 0, max_deg)
}

#[derive(Clone, Copy)]
struct MotifEvent {
    start: i32,
    duration: i32,
    degree: i32,
    velocity: i32,
}

#[derive(Clone, Copy)]
struct Motif {
    events: [MotifEvent; MOTIF_CAP],
    count: i32,
    length: i32,
}

impl Motif {
    fn empty() -> Self {
        Motif {
            events: [MotifEvent { start: 0, duration: 1, degree: 0, velocity: 92 }; MOTIF_CAP],
            count: 0,
            length: 0,
        }
    }

    fn push(&mut self, event: MotifEvent) {
        if self.count < MOTIF_CAP as i32 {
            self.events[self.count as usize] = event;
            self.count += 1;
        }
    }
}

const SUBJECT_DEGREES: [i32; 8] = [0, 1, 2, 4, 3, 2, 1, 0];

fn generate_fresh(rng: &mut Rng, c: &Controls, p: &Pattern, phrase: i32) -> Motif {
    let mut motif = Motif::empty();
    motif.length = phrase_length_steps(c, p);
    let max_deg = max_degree(c);

    if strict_fugue(c) {
        let beat_steps = p.steps_per_beat.max(1);
        let spacing = if c.density >= 0.78 { (beat_steps / 2).max(1) } else { beat_steps };
        let duration = clamp_i(lround(spacing as f32 * (0.72 + c.hold * 0.32)), 1, beat_steps.max(1));
        let lift = if phrase % 2 == 0 { 0 } else { 4 };
        let mut step = 0;
        let mut subject = 0;
        while step < motif.length {
            if !(c.density < 0.95 && subject > 0 && subject % 5 == 4 && rng.next_float() > c.density) {
                let degree = clamp_i(SUBJECT_DEGREES[subject % 8] + lift, 0, max_deg);
                let strong = step % beat_steps == 0;
                let accent = if strong { lround(c.accent * 22.0) } else { 0 };
                motif.push(MotifEvent { start: step, duration, degree, velocity: 86 + accent });
            }
            step += spacing;
            subject += 1;
        }
        if motif.count == 0 {
            motif.push(MotifEvent { start: 0, duration: beat_steps, degree: 0, velocity: 96 });
        }
        return motif;
    }

    let mut degree = contour_target(c, if phrase % 2 == 0 { 0.12 } else { 0.36 }, max_deg);
    let mut step = 0;
    while step < motif.length {
        let progress = if motif.length > 1 { step as f32 / (motif.length - 1) as f32 } else { 0.0 };
        let strong = step % p.steps_per_beat.max(1) == 0;
        let rest_chance = (c.rest * (if strong { 0.45 } else { 1.15 })).clamp(0.0, 0.9);
        let hit_chance = (c.density * (if strong { 1.35 } else { 0.85 })).clamp(0.02, 0.98);
        let duration = choose_duration(rng, c, p.steps_per_beat);
        if rng.next_float() >= rest_chance && rng.next_float() < hit_chance {
            let target = contour_target(c, progress, max_deg);
            degree = choose_next_degree(rng, c, degree, target, max_deg);
            let accent = if strong { lround(c.accent * 22.0) } else { 0 };
            motif.push(MotifEvent {
                start: step,
                duration,
                degree,
                velocity: 82 + accent + rng.next_int(-6, 9),
            });
        }
        let half = (p.steps_per_beat / 2).max(1);
        step += if rng.next_float() < 0.70 { half } else { p.steps_per_beat.max(1) };
    }
    if motif.count == 0 {
        motif.push(MotifEvent {
            start: 0,
            duration: p.steps_per_beat.max(1),
            degree: contour_target(c, 0.0, max_deg),
            velocity: 96,
        });
    }
    motif
}

fn derive_motif(rng: &mut Rng, c: &Controls, p: &Pattern, source: &Motif, role: i32) -> Motif {
    let mut motif = Motif::empty();
    motif.length = phrase_length_steps(c, p);
    motif.count = source.count.min(MOTIF_CAP as i32);
    for i in 0..motif.count as usize {
        motif.events[i] = source.events[i];
    }
    let max_deg = max_degree(c);
    let strict_answer = strict_fugue(c) && role == ROLE_ANSWER;
    let shift = if strict_answer {
        4
    } else if c.answer == TRANSPOSE {
        rng.next_int(1, 3)
    } else if role == ROLE_ANSWER {
        2
    } else {
        0
    };
    let invert = c.answer == INVERT
        || (if strict_answer {
            c.color >= 0.75
        } else {
            role == ROLE_ANSWER && rng.next_float() < c.structure * 0.25
        });
    let mutation = if strict_answer {
        (c.color * 0.08).clamp(0.0, 1.0)
    } else {
        (1.0 - c.structure + c.color * 0.25).clamp(0.0, 1.0)
    };
    let center = max_deg / 2;
    for i in 0..motif.count as usize {
        let event = &mut motif.events[i];
        if c.answer == COMPRESS && role == ROLE_ANSWER {
            event.start /= 2;
            event.duration = (event.duration / 2).max(1);
        } else if c.answer == EXPAND && role == ROLE_ANSWER {
            event.start = (motif.length - 1).min(event.start * 2);
            event.duration = (event.duration * 2).max(1);
        }
        if invert {
            event.degree = center - (event.degree - center);
        }
        event.degree += shift;
        if role == ROLE_VARIATION && i >= motif.count as usize - 2 {
            event.degree += rng.next_int(-2, 2);
        } else if role == ROLE_CONTRAST {
            let at = if motif.length > 0 { event.start as f32 / motif.length.max(1) as f32 } else { 0.0 };
            event.degree = contour_target(c, 1.0 - at, max_deg);
        } else if rng.next_float() < mutation * 0.35 {
            event.degree += rng.next_int(-2, 2);
        }
        event.degree = clamp_i(event.degree, 0, max_deg);
        event.velocity = clamp_i(event.velocity + rng.next_int(-5, 5), 1, 127);
    }
    motif
}

fn apply_cadence(c: &Controls, motif: &mut Motif, role: i32) {
    if motif.count <= 0 || c.cadence <= 0.001 {
        return;
    }
    let strong_ending =
        role == ROLE_ANSWER || role == ROLE_VARIATION || role == ROLE_CADENCE || c.period == AA;
    let strength = if strong_ending { c.cadence } else { c.cadence * 0.45 };
    if strength < 0.15 {
        return;
    }
    let last = &mut motif.events[motif.count as usize - 1];
    if strict_fugue(c) && role == ROLE_ANSWER {
        last.degree = 4;
    } else if strength > 0.74 {
        last.degree = 0;
    } else if strength > 0.42 {
        last.degree = 4;
    } else {
        last.degree = 2;
    }
}

fn append_event(p: &mut Pattern, start: i32, duration: i32, note: i32, velocity: i32) {
    if p.event_count >= MAX_EVENTS as i32 || start < 0 || start >= p.pattern_steps {
        return;
    }
    let event = NoteEvent {
        start,
        duration: clamp_i(duration, 1, p.pattern_steps - start),
        note: clamp_i(note, 0, 127),
        velocity: clamp_i(velocity, 1, 127),
    };
    p.events[p.event_count as usize] = event;
    p.event_count += 1;
}

fn realize_motif(p: &mut Pattern, c: &Controls, motif: &Motif, phrase_start: i32, rng: &mut Rng) {
    for i in 0..motif.count as usize {
        let event = motif.events[i];
        let start = phrase_start + event.start;
        if start >= p.pattern_steps {
            continue;
        }
        let base = note_from_degree(c, event.degree);
        let next = if i + 1 < motif.count as usize {
            note_from_degree(c, motif.events[i + 1].degree)
        } else {
            -1
        };
        let protect = i == motif.count as usize - 1 && c.cadence > 0.20;
        let note = apply_color(rng, c, p.steps_per_beat, event.start, base, next, protect);
        append_event(p, start, event.duration, note, event.velocity);
    }
}

fn sort_events(p: &mut Pattern) {
    for i in 1..p.event_count as usize {
        let mut j = i;
        while j > 0 {
            let (a, b) = (p.events[j - 1], p.events[j]);
            let swap = a.start > b.start || (a.start == b.start && a.duration > b.duration);
            if !swap {
                break;
            }
            p.events[j - 1] = b;
            p.events[j] = a;
            j -= 1;
        }
    }
}

/// The scale note nearest a target within a range, breaking ties toward the
/// root. What pulls a followed pitch into key.
pub fn nearest_scale_note(raw: &Controls, target_note: i32, min_note: i32, max_note: i32) -> i32 {
    let c = clamp_controls(raw);
    let lo = clamp_i(min_note.min(max_note), 0, 127);
    let hi = clamp_i(min_note.max(max_note), 0, 127);
    let target = clamp_i(target_note, lo, hi);
    let (count, table) = SCALES[c.scale.clamp(0, 22) as usize];
    let root_pc = c.root_note.rem_euclid(12);
    let mut best = target;
    let mut best_distance = 128;
    for note in lo..=hi {
        let interval = (note - root_pc).rem_euclid(12);
        let mut in_scale = false;
        for i in 0..count as usize {
            if table[i] as i32 == interval {
                in_scale = true;
                break;
            }
        }
        if !in_scale {
            continue;
        }
        let distance = (note - target).abs();
        if distance < best_distance
            || (distance == best_distance
                && (note - c.root_note).abs() < (best - c.root_note).abs())
        {
            best = note;
            best_distance = distance;
        }
    }
    best
}

pub fn regenerate(p: &mut Pattern, raw: &Controls, meter: Meter, regen_rhythm: bool, regen_notes: bool) {
    let c = clamp_controls(raw);
    let previous = *p;
    *p = Pattern::empty();
    p.serial = next_serial(previous.serial);
    p.steps_per_beat = steps_per_beat(c.subdivision);
    p.meter = meter;
    p.steps_per_bar = meter.steps_per_bar(p.steps_per_beat);
    p.pattern_steps = clamp_i(c.length_beats * p.steps_per_beat, 1, MAX_STEPS as i32);

    let mut rng = Rng::new(seed_mix(&c, if regen_rhythm && regen_notes { p.serial } else { previous.serial }));

    let phrase_length = phrase_length_steps(&c, p);
    let phrase_count = clamp_i(
        (p.pattern_steps + phrase_length - 1) / phrase_length,
        1,
        MAX_PHRASES as i32,
    );
    p.phrase_count = phrase_count;

    // Motifs are rebuilt phrase by phrase; derivation reads the source
    // phrase's motif, so they are kept until every phrase is realised.
    let mut motifs = [Motif::empty(); MAX_PHRASES];
    for phrase in 0..phrase_count as usize {
        let start = phrase as i32 * phrase_length;
        let role = role_for_phrase(c.period, phrase as i32);
        let source = source_for_phrase(c.period, phrase as i32);
        p.phrases[phrase] = PhraseInfo {
            start,
            length: (phrase_length).min(p.pattern_steps - start),
            role,
            source,
        };
        if !regen_rhythm && previous.event_count > 0 {
            continue;
        }
        let mut motif = if source >= 0 && (source as usize) < phrase && c.structure > 0.05 {
            // The source phrase was built this pass, so deriving from it is
            // reading finished work rather than a half-built bar.
            let src = Motif {
                events: motifs[source as usize].events,
                count: motifs[source as usize].count,
                length: motifs[source as usize].length,
            };
            derive_motif(&mut rng, &c, p, &src, role)
        } else {
            generate_fresh(&mut rng, &c, p, phrase as i32)
        };
        apply_cadence(&c, &mut motif, role);
        motifs[phrase] = Motif {
            events: motif.events,
            count: motif.count,
            length: motif.length,
        };
    }

    if !regen_rhythm && previous.event_count > 0 {
        p.event_count = previous.event_count.min(MAX_EVENTS as i32);
        for i in 0..p.event_count as usize {
            let mut event = previous.events[i];
            if regen_notes {
                let max_deg = max_degree(&c);
                let base = note_from_degree(&c, rng.next_int(0, max_deg));
                let next = if i + 1 < p.event_count as usize { previous.events[i + 1].note } else { -1 };
                event.note = apply_color(&mut rng, &c, p.steps_per_beat, event.start, base, next, false);
            }
            p.events[i] = event;
        }
    } else {
        for phrase in 0..phrase_count as usize {
            let m = Motif {
                events: motifs[phrase].events,
                count: motifs[phrase].count,
                length: motifs[phrase].length,
            };
            realize_motif(p, &c, &m, p.phrases[phrase].start, &mut rng);
        }
    }
    sort_events(p);
}

pub fn partial_mutation(p: &mut Pattern, raw: &Controls, strength: f32) {
    let c = clamp_controls(raw);
    if p.event_count <= 0 {
        regenerate(p, &c, p.meter, true, true);
        return;
    }
    let mut rng = Rng::new(
        c.seed
            ^ ((p.serial as u32).wrapping_mul(747796405))
            ^ ((p.event_count as u32).wrapping_mul(2891336453)),
    );
    let max_deg = max_degree(&c);
    let chance = strength.clamp(0.0, 1.0);
    for i in 0..p.event_count as usize {
        if rng.next_float() < chance {
            let base = note_from_degree(&c, rng.next_int(0, max_deg));
            let next = if i + 1 < p.event_count as usize { p.events[i + 1].note } else { -1 };
            p.events[i].note =
                apply_color(&mut rng, &c, p.steps_per_beat, p.events[i].start, base, next, false);
            p.events[i].velocity = clamp_i(p.events[i].velocity + rng.next_int(-10, 10), 1, 127);
        }
    }
    p.serial = next_serial(p.serial);
}
