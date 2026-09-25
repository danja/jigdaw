// plugins/drumgen/src/pattern.rs
//
// The pattern: eleven drum lanes over up to 128 steps, built from the
// controls by seeded chance. A direct port of downspout's drumgen_pattern
// command set: clamp and change detection, per-bar building from anchors and
// a Euclidean layer, genre signatures, fill overlays, and the cleanup that
// keeps hats, claps and crashes from doubling each other.

use crate::anchors::{
    accent_beats, anchor_probability, euclid_hit, euclid_influence, euclid_pulses, is_backbeat,
    low_density_scale, AUTO, DIDDLEY, DISCO, ELECTRO, AMEN, BREAKBEAT, HIPHOP, JAZZ, JUNGLE, ROCK,
    SHUFFLE, DUB, MOTORIK, BOSSA, AFRO, FUGUE,
};
use crate::meter::Meter;
use crate::rng::Rng;

pub const LANES: usize = 11;
pub const MAX_STEPS: usize = 128;

pub const KICK: i32 = 0;
pub const CLAP: i32 = 1;
pub const SNARE: i32 = 2;
pub const CRASH: i32 = 3;
pub const CHAT: i32 = 4;
pub const LOWTOM: i32 = 5;
pub const OHAT: i32 = 6;
pub const HIGHTOM: i32 = 7;
pub const BASH: i32 = 8;
pub const COWBELL: i32 = 9;
pub const CLAVE: i32 = 10;

pub const FLAG_ACCENT: u8 = 1;
pub const FLAG_FILL: u8 = 2;

const FLUES_NOTES: [u8; LANES] = [36, 39, 40, 41, 42, 45, 46, 50, 51, 52, 53];
const GM_NOTES: [u8; LANES] = [36, 39, 38, 49, 42, 45, 46, 50, 57, 56, 75];

fn clamp_i(v: i32, lo: i32, hi: i32) -> i32 {
    v.clamp(lo, hi)
}

fn lround(v: f32) -> i32 {
    if v >= 0.0 { (v + 0.5) as i32 } else { (v - 0.5) as i32 }
}

/// Every control, by jig:paramIndex. Defaults match the downspout wrapper, so
/// a project moving between the two starts from the same groove.
#[derive(Clone, Copy)]
pub struct Controls {
    pub genre: i32,
    pub style_mode: i32,
    pub channel: i32,
    pub kit_map: i32,
    pub bars: i32,
    pub resolution: i32,
    pub density: f32,
    pub variation: f32,
    pub fill: f32,
    pub seed: u32,
    pub kick_amt: f32,
    pub backbeat_amt: f32,
    pub hat_amt: f32,
    pub aux_amt: f32,
    pub action_new: u32,
    pub action_mutate: u32,
    pub action_fill: u32,
    pub tom_amt: f32,
    pub metal_amt: f32,
    pub vary: f32,
    pub conductor_ch: i32,
    /// Not a parameter. The builder sets it before each bar so the anchor
    /// tables can tell the first bar from the rest; see anchors.rs.
    pub bar_hint: i32,
}

impl Controls {
    pub const fn new() -> Self {
        Controls {
            genre: ROCK,
            style_mode: AUTO,
            channel: 10,
            kit_map: 0,
            bars: 2,
            resolution: 1,
            density: 0.58,
            variation: 0.35,
            fill: 0.30,
            seed: 1,
            kick_amt: 0.78,
            backbeat_amt: 0.76,
            hat_amt: 0.82,
            aux_amt: 0.28,
            action_new: 0,
            action_mutate: 0,
            action_fill: 0,
            tom_amt: 0.30,
            metal_amt: 0.26,
            vary: 0.0,
            conductor_ch: 0,
            bar_hint: 0,
        }
    }
}

pub fn clamp_controls(raw: &Controls) -> Controls {
    let mut c = *raw;
    c.genre = clamp_i(c.genre, 0, 13);
    c.style_mode = clamp_i(c.style_mode, 0, 6);
    c.channel = clamp_i(c.channel, 1, 16);
    c.kit_map = clamp_i(c.kit_map, 0, 1);
    c.bars = clamp_i(c.bars, 1, 4);
    c.resolution = clamp_i(c.resolution, 0, 3);
    c.density = c.density.clamp(0.0, 1.0);
    c.variation = c.variation.clamp(0.0, 1.0);
    c.fill = c.fill.clamp(0.0, 1.0);
    c.kick_amt = c.kick_amt.clamp(0.0, 1.0);
    c.backbeat_amt = c.backbeat_amt.clamp(0.0, 1.0);
    c.hat_amt = c.hat_amt.clamp(0.0, 1.0);
    c.aux_amt = c.aux_amt.clamp(0.0, 1.0);
    c.tom_amt = c.tom_amt.clamp(0.0, 1.0);
    c.metal_amt = c.metal_amt.clamp(0.0, 1.0);
    c.vary = c.vary.clamp(0.0, 1.0);
    c.conductor_ch = clamp_i(c.conductor_ch, 0, 16);
    c
}

