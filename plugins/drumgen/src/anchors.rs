// plugins/drumgen/src/anchors.rs
//
// How likely each lane is to sound on each step, before the Euclidean layer.
// A direct port of the anchor tables in downspout's drumgen_pattern.cpp:
// genre voices for straight meters, dedicated tables for compound and triple
// feels, and pulse-aware ones for the six forced style modes. The numbers are
// probabilities, so changing one changes a groove rather than breaking it,
// which is why they are kept verbatim instead of simplified.

use crate::meter::Meter;
use crate::pattern::{
    Controls, KICK, CLAP, SNARE, CRASH, CHAT, LOWTOM, OHAT, HIGHTOM, BASH, COWBELL, CLAVE,
};
use crate::rng::Rng;

/// The step role as a plain number for callers that only need the accent
/// classes: 0 primary, 1 secondary, 2 pickup, 3 weak.
pub fn style_role_of(style: i32, meter: &Meter, beat: i32, sub: i32, spb: i32) -> i32 {
    match style_role(style, meter, beat, sub, spb) {
        Role::Primary => 0,
        Role::Secondary => 1,
        Role::Pickup => 2,
        Role::Weak => 3,
    }
}

// Genres, in jig:paramIndex order for the genre port.
pub const ROCK: i32 = 0;
pub const DISCO: i32 = 1;
pub const SHUFFLE: i32 = 2;
pub const ELECTRO: i32 = 3;
pub const DUB: i32 = 4;
pub const MOTORIK: i32 = 5;
pub const BOSSA: i32 = 6;
pub const AFRO: i32 = 7;
pub const BREAKBEAT: i32 = 8;
pub const AMEN: i32 = 9;
pub const JUNGLE: i32 = 10;
pub const HIPHOP: i32 = 11;
pub const JAZZ: i32 = 12;
pub const FUGUE: i32 = 13;

// Style modes, in port order.
pub const AUTO: i32 = 0;
pub const STRAIGHT: i32 = 1;
pub const REEL: i32 = 2;
pub const WALTZ: i32 = 3;
pub const JIG: i32 = 4;
pub const SLIPJIG: i32 = 5;
pub const DIDDLEY: i32 = 6;

fn clamp_i(v: i32, lo: i32, hi: i32) -> i32 {
    v.clamp(lo, hi)
}

fn lround(v: f32) -> i32 {
    if v >= 0.0 { (v + 0.5) as i32 } else { (v - 0.5) as i32 }
}

/// The quarter-beat grid mapped onto however many beats this bar has, so a
/// backbeat lands on beat 2 of 4/4 and on the middle pulse of anything else.
fn quarter_beat(meter: &Meter, slot: i32) -> i32 {
    if slot <= 0 {
        return 0;
    }
    clamp_i(lround(slot as f32 * meter.num as f32 / 4.0), 0, meter.num - 1)
}

fn frac_beat(meter: &Meter, num: i32, den: i32) -> i32 {
    if meter.num <= 1 || den <= 0 {
        return 0;
    }
    clamp_i(meter.num * num / den, 0, meter.num - 1)
}

pub fn is_backbeat(meter: &Meter, beat: i32) -> bool {
    meter.pulse_start(beat) && meter.pulse_index(beat) % 2 == 1
}

fn is_breakbeat_family(genre: i32) -> bool {
    genre == BREAKBEAT || genre == AMEN || genre == JUNGLE
}

fn is_offbeat(step_in_bar: i32, spb: i32) -> bool {
    if spb <= 0 {
        return false;
    }
    if spb == 3 {
        return step_in_bar % spb == 2;
    }
    step_in_bar % spb == spb / 2
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Weak,
    Pickup,
    Secondary,
    Primary,
}

struct PulseInfo {
    count: i32,
    index: i32,
    start: bool,
    pickup: bool,
}

fn style_pulse(style: i32, meter: &Meter, beat: i32, sub: i32, spb: i32) -> PulseInfo {
    let beat = clamp_i(beat, 0, meter.num - 1);
    let beat_start = sub == 0;
    let late = spb > 0 && sub == spb - 1;
    match style {
        STRAIGHT => PulseInfo {
            count: meter.num,
            index: beat,
            start: beat_start,
            pickup: late,
        },
        REEL => {
            let half = frac_beat(meter, 1, 2);
            let count = if meter.num >= 2 { 2 } else { 1 };
            PulseInfo {
                count,
                index: if beat >= half { count - 1 } else { 0 },
                start: beat_start && (beat == 0 || beat == half),
                pickup: late
                    && ((beat + 1) % meter.num == half || (beat + 1) % meter.num == 0),
            }
        }
        WALTZ | SLIPJIG => {
            let second = frac_beat(meter, 1, 3);
            let third = frac_beat(meter, 2, 3);
            PulseInfo {
                count: 3,
                index: if beat >= third { 2 } else if beat >= second { 1 } else { 0 },
                start: beat_start && (beat == 0 || beat == second || beat == third),
                pickup: late
                    && ((beat + 1) % meter.num == second
                        || (beat + 1) % meter.num == third
                        || (beat + 1) % meter.num == 0),
            }
        }
        JIG => {
            let second = frac_beat(meter, 1, 2);
            PulseInfo {
                count: 2,
                index: if beat >= second { 1 } else { 0 },
                start: beat_start && (beat == 0 || beat == second),
                pickup: late
                    && ((beat + 1) % meter.num == second || (beat + 1) % meter.num == 0),
            }
        }
        DIDDLEY => PulseInfo {
            count: 5,
            index: if frac_beat(meter, 3, 4) <= beat {
                2
            } else if frac_beat(meter, 1, 2) <= beat {
                1
            } else {
                0
            },
            start: beat_start
                && (beat == 0
                    || beat == frac_beat(meter, 1, 2)
                    || beat == frac_beat(meter, 3, 4)),
            pickup: late,
        },
        _ => PulseInfo {
            count: meter.pulses(),
            index: meter.pulse_index(beat),
            start: beat_start && meter.pulse_start(beat),
            pickup: late && meter.pulse_start((beat + 1) % meter.num),
        },
    }
}

