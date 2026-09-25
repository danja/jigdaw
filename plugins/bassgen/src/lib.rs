// plugins/bassgen/src/lib.rs
//
// BassGen: a transport synced bass line generator, and the worked example of a
// JigDAW MIDI generator. It is a port of the downspout VST3 of the same name,
// keeping its controls and the shape of what it produces rather than copying its
// 4500 lines: this exists to exercise jig:Abi2, and a faithful transliteration
// would prove the same things about the ABI at ten times the size.
//
// It is the first plugin that could not have been written at all under version
// 1 of the ABI. It emits MIDI, which version 1 had no way to carry, and it is in
// time with the session, which version 1 had no way to tell it about.
//
// The same real-time rules as pulse and cascade, visible the same way: no_std,
// no allocator, fixed arrays, no transcendental functions. Pattern generation
// happens on a parameter write rather than inside jig_process, so the audio
// thread only ever reads it.

#![no_std]

use core::cell::UnsafeCell;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const MAX_STEPS: usize = 256;
const MIDI_IN_CAPACITY: usize = 64;
const MIDI_OUT_CAPACITY: usize = 128;

// docs/module-abi.md: the transport valid bits.
const VALID_BPM: u32 = 1;
const VALID_BEAT: u32 = 2;

/// The 8 byte event record the ABI fixes.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct MidiEvent {
    frame: u32,
    size: u8,
    data: [u8; 3],
}

/// The 64 byte transport block the host fills in before each jig_process.
#[repr(C)]
#[derive(Clone, Copy)]
struct Transport {
    playing: u32,
    ticks_per_beat: u32,
    bpm: f64,
    beat: f64,
    bar_start_beat: f64,
    bar: i32,
    beat_in_bar: i32,
    tick: i32,
    numerator: i32,
    denominator: i32,
    valid: u32,
    seconds: f64,
}

/// Scale degrees in semitones. The full set the downspout plugin offers, because
/// they are a table rather than code and leaving some out would be an arbitrary
/// answer to "which music is this for".
const SCALES: [(u8, [i8; 8]); 23] = [
    (7, [0, 2, 4, 5, 7, 9, 11, 0]),   // major
    (7, [0, 2, 4, 5, 7, 9, 11, 0]),   // ionian
    (7, [0, 2, 3, 5, 7, 8, 10, 0]),   // minor
    (7, [0, 2, 3, 5, 7, 8, 11, 0]),   // harmonic minor
    (7, [0, 2, 3, 5, 7, 9, 11, 0]),   // melodic minor
    (7, [0, 2, 3, 5, 7, 9, 10, 0]),   // dorian
    (7, [0, 1, 3, 5, 7, 8, 10, 0]),   // phrygian
    (7, [0, 2, 4, 6, 7, 9, 11, 0]),   // lydian
    (7, [0, 2, 4, 5, 7, 9, 10, 0]),   // mixolydian
    (7, [0, 1, 3, 5, 6, 8, 10, 0]),   // locrian
    (7, [0, 1, 4, 5, 7, 8, 10, 0]),   // phrygian dominant
    (7, [0, 1, 4, 5, 7, 9, 11, 0]),   // neapolitan major
    (7, [0, 1, 3, 5, 7, 8, 11, 0]),   // neapolitan minor
    (5, [0, 2, 4, 7, 9, 0, 0, 0]),    // pentatonic major
    (5, [0, 3, 5, 7, 10, 0, 0, 0]),   // pentatonic minor
    (6, [0, 3, 5, 6, 7, 10, 0, 0]),   // blues
    (6, [0, 2, 4, 6, 8, 10, 0, 0]),   // whole tone
    (7, [0, 1, 3, 4, 6, 8, 10, 0]),   // altered
    (8, [0, 1, 3, 4, 6, 7, 9, 10]),   // half whole diminished
    (8, [0, 2, 3, 5, 6, 8, 9, 11]),   // whole half diminished
    (8, [0, 2, 4, 5, 7, 9, 10, 11]),  // bebop dominant
    (8, [0, 2, 4, 5, 7, 8, 9, 11]),   // bebop major
    (8, [0, 2, 3, 5, 7, 8, 9, 10]),   // bebop minor
];