/// Whether the pattern has to be rebuilt. Vary only resets the loop
/// variation countdown, and the action counters are handled where they fire.
pub fn structural_changed(a: &Controls, b: &Controls) -> bool {
    a.genre != b.genre
        || a.style_mode != b.style_mode
        || a.kit_map != b.kit_map
        || a.bars != b.bars
        || a.resolution != b.resolution
        || (a.density - b.density).abs() >= 0.0001
        || (a.variation - b.variation).abs() >= 0.0001
        || (a.fill - b.fill).abs() >= 0.0001
        || a.seed != b.seed
        || (a.kick_amt - b.kick_amt).abs() >= 0.0001
        || (a.backbeat_amt - b.backbeat_amt).abs() >= 0.0001
        || (a.hat_amt - b.hat_amt).abs() >= 0.0001
        || (a.aux_amt - b.aux_amt).abs() >= 0.0001
        || (a.tom_amt - b.tom_amt).abs() >= 0.0001
        || (a.metal_amt - b.metal_amt).abs() >= 0.0001
}

pub fn steps_per_beat(resolution: i32) -> i32 {
    match resolution {
        0 => 2,
        2 => 3,
        3 => 1,
        _ => 4,
    }
}

pub fn note_for_lane(kit_map: i32, lane: usize) -> u8 {
    if kit_map == 1 { GM_NOTES[lane] } else { FLUES_NOTES[lane] }
}

#[derive(Clone, Copy)]
pub struct Pattern {
    pub bars: i32,
    pub steps_per_beat: i32,
    pub steps_per_bar: i32,
    pub total_steps: i32,
    pub serial: i32,
    pub meter: Meter,
    pub notes: [u8; LANES],
    pub vel: [[u8; MAX_STEPS]; LANES],
    pub flags: [[u8; MAX_STEPS]; LANES],
}

impl Pattern {
    pub const fn empty() -> Self {
        Pattern {
            bars: 0,
            steps_per_beat: 4,
            steps_per_bar: 0,
            total_steps: 0,
            serial: 0,
            meter: Meter::new(4, 4),
            notes: [0; LANES],
            vel: [[0; MAX_STEPS]; LANES],
            flags: [[0; MAX_STEPS]; LANES],
        }
    }
}

fn next_serial(current: i32) -> i32 {
    if current >= i32::MAX { 1 } else { current + 1 }
}

fn base_seed(c: &Controls, serial: i32) -> u32 {
    c.seed
        ^ ((c.genre as u32).wrapping_mul(0x45D9F3B))
        ^ (((c.style_mode + 1) as u32).wrapping_mul(0x119DE1F3))
        ^ ((serial as u32).wrapping_mul(0x9E3779B9))
}

fn fill_seed(c: &Controls, serial: i32) -> u32 {
    c.seed ^ ((serial as u32).wrapping_mul(0x85EBCA6B)) ^ 0xA511E9B3
}

fn bar_seed(c: &Controls, serial: i32, bar: i32, fill_bar: bool) -> u32 {
    base_seed(c, serial)
        ^ (((bar + 1) as u32).wrapping_mul(0x27D4EB2D))
        ^ (if fill_bar { fill_seed(c, serial) } else { 0 })
}

/// A manual Fill plays louder than the fill slider alone.
pub fn manual_fill_controls(raw: &Controls) -> Controls {
    let mut c = clamp_controls(raw);
    c.fill = c.fill.max(0.72).clamp(0.0, 1.0);
    c
}

fn clear_pattern(p: &mut Pattern, c: &Controls, meter: Meter) {
    *p = Pattern::empty();
    p.bars = c.bars;
    p.steps_per_beat = steps_per_beat(c.resolution);
    p.meter = meter;
    p.steps_per_bar = meter.steps_per_bar(p.steps_per_beat);
    p.total_steps = clamp_i(p.bars * p.steps_per_bar, 1, MAX_STEPS as i32);
    for lane in 0..LANES {
        p.notes[lane] = note_for_lane(c.kit_map, lane);
    }
}

fn clear_step(p: &mut Pattern, lane: i32, step: i32) {
    if lane < 0 || lane >= LANES as i32 || step < 0 || step >= p.total_steps {
        return;
    }
    p.vel[lane as usize][step as usize] = 0;
    p.flags[lane as usize][step as usize] = 0;
}