fn style_role(style: i32, meter: &Meter, beat: i32, sub: i32, spb: i32) -> Role {
    let info = style_pulse(style, meter, beat, sub, spb);
    if sub == 0 && info.start {
        Role::Primary
    } else if sub == 0 {
        Role::Secondary
    } else if info.pickup {
        Role::Pickup
    } else {
        Role::Weak
    }
}

/// Which beats carry the backbeat for the cleanup guarantee. Auto mode uses
/// the meter's own odd pulses; a forced style names its own.
pub fn accent_beats(style: i32, meter: &Meter, out: &mut [i32; 8]) -> usize {
    let mut count = 0usize;
    if style == AUTO {
        for beat in 0..meter.num {
            if is_backbeat(meter, beat) {
                count = push_beat(out, count, meter.num, beat);
            }
        }
        if count == 0 && meter.num > 1 {
            count = push_beat(out, count, meter.num, quarter_beat(meter, 1));
        }
        return count;
    }
    match style {
        STRAIGHT => {
            let mut beat = 1;
            while beat < meter.num {
                count = push_beat(out, count, meter.num, beat);
                beat += 2;
            }
        }
        REEL => {
            count = push_beat(out, count, meter.num, frac_beat(meter, 1, 4));
            count = push_beat(out, count, meter.num, frac_beat(meter, 3, 4));
        }
        WALTZ => count = push_beat(out, count, meter.num, frac_beat(meter, 1, 3)),
        JIG => count = push_beat(out, count, meter.num, frac_beat(meter, 1, 2)),
        SLIPJIG => count = push_beat(out, count, meter.num, frac_beat(meter, 1, 3)),
        DIDDLEY => count = push_beat(out, count, meter.num, frac_beat(meter, 3, 4)),
        _ => {}
    }
    if count == 0 && meter.num > 1 {
        count = push_beat(out, count, meter.num, frac_beat(meter, 1, 2));
    }
    count
}

fn push_beat(out: &mut [i32; 8], mut count: usize, beats: i32, beat: i32) -> usize {
    let beat = clamp_i(beat, 0, beats - 1);
    if !out[..count].contains(&beat) && count < out.len() {
        out[count] = beat;
        count += 1;
    }
    count
}

fn compound_anchor(
    c: &Controls,
    meter: &Meter,
    lane: i32,
    beat: i32,
    sub: i32,
    spb: i32,
    fill_bar: bool,
) -> f32 {
    let beat_start = sub == 0;
    let pulse_start = beat_start && meter.pulse_start(beat);
    let pulse = meter.pulse_index(beat);
    let last = meter.pulses() - 1;
    let second = pulse_start && pulse == last.min(1);
    let final_pulse = meter.pulse_index(beat) == last;
    let pickup = spb > 0 && sub == spb - 1 && meter.pulse_start((beat + 1) % meter.num);
    let late = sub == spb - 1;
    let (kick, backbeat, hat, tom, metal, perc, fill) =
        (c.kick_amt, c.backbeat_amt, c.hat_amt, c.tom_amt, c.metal_amt, c.aux_amt, c.fill);
    match lane {
        KICK => {
            if pulse_start && pulse == 0 {
                return 0.96;
            }
            if pulse_start {
                if c.genre == DISCO || c.genre == MOTORIK {
                    return 0.72 + 0.20 * kick;
                }
                if c.genre == ELECTRO {
                    return 0.54 + 0.24 * kick;
                }
                return 0.46 + 0.20 * kick;
            }
            if pickup && (c.genre == SHUFFLE || c.genre == DUB || c.genre == AFRO) {
                return 0.12 + 0.14 * c.variation;
            }
        }
        SNARE => {
            if second {
                return 0.78 + 0.18 * backbeat;
            }
            if fill_bar && final_pulse && late {
                return 0.10 + 0.24 * fill * backbeat;
            }
        }
        CLAP => {
            if second {
                if c.genre == DISCO {
                    return 0.68 + 0.18 * backbeat;
                }
                if c.genre == ELECTRO {
                    return 0.42 + 0.22 * backbeat;
                }
                return 0.12 + 0.24 * backbeat;
            }
            if fill_bar && final_pulse && !beat_start {
                return 0.08 + 0.18 * fill * backbeat;
            }
        }
        CRASH => {
            if beat == 0 && beat_start {
                return 0.06 + 0.08 * metal;
            }
            if fill_bar && final_pulse && beat_start {
                return 0.04 + 0.10 * fill * metal;
            }
        }
        CHAT => {
            if beat_start {
                return if pulse_start { 0.82 + 0.16 * hat } else { 0.66 + 0.18 * hat };
            }
            if pickup {
                return 0.30 + 0.18 * hat;
            }
            return 0.10 + 0.16 * hat * c.variation;
        }
        OHAT => {
            if pickup {
                return 0.24 + 0.18 * hat;
            }
            if pulse_start && pulse > 0 {
                return 0.14 + 0.16 * hat;
            }
            if fill_bar && final_pulse && late {
                return 0.16 + 0.16 * fill;
            }
        }
        LOWTOM => {
            if fill_bar && final_pulse && (pickup || late) {
                return 0.10 + 0.30 * fill + 0.12 * tom;
            }
        }
        HIGHTOM => {
            if fill_bar && final_pulse && !beat_start {
                return 0.10 + 0.28 * fill + 0.12 * tom;
            }
        }
        BASH => {
            if fill_bar && final_pulse && (beat_start || late) {
                return 0.10 + 0.22 * fill * metal;
            }
            if (c.genre == DUB || c.genre == ELECTRO) && pickup {
                return 0.08 + 0.16 * metal;
            }
        }
        COWBELL => {
            if pulse_start && pulse > 0 {
                return 0.12 + 0.20 * perc;
            }
            if pickup {
                return 0.16 + 0.18 * perc;
            }
        }
        CLAVE => {
            if pulse_start && (second || final_pulse) {
                return 0.14 + 0.18 * perc;
            }
            if pickup {
                return 0.16 + 0.18 * perc;
            }
        }
        _ => {}
    }
    0.0
}

