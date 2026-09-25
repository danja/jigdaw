// plugins/ground/src/pattern.rs
//
// The long-form bass plan: a form of bars divided into phrases, each phrase
// carrying a role, a root degree and its own generated events. A direct port
// of downspout's ground_pattern command set, keeping its form shapes, blues
// tables, role tables, onset grids and register lane, with one structural
// change: downspout rebuilds phrases through a 32 by 512 event scratch
// buffer, a quarter megabyte of stack that a 64KB WebAssembly stack cannot
// hold. This port generates one phrase at a time into a single 512 event
// workspace and splices the result into the form in place, which computes
// the same events without the scratch.

use crate::meter::Meter;
use crate::rng::Rng;

pub const MAX_PHRASES: usize = 32;
pub const MAX_STEPS: usize = 2048;
pub const MAX_EVENTS: usize = 2048;

// Styles, in jig:paramIndex order for the style port.
pub const GROUNDED: i32 = 0;
pub const OSTINATO: i32 = 1;
pub const MARCH: i32 = 2;
pub const PULSE: i32 = 3;
pub const DRONE: i32 = 4;
pub const CLIMB: i32 = 5;
pub const DUB: i32 = 6;
pub const JAZZ: i32 = 7;
pub const ROCK: i32 = 8;
pub const DESCEND: i32 = 9;
pub const ASCEND: i32 = 10;

// Phrase roles, in port order.
pub const STATEMENT: i32 = 0;
pub const ANSWER: i32 = 1;
pub const CLIMB_R: i32 = 2;
pub const PEDAL: i32 = 3;
pub const BREAKDOWN: i32 = 4;
pub const CADENCE: i32 = 5;
pub const RELEASE: i32 = 6;

// Form shapes, in port order.
pub const FREE: i32 = 0;
pub const BLUES12: i32 = 1;
pub const BLUES12_QUICK: i32 = 2;
pub const BLUES12_MINOR: i32 = 3;
pub const BLUES12_JAZZ: i32 = 4;
pub const CLASSICAL16: i32 = 5;
pub const FUGUE16: i32 = 6;
pub const JAZZ_AABA32: i32 = 7;
pub const RHYTHM32: i32 = 8;
pub const TECHNO16: i32 = 9;
pub const DUB16: i32 = 10;
pub const AMBIENT8: i32 = 11;
pub const RONDO32: i32 = 12;

/// The 23 scales, in ScaleId order. Identical to the downspout table.
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

pub(crate) fn clamp_i(v: i32, lo: i32, hi: i32) -> i32 {
    v.clamp(lo, hi)
}

/// lround for the non-negative values the planner rounds.
pub(crate) fn lround(v: f32) -> i32 {
    if v >= 0.0 { (v + 0.5) as i32 } else { (v - 0.5) as i32 }
}

pub(crate) fn floor_i32(v: f32) -> i32 {
    if v >= 0.0 { v as i32 } else { (v as i32) - (if (v as i32) as f32 == v { 0 } else { 1 }) }
}

/// Every control, by jig:paramIndex. Defaults match the downspout wrapper.
#[derive(Clone, Copy)]
pub struct Controls {
    pub root_note: i32,
    pub scale: i32,
    pub style: i32,
    pub channel: i32,
    pub form_bars: i32,
    pub phrase_bars: i32,
    pub density: f32,
    pub motion: f32,
    pub tension: f32,
    pub cadence: f32,
    pub range: f32,
    pub leap: f32,
    pub rest: f32,
    pub reg: i32,
    pub register_arc: f32,
    pub sequence: f32,
    pub seed: u32,
    pub vary: f32,
    pub action_new_form: u32,
    pub action_new_phrase: u32,
    pub action_mutate: u32,
    pub color: f32,
    pub note_length: f32,
    pub note_length_var: f32,
    pub form_shape: i32,
    pub overrides: [i32; 32],
    pub clamp_semi: i32,
    pub conductor_ch: i32,
}