fn set_step(p: &mut Pattern, lane: i32, step: i32, velocity: i32, flags: u8) {
    if lane < 0 || lane >= LANES as i32 || step < 0 || step >= p.total_steps {
        return;
    }
    let cell = &mut p.vel[lane as usize][step as usize];
    if velocity > *cell as i32 {
        *cell = clamp_i(velocity, 1, 127) as u8;
    }
    p.flags[lane as usize][step as usize] |= flags;
}

/// The signature overlays are written on a sixteen-slot grid and stretched
/// onto however many steps this bar actually has, so they survive odd meters.
fn step_for_slot(p: &Pattern, bar_start: i32, slot: i32) -> i32 {
    if p.steps_per_bar <= 0 {
        return bar_start;
    }
    bar_start + clamp_i(lround(slot as f32 * p.steps_per_bar as f32 / 16.0), 0, p.steps_per_bar - 1)
}

fn set_slot(p: &mut Pattern, bar_start: i32, lane: i32, slot: i32, velocity: i32, flags: u8) {
    set_step(p, lane, step_for_slot(p, bar_start, slot), velocity, flags);
}

fn break_hats(p: &mut Pattern, bar_start: i32, c: &Controls, dense: bool) {
    let stride = if dense { 1 } else { 2 };
    let mut slot = 0;
    while slot < 16 {
        let velocity = if dense {
            62 + (if slot % 4 == 0 { 8 } else { 0 })
        } else {
            78 + (if slot % 4 == 0 { 7 } else { 0 })
        };
        set_slot(p, bar_start, CHAT, slot, velocity, 0);
        slot += stride;
    }
    if c.hat_amt > 0.20 {
        let open = if c.genre == HIPHOP { 62 } else { 70 };
        set_slot(p, bar_start, OHAT, 3, open, 0);
        set_slot(p, bar_start, OHAT, 7, open + 2, 0);
        set_slot(p, bar_start, OHAT, 11, open, 0);
        set_slot(p, bar_start, OHAT, 15, open + 4, 0);
    }
}

/// Pinned grooves for the genres that have one: rock's kick and backbeat,
/// the Amen break's ghost notes, boom-bap's laid hats. Everything else is
/// left to the anchors.
fn genre_signature_bar(p: &mut Pattern, c: &Controls, bar: i32) {
    if c.style_mode != AUTO || p.steps_per_bar <= 0 || bar < 0 || bar >= p.bars {
        return;
    }
    let start = bar * p.steps_per_bar;
    match c.genre {
        ROCK => {
            let mut slot = 0;
            while slot < 16 {
                set_slot(p, start, CHAT, slot, 82 + (if slot % 4 == 0 { 10 } else { 0 }), 0);
                slot += 2;
            }
            set_slot(p, start, KICK, 0, 124, FLAG_ACCENT);
            set_slot(p, start, KICK, 8, 118, FLAG_ACCENT);
            set_slot(p, start, KICK, 14, 98, 0);
            set_slot(p, start, SNARE, 4, 122, FLAG_ACCENT);
            set_slot(p, start, SNARE, 12, 124, FLAG_ACCENT);
            set_slot(p, start, CRASH, 0, 94, FLAG_ACCENT);
        }
        JAZZ => {
            let mut slot = 0;
            while slot < 16 {
                set_slot(
                    p,
                    start,
                    KICK,
                    slot,
                    66 + (if slot == 0 { 8 } else { 0 }),
                    if slot == 0 { FLAG_ACCENT } else { 0 },
                );
                set_slot(
                    p,
                    start,
                    CHAT,
                    slot,
                    82 + (if slot == 0 { 8 } else { 0 }),
                    if slot == 0 { FLAG_ACCENT } else { 0 },
                );
                set_slot(p, start, CHAT, slot + 3, 70, 0);
                slot += 4;
            }
            set_slot(p, start, OHAT, 4, 68, 0);
            set_slot(p, start, OHAT, 12, 72, 0);
            set_slot(p, start, SNARE, 6, 62, 0);
            set_slot(p, start, SNARE, 10, 58, 0);
        }
        AMEN => {
            break_hats(p, start, c, false);
            set_slot(p, start, KICK, 0, 122, FLAG_ACCENT);
            set_slot(p, start, KICK, 6, 108, 0);
            set_slot(p, start, KICK, 10, 112, 0);
            set_slot(p, start, SNARE, 4, 119, FLAG_ACCENT);
            set_slot(p, start, SNARE, 12, 122, FLAG_ACCENT);
            set_slot(p, start, SNARE, 3, 58, 0);
            set_slot(p, start, SNARE, 7, 66, 0);
            set_slot(p, start, SNARE, 11, 58, 0);
            set_slot(p, start, SNARE, 15, 72, 0);
            set_slot(p, start, CRASH, 0, 86, FLAG_ACCENT);
        }
        JUNGLE => {
            break_hats(p, start, c, true);
            set_slot(p, start, KICK, 0, 122, FLAG_ACCENT);
            set_slot(p, start, KICK, 6, 112, 0);
            set_slot(p, start, KICK, 10, 116, 0);
            set_slot(p, start, KICK, 14, 96, 0);
            set_slot(p, start, SNARE, 4, 121, FLAG_ACCENT);
            set_slot(p, start, SNARE, 12, 124, FLAG_ACCENT);
            set_slot(p, start, SNARE, 3, 54, 0);
            set_slot(p, start, SNARE, 7, 70, 0);
            set_slot(p, start, SNARE, 11, 62, 0);
            set_slot(p, start, SNARE, 15, 76, 0);
            set_slot(p, start, BASH, 15, 98, 0);
        }
        BREAKBEAT => {
            break_hats(p, start, c, false);
            set_slot(p, start, KICK, 0, 120, FLAG_ACCENT);
            set_slot(p, start, KICK, 3, 96, 0);
            set_slot(p, start, KICK, 10, 110, 0);
            set_slot(p, start, SNARE, 4, 116, FLAG_ACCENT);
            set_slot(p, start, SNARE, 12, 118, FLAG_ACCENT);
            set_slot(p, start, SNARE, 7, 64, 0);
            set_slot(p, start, SNARE, 15, 70, 0);
        }
        HIPHOP => {
            let mut slot = 0;
            while slot < 16 {
                set_slot(p, start, CHAT, slot, 68 + (if slot % 4 == 0 { 8 } else { 0 }), 0);
                slot += 2;
            }
            set_slot(p, start, KICK, 0, 120, FLAG_ACCENT);
            set_slot(p, start, KICK, 7, 94, 0);
            set_slot(p, start, KICK, 10, 108, 0);
            set_slot(p, start, SNARE, 4, 116, FLAG_ACCENT);
            set_slot(p, start, SNARE, 12, 118, FLAG_ACCENT);
            set_slot(p, start, SNARE, 15, 52, 0);
            set_slot(p, start, OHAT, 6, 58, 0);
            set_slot(p, start, OHAT, 14, 60, 0);
        }
        _ => {}
    }
}