fn triple_anchor(c: &Controls, lane: i32, beat: i32, sub: i32, spb: i32, fill_bar: bool) -> f32 {
    let beat_start = sub == 0;
    let offbeat = is_offbeat(beat * spb + sub, spb);
    let late = sub == spb - 1;
    let (one, two, three) = (beat == 0, beat == 1, beat == 2);
    let (kick, backbeat, hat, tom, metal, perc, fill) =
        (c.kick_amt, c.backbeat_amt, c.hat_amt, c.tom_amt, c.metal_amt, c.aux_amt, c.fill);
    match lane {
        KICK => {
            if one && beat_start {
                return 0.96;
            }
            if three && beat_start {
                return 0.46 + 0.20 * kick;
            }
            if two && late && c.genre == SHUFFLE {
                return 0.10 + 0.12 * c.variation;
            }
        }
        SNARE => {
            if two && beat_start {
                return 0.72 + 0.18 * backbeat;
            }
            if fill_bar && three && late {
                return 0.08 + 0.22 * fill * backbeat;
            }
        }
        CLAP => {
            if two && beat_start {
                return 0.16 + 0.22 * backbeat;
            }
            if c.genre == DISCO && three && offbeat {
                return 0.08 + 0.12 * c.variation;
            }
        }
        CRASH => {
            if one && beat_start {
                return 0.06 + 0.08 * metal;
            }
            if fill_bar && three && beat_start {
                return 0.04 + 0.10 * fill * metal;
            }
        }
        CHAT => {
            if beat_start {
                return if one { 0.82 + 0.16 * hat } else { 0.68 + 0.18 * hat };
            }
            if offbeat {
                return 0.16 + 0.14 * hat;
            }
            return 0.08 + 0.10 * hat * c.variation;
        }
        OHAT => {
            if three && offbeat {
                return 0.20 + 0.18 * hat;
            }
            if fill_bar && three && late {
                return 0.14 + 0.16 * fill;
            }
        }
        LOWTOM => {
            if fill_bar && three && (offbeat || late) {
                return 0.10 + 0.28 * fill + 0.12 * tom;
            }
        }
        HIGHTOM => {
            if fill_bar && three && !beat_start {
                return 0.10 + 0.26 * fill + 0.12 * tom;
            }
        }
        BASH => {
            if fill_bar && three && (beat_start || late) {
                return 0.10 + 0.20 * fill * metal;
            }
        }
        COWBELL => {
            if two && beat_start {
                return 0.12 + 0.18 * perc;
            }
            if three && offbeat {
                return 0.14 + 0.18 * perc;
            }
        }
        CLAVE => {
            if one && beat_start {
                return 0.16 + 0.16 * perc;
            }
            if two && late {
                return 0.14 + 0.18 * perc;
            }
            if three && beat_start {
                return 0.16 + 0.16 * perc;
            }
        }
        _ => {}
    }
    0.0
}