/// How a genre leans, as the four numbers the generator actually consults.
///
/// `root_pull` is how often it returns to the root, `reach` how far it wanders,
/// `syncopation` how willing it is to place a note off the beat, and `octave`
/// how often it jumps an octave. A table because the alternative is twelve
/// branches that each say the same four things.
struct Genre {
    root_pull: f32,
    reach: f32,
    syncopation: f32,
    octave: f32,
}

const GENRES: [Genre; 12] = [
    Genre { root_pull: 0.55, reach: 0.25, syncopation: 0.20, octave: 0.10 }, // techno
    Genre { root_pull: 0.40, reach: 0.45, syncopation: 0.45, octave: 0.25 }, // acid
    Genre { root_pull: 0.45, reach: 0.30, syncopation: 0.35, octave: 0.20 }, // house
    Genre { root_pull: 0.35, reach: 0.50, syncopation: 0.40, octave: 0.30 }, // electro
    Genre { root_pull: 0.65, reach: 0.20, syncopation: 0.15, octave: 0.05 }, // dub
    Genre { root_pull: 0.70, reach: 0.15, syncopation: 0.05, octave: 0.05 }, // ambient
    Genre { root_pull: 0.30, reach: 0.55, syncopation: 0.60, octave: 0.20 }, // funk
    Genre { root_pull: 0.75, reach: 0.15, syncopation: 0.10, octave: 0.15 }, // sabbath
    Genre { root_pull: 0.25, reach: 0.65, syncopation: 0.50, octave: 0.15 }, // jazz
    Genre { root_pull: 0.30, reach: 0.60, syncopation: 0.20, octave: 0.10 }, // fugue
    Genre { root_pull: 0.50, reach: 0.35, syncopation: 0.25, octave: 0.15 }, // rock
    Genre { root_pull: 0.60, reach: 0.30, syncopation: 0.10, octave: 0.35 }, // moroder
];

/// Steps per beat for each subdivision.
const SUBDIVISIONS: [u32; 4] = [2, 4, 6, 1];   // eighth, sixteenth, triplet, quarter

#[derive(Clone, Copy, Default)]
struct Step {
    active: bool,
    note: u8,
    velocity: u8,
}

/// floor for f64, which lives in std and not in core.
///
/// Negative positions are not hypothetical: a host counts pre-roll backwards
/// from the start of the timeline, and truncation there rounds towards zero,
/// which would play step 0 twice and skip step -1.
#[inline]
fn floor_i64(value: f64) -> i64 {
    let truncated = value as i64;
    if value < 0.0 && (truncated as f64) != value { truncated - 1 } else { truncated }
}

/// xorshift32. Deterministic, seeded, and the same line every time for a seed,
/// which is the whole point of a seed control.
struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }
    fn unit(&mut self) -> f32 {
        (self.next() >> 8) as f32 / 16777216.0
    }
    fn below(&mut self, limit: u32) -> u32 {
        if limit == 0 { 0 } else { self.next() % limit }
    }
}

struct State {
    sample_rate: f64,

    // Controls, by jig:paramIndex.
    root: i32,
    scale: usize,
    genre: usize,
    length_beats: i32,
    subdivision: usize,
    density: f32,
    register: i32,
    hold: f32,
    accent: f32,
    colour: f32,
    vary: f32,
    seed: u32,
    follow: f32,

    pattern: [Step; MAX_STEPS],
    steps: usize,

    /// Where playback had got to, so a step boundary is a change rather than a
    /// recomputation. -1 means nothing has played yet.
    last_step: i64,    sounding: u8,          ///< 0 means nothing is sounding
    off_at_beat: f64,
    was_playing: bool,
    /// The beat at the end of the last processed block, advanced at the
    /// supplied tempo between transport messages, with the last transport
    /// beat seen alongside so a stale repeat is flown through and only a
    /// changed value is compared against the clock. See process().
    clock_beat: f64,
    clock_on: bool,
    last_t: f64,