/// The two-bar "shave and a haircut" 3-2 shape: clave accents with kick and
/// snare reinforcement and light hats underneath.
fn diddley_bar(p: &mut Pattern, c: &Controls, bar: i32) {
    if c.style_mode != DIDDLEY || p.steps_per_bar <= 0 || bar < 0 || bar >= p.bars {
        return;
    }
    let start = bar * p.steps_per_bar;
    let phrase = bar % 2;
    let mut slot = 0;
    while slot < 16 {
        set_slot(p, start, CHAT, slot, 60 + (if slot % 4 == 0 { 8 } else { 0 }), 0);
        slot += 2;
    }
    for slot in 0..16 {
        let accent = if phrase == 0 {
            slot == 0 || slot == 6 || slot == 12
        } else {
            slot == 4 || slot == 8
        };
        if !accent {
            continue;
        }
        let first = phrase == 0 && slot == 0;
        let tail = (phrase == 1 && slot == 8) || (phrase == 0 && slot == 12);
        set_slot(p, start, CLAVE, slot, if first { 118 } else if tail { 112 } else { 106 }, FLAG_ACCENT);
        if first || (phrase == 0 && slot == 12) || (phrase == 1 && slot == 8) {
            set_slot(p, start, KICK, slot, if first { 116 } else { 102 }, if first { FLAG_ACCENT } else { 0 });
        }
        if (phrase == 0 && slot == 6) || (phrase == 1 && slot == 4) {
            set_slot(p, start, SNARE, slot, 96, 0);
        }
    }
}

/// Fugue is a sparse pulse, not a drum style: hats and kick on the beats,
/// one clave halfway, nothing else.
fn fugue_overlay(p: &mut Pattern, c: &Controls) {
    if c.genre != FUGUE || p.total_steps <= 0 || p.steps_per_beat <= 0 || p.steps_per_bar <= 0 {
        return;
    }
    for lane in 0..LANES {
        for step in 0..p.total_steps as usize {
            p.vel[lane][step] = 0;
            p.flags[lane][step] = 0;
        }
    }
    for bar in 0..p.bars {
        let start = bar * p.steps_per_bar;
        for beat in 0..p.meter.num {
            let step = start + beat * p.steps_per_beat;
            if step >= p.total_steps {
                break;
            }
            let downbeat = beat == 0;
            set_step(p, CHAT, step, if downbeat { 82 } else { 66 }, if downbeat { FLAG_ACCENT } else { 0 });
            if downbeat {
                set_step(p, KICK, step, 88, FLAG_ACCENT);
            } else if beat == p.meter.num / 2 && c.aux_amt > 0.18 {
                set_step(p, CLAVE, step, 56, 0);
            }
        }
    }
}