impl Controls {
    pub const fn new() -> Self {
        Controls {
            root_note: 36,
            scale: 2,
            style: 0,
            channel: 1,
            form_bars: 16,
            phrase_bars: 4,
            density: 0.45,
            motion: 0.55,
            tension: 0.45,
            cadence: 0.50,
            range: 0.45,
            leap: 0.28,
            rest: 0.24,
            reg: 1,
            register_arc: 0.40,
            sequence: 0.35,
            seed: 1,
            vary: 0.0,
            action_new_form: 0,
            action_new_phrase: 0,
            action_mutate: 0,
            color: 0.0,
            note_length: 0.35,
            note_length_var: 0.35,
            form_shape: 0,
            overrides: [0; 32],
            clamp_semi: 12,
            conductor_ch: 0,
        }
    }
}

pub fn normalize_form_bars(raw: i32) -> i32 {
    let mut best = 8;
    let mut best_distance = i32::MAX;
    for value in [8, 12, 16, 32, 64] {
        let distance = (raw - value).abs();
        if distance < best_distance {
            best = value;
            best_distance = distance;
        }
    }
    best
}

pub fn normalize_phrase_bars(raw: i32, form_bars: i32) -> i32 {
    let mut best = 1;
    let mut best_distance = i32::MAX;
    for value in [1, 2, 3, 4, 6, 8, 12] {
        if value > form_bars || form_bars % value != 0 {
            continue;
        }
        let distance = (raw - value).abs();
        if distance < best_distance {
            best = value;
            best_distance = distance;
        }
    }
    best
}

fn shaped_bars(shape: i32) -> i32 {
    match shape {
        AMBIENT8 => 8,
        BLUES12 | BLUES12_QUICK | BLUES12_MINOR | BLUES12_JAZZ => 12,
        CLASSICAL16 | FUGUE16 | TECHNO16 | DUB16 => 16,
        JAZZ_AABA32 | RHYTHM32 | RONDO32 => 32,
        _ => 16,
    }
}

fn shaped_phrase_bars(shape: i32) -> i32 {
    match shape {
        BLUES12 | BLUES12_QUICK | BLUES12_MINOR | BLUES12_JAZZ => 1,
        FUGUE16 | AMBIENT8 => 2,
        _ => 4,
    }
}

pub fn clamp_controls(raw: &Controls) -> Controls {
    let mut c = *raw;
    c.root_note = clamp_i(c.root_note, 0, 127);
    c.scale = clamp_i(c.scale, 0, 22);
    c.style = clamp_i(c.style, 0, 11);
    c.form_shape = clamp_i(c.form_shape, 0, 12);
    c.channel = clamp_i(c.channel, 1, 16);
    if c.form_shape != FREE {
        c.form_bars = shaped_bars(c.form_shape);
        c.phrase_bars = shaped_phrase_bars(c.form_shape);
    } else {
        c.form_bars = normalize_form_bars(c.form_bars);
        c.phrase_bars = normalize_phrase_bars(c.phrase_bars, c.form_bars);
    }
    c.density = c.density.clamp(0.0, 1.0);
    c.motion = c.motion.clamp(0.0, 1.0);
    c.tension = c.tension.clamp(0.0, 1.0);
    c.color = c.color.clamp(0.0, 1.0);
    c.cadence = c.cadence.clamp(0.0, 1.0);
    c.range = c.range.clamp(0.0, 1.0);
    c.leap = c.leap.clamp(0.0, 1.0);
    c.rest = c.rest.clamp(0.0, 1.0);
    c.reg = clamp_i(c.reg, 0, 3);
    c.register_arc = c.register_arc.clamp(0.0, 1.0);
    c.clamp_semi = clamp_i(c.clamp_semi, 12, 48);
    c.sequence = c.sequence.clamp(0.0, 1.0);
    c.note_length = c.note_length.clamp(0.0, 1.0);
    c.note_length_var = c.note_length_var.clamp(0.0, 1.0);
    c.vary = c.vary.clamp(0.0, 1.0);
    if c.seed == 0 {
        c.seed = 1;
    }
    for o in c.overrides.iter_mut() {
        *o = clamp_i(*o, 0, 7);
    }
    c
}