    midi_in: [MidiEvent; MIDI_IN_CAPACITY],
    midi_in_count: u32,
    midi_out: [MidiEvent; MIDI_OUT_CAPACITY],
    midi_out_count: u32,
    transport: Transport,
}

impl State {
    const fn new() -> Self {
        State {
            sample_rate: 48000.0,
            root: 36,
            scale: 2,
            genre: 0,
            length_beats: 16,
            subdivision: 1,
            density: 0.45,
            register: 1,
            hold: 0.35,
            accent: 0.45,
            colour: 0.5,
            vary: 0.0,
            seed: 1,
            follow: 0.0,
            pattern: [Step { active: false, note: 0, velocity: 0 }; MAX_STEPS],
            steps: 64,
            last_step: -1,
            sounding: 0,
            off_at_beat: 0.0,
            was_playing: false,
            clock_beat: 0.0,
            clock_on: false,
            last_t: 0.0,
            midi_in: [MidiEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_IN_CAPACITY],
            midi_in_count: 0,
            midi_out: [MidiEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_OUT_CAPACITY],
            midi_out_count: 0,
            transport: Transport {
                playing: 0, ticks_per_beat: 0, bpm: 120.0, beat: 0.0, bar_start_beat: 0.0,
                bar: 1, beat_in_bar: 1, tick: 0, numerator: 4, denominator: 4,
                valid: 0, seconds: 0.0,
            },
        }
    }

    fn steps_per_beat(&self) -> u32 {
        SUBDIVISIONS[self.subdivision.min(SUBDIVISIONS.len() - 1)]
    }

    /// Build the whole pattern. Called on a parameter write, never from
    /// jig_process: the audio thread reads this array and does not write it.
    fn regenerate(&mut self) {
        let per_beat = self.steps_per_beat() as usize;
        let wanted = (self.length_beats.max(1) as usize) * per_beat;
        self.steps = wanted.min(MAX_STEPS).max(1);

        let genre = &GENRES[self.genre.min(GENRES.len() - 1)];
        let (degrees, table) = SCALES[self.scale.min(SCALES.len() - 1)];
        let degrees = degrees as usize;

        let mut rng = Rng(if self.seed == 0 { 1 } else { self.seed });
        let mut degree: i32 = 0;

        for step in 0..self.steps {
            let in_beat = step % per_beat;
            let downbeat = in_beat == 0;
            let half = per_beat > 1 && in_beat == per_beat / 2;

            // A downbeat is likelier than an offbeat, and how much likelier is
            // what separates dub from funk.
            let weight = if downbeat {
                1.0
            } else if half {
                0.55 + genre.syncopation * 0.45
            } else {
                genre.syncopation
            };

            let active = rng.unit() < self.density * weight * 1.6;
            if !active {
                self.pattern[step] = Step::default();
                continue;
            }

            // Walk the scale, pulled back towards the root.
            if rng.unit() < genre.root_pull {
                degree = 0;
            } else {
                let span = 1 + (genre.reach * 4.0) as i32;
                degree += rng.below((span * 2 + 1) as u32) as i32 - span;
            }
            degree = degree.clamp(-(degrees as i32), (degrees as i32) * 2);

            let octave = degree.div_euclid(degrees as i32);
            let within = degree.rem_euclid(degrees as i32) as usize;
            let mut note = self.root + table[within] as i32 + octave * 12
                + self.register.clamp(0, 3) * 12;

            if rng.unit() < genre.octave { note += 12; }
            // Colour leans the line brighter or darker without leaving the scale.
            if self.colour > 0.75 && rng.unit() < (self.colour - 0.75) * 4.0 { note += 12; }
            if self.colour < 0.25 && rng.unit() < (0.25 - self.colour) * 4.0 { note -= 12; }

            let accent = if downbeat { self.accent } else { self.accent * 0.6 };
            let velocity = (56.0 + accent * 70.0 + rng.unit() * 12.0) as i32;

            self.pattern[step] = Step {
                active: true,
                note: note.clamp(0, 127) as u8,
                velocity: velocity.clamp(1, 127) as u8,
            };
        }
    }

