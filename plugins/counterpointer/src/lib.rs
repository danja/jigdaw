// plugins/counterpointer/src/lib.rs
//
// Counterpointer: a transport-aware MIDI processor that learns an incoming
// cycle and answers it with a monophonic counter-melody, and the second
// learned-cycle JigDAW MIDI processor after Cadence. It is a port of the
// downspout VST3 of the same name, keeping its capture model, its candidate
// scoring, its fugal answering path and its Bass Descend response mode
// rather than reimagining any of them.
//
// Ported from downspout plugins/counterpointer (MIT, danja). Three
// deliberate deviations, each marked where it happens: the mutation interval
// uses the square where the original raises to 2.5, because core has no pow;
// the status LEDs (Ready, MIDI In/Out activity) stay out, because a Jig
// declares parameters, not LEDs; and the beat clock flywheels between
// transport messages, because a host that reports the beat on a slow loop
// would otherwise quantise capture to that grid - the same flywheel the
// cadence, drumgen and bassgen ports carry.
//
// The same real-time rules as the sibling processors, visible the same way:
// no_std, no allocator, fixed arrays, no transcendental functions. Phrase
// building and variation run at cycle boundaries, both bounded, and
// jig_process only ever walks the timeline and appends to fixed buffers.
// The produced-event buffer lives in the static state, not the stack: 2048
// entries do not fit the WebAssembly stack, the lesson the cadence port
// records about its own planning tables.

#![no_std]

mod phrase;
mod rng;
mod scales;
mod timeline;

use core::cell::UnsafeCell;

use phrase::Controls;
use timeline::{BlockTransport, EngineEvent, EngineOut, EngineState, MIDI_OUT_CAPACITY};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const MIDI_IN_CAPACITY: usize = 64;

// docs/module-abi.md: the transport valid bits.
const VALID_BPM: u32 = 1;
const VALID_BEAT: u32 = 2;
const VALID_METER: u32 = 8;

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

struct State {
    sample_rate: f64,
    controls: Controls,
    trig_level: f32,
    engine: EngineState,
    was_playing: bool,
    clock_beat: f64,
    clock_on: bool,
    last_t: f64,
    pending_silence: bool,
    produced: [EngineEvent; MIDI_OUT_CAPACITY],
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
            controls: Controls::new(),
            trig_level: 0.0,
            engine: EngineState::new(),
            was_playing: false,
            clock_beat: 0.0,
            clock_on: false,
            last_t: 0.0,
            pending_silence: false,
            produced: [EngineEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_OUT_CAPACITY],
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
}

impl State {
    fn beats_per_bar(&self) -> f64 {
        if (self.transport.valid & VALID_METER) != 0
            && self.transport.numerator > 0
            && self.transport.denominator > 0
        {
            self.transport.numerator as f64
        } else {
            4.0
        }
    }

    fn process(&mut self, frames: u32) {
        self.midi_out_count = 0;
        if self.pending_silence {
            self.pending_silence = false;
            let mut out = EngineOut { buf: &mut self.produced, count: 0 };
            self.engine.silence_output(&mut out, 0);
            for i in 0..out.count {
                let e = out.buf[i];
                self.midi_out[i] = MidiEvent { frame: e.frame, size: e.size, data: e.data };
            }
            self.midi_out_count = out.count as u32;
            self.engine.was_playing = false;
            self.was_playing = false;
            return;
        }

        // Snapshot the input queue: the timeline consumes it in order while
        // the count resets for the next block.
        let input_count = self.midi_in_count.min(MIDI_IN_CAPACITY as u32) as usize;
        self.midi_in_count = 0;
        let mut input = [EngineEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_IN_CAPACITY];
        for i in 0..input_count {
            let m = self.midi_in[i];
            input[i] = EngineEvent { frame: m.frame, size: m.size, data: m.data };
        }

        // The beat clock flywheels between transport messages: see drumgen.
        let beats_step = (frames as f64 * self.transport.bpm) / (60.0 * self.sample_rate);
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

        let snap = BlockTransport {
            valid: (self.transport.valid & (VALID_BEAT | VALID_BPM)) == (VALID_BEAT | VALID_BPM),
            playing: self.transport.playing != 0,
            bpm: self.transport.bpm,
            beats_per_bar: self.beats_per_bar(),
            abs_start: base,
            abs_end: base + beats_step,
        };

        let mut out = EngineOut { buf: &mut self.produced, count: 0 };
        timeline::process_block(
            &mut self.engine,
            &self.controls,
            &snap,
            frames,
            self.sample_rate,
            &input[..input_count],
            &mut out,
        );
        for i in 0..out.count {
            let e = out.buf[i];
            self.midi_out[i] = MidiEvent { frame: e.frame, size: e.size, data: e.data };
        }
        self.midi_out_count = out.count as u32;

        self.was_playing = self.engine.was_playing;
        self.clock_beat = base + beats_step;
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
    s.controls = Controls::new();
    s.engine = EngineState::new();
    s.trig_level = 0.0;
    s.was_playing = false;
    s.clock_on = false;
    s.pending_silence = false;
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 {
    MAX_FRAMES as u32
}

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    match index {
        0 => s.controls.key = value as i32,
        1 => s.controls.scale = value as i32,
        2 => s.controls.cycle_bars = value as i32,
        3 => s.controls.granularity = value as i32,
        4 => s.controls.follow = value,
        5 => s.controls.counter = value,
        6 => s.controls.short_random = value,
        7 => s.controls.long_random = value,
        8 => s.controls.density = value,
        9 => s.controls.rhythm_follow = value,
        10 => s.controls.syncopation = value,
        11 => s.controls.consonance = value,
        12 => s.controls.color = value,
        13 => s.controls.embellish = value,
        14 => s.controls.regularity = value,
        15 => s.controls.reg = value as i32,
        16 => s.controls.span = value,
        17 => s.controls.gate = value,
        18 => s.controls.velocity_follow = value,
        19 => s.controls.pass_input = value >= 0.5,
        20 => s.controls.output_channel = value as i32,
        21 => s.controls.freeze = value >= 0.5,
        // The learn trigger fires on the rising edge: a held 1 is one
        // press, not a held button, and the counter is what the engine
        // compares.
        22 => {
            if value > 0.5 && s.trig_level <= 0.5 {
                s.controls.action_learn = s.controls.action_learn.wrapping_add(1);
            }
            s.trig_level = value;
            return;
        }
        23 => s.controls.response_mode = value as i32,
        _ => return,
    }
}

#[no_mangle]
pub extern "C" fn jig_midi_in_ptr() -> *const MidiEvent {
    state().midi_in.as_ptr()
}

#[no_mangle]
pub extern "C" fn jig_midi_in_capacity() -> u32 {
    MIDI_IN_CAPACITY as u32
}

#[no_mangle]
pub extern "C" fn jig_midi_in(count: u32) {
    state().midi_in_count = count.min(MIDI_IN_CAPACITY as u32);
}

#[no_mangle]
pub extern "C" fn jig_midi_out_ptr() -> *const MidiEvent {
    state().midi_out.as_ptr()
}

#[no_mangle]
pub extern "C" fn jig_midi_out_capacity() -> u32 {
    MIDI_OUT_CAPACITY as u32
}

#[no_mangle]
pub extern "C" fn jig_midi_out_count() -> u32 {
    state().midi_out_count
}

#[no_mangle]
pub extern "C" fn jig_transport_ptr() -> *const Transport {
    &state().transport
}

#[no_mangle]
pub extern "C" fn jig_all_notes_off() {
    state().pending_silence = true;
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    state().process(frames);
}