fn step_velocity(
    c: &Controls,
    meter: &Meter,
    lane: i32,
    beat: i32,
    sub: i32,
    spb: i32,
    fill_bar: bool,
    rng: &mut Rng,
) -> (i32, u8) {
    let mut velocity = match lane {
        KICK => 108,
        CLAP => 104,
        SNARE => 100,
        CRASH => 96,
        CHAT => 82,
        OHAT => 76,
        LOWTOM => 92,
        HIGHTOM => 94,
        BASH => 110,
        COWBELL => 88,
        _ => 90,
    };
    let mut flags: u8 = 0;
    velocity += if sub == 0 { 8 } else { -4 };

    if c.style_mode != AUTO {
        let (primary, secondary, pickup) = match crate::anchors::style_role_of(c.style_mode, meter, beat, sub, spb) {
            0 => (true, false, false),
            1 => (false, true, false),
            2 => (false, false, true),
            _ => (false, false, false),
        };
        if primary {
            velocity += if lane == KICK || lane == SNARE || lane == CLAP { 9 } else { 6 };
            flags |= FLAG_ACCENT;
        } else if secondary {
            velocity += if lane == SNARE || lane == CLAP || lane == COWBELL { 5 } else { 2 };
        } else if pickup {
            velocity += 4;
        }
        if c.style_mode == DIDDLEY && (lane == CLAVE || lane == COWBELL) {
            velocity += 10;
            flags |= FLAG_ACCENT;
        }
    } else {
        if (lane == SNARE || lane == CLAP) && is_backbeat(meter, beat) && sub == 0 {
            velocity += 10;
            flags |= FLAG_ACCENT;
        }
        if meter.compound() && sub == 0 && meter.pulse_start(beat) {
            velocity += if lane == KICK || lane == SNARE || lane == CLAP { 8 } else { 5 };
            flags |= FLAG_ACCENT;
        }
        if meter.triple() && sub == 0 {
            if beat == 0 {
                velocity += 7;
                flags |= FLAG_ACCENT;
            } else if beat == 1 && (lane == SNARE || lane == CLAP || lane == COWBELL) {
                velocity += 4;
            }
        }
    }
    if lane == KICK && beat == 0 && sub == 0 {
        velocity += 8;
        flags |= FLAG_ACCENT;
    }
    if (lane == COWBELL || lane == CLAVE) && sub != 0 {
        velocity += 4;
    }
    if lane == BASH && (beat == 0 || fill_bar) {
        velocity += 6;
        flags |= FLAG_ACCENT;
    }
    if fill_bar && (lane == CRASH || lane == LOWTOM || lane == HIGHTOM) {
        velocity += 6;
        flags |= FLAG_FILL;
    }
    if fill_bar && (lane == BASH || lane == COWBELL || lane == CLAVE) {
        velocity += 4;
        flags |= FLAG_FILL;
    }
    velocity += rng.next_int(-6, 6);
    (clamp_i(velocity, 1, 127), flags)
}

fn build_bar(p: &mut Pattern, c: &Controls, bar: i32, fill_bar: bool, seed: u32) {
    let spb = p.steps_per_beat;
    let per_bar = p.steps_per_bar;
    let mut rng = Rng::new(seed);
    let mut pulses = [0i32; LANES];
    let mut offsets = [0i32; LANES];
    for lane in 0..LANES {
        pulses[lane] = euclid_pulses(c, lane as i32, per_bar, fill_bar, &mut rng);
        offsets[lane] = if pulses[lane] > 0 { rng.next_int(0, per_bar - 1) } else { 0 };
    }
    let mut hinted = *c;
    hinted.bar_hint = bar;
    for step in 0..per_bar {
        let global = bar * per_bar + step;
        if global >= p.total_steps {
            break;
        }
        let beat = step / spb;
        let sub = step % spb;
        for lane in 0..LANES as i32 {
            let mut anchor = anchor_probability(&hinted, &p.meter, lane, beat, sub, spb, fill_bar);
            if !fill_bar {
                anchor *= low_density_scale(&hinted, &p.meter, lane, beat, sub);
            }
            let anchored = anchor > 0.0 && rng.next_float() < anchor.clamp(0.0, 1.0);
            let mut hit = anchored;
            if !hit && euclid_hit(step, pulses[lane as usize], offsets[lane as usize], per_bar) {
                hit = rng.next_float() < euclid_influence(&hinted, lane, fill_bar).clamp(0.0, 1.0);
            }
            if !hit {
                continue;
            }
            let (velocity, flags) = step_velocity(&hinted, &p.meter, lane, beat, sub, spb, fill_bar, &mut rng);
            p.vel[lane as usize][global as usize] = velocity as u8;
            p.flags[lane as usize][global as usize] = flags;
        }
    }
}