/// Whether the form has to be rebuilt. Vary only steers loop mutation, the
/// channel only addresses output bytes, and the actions and overrides are
/// handled where they fire.
pub fn structural_matches(a: &Controls, b: &Controls) -> bool {
    a.root_note == b.root_note
        && a.scale == b.scale
        && a.style == b.style
        && a.form_shape == b.form_shape
        && a.form_bars == b.form_bars
        && a.phrase_bars == b.phrase_bars
        && (a.density - b.density).abs() < 0.0001
        && (a.motion - b.motion).abs() < 0.0001
        && (a.tension - b.tension).abs() < 0.0001
        && (a.color - b.color).abs() < 0.0001
        && (a.cadence - b.cadence).abs() < 0.0001
        && (a.range - b.range).abs() < 0.0001
        && (a.leap - b.leap).abs() < 0.0001
        && (a.rest - b.rest).abs() < 0.0001
        && a.reg == b.reg
        && (a.register_arc - b.register_arc).abs() < 0.0001
        && a.clamp_semi == b.clamp_semi
        && (a.sequence - b.sequence).abs() < 0.0001
        && (a.note_length - b.note_length).abs() < 0.0001
        && (a.note_length_var - b.note_length_var).abs() < 0.0001
        && a.seed == b.seed
}

#[derive(Clone, Copy, Default)]
pub struct NoteEvent {
    pub start: i32,
    pub duration: i32,
    pub note: i32,
    pub velocity: i32,
}

#[derive(Clone, Copy, Default)]
pub struct PhrasePlan {
    pub role: i32,
    pub start_bar: i32,
    pub bars: i32,
    pub start_step: i32,
    pub step_count: i32,
    pub event_start: i32,
    pub event_count: i32,
    pub root_degree: i32,
    pub reg_offset: i32,
    pub intensity: f32,
    pub motion_bias: f32,
}

#[derive(Clone, Copy)]
pub struct Form {
    pub form_bars: i32,
    pub phrase_bars: i32,
    pub phrase_count: i32,
    pub pattern_steps: i32,
    pub steps_per_beat: i32,
    pub steps_per_bar: i32,
    pub event_count: i32,
    pub serial: i32,
    pub meter: Meter,
    pub phrases: [PhrasePlan; MAX_PHRASES],
    pub events: [NoteEvent; MAX_EVENTS],
}

impl Form {
    pub const fn empty() -> Self {
        Form {
            form_bars: 0,
            phrase_bars: 0,
            phrase_count: 0,
            pattern_steps: 0,
            steps_per_beat: 4,
            steps_per_bar: 16,
            event_count: 0,
            serial: 0,
            meter: Meter::new(4, 4),
            phrases: [PhrasePlan {
                role: 0, start_bar: 0, bars: 0, start_step: 0, step_count: 0,
                event_start: 0, event_count: 0, root_degree: 0, reg_offset: 0,
                intensity: 0.0, motion_bias: 0.0,
            }; MAX_PHRASES],
            events: [NoteEvent { start: 0, duration: 0, note: 0, velocity: 0 }; MAX_EVENTS],
        }
    }
}

pub(crate) fn next_serial(current: i32) -> i32 {
    if current >= i32::MAX { 1 } else { current + 1 }
}

pub(crate) fn seed_mix(c: &Controls, serial: i32, phrase: i32, salt: u32) -> u32 {
    c.seed
        ^ ((serial as u32).wrapping_mul(2654435761))
        ^ (((phrase + 1) as u32).wrapping_mul(2246822519))
        ^ ((lround(c.color * 1000.0) as u32).wrapping_mul(3266489917))
        ^ ((c.form_shape as u32).wrapping_mul(668265263))
        ^ salt
}

