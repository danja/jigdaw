// plugins/counterpointer/src/scales.rs
//
// The 24 scale vocabularies downspout's counterpointer engine scores
// against, in ScaleId order: Chromatic, Major, Ionian, Natural Minor,
// Harmonic Minor, Melodic Minor, Dorian, Phrygian, Lydian, Mixolydian,
// Locrian, Phrygian Dominant, Neapolitan Major and Minor, Pentatonic Major
// and Minor, Blues, Whole Tone, Altered, the two diminished forms, and the
// three bebop forms. Same intervals, so the same input scores the same way.

pub const SCALE_COUNT: usize = 24;

const CHROMATIC: &[i32] = &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MAJOR: &[i32] = &[0, 2, 4, 5, 7, 9, 11];
const IONIAN: &[i32] = &[0, 2, 4, 5, 7, 9, 11];
const NAT_MINOR: &[i32] = &[0, 2, 3, 5, 7, 8, 10];
const HARM_MINOR: &[i32] = &[0, 2, 3, 5, 7, 8, 11];
const MELODIC_MINOR: &[i32] = &[0, 2, 3, 5, 7, 9, 11];
const DORIAN: &[i32] = &[0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN: &[i32] = &[0, 1, 3, 5, 7, 8, 10];
const LYDIAN: &[i32] = &[0, 2, 4, 6, 7, 9, 11];
const MIXOLYDIAN: &[i32] = &[0, 2, 4, 5, 7, 9, 10];
const LOCRIAN: &[i32] = &[0, 1, 3, 5, 6, 8, 10];
const PHRYGIAN_DOMINANT: &[i32] = &[0, 1, 4, 5, 7, 8, 10];
const NEO_MAJOR: &[i32] = &[0, 1, 4, 5, 7, 9, 11];
const NEO_MINOR: &[i32] = &[0, 1, 3, 5, 7, 8, 10];
const PENT_MAJOR: &[i32] = &[0, 2, 4, 7, 9];
const PENT_MINOR: &[i32] = &[0, 3, 5, 7, 10];
const BLUES: &[i32] = &[0, 3, 5, 6, 7, 10];
const WHOLE_TONE: &[i32] = &[0, 2, 4, 6, 8, 10];
const ALTERED: &[i32] = &[0, 1, 3, 4, 6, 8, 10];
const HALF_WHOLE_DIM: &[i32] = &[0, 1, 3, 4, 6, 7, 9, 10];
const WHOLE_HALF_DIM: &[i32] = &[0, 2, 3, 5, 6, 8, 9, 11];
const BEBOP_DOMINANT: &[i32] = &[0, 2, 4, 5, 7, 9, 10, 11];
const BEBOP_MAJOR: &[i32] = &[0, 2, 4, 5, 7, 8, 9, 11];
const BEBOP_MINOR: &[i32] = &[0, 2, 3, 4, 5, 7, 9, 10];

pub const SCALES: [&[i32]; SCALE_COUNT] = [
    CHROMATIC,
    MAJOR,
    IONIAN,
    NAT_MINOR,
    HARM_MINOR,
    MELODIC_MINOR,
    DORIAN,
    PHRYGIAN,
    LYDIAN,
    MIXOLYDIAN,
    LOCRIAN,
    PHRYGIAN_DOMINANT,
    NEO_MAJOR,
    NEO_MINOR,
    PENT_MAJOR,
    PENT_MINOR,
    BLUES,
    WHOLE_TONE,
    ALTERED,
    HALF_WHOLE_DIM,
    WHOLE_HALF_DIM,
    BEBOP_DOMINANT,
    BEBOP_MAJOR,
    BEBOP_MINOR,
];

pub fn wrap12(value: i32) -> i32 {
    let out = value % 12;
    if out < 0 { out + 12 } else { out }
}

pub fn scale_contains(scale_index: i32, key: i32, note: i32) -> bool {
    let scale = SCALES[scale_index.clamp(0, SCALE_COUNT as i32 - 1) as usize];
    let rel = wrap12(note - key);
    scale.contains(&rel)
}

/// The nearest note in the key and scale, scanning outward like the
/// downspout original rather than quantising up or down.
pub fn nearest_scale_note(key: i32, scale_index: i32, target: i32, min_note: i32, max_note: i32) -> i32 {
    let mut best = target.clamp(min_note, max_note);
    let mut best_distance = 1024;
    let mut note = min_note;
    while note <= max_note {
        if scale_contains(scale_index, key, note) {
            let distance = (note - target).abs();
            if distance < best_distance {
                best = note;
                best_distance = distance;
            }
        }
        note += 1;
    }
    best
}

/// Scale ids 6 to 11 and 17 to 23 take the full Color amount; the rest take
/// less than half, exactly the is_jazz_scale split downspout makes.
pub fn is_jazz_scale(scale: i32) -> bool {
    matches!(scale, 6 | 9 | 8 | 5 | 7 | 10 | 11 | 17 | 18 | 19 | 20 | 21 | 22 | 23)
}