fn fill_zone(p: &Pattern, c: &Controls) -> (i32, i32) {
    let fill_beats = p.meter.fill_beats(c.fill);
    let fill_steps = clamp_i(fill_beats * p.steps_per_beat, p.steps_per_beat, p.steps_per_bar);
    (p.steps_per_bar - fill_steps, p.steps_per_bar)
}

fn apply_fill_bar(p: &mut Pattern, c: &Controls, seed: u32, bar: i32) {
    if p.bars <= 0 || p.total_steps <= 0 || c.fill < 0.08 {
        return;
    }
    let mut rng = Rng::new(seed ^ 0xC001D00D);
    let per_bar = p.steps_per_bar;
    let spb = p.steps_per_beat;
    let target = clamp_i(bar, 0, p.bars - 1);
    let start = target * per_bar;
    let end = clamp_i(start + per_bar, 0, p.total_steps);
    let (zone_off, _) = fill_zone(p, c);
    let zone = clamp_i(start + zone_off, start, end);
    let mut motif = match c.genre {
        ROCK | SHUFFLE | HIPHOP | JAZZ => rng.next_int(0, 1),
        DISCO | MOTORIK => 2 + rng.next_int(0, 1),
        ELECTRO | DUB | BREAKBEAT | AMEN | JUNGLE => 1 + rng.next_int(0, 2),
        BOSSA | AFRO => {
            if rng.next_float() < 0.65 { 2 } else { 3 }
        }
        _ => rng.next_int(0, 3),
    };
    if motif < 0 || motif > 3 {
        motif = 0;
    }
    for step in zone..end {
        clear_step(p, OHAT, step);
        clear_step(p, CRASH, step);
        clear_step(p, BASH, step);
        if c.fill > 0.45 {
            if (step - zone) % 2 == 1 {
                clear_step(p, CHAT, step);
            }
            if (step % spb) != 0 && c.fill > 0.60 {
                clear_step(p, KICK, step);
            }
        }
    }
    match motif {
        0 => {
            let mut index = 0;
            let stride = if c.fill > 0.65 { 1 } else { 2 };
            let mut step = zone;
            while step < end {
                set_step(
                    p,
                    if index % 2 == 0 { LOWTOM } else { HIGHTOM },
                    step,
                    92 + index * 5,
                    FLAG_FILL | (if index > 1 { FLAG_ACCENT } else { 0 }),
                );
                index += 1;
                step += stride;
            }
            set_step(
                p,
                if c.genre == ELECTRO || c.genre == MOTORIK { BASH } else { CRASH },
                end - 1,
                114,
                FLAG_FILL | FLAG_ACCENT,
            );
        }
        1 => {
            let mut rise = 0;
            for step in zone..end {
                set_step(p, SNARE, step, 88 + rise * 4, FLAG_FILL);
                if (step - zone) % 2 == 1 {
                    set_step(p, CLAP, step, 84 + rise * 3, FLAG_FILL);
                }
                rise += 1;
            }
            set_step(p, HIGHTOM, clamp_i(end - 2, zone, end - 1), 108, FLAG_FILL | FLAG_ACCENT);
            if c.metal_amt > 0.20 {
                set_step(p, BASH, end - 1, 116, FLAG_FILL | FLAG_ACCENT);
            }
        }
        2 => {
            let mut toggle = 0;
            for step in zone..end {
                let in_bar = step - start;
                if (spb > 0 && in_bar % spb == spb / 2 && spb != 3)
                    || (spb == 3 && in_bar % spb == 2)
                    || (step - zone) % 2 == 0
                {
                    set_step(p, if toggle % 2 == 0 { COWBELL } else { CLAVE }, step, 90 + toggle * 2, FLAG_FILL);
                    toggle += 1;
                }
            }
            set_step(p, LOWTOM, zone, 96, FLAG_FILL);
            set_step(p, HIGHTOM, clamp_i(end - 2, zone, end - 1), 104, FLAG_FILL | FLAG_ACCENT);
        }
        _ => {
            let bash = clamp_i(zone + (end - zone) / 2, zone, end - 1);
            let mut index = 0;
            set_step(p, BASH, bash, 114, FLAG_FILL | FLAG_ACCENT);
            let mut step = zone;
            while step < end {
                set_step(
                    p,
                    if index % 3 == 0 { HIGHTOM } else if index % 3 == 1 { COWBELL } else { CLAVE },
                    step,
                    92 + index * 4,
                    FLAG_FILL,
                );
                index += 1;
                step += 2;
            }
            set_step(p, CLAVE, clamp_i(end - 2, zone, end - 1), 98, FLAG_FILL);
            set_step(p, HIGHTOM, end - 1, 108, FLAG_FILL | FLAG_ACCENT);
        }
    }
}