/// A legacy sixteenth slot stretched onto however many steps this bar
/// actually holds, so the onset grids survive odd meters.
pub(crate) fn scaled_step(steps_per_bar: i32, legacy: i32) -> i32 {
    if steps_per_bar <= 0 {
        return 0;
    }
    lround(legacy as f32 / 16.0 * steps_per_bar as f32).clamp(0, steps_per_bar - 1)
}

fn is_jazz_scale(scale: i32) -> bool {
    matches!(scale, 5 | 8 | 7 | 4 | 16 | 17 | 18 | 19 | 20 | 21 | 22)
}

pub(crate) fn color_amount(c: &Controls) -> f32 {
    let color = c.color.clamp(0.0, 1.0);
    if is_jazz_scale(c.scale) { color } else { color * 0.45 }
}

pub(crate) fn reg_octaves(reg: i32) -> i32 {
    reg.clamp(0, 3) - 1
}

pub(crate) fn scale_count(scale: i32) -> i32 {
    SCALES[scale.clamp(0, 22) as usize].0 as i32
}

pub(crate) fn scale_table(scale: i32) -> (i32, [u8; 8]) {
    let (count, table) = SCALES[scale.clamp(0, 22) as usize];
    (count as i32, table)
}

pub(crate) fn role_base_degree(role: i32, rng: &mut Rng) -> i32 {
    match role {
        STATEMENT => {
            if rng.next_float() < 0.75 { 0 } else { 2 }
        }
        ANSWER => {
            if rng.next_float() < 0.55 { 3 } else { 4 }
        }
        CLIMB_R => {
            if rng.next_float() < 0.55 { 4 } else { 5 }
        }
        PEDAL => {
            if rng.next_float() < 0.70 { 0 } else { 4 }
        }
        BREAKDOWN => 0,
        CADENCE => {
            if rng.next_float() < 0.65 { 4 } else { 5 }
        }
        _ => {
            if rng.next_float() < 0.60 { 0 } else { 2 }
        }
    }
}

pub(crate) fn role_intensity(role: i32) -> f32 {
    match role {
        STATEMENT => 0.72,
        ANSWER => 0.62,
        CLIMB_R => 0.94,
        PEDAL => 0.48,
        BREAKDOWN => 0.26,
        CADENCE => 0.86,
        RELEASE => 0.44,
        _ => 0.60,
    }
}

pub(crate) fn role_motion_bias(role: i32, motion: f32) -> f32 {
    match role {
        STATEMENT => motion * 0.75,
        ANSWER => motion * 0.60,
        CLIMB_R => (motion * 1.25 + 0.12).clamp(0.0, 1.0),
        PEDAL => motion * 0.18,
        BREAKDOWN => motion * 0.15,
        CADENCE => motion * 0.55,
        RELEASE => motion * 0.35,
        _ => motion,
    }
}

pub(crate) fn fugal_mode(c: &Controls) -> bool {
    c.sequence >= 0.78 && c.cadence >= 0.62 && c.density >= 0.22
}

pub(crate) fn blues_mode(c: &Controls) -> bool {
    matches!(c.form_shape, BLUES12 | BLUES12_QUICK | BLUES12_MINOR | BLUES12_JAZZ)
}

pub(crate) fn shaped_mode(c: &Controls) -> bool {
    c.form_shape != FREE
}

pub(crate) fn fugal_role(phrase: i32, count: i32) -> i32 {
    if phrase <= 0 {
        STATEMENT
    } else if phrase == count - 1 {
        CADENCE
    } else if count >= 4 && phrase == count - 2 {
        PEDAL
    } else if phrase % 2 == 1 {
        ANSWER
    } else if phrase >= (2).max(count / 2) {
        CLIMB_R
    } else {
        STATEMENT
    }
}

pub(crate) fn fugal_root(role: i32, phrase: i32) -> i32 {
    match role {
        STATEMENT => {
            if phrase <= 0 { 0 } else { 2 }
        }
        ANSWER => 4,
        CLIMB_R => {
            if phrase % 2 == 0 { 2 } else { 5 }
        }
        PEDAL | BREAKDOWN | RELEASE => 0,
        CADENCE => 4,
        _ => 0,
    }
}