fn style_anchor(
    c: &Controls,
    meter: &Meter,
    lane: i32,
    beat: i32,
    sub: i32,
    spb: i32,
    fill_bar: bool,
) -> f32 {
    let pulse = style_pulse(c.style_mode, meter, beat, sub, spb);
    let role = style_role(c.style_mode, meter, beat, sub, spb);
    let beat_start = sub == 0;
    let offbeat = is_offbeat(beat * spb + sub, spb);
    let late = sub == spb - 1;
    let primary = pulse.index == 0;
    let second = pulse.index == (pulse.count - 1).min(1);
    let final_pulse = pulse.index == pulse.count - 1;
    let (kick, backbeat, hat, tom, metal, perc, fill) =
        (c.kick_amt, c.backbeat_amt, c.hat_amt, c.tom_amt, c.metal_amt, c.aux_amt, c.fill);
    let mode = c.style_mode;
    match lane {
        KICK => {
            if mode == DIDDLEY {
                if beat_start && primary {
                    return 0.94;
                }
                if role == Role::Pickup {
                    return 0.18 + 0.22 * kick;
                }
            }
            if pulse.start && primary {
                return 0.96;
            }
            if mode == REEL && beat_start && role == Role::Secondary {
                return 0.18 + 0.16 * kick;
            }
            if (mode == WALTZ || mode == JIG || mode == SLIPJIG) && pulse.start {
                return (if second { 0.44 } else { 0.34 }) + 0.18 * kick;
            }
            if role == Role::Pickup && (mode == REEL || mode == JIG || mode == SLIPJIG) {
                return 0.10 + 0.14 * c.variation;
            }
        }
        SNARE => {
            if mode == DIDDLEY {
                if pulse.start && final_pulse {
                    return 0.62 + 0.22 * backbeat;
                }
                if role == Role::Pickup {
                    return 0.10 + 0.16 * c.variation;
                }
            }
            if mode == REEL && beat_start && role == Role::Secondary {
                return 0.76 + 0.18 * backbeat;
            }
            if mode == STRAIGHT && beat_start && beat % 2 == 1 {
                return 0.72 + 0.18 * backbeat;
            }
            if mode == WALTZ && beat_start && second {
                return 0.74 + 0.18 * backbeat;
            }
            if (mode == JIG || mode == SLIPJIG) && pulse.start && second {
                return 0.78 + 0.18 * backbeat;
            }
            if fill_bar && final_pulse && late {
                return 0.10 + 0.24 * fill * backbeat;
            }
        }
        CLAP => {
            if mode == DIDDLEY && pulse.start && final_pulse {
                return 0.18 + 0.20 * backbeat;
            }
            if mode == REEL && beat_start && role == Role::Secondary {
                return 0.20 + 0.22 * backbeat;
            }
            if mode == STRAIGHT && beat_start && beat % 2 == 1 {
                return 0.16 + 0.22 * backbeat;
            }
            if mode == WALTZ && beat_start && second {
                return 0.12 + 0.18 * backbeat;
            }
            if (mode == JIG || mode == SLIPJIG) && pulse.start && second {
                return 0.10 + 0.18 * backbeat;
            }
            if fill_bar && final_pulse && !beat_start {
                return 0.08 + 0.18 * fill * backbeat;
            }
        }
        CRASH => {
            if beat_start && primary {
                return 0.06 + 0.08 * metal;
            }
            if fill_bar && final_pulse && beat_start {
                return 0.04 + 0.10 * fill * metal;
            }
        }
        CHAT => {
            if mode == DIDDLEY {
                if beat_start || offbeat {
                    return 0.56 + 0.22 * hat;
                }
                return 0.08 + 0.12 * hat * c.variation;
            }
            if beat_start {
                return if pulse.start { 0.82 + 0.16 * hat } else { 0.66 + 0.18 * hat };
            }
            if role == Role::Pickup || offbeat {
                return 0.18 + 0.18 * hat;
            }
            return 0.08 + 0.14 * hat * c.variation;
        }
        OHAT => {
            if role == Role::Pickup {
                return 0.22 + 0.18 * hat;
            }
            if pulse.start && !primary {
                return 0.14 + 0.16 * hat;
            }
            if fill_bar && final_pulse && late {
                return 0.14 + 0.16 * fill;
            }
        }
        LOWTOM => {
            if fill_bar && final_pulse && (role == Role::Pickup || late) {
                return 0.10 + 0.30 * fill + 0.12 * tom;
            }
        }
        HIGHTOM => {
            if fill_bar && final_pulse && !beat_start {
                return 0.10 + 0.28 * fill + 0.12 * tom;
            }
        }
        BASH => {
            if fill_bar && final_pulse && (beat_start || late) {
                return 0.10 + 0.22 * fill * metal;
            }
            if (mode == JIG || mode == SLIPJIG) && role == Role::Pickup {
                return 0.08 + 0.16 * metal;
            }
        }
        COWBELL => {
            if mode == DIDDLEY && (pulse.start || role == Role::Pickup) {
                return 0.24 + 0.32 * perc;
            }
            if pulse.start && !primary {
                return 0.14 + 0.20 * perc;
            }
            if role == Role::Pickup {
                return 0.16 + 0.18 * perc;
            }
        }
        CLAVE => {
            if mode == DIDDLEY && (pulse.start || role == Role::Pickup) {
                return 0.34 + 0.36 * perc;
            }
            if pulse.start && (second || final_pulse) {
                return 0.14 + 0.18 * perc;
            }
            if role == Role::Pickup {
                return 0.16 + 0.18 * perc;
            }
        }
        _ => {}
    }
    0.0
}