/// After generation, three conflicts are resolved and the backbeat is
/// guaranteed: open and closed hats never share a step, cowbell and clave
/// never do, claps defer to snares outside disco and electro, crashes are
/// rationed, and a missing backbeat is restored rather than left out.
fn cleanup(p: &mut Pattern, c: &Controls) {
    if p.total_steps <= 0 {
        return;
    }
    fugue_overlay(p, c);
    if c.genre == FUGUE {
        return;
    }
    let per_bar = p.steps_per_bar;
    let spb = p.steps_per_beat;
    for step in 0..p.total_steps as usize {
        let in_bar = step as i32 % per_bar;
        let offbeat = if spb == 3 { in_bar % spb == 2 } else { spb > 0 && in_bar % spb == spb / 2 };
        if p.vel[CHAT as usize][step] > 0 && p.vel[OHAT as usize][step] > 0 {
            if offbeat {
                p.vel[CHAT as usize][step] = 0;
                p.flags[CHAT as usize][step] = 0;
            } else {
                p.vel[OHAT as usize][step] = 0;
                p.flags[OHAT as usize][step] = 0;
            }
        }
        if p.vel[COWBELL as usize][step] > 0 && p.vel[CLAVE as usize][step] > 0 {
            if c.genre == BOSSA || c.genre == AFRO {
                p.vel[COWBELL as usize][step] = 0;
                p.flags[COWBELL as usize][step] = 0;
            } else {
                p.vel[CLAVE as usize][step] = 0;
                p.flags[CLAVE as usize][step] = 0;
            }
        }
        if p.vel[SNARE as usize][step] > 0
            && p.vel[CLAP as usize][step] > 0
            && c.genre != DISCO
            && c.genre != ELECTRO
        {
            p.vel[CLAP as usize][step] = 0;
            p.flags[CLAP as usize][step] = 0;
        }
    }
    for bar in 0..p.bars {
        let start = bar * per_bar;
        let section_start = bar == 0;
        let fill_end = bar == p.bars - 1;
        let max_crash = if section_start || fill_end || c.metal_amt > 0.70 { 1 } else { 0 };
        let mut crashes = 0;
        let mut bashes = 0;
        let mut step = 0;
        while step < per_bar && start + step < p.total_steps {
            let at = (start + step) as usize;
            if p.vel[CRASH as usize][at] > 0 {
                crashes += 1;
                if crashes > max_crash {
                    p.vel[CRASH as usize][at] = 0;
                    p.flags[CRASH as usize][at] = 0;
                }
            }
            if p.vel[BASH as usize][at] > 0 {
                bashes += 1;
                if bashes > 2 {
                    p.vel[BASH as usize][at] = 0;
                    p.flags[BASH as usize][at] = 0;
                }
            }
            let (zone_off, _) = fill_zone(p, c);
            if step >= zone_off {
                let active = p.vel[LOWTOM as usize][at] > 0
                    || p.vel[HIGHTOM as usize][at] > 0
                    || p.vel[BASH as usize][at] > 0
                    || p.vel[COWBELL as usize][at] > 0
                    || p.vel[CLAVE as usize][at] > 0;
                if active {
                    clear_step(p, OHAT, start + step);
                    if (step - (per_bar - spb)) % 2 != 0 {
                        clear_step(p, CHAT, start + step);
                    }
                }
            }
            step += 1;
        }
        if c.backbeat_amt > 0.30 && c.style_mode != DIDDLEY {
            let mut beats = [0i32; 8];
            let count = accent_beats(c.style_mode, &p.meter, &mut beats);
            for i in 0..count {
                let at = start + beats[i] * spb;
                if at < p.total_steps
                    && p.vel[SNARE as usize][at as usize] == 0
                    && p.vel[CLAP as usize][at as usize] == 0
                {
                    p.vel[SNARE as usize][at as usize] = (102 + i as i32 * 2) as u8;
                    p.flags[SNARE as usize][at as usize] = FLAG_ACCENT;
                }
            }
        }
    }
}