// The twelve-bar plans, as (root semitone, role) per bar.
const BLUES_STD_PLAN: [(i32, i32); 12] = [
    (0, STATEMENT), (0, ANSWER), (0, STATEMENT), (0, ANSWER),
    (5, CLIMB_R), (5, ANSWER), (0, STATEMENT), (0, BREAKDOWN),
    (7, CLIMB_R), (5, ANSWER), (0, CADENCE), (7, CADENCE),
];
const BLUES_QUICK_PLAN: [(i32, i32); 12] = [
    (0, STATEMENT), (5, ANSWER), (0, STATEMENT), (0, ANSWER),
    (5, CLIMB_R), (5, ANSWER), (0, STATEMENT), (0, BREAKDOWN),
    (7, CLIMB_R), (5, ANSWER), (0, CADENCE), (7, CADENCE),
];
const BLUES_MINOR_PLAN: [(i32, i32); 12] = BLUES_STD_PLAN;
const BLUES_JAZZ_PLAN: [(i32, i32); 12] = [
    (0, STATEMENT), (5, ANSWER), (0, STATEMENT), (0, ANSWER),
    (5, CLIMB_R), (6, CLIMB_R), (0, STATEMENT), (9, ANSWER),
    (2, CLIMB_R), (7, CADENCE), (0, CADENCE), (7, CADENCE),
];

pub(crate) fn blues_plan(shape: i32, bar: i32) -> (i32, i32) {
    let at = bar.clamp(0, 11) as usize;
    match shape {
        BLUES12_QUICK => BLUES_QUICK_PLAN[at],
        BLUES12_MINOR => BLUES_MINOR_PLAN[at],
        BLUES12_JAZZ => BLUES_JAZZ_PLAN[at],
        _ => BLUES_STD_PLAN[at],
    }
}

const CLASSICAL16_PLAN: [(i32, i32); 4] =
    [(0, STATEMENT), (7, ANSWER), (5, CLIMB_R), (7, CADENCE)];
const FUGUE16_PLAN: [(i32, i32); 8] = [
    (0, STATEMENT), (7, ANSWER), (0, STATEMENT), (5, ANSWER),
    (2, CLIMB_R), (7, PEDAL), (5, CLIMB_R), (7, CADENCE),
];
const AABA32_PLAN: [(i32, i32); 8] = [
    (0, STATEMENT), (5, ANSWER), (0, STATEMENT), (7, CADENCE),
    (4, CLIMB_R), (9, CLIMB_R), (2, ANSWER), (7, CADENCE),
];
const RHYTHM32_PLAN: [(i32, i32); 8] = [
    (0, STATEMENT), (9, ANSWER), (2, CLIMB_R), (7, CADENCE),
    (0, STATEMENT), (9, ANSWER), (2, CLIMB_R), (7, CADENCE),
];
const TECHNO16_PLAN: [(i32, i32); 4] =
    [(0, PEDAL), (0, STATEMENT), (0, CLIMB_R), (0, CADENCE)];
const DUB16_PLAN: [(i32, i32); 4] =
    [(0, PEDAL), (5, ANSWER), (0, BREAKDOWN), (7, CADENCE)];
const AMBIENT8_PLAN: [(i32, i32); 4] =
    [(0, PEDAL), (0, PEDAL), (5, RELEASE), (0, RELEASE)];
const RONDO32_PLAN: [(i32, i32); 8] = [
    (0, STATEMENT), (7, ANSWER), (0, STATEMENT), (5, CLIMB_R),
    (0, STATEMENT), (9, BREAKDOWN), (0, STATEMENT), (7, CADENCE),
];