/// The straight-meter genre voices: what makes rock land on kick and backbeat
/// while jazz barely touches the kick and rides the hats.
fn genre_anchor(
    c: &Controls,
    meter: &Meter,
    lane: i32,
    beat: i32,
    sub: i32,
    spb: i32,
    fill_bar: bool,
) -> f32 {
    let beat_start = sub == 0;
    let offbeat = is_offbeat(beat * spb + sub, spb);
    let late = sub == spb - 1;
    let q1 = quarter_beat(meter, 1);
    let q2 = quarter_beat(meter, 2);
    let q3 = quarter_beat(meter, 3);
    let (on_q1, on_q2, on_q3) = (beat == q1, beat == q2, beat == q3);
    let backbeat_start = beat_start && is_backbeat(meter, beat);
    let (kick, backbeat, hat, tom, metal, perc, fill) =
        (c.kick_amt, c.backbeat_amt, c.hat_amt, c.tom_amt, c.metal_amt, c.aux_amt, c.fill);
    match lane {
        KICK => match c.genre {
            BREAKBEAT | AMEN | JUNGLE => {
                if beat == 0 && beat_start {
                    return 0.98;
                }
                if beat == 1 && sub == (spb / 2).max(1) {
                    return 0.56 + 0.28 * kick;
                }
                if beat == 2 && sub == (spb / 2).max(1) {
                    return 0.48 + 0.24 * kick;
                }
                if beat == 3 && late {
                    return 0.18 + 0.20 * c.variation;
                }
            }
            HIPHOP => {
                if beat == 0 && beat_start {
                    return 0.96;
                }
                if (on_q1 || on_q2) && offbeat {
                    return 0.22 + 0.22 * kick;
                }
                if on_q3 && late {
                    return 0.14 + 0.16 * c.variation;
                }
            }
            JAZZ => {
                if beat_start {
                    return 0.34 + 0.34 * kick;
                }
                if late && (on_q1 || on_q3) {
                    return 0.06 + 0.10 * c.variation;
                }
            }
            DISCO | MOTORIK => {
                if beat_start {
                    return 0.86 + 0.12 * kick;
                }
                if offbeat && on_q3 {
                    return 0.12 + 0.10 * c.variation;
                }
            }
            SHUFFLE => {
                if beat == 0 && beat_start {
                    return 0.96;
                }
                if on_q2 && beat_start {
                    return 0.62 + 0.18 * kick;
                }
                if offbeat && (on_q1 || on_q3) {
                    return 0.16 + 0.10 * c.variation;
                }
            }
            ELECTRO => {
                if beat == 0 && beat_start {
                    return 0.94;
                }
                if on_q2 && beat_start {
                    return 0.40 + 0.22 * kick;
                }
                if late {
                    return 0.12 + 0.22 * c.variation;
                }
            }
            DUB => {
                if beat == 0 && beat_start {
                    return 0.96;
                }
                if on_q2 && beat_start {
                    return 0.24 + 0.18 * kick;
                }
                if offbeat && on_q3 {
                    return 0.10 + 0.10 * c.variation;
                }
            }
            BOSSA => {
                if beat == 0 && beat_start {
                    return 0.82;
                }
                if on_q1 && late {
                    return 0.34;
                }
                if on_q2 && beat_start {
                    return 0.56;
                }
                if on_q3 && offbeat {
                    return 0.42;
                }
            }
            AFRO => {
                if beat == 0 && beat_start {
                    return 0.84;
                }
                if on_q1 && offbeat {
                    return 0.34;
                }
                if on_q2 && beat_start {
                    return 0.58;
                }
                if on_q3 && offbeat {
                    return 0.38;
                }
            }
            _ => {
                if beat == 0 && beat_start {
                    return 0.98;
                }
                if on_q2 && beat_start {
                    return 0.68 + 0.18 * kick;
                }
                if on_q3 && late {
                    return 0.10 + 0.18 * c.variation;
                }
                if on_q1 && beat_start {
                    return 0.12 + 0.10 * kick;
                }
            }
        },
        SNARE => {
            if backbeat_start {
                return match c.genre {
                    BREAKBEAT | AMEN | JUNGLE => 0.88 + 0.10 * backbeat,
                    HIPHOP => 0.82 + 0.12 * backbeat,
                    JAZZ => 0.38 + 0.18 * backbeat,
                    DISCO => 0.76 + 0.18 * backbeat,
                    ELECTRO => 0.72 + 0.18 * backbeat,
                    DUB => 0.64 + 0.16 * backbeat,
                    _ => 0.84 + 0.12 * backbeat,
                };
            }
            if is_breakbeat_family(c.genre) && late {
                return 0.16 + 0.20 * c.variation * backbeat;
            }
            if c.genre == HIPHOP && late && (on_q1 || on_q3) {
                return 0.08 + 0.08 * c.variation;
            }
            if c.genre == JAZZ && (offbeat || late) {
                return 0.10 + 0.18 * c.variation * backbeat;
            }
            if fill_bar && beat >= q2 && late {
                return 0.08 + 0.24 * fill * backbeat;
            }
            if c.genre == AFRO && offbeat {
                return 0.08 + 0.10 * c.variation;
            }
            if c.genre == SHUFFLE && late {
                return 0.06 + 0.10 * c.variation;
            }
        }
        CLAP => {
            if backbeat_start {
                return match c.genre {
                    BREAKBEAT | AMEN | JUNGLE => 0.10 + 0.14 * backbeat,
                    HIPHOP => 0.10 + 0.18 * backbeat,
                    JAZZ => 0.03 + 0.05 * backbeat,
                    DISCO => 0.78 + 0.16 * backbeat,
                    ELECTRO => 0.52 + 0.20 * backbeat,
                    DUB => 0.18 + 0.14 * backbeat,
                    _ => 0.18 + 0.34 * backbeat,
                };
            }
            if c.genre == DISCO && offbeat {
                return 0.08 + 0.14 * c.variation;
            }
            if fill_bar && on_q3 && !beat_start {
                return 0.06 + 0.18 * fill * backbeat;
            }
        }
        CRASH => {
            if beat_start && beat == 0 {
                return (if bar_is_first(c, meter) { 0.14 } else { 0.03 }) + 0.06 * metal;
            }
            if fill_bar && beat_start && beat >= q2 {
                return 0.03 + 0.08 * fill * (0.55 + 0.45 * metal);
            }
        }
        CHAT => {
            if c.genre == JAZZ {
                if spb == 3 {
                    if sub == 0 {
                        return 0.78 + 0.16 * hat;
                    }
                    if sub == 2 {
                        return 0.58 + 0.20 * hat;
                    }
                    return 0.08 + 0.10 * c.variation;
                }
                if beat_start {
                    return 0.74 + 0.14 * hat;
                }
                if offbeat {
                    return 0.48 + 0.22 * hat;
                }
                if late {
                    return 0.14 + 0.12 * c.variation;
                }
                return 0.08 + 0.10 * c.variation;
            }
            if spb == 3 {
                if sub == 0 {
                    return 0.70 + 0.18 * hat;
                }
                if sub == 2 {
                    return 0.54 + 0.20 * hat;
                }
                return 0.18 + 0.16 * c.variation;
            }
            if is_breakbeat_family(c.genre) {
                if c.genre == JUNGLE {
                    return 0.48 + 0.38 * hat;
                }
                if sub == 0 || sub == 2 {
                    return 0.78 + 0.16 * hat;
                }
                return 0.30 + 0.24 * hat * c.density;
            }
            if c.genre == HIPHOP {
                if sub == 0 || sub == 2 {
                    return 0.66 + 0.16 * hat;
                }
                return 0.08 + 0.14 * hat * c.variation;
            }
            if spb == 2 {
                return if offbeat { 0.66 + 0.20 * hat } else { 0.74 + 0.16 * hat };
            }
            if sub == 0 || sub == 2 {
                return 0.74 + 0.18 * hat;
            }
            return 0.18 + 0.28 * hat * c.density;
        }
        OHAT => {
            if offbeat {
                return match c.genre {
                    BREAKBEAT | AMEN | JUNGLE => 0.22 + 0.24 * hat,
                    HIPHOP => 0.10 + 0.12 * hat,
                    JAZZ => 0.12 + 0.12 * hat,
                    DISCO | MOTORIK => 0.34 + 0.32 * hat,
                    DUB => 0.14 + 0.18 * hat,
                    _ => 0.18 + 0.20 * hat,
                };
            }
            if c.genre == JAZZ && backbeat_start {
                return 0.18 + 0.20 * hat;
            }
            if fill_bar && on_q3 && late {
                return 0.16 + 0.14 * fill;
            }
        }
        LOWTOM => {
            if fill_bar && beat >= q2 && (offbeat || late) {
                return 0.08 + 0.28 * fill + 0.12 * tom;
            }
        }
        HIGHTOM => {
            if fill_bar && beat >= q2 && !beat_start {
                return 0.08 + 0.26 * fill + 0.12 * tom;
            }
        }
        BASH => match c.genre {
            BREAKBEAT | AMEN | JUNGLE => {
                if beat_start && beat == 0 {
                    return 0.10 + 0.18 * metal;
                }
                if late && (on_q1 || on_q3) {
                    return 0.10 + 0.16 * metal;
                }
                if fill_bar && beat >= q2 && (offbeat || late) {
                    return 0.10 + 0.22 * fill * metal;
                }
            }
            ELECTRO => {
                if beat_start && beat == 0 {
                    return 0.14 + 0.16 * metal;
                }
                if fill_bar && beat >= q2 && (beat_start || late) {
                    return 0.10 + 0.26 * fill * metal;
                }
                if late && on_q3 {
                    return 0.08 + 0.14 * c.variation;
                }
            }
            MOTORIK => {
                if beat_start && beat == 0 {
                    return 0.12 + 0.18 * metal;
                }
                if fill_bar && on_q3 && beat_start {
                    return 0.10 + 0.22 * fill * metal;
                }
            }
            DUB => {
                if (offbeat && on_q3) || (late && on_q2) {
                    return 0.10 + 0.18 * metal;
                }
                if fill_bar && on_q3 {
                    return 0.10 + 0.18 * fill * metal;
                }
            }
            _ => {
                if fill_bar && beat >= q3 && (offbeat || late) {
                    return 0.06 + 0.18 * fill * metal;
                }
            }
        },
        COWBELL => match c.genre {
            BREAKBEAT | AMEN | JUNGLE => {
                if late && (on_q1 || on_q3) {
                    return 0.08 + 0.12 * perc;
                }
            }
            DISCO => {
                if offbeat {
                    return 0.16 + 0.24 * perc;
                }
                if beat_start && (on_q1 || on_q3) {
                    return 0.08 + 0.14 * perc;
                }
            }
            MOTORIK => {
                if beat_start && (beat == 0 || on_q2) {
                    return 0.10 + 0.18 * perc;
                }
                if offbeat {
                    return 0.10 + 0.16 * perc;
                }
            }
            BOSSA => {
                if (beat == 0 || on_q2) && late {
                    return 0.16 + 0.18 * perc;
                }
                if (on_q1 || on_q3) && offbeat {
                    return 0.16 + 0.20 * perc;
                }
            }
            AFRO => {
                if offbeat || late {
                    return 0.14 + 0.20 * perc;
                }
            }
            _ => {
                if fill_bar && beat >= q2 && offbeat {
                    return 0.06 + 0.16 * fill * perc;
                }
            }
        },
        CLAVE => match c.genre {
            BOSSA => {
                if beat == 0 && beat_start {
                    return 0.26 + 0.16 * perc;
                }
                if on_q1 && offbeat {
                    return 0.22 + 0.16 * perc;
                }
                if on_q2 && late {
                    return 0.22 + 0.16 * perc;
                }
                if on_q3 && beat_start {
                    return 0.24 + 0.16 * perc;
                }
            }
            AFRO => {
                if beat == 0 && beat_start {
                    return 0.20 + 0.18 * perc;
                }
                if on_q1 && late {
                    return 0.18 + 0.18 * perc;
                }
                if on_q2 && offbeat {
                    return 0.22 + 0.18 * perc;
                }
                if on_q3 && beat_start {
                    return 0.18 + 0.16 * perc;
                }
            }
            SHUFFLE => {
                if on_q1 && late {
                    return 0.10 + 0.14 * perc;
                }
                if on_q3 && offbeat {
                    return 0.10 + 0.14 * perc;
                }
            }
            _ => {
                if fill_bar && on_q3 && !beat_start {
                    return 0.06 + 0.14 * fill * perc;
                }
            }
        },
        _ => {}
    }
    0.0
}