    /// Mutate a few steps, for the vary control. Also off the audio thread: this
    /// runs at a pattern wrap, which is detected in process but applied to the
    /// same array the next block reads.
    fn mutate(&mut self, cycle: u32) {
        if self.vary <= 0.0 { return; }
        let mut rng = Rng(self.seed.wrapping_mul(2654435761).wrapping_add(cycle).max(1));
        let changes = (self.vary * 6.0) as u32 + 1;
        for _ in 0..changes {
            if rng.unit() > self.vary { continue; }
            let at = rng.below(self.steps as u32) as usize;
            if self.pattern[at].active && rng.unit() < 0.4 {
                self.pattern[at].active = false;
            } else {
                let (degrees, table) = SCALES[self.scale.min(SCALES.len() - 1)];
                let within = rng.below(degrees as u32) as usize;
                let note = self.root + table[within] as i32 + self.register.clamp(0, 3) * 12;
                self.pattern[at] = Step {
                    active: true,
                    note: note.clamp(0, 127) as u8,
                    velocity: (60.0 + self.accent * 60.0) as u8,
                };
            }
        }
    }

    fn emit(&mut self, frame: u32, status: u8, a: u8, b: u8) {
        if self.midi_out_count as usize >= MIDI_OUT_CAPACITY { return; }
        self.midi_out[self.midi_out_count as usize] = MidiEvent {
            frame,
            size: 3,
            data: [status, a, b],
        };
        self.midi_out_count += 1;
    }

    fn stop_sounding(&mut self, frame: u32) {
        if self.sounding != 0 {
            self.emit(frame, 0x80, self.sounding, 0);
            self.sounding = 0;
        }
    }

    /// Incoming MIDI. Follow takes the root from whatever is played, which is
    /// how the downspout plugin lets a keyboard steer the line.
    fn take_input(&mut self) {
        let count = self.midi_in_count.min(MIDI_IN_CAPACITY as u32);
        self.midi_in_count = 0;
        if self.follow < 0.5 { return; }

        for i in 0..count as usize {
            let event = self.midi_in[i];
            if event.size < 3 { continue; }
            if event.data[0] & 0xf0 != 0x90 || event.data[2] == 0 { continue; }
            let root = event.data[1] as i32;
            if root != self.root {
                self.root = root;
                self.regenerate();
            }
        }
    }

    fn process(&mut self, frames: u32) {
        self.midi_out_count = 0;
        self.take_input();

        let playing = self.transport.playing != 0
            && (self.transport.valid & VALID_BEAT) != 0
            && (self.transport.valid & VALID_BPM) != 0;

        if !playing {
            // Stopping is a thing that has to happen, not a thing that happens
            // by not playing. A held note with no note off is a stuck note.
            if self.was_playing {
                self.stop_sounding(0);
                self.last_step = -1;
                self.was_playing = false;
                self.clock_on = false;
            }
            return;
        }

        // The beat clock flywheels between transport messages. Jiggy tells
        // the plugins where the transport is on a 100ms loop rather than
        // every quantum, so the beat arriving with a block is routinely
        // stale: scheduling purely from it replays the same step while it
        // repeats, then skips ahead on the next update, quantising the line
        // to the update grid. Instead the clock advances at the supplied
        // tempo and the supplied beat only corrects it: a fresh beat a beat
        // or more off the clock is a seek or a loop, and anything else - a
        // stale repeat, or an ordinary lagging update - is flown through.
        // This still derives timing from the supplied beat the way contract
        // section 7 requires; counting process() calls would drift, and this
        // cannot, because every real seek re-anchors it.
        let t_beat = self.transport.beat;
        let base = if !self.was_playing || !self.clock_on {
            self.clock_on = true;
            self.last_t = t_beat;
            t_beat
        } else if t_beat != self.last_t {
            self.last_t = t_beat;
            if t_beat < self.clock_beat - 1.0 || t_beat > self.clock_beat + 1.0 {
                t_beat
            } else {
                self.clock_beat
            }
        } else {
            self.clock_beat
        };
        self.was_playing = true;

        let frames = frames.min(MAX_FRAMES as u32);
        let per_beat = self.steps_per_beat() as f64;
        let beats_per_frame = self.transport.bpm / (60.0 * self.sample_rate);
        let step_beats = 1.0 / per_beat;

        for frame in 0..frames {
            let beat = base + beats_per_frame * frame as f64;

            if self.sounding != 0 && beat >= self.off_at_beat {
                self.stop_sounding(frame);
            }

            let absolute = floor_i64(beat * per_beat);
            if absolute == self.last_step { continue; }

            let wrapped = absolute.rem_euclid(self.steps as i64) as usize;
            // A wrap is where variation happens, so a line drifts over repeats
            // rather than being regenerated under the player's hands.
            if self.last_step >= 0 && wrapped == 0 {
                let cycle = (absolute / self.steps as i64) as u32;
                self.mutate(cycle);
            }
            self.last_step = absolute;

            let step = self.pattern[wrapped];
            if !step.active { continue; }

            self.stop_sounding(frame);
            self.emit(frame, 0x90, step.note, step.velocity);
            self.sounding = step.note;
            self.off_at_beat = beat + step_beats * (0.15 + self.hold as f64 * 0.85);
        }
        self.clock_beat = base + beats_per_frame * frames as f64;
    }
}