pub(crate) fn structured_plan(shape: i32, phrase: i32) -> (i32, i32) {
    match shape {
        CLASSICAL16 => CLASSICAL16_PLAN[phrase.clamp(0, 3) as usize],
        FUGUE16 => FUGUE16_PLAN[phrase.clamp(0, 7) as usize],
        JAZZ_AABA32 => AABA32_PLAN[phrase.clamp(0, 7) as usize],
        RHYTHM32 => RHYTHM32_PLAN[phrase.clamp(0, 7) as usize],
        TECHNO16 => TECHNO16_PLAN[phrase.clamp(0, 3) as usize],
        DUB16 => DUB16_PLAN[phrase.clamp(0, 3) as usize],
        AMBIENT8 => AMBIENT8_PLAN[phrase.clamp(0, 3) as usize],
        RONDO32 => RONDO32_PLAN[phrase.clamp(0, 7) as usize],
        _ => (0, STATEMENT),
    }
}

pub(crate) fn note_from_degree(c: &Controls, degree_index: i32, phrase_reg: i32) -> i32 {
    let (count, table) = SCALES[c.scale.clamp(0, 22) as usize];
    let count = count as i32;
    let mut octave = degree_index.div_euclid(count);
    let mut degree = degree_index.rem_euclid(count);
    if degree < 0 {
        degree += count;
        octave -= 1;
    }
    let interval = table[degree as usize] as i32 + 12 * (octave + reg_octaves(c.reg) + phrase_reg);
    clamp_i(c.root_note + interval, 0, 127)
}

/// Every generated note is folded into the guarded bass lane: up or down by
/// octaves into the register window, then clamped to the clamp width. A bass
/// line that escapes into the midrange is a defect, not expression.
pub(crate) fn constrain_to_lane(c: &Controls, note: i32) -> i32 {
    let mut note = note;
    let root = clamp_i(c.root_note + 12 * reg_octaves(c.reg), 0, 127);
    let lower = clamp_i(root - 7, 0, 127);
    let upper = clamp_i(root + 19 + lround(c.register_arc.clamp(0.0, 1.0) * 5.0), 0, 127);
    while note > upper && note >= 12 {
        note -= 12;
    }
    while note < lower && note <= 115 {
        note += 12;
    }
    note = clamp_i(note, lower, lower.max(upper));
    let clamp_upper = clamp_i(root + c.clamp_semi, root, 127);
    while note < root && note + 12 <= 127 {
        note += 12;
    }
    while note > clamp_upper && note - 12 >= 0 {
        note -= 12;
    }
    while note < root && note + 12 <= clamp_upper {
        note += 12;
    }
    clamp_i(note, root, clamp_upper)
}

pub(crate) fn choose_role(c: &Controls, rng: &mut Rng, phrase: i32, count: i32, peak: i32) -> i32 {
    if phrase <= 0 {
        return STATEMENT;
    }
    if phrase == count - 1 {
        return if c.cadence >= 0.28 { CADENCE } else { RELEASE };
    }
    if phrase == peak || phrase + 1 == peak {
        return CLIMB_R;
    }
    let progress = phrase as f32 / (count - 1).max(1) as f32;
    let color = color_amount(c);
    if rng.next_float() < c.tension * 0.24 + color * 0.10 + (if progress > 0.55 { 0.10 } else { 0.0 }) {
        return BREAKDOWN;
    }
    if c.sequence > 0.45 && phrase % 2 == 1 {
        return ANSWER;
    }
    if rng.next_float() < 0.12 + c.cadence * 0.12 {
        return PEDAL;
    }
    if phrase % 2 == 0 { STATEMENT } else { ANSWER }
}

pub(crate) fn phrase_reg_offset(c: &Controls, role: i32, phrase: i32, count: i32) -> i32 {
    let progress = phrase as f32 / (count - 1).max(1) as f32;
    let mut offset = floor_i32(progress * c.register_arc * 3.0);
    match role {
        PEDAL | BREAKDOWN => offset -= 1,
        CLIMB_R | CADENCE => offset += 1,
        _ => {}
    }
    clamp_i(offset, -1, 2)
}