// The crash voice is louder on the first bar of the loop. The bar index is
// not passed this far down, so this reads it back out of the controls stash
// the builder sets before each bar. See pattern.rs.
fn bar_is_first(c: &Controls, _meter: &Meter) -> bool {
    c.bar_hint == 0
}

pub fn anchor_probability(
    c: &Controls,
    meter: &Meter,
    lane: i32,
    beat: i32,
    sub: i32,
    spb: i32,
    fill_bar: bool,
) -> f32 {
    if c.style_mode != AUTO {
        return style_anchor(c, meter, lane, beat, sub, spb, fill_bar);
    }
    if meter.compound() {
        return compound_anchor(c, meter, lane, beat, sub, spb, fill_bar);
    }
    if meter.triple() {
        return triple_anchor(c, lane, beat, sub, spb, fill_bar);
    }
    genre_anchor(c, meter, lane, beat, sub, spb, fill_bar)
}

/// A forced style leans the Euclidean layer with the anchors: reels and jigs
/// want their hats busier, diddley wants its clave and cowbell everywhere.
pub fn style_euclid_bias(style: i32, lane: i32) -> f32 {
    match style {
        REEL => match lane {
            KICK | SNARE | CLAP => 0.82,
            CHAT | OHAT => 1.04,
            COWBELL | CLAVE => 0.58,
            _ => 0.90,
        },
        WALTZ => match lane {
            KICK => 0.74,
            SNARE | CLAP => 0.68,
            CHAT | OHAT => 0.92,
            _ => 0.88,
        },
        JIG => match lane {
            CHAT | OHAT => 1.10,
            COWBELL | CLAVE => 0.92,
            _ => 0.94,
        },
        SLIPJIG => match lane {
            CHAT | OHAT => 1.14,
            COWBELL | CLAVE => 0.94,
            _ => 0.92,
        },
        DIDDLEY => match lane {
            KICK => 0.84,
            SNARE | CLAP => 0.72,
            CHAT | OHAT => 0.74,
            COWBELL | CLAVE => 1.34,
            _ => 0.78,
        },
        _ => 1.0,
    }
}