static STATE: Wrapper = Wrapper(UnsafeCell::new(State::new()));
struct Wrapper(UnsafeCell<State>);
unsafe impl Sync for Wrapper {}

#[allow(clippy::mut_from_ref)]
fn state() -> &'static mut State {
    unsafe { &mut *STATE.0.get() }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    let s = state();
    s.sample_rate = sample_rate as f64;
    s.regenerate();
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 { MAX_FRAMES as u32 }

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    let before_shape = (s.subdivision, s.length_beats);
    match index {
        0 => s.root = value as i32,
        1 => s.scale = (value as i32).clamp(0, 22) as usize,
        2 => s.genre = (value as i32).clamp(0, 11) as usize,
        3 => s.length_beats = (value as i32).clamp(1, 32),
        4 => s.subdivision = (value as i32).clamp(0, 3) as usize,
        5 => s.density = value.clamp(0.0, 1.0),
        6 => s.register = (value as i32).clamp(0, 3),
        7 => s.hold = value.clamp(0.0, 1.0),
        8 => s.accent = value.clamp(0.0, 1.0),
        9 => s.colour = value.clamp(0.0, 1.0),
        10 => s.vary = value.clamp(0.0, 1.0),
        11 => s.seed = (value as i32).clamp(1, 9999) as u32,
        12 => s.follow = value.clamp(0.0, 1.0),
        _ => return,
    }
    // Hold and vary change how the pattern is played, not what it is. Anything
    // else is a different line, so it is rebuilt.
    if index != 7 && index != 10 && index != 12 {
        s.regenerate();
        if before_shape != (s.subdivision, s.length_beats) { s.last_step = -1; }
    }
}

#[no_mangle]
pub extern "C" fn jig_midi_in_ptr() -> *const MidiEvent { state().midi_in.as_ptr() }

#[no_mangle]
pub extern "C" fn jig_midi_in_capacity() -> u32 { MIDI_IN_CAPACITY as u32 }

#[no_mangle]
pub extern "C" fn jig_midi_in(count: u32) {
    state().midi_in_count = count.min(MIDI_IN_CAPACITY as u32);
}

#[no_mangle]
pub extern "C" fn jig_midi_out_ptr() -> *const MidiEvent { state().midi_out.as_ptr() }

#[no_mangle]
pub extern "C" fn jig_midi_out_capacity() -> u32 { MIDI_OUT_CAPACITY as u32 }

#[no_mangle]
pub extern "C" fn jig_midi_out_count() -> u32 { state().midi_out_count }

#[no_mangle]
pub extern "C" fn jig_transport_ptr() -> *const Transport { &state().transport }

#[no_mangle]
pub extern "C" fn jig_all_notes_off() {
    let s = state();
    s.stop_sounding(0);
    s.last_step = -1;
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    state().process(frames);
}