pub fn regenerate(p: &mut Pattern, raw: &Controls, meter: Meter, fill_only: bool) {
    let c = clamp_controls(raw);
    let previous = *p;
    let had = previous.total_steps > 0;
    let mut next = Pattern::empty();
    clear_pattern(&mut next, &c, meter);
    next.serial = next_serial(previous.serial);
    let same_shape = had
        && previous.bars == next.bars
        && previous.meter == next.meter
        && previous.steps_per_bar == next.steps_per_bar
        && previous.total_steps == next.total_steps;
    let bars = next.bars;
    let serial = next.serial;
    if fill_only && same_shape && next.total_steps > next.steps_per_bar {
        let prefix = next.total_steps - next.steps_per_bar;
        for lane in 0..LANES {
            next.vel[lane][..prefix as usize].copy_from_slice(&previous.vel[lane][..prefix as usize]);
            next.flags[lane][..prefix as usize].copy_from_slice(&previous.flags[lane][..prefix as usize]);
        }
        let last = bars - 1;
        build_bar(&mut next, &c, last, true, bar_seed(&c, serial, last, true));
    } else {
        for bar in 0..bars {
            let fill_bar = bar == bars - 1;
            build_bar(&mut next, &c, bar, fill_bar, bar_seed(&c, serial, bar, fill_bar));
        }
    }
    let overlay_seed = base_seed(&c, serial) ^ fill_seed(&c, serial) ^ 0x6D2B79F5;
    apply_fill_bar(&mut next, &c, overlay_seed, bars - 1);
    for bar in 0..bars {
        genre_signature_bar(&mut next, &c, bar);
    }
    if c.style_mode == DIDDLEY {
        for bar in 0..bars {
            diddley_bar(&mut next, &c, bar);
        }
    }
    cleanup(&mut next, &c);
    *p = next;
}

fn shape_matches(p: &Pattern, c: &Controls, meter: Meter) -> bool {
    p.bars > 0
        && p.total_steps > 0
        && p.bars == c.bars
        && p.meter == meter
        && p.steps_per_beat == steps_per_beat(c.resolution)
}

pub fn refresh_bar(p: &mut Pattern, raw: &Controls, meter: Meter, bar: i32) {
    let c = clamp_controls(raw);
    if !shape_matches(p, &c, meter) {
        regenerate(p, &c, meter, false);
        return;
    }
    let at = clamp_i(bar, 0, p.bars - 1);
    let serial = next_serial(p.serial);
    p.serial = serial;
    for lane in 0..LANES {
        p.notes[lane] = note_for_lane(c.kit_map, lane);
    }
    let start = at * p.steps_per_bar;
    let end = clamp_i(start + p.steps_per_bar, 0, p.total_steps);
    for lane in 0..LANES {
        for step in start..end {
            p.vel[lane][step as usize] = 0;
            p.flags[lane][step as usize] = 0;
        }
    }
    build_bar(p, &c, at, at == p.bars - 1, bar_seed(&c, serial, at, at == p.bars - 1));
    if at == p.bars - 1 {
        let overlay = base_seed(&c, serial) ^ fill_seed(&c, serial) ^ 0x6D2B79F5;
        apply_fill_bar(p, &c, overlay, p.bars - 1);
    }
    genre_signature_bar(p, &c, at);
    if c.style_mode == DIDDLEY {
        for bar in 0..p.bars {
            diddley_bar(p, &c, bar);
        }
    }
    cleanup(p, &c);
}

/// A manual Fill rebuilds one bar with the fill amount forced up, then folds
/// the cleaned bar back so the rest of the loop keeps playing.
pub fn refresh_fill_bar(p: &mut Pattern, raw: &Controls, meter: Meter, bar: i32) {
    let c = manual_fill_controls(raw);
    if !shape_matches(p, &c, meter) {
        regenerate(p, &c, meter, false);
        return;
    }
    let at = clamp_i(bar, 0, p.bars - 1);
    let serial = next_serial(p.serial);
    let mut next = *p;
    next.serial = serial;
    for lane in 0..LANES {
        next.notes[lane] = note_for_lane(c.kit_map, lane);
    }
    let start = at * next.steps_per_bar;
    let end = clamp_i(start + next.steps_per_bar, 0, next.total_steps);
    for lane in 0..LANES {
        for step in start..end {
            next.vel[lane][step as usize] = 0;
            next.flags[lane][step as usize] = 0;
        }
    }
    build_bar(&mut next, &c, at, true, bar_seed(&c, serial, at, true));
    let overlay = base_seed(&c, serial) ^ fill_seed(&c, serial) ^ 0x6D2B79F5 ^ (((at + 1) as u32).wrapping_mul(0xA24BAED5));
    apply_fill_bar(&mut next, &c, overlay, at);
    genre_signature_bar(&mut next, &c, at);
    diddley_bar(&mut next, &c, at);
    let mut cleaned = next;
    cleanup(&mut cleaned, &c);
    for lane in 0..LANES {
        for step in start..end {
            next.vel[lane][step as usize] = cleaned.vel[lane][step as usize];
            next.flags[lane][step as usize] = cleaned.flags[lane][step as usize];
        }
    }
    *p = next;
}