fn lane_macro(c: &Controls, lane: i32) -> f32 {
    match lane {
        KICK => c.kick_amt,
        CLAP | SNARE => c.backbeat_amt,
        CHAT | OHAT => c.hat_amt,
        LOWTOM | HIGHTOM => c.tom_amt,
        CRASH | BASH => c.metal_amt,
        _ => c.aux_amt,
    }
}

/// How many hits the Euclidean rhythm wants in a bar, before the anchors
/// have their say. Density scales the wish; variation jitters it.
pub fn euclid_pulses(
    c: &Controls,
    lane: i32,
    steps_per_bar: i32,
    fill_bar: bool,
    rng: &mut Rng,
) -> i32 {
    let (density, variation, fill, macro_amt) =
        (c.density, c.variation, c.fill, lane_macro(c, lane));
    let mut desired = match lane {
        KICK => {
            1.0 + (if c.genre == DISCO || c.genre == MOTORIK {
                3.0
            } else if is_breakbeat_family(c.genre) {
                2.4
            } else if c.genre == HIPHOP {
                1.2
            } else if c.genre == JAZZ {
                2.2
            } else {
                1.6
            }) * density
                * macro_amt
        }
        CLAP => {
            (if c.genre == DISCO || c.genre == ELECTRO {
                1.6
            } else if is_breakbeat_family(c.genre) {
                0.45
            } else if c.genre == JAZZ {
                0.12
            } else {
                0.8
            }) * density
                * macro_amt
        }
        SNARE => {
            1.0 + (if is_breakbeat_family(c.genre) {
                1.8
            } else if c.genre == JAZZ {
                1.6
            } else {
                1.0
            }) * density
                * macro_amt
                * (0.4 + 0.6 * variation)
        }
        CRASH => {
            if fill_bar {
                0.08 + 0.45 * fill * macro_amt
            } else {
                0.02 + 0.10 * macro_amt
            }
        }
        CHAT => {
            (steps_per_bar as f32
                * if is_breakbeat_family(c.genre) {
                    0.34 + 0.58 * density * macro_amt
                } else if c.genre == HIPHOP {
                    0.16 + 0.42 * density * macro_amt
                } else if c.genre == JAZZ {
                    0.32 + 0.40 * density * macro_amt
                } else {
                    0.20 + 0.55 * density * macro_amt
                })
                + (if steps_per_bar >= 16 { 1.5 } else { 0.0 })
        }
        OHAT => {
            (if is_breakbeat_family(c.genre) {
                0.7
            } else if c.genre == JAZZ {
                0.6
            } else {
                0.4
            }) + 1.5 * density * macro_amt
        }
        LOWTOM | HIGHTOM => {
            if fill_bar {
                0.4 + 2.4 * fill * macro_amt
            } else {
                0.0
            }
        }
        BASH => {
            if fill_bar {
                0.2 + 1.4 * fill * macro_amt
            } else if c.genre == ELECTRO || c.genre == DUB || c.genre == MOTORIK || is_breakbeat_family(c.genre) {
                0.15 + 0.75 * variation * macro_amt
            } else {
                0.05 + 0.35 * variation * macro_amt
            }
        }
        COWBELL => {
            if c.genre == DISCO || c.genre == MOTORIK {
                0.8 + 3.0 * density * macro_amt
            } else if c.genre == BOSSA || c.genre == AFRO {
                0.8 + 2.4 * density * macro_amt
            } else {
                0.2 + 1.0 * density * variation * macro_amt
            }
        }
        CLAVE => {
            if c.genre == BOSSA || c.genre == AFRO {
                0.8 + 2.0 * density * macro_amt
            } else if c.genre == SHUFFLE {
                0.4 + 1.4 * density * macro_amt
            } else {
                0.15 + 0.8 * variation * macro_amt
            }
        }
        _ => 0.0,
    };
    desired *= style_euclid_bias(c.style_mode, lane);
    if lane != KICK && lane != SNARE && !fill_bar {
        desired *= 0.22 + 0.78 * density;
    }
    let jitter = lround((rng.next_float() * 2.0 - 1.0) * (variation * 2.0));
    clamp_i(lround(desired) + jitter, 0, steps_per_bar)
}

pub fn euclid_hit(step: i32, pulses: i32, offset: i32, length: i32) -> bool {
    if length <= 0 || pulses <= 0 {
        return false;
    }
    if pulses >= length {
        return true;
    }
    let base = (step - offset + length) % length;
    (base * pulses) % length < pulses
}

/// At low density the anchors thin out but the downbeat and the backbeat
/// stay: a sparse pattern with no pulse is just gaps.
pub fn low_density_scale(c: &Controls, meter: &Meter, lane: i32, beat: i32, sub: i32) -> f32 {
    let density = c.density.clamp(0.0, 1.0);
    let beat_start = sub == 0;
    if (lane == KICK && beat == 0 && beat_start)
        || ((lane == SNARE || lane == CLAP) && beat_start && is_backbeat(meter, beat))
    {
        return 1.0;
    }
    match lane {
        CHAT | OHAT => 0.12 + 0.88 * density,
        COWBELL | CLAVE | CRASH | BASH => 0.10 + 0.90 * density,
        LOWTOM | HIGHTOM => 0.16 + 0.84 * density,
        KICK => 0.28 + 0.72 * density,
        SNARE | CLAP => 0.22 + 0.78 * density,
        _ => 0.18 + 0.82 * density,
    }
}

/// How much of a Euclidean hit survives when no anchor claimed the step.
/// Kick and snare mostly follow their anchors; hats wander more.
pub fn euclid_influence(c: &Controls, lane: i32, fill_bar: bool) -> f32 {
    match lane {
        KICK => 0.10 + 0.35 * c.variation * c.kick_amt,
        CLAP | SNARE => 0.10 + 0.32 * c.variation * c.backbeat_amt,
        CRASH => 0.03 + 0.10 * c.variation * c.metal_amt + (if fill_bar { 0.06 } else { 0.0 }),
        CHAT => 0.24 + 0.52 * c.variation * c.hat_amt,
        OHAT => 0.16 + 0.42 * c.variation * c.hat_amt,
        LOWTOM | HIGHTOM => {
            0.10 + 0.44 * c.variation * c.tom_amt + (if fill_bar { 0.24 } else { 0.0 })
        }
        BASH => 0.10 + 0.36 * c.variation * c.metal_amt + (if fill_bar { 0.28 } else { 0.0 }),
        COWBELL => 0.18 + 0.34 * c.variation * c.aux_amt,
        CLAVE => 0.16 + 0.32 * c.variation * c.aux_amt + (if fill_bar { 0.10 } else { 0.0 }),
        _ => 0.20,
    }
}
