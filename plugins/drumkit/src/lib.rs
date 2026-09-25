// plugins/drumkit/src/lib.rs
//
// DrumKit: an eleven-voice synthesised drum instrument, and the worked
// example of a JigDAW drum machine. It is a port of the downspout VST3 of the
// same name, keeping its voices, its note map and its master bus rather than
// reimagining any of them: kick, clap, snare, crash, closed and open hats,
// two toms, bash, cowbell and clave, through per-voice saturation into a
// bitcrusher, distortion, Schroeder reverb and DC blocker.
//
// Ported from downspout plugins/drumkit (MIT, danja). Four deliberate
// deviations, each marked where it happens: the 11 trig outputs are not
// parameters here, because a JigDAW profile cannot carry an output parameter;
// the crash brightness range is scaled to Hz, where downspout maps it to
// 1.5-10.0 and its own comment says kHz; sin, tanh, pow and exp are
// deterministic approximations in math.rs, because core has none of them and
// Pulse keeps libm off the audio thread; and the reverb delay lines are fixed
// arrays sized for 192 kHz rather than vectors, because a module never grows
// memory after jig_init.
//
// The same real-time rules as pulse and 8b8, visible the same way: no_std,
// no allocator, fixed buffers, bounded queues. MIDI arrives frame-stamped
// through the Abi2 event buffer and is interleaved per sample, the way the
// downspout wrapper folds its queue into the block.

#![no_std]

mod biquad;
mod bus;
mod envelope;
mod math;
mod noise;
mod params;
mod voices_cymbal;
mod voices_drum;
mod voices_metal;

use core::cell::UnsafeCell;

use bus::{Bitcrusher, DcBlocker, Distortion, Reverb};
use params::{CLAP, CLAVE, CLOSED_HH, COWBELL, CRASH, INSTRUMENTS, KICK, MUTES, NOTES, OPEN_HH, PANS, SNARE, SPECS, TOM1, TOM2, BASH, COUNT};
use voices_cymbal::{Crash, HiHat};
use voices_drum::{Clap, Kick, Snare, Tom};
use voices_metal::{Bash, Clave, Cowbell};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const MIDI_IN_CAPACITY: usize = 64;

/// The 8 byte event record the ABI fixes.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct MidiEvent {
    frame: u32,
    size: u8,
    data: [u8; 3],
}

struct State {
    params: [f32; COUNT],
    muted: [bool; INSTRUMENTS],
    master_gain: f32,
    kick: Kick,
    snare: Snare,
    clap: Clap,
    low_tom: Tom,
    high_tom: Tom,
    closed_hat: HiHat,
    open_hat: HiHat,
    crash: Crash,
    bash: Bash,
    cowbell: Cowbell,
    clave: Clave,
    crush_l: Bitcrusher,
    crush_r: Bitcrusher,
    drive_l: Distortion,
    drive_r: Distortion,
    reverb_l: Reverb,
    reverb_r: Reverb,
    dc_l: DcBlocker,
    dc_r: DcBlocker,
    out_l: [f32; MAX_FRAMES],
    out_r: [f32; MAX_FRAMES],
    midi_in: [MidiEvent; MIDI_IN_CAPACITY],
    midi_in_count: u32,
}

impl State {
    fn init(sample_rate: f32) -> Self {
        let mut state = State {
            params: [0.0; COUNT],
            muted: [false; INSTRUMENTS],
            master_gain: 0.7,
            kick: Kick::new(sample_rate),
            snare: Snare::new(sample_rate),
            clap: Clap::new(sample_rate),
            low_tom: Tom::new(sample_rate, 80.0),
            high_tom: Tom::new(sample_rate, 200.0),
            closed_hat: HiHat::new(sample_rate, true),
            open_hat: HiHat::new(sample_rate, false),
            crash: Crash::new(sample_rate),
            bash: Bash::new(sample_rate),
            cowbell: Cowbell::new(sample_rate),
            clave: Clave::new(sample_rate),
            crush_l: Bitcrusher::new(),
            crush_r: Bitcrusher::new(),
            drive_l: Distortion::new(),
            drive_r: Distortion::new(),
            reverb_l: Reverb::new(sample_rate),
            reverb_r: Reverb::new(sample_rate),
            dc_l: DcBlocker::new(0.999),
            dc_r: DcBlocker::new(0.999),
            out_l: [0.0; MAX_FRAMES],
            out_r: [0.0; MAX_FRAMES],
            midi_in: [MidiEvent { frame: 0, size: 0, data: [0; 3] }; MIDI_IN_CAPACITY],
            midi_in_count: 0,
        };
        // The two channels do not share a room: the widths differ slightly,
        // which is what stops the reverb collapsing to mono.
        state.reverb_l.set_size(0.58);
        state.reverb_r.set_size(0.64);
        for index in 0..COUNT {
            let default = SPECS[index].default;
            state.params[index] = default;
            state.apply(index, default);
        }
        state
    }

    fn clamp_param(index: usize, value: f32) -> f32 {
        let spec = &SPECS[index];
        if spec.toggled {
            if value >= 0.5 { 1.0 } else { 0.0 }
        } else {
            value.clamp(spec.min, spec.max)
        }
    }

    fn set_param(&mut self, index: usize, value: f32) {
        if index >= COUNT {
            return;
        }
        let clamped = Self::clamp_param(index, value);
        let was_muted = SPECS[index].toggled && self.params[index] >= 0.5;
        self.params[index] = clamped;
        self.apply(index, clamped);
        // Enabling a mute resets the voice immediately, so a ringing cymbal
        // stops the moment it is muted rather than decaying under the mute.
        if SPECS[index].toggled && clamped >= 0.5 && !was_muted {
            for instrument in 0..INSTRUMENTS {
                if MUTES[instrument] == index {
                    self.muted[instrument] = true;
                    self.reset_voice(instrument);
                    break;
                }
            }
        } else if SPECS[index].toggled && clamped < 0.5 {
            for instrument in 0..INSTRUMENTS {
                if MUTES[instrument] == index {
                    self.muted[instrument] = false;
                    break;
                }
            }
        }
    }

    fn apply(&mut self, index: usize, value: f32) {
        match index {
            0 => self.kick.set_pitch(value),
            1 => self.kick.set_decay(value),
            2 => self.kick.set_drive(value),
            3 => self.kick.set_punch(value),
            4 => self.kick.set_level(value),
            5 => self.snare.set_tone(value),
            6 => self.snare.set_snap(value),
            7 => self.snare.set_level(value),
            8 => self.clap.set_density(value),
            9 => self.clap.set_tone(value),
            10 => self.clap.set_level(value),
            11 => self.low_tom.set_pitch(value),
            12 => self.low_tom.set_decay(value),
            13 => self.low_tom.set_level(value),
            14 => self.high_tom.set_pitch(value),
            15 => self.high_tom.set_decay(value),
            16 => self.high_tom.set_level(value),
            17 => self.closed_hat.set_brightness(value),
            18 => self.closed_hat.set_decay(value),
            19 => self.closed_hat.set_level(value),
            20 => self.open_hat.set_brightness(value),
            21 => self.open_hat.set_decay(value),
            22 => self.open_hat.set_level(value),
            23 => self.crash.set_brightness(value),
            24 => self.crash.set_decay(value),
            25 => self.crash.set_level(value),
            26 => self.cowbell.set_tone(value),
            27 => self.cowbell.set_decay(value),
            28 => self.cowbell.set_level(value),
            29 => self.clave.set_tone(value),
            30 => self.clave.set_decay(value),
            31 => self.clave.set_level(value),
            32 => self.bash.set_size(value),
            33 => self.bash.set_spread(value),
            34 => self.bash.set_decay(value),
            35 => self.bash.set_drive(value),
            36 => self.bash.set_noise(value),
            37 => self.bash.set_edge(value),
            38 => self.bash.set_level(value),
            39 => {
                self.crush_l.set_amount(value);
                self.crush_r.set_amount(value);
            }
            40 => {
                self.drive_l.set_drive(1.0 + value * 4.0);
                self.drive_r.set_drive(1.0 + value * 4.0);
            }
            41 => {
                self.reverb_l.set_level(value * 0.6);
                self.reverb_r.set_level(value * 0.6);
            }
            42 => self.master_gain = value,
            54 => self.kick.set_transient(value),
            55 => self.clap.set_metal(value),
            56 => self.snare.set_metal(value),
            57 => self.crash.set_metal(value),
            58 => self.closed_hat.set_metal(value),
            59 => self.low_tom.set_metal(value),
            60 => self.open_hat.set_metal(value),
            61 => self.high_tom.set_metal(value),
            62 => self.cowbell.set_metal(value),
            63 => self.clave.set_metal(value),
            _ => {}
        }
    }

    fn reset_voice(&mut self, instrument: usize) {
        match instrument {
            KICK => self.kick.reset(),
            CLAP => self.clap.reset(),
            SNARE => self.snare.reset(),
            CRASH => self.crash.reset(),
            CLOSED_HH => self.closed_hat.reset(),
            TOM1 => self.low_tom.reset(),
            OPEN_HH => self.open_hat.reset(),
            TOM2 => self.high_tom.reset(),
            BASH => self.bash.reset(),
            COWBELL => self.cowbell.reset(),
            CLAVE => self.clave.reset(),
            _ => {}
        }
    }

    fn note_on(&mut self, note: u8, velocity: u8) {
        let vel = velocity as f32 / 127.0;
        let mut instrument = INSTRUMENTS;
        for i in 0..INSTRUMENTS {
            if NOTES[i] == note {
                instrument = i;
                break;
            }
        }
        if instrument >= INSTRUMENTS {
            return;
        }
        match instrument {
            KICK => {
                if !self.muted[KICK] {
                    self.kick.trigger(vel);
                }
            }
            CLAP => {
                if !self.muted[CLAP] {
                    self.clap.trigger(1.0);
                }
            }
            SNARE => {
                if !self.muted[SNARE] {
                    self.snare.trigger(vel);
                }
            }
            CRASH => {
                if !self.muted[CRASH] {
                    self.crash.trigger(1.0);
                }
            }
            CLOSED_HH => {
                // The choke lands whether or not the closed hat is muted:
                // a muted hat still cuts the open one short.
                self.open_hat.kill();
                if !self.muted[CLOSED_HH] {
                    self.closed_hat.trigger(1.0);
                }
            }
            TOM1 => {
                if !self.muted[TOM1] {
                    self.low_tom.trigger(vel);
                }
            }
            OPEN_HH => {
                if !self.muted[OPEN_HH] {
                    self.open_hat.trigger(1.0);
                }
            }
            TOM2 => {
                if !self.muted[TOM2] {
                    self.high_tom.trigger(vel);
                }
            }
            BASH => {
                if !self.muted[BASH] {
                    self.bash.trigger(vel);
                }
            }
            COWBELL => {
                if !self.muted[COWBELL] {
                    self.cowbell.trigger(vel);
                }
            }
            CLAVE => {
                if !self.muted[CLAVE] {
                    self.clave.trigger(vel);
                }
            }
            _ => {}
        }
    }

    fn handle_bytes(&mut self, status: u8, data1: u8, data2: u8) {
        match status & 0xf0 {
            0x90 => {
                if data2 > 0 {
                    self.note_on(data1, data2);
                }
            }
            0xb0 => {
                if data1 == 120 || data1 == 123 {
                    self.reset_all();
                }
            }
            _ => {}
        }
    }

    fn voice_sample(&mut self, instrument: usize) -> f32 {
        if self.muted[instrument] {
            return 0.0;
        }
        match instrument {
            KICK => self.kick.process(),
            CLAP => self.clap.process(),
            SNARE => self.snare.process(),
            CRASH => self.crash.process(),
            CLOSED_HH => self.closed_hat.process(),
            TOM1 => self.low_tom.process(),
            OPEN_HH => self.open_hat.process(),
            TOM2 => self.high_tom.process(),
            BASH => self.bash.process(),
            COWBELL => self.cowbell.process(),
            CLAVE => self.clave.process(),
            _ => 0.0,
        }
    }

    fn reset_all(&mut self) {
        for instrument in 0..INSTRUMENTS {
            self.reset_voice(instrument);
        }
        self.reverb_l.reset();
        self.reverb_r.reset();
        self.dc_l.reset();
        self.dc_r.reset();
    }

    fn process(&mut self, frames: u32) {
        let count = self.midi_in_count.min(MIDI_IN_CAPACITY as u32) as usize;
        self.midi_in_count = 0;
        let mut next = 0usize;
        let frames = frames.min(MAX_FRAMES as u32) as usize;
        for at in 0..frames {
            while next < count && self.midi_in[next].frame as usize <= at {
                let event = self.midi_in[next];
                next += 1;
                if event.size >= 2 {
                    self.handle_bytes(event.data[0], event.data[1], event.data[2]);
                }
            }
            let mut left = 0.0;
            let mut right = 0.0;
            for instrument in 0..INSTRUMENTS {
                let sample = self.voice_sample(instrument);
                if sample != 0.0 {
                    let pan = self.params[PANS[instrument]].clamp(-1.0, 1.0);
                    let angle = (pan + 1.0) * (3.14159265359 * 0.25);
                    left += sample * crate::math::cos(angle);
                    right += sample * crate::math::sin(angle);
                }
            }
            left = self.crush_l.process(left);
            right = self.crush_r.process(right);
            left = self.drive_l.process(left);
            right = self.drive_r.process(right);
            left = self.reverb_l.process(left);
            right = self.reverb_r.process(right);
            left = self.dc_l.process(left);
            right = self.dc_r.process(right);
            left *= self.master_gain;
            right *= self.master_gain;
            self.out_l[at] = left.clamp(-1.0, 1.0);
            self.out_r[at] = right.clamp(-1.0, 1.0);
        }
    }
}

static STATE: Wrapper = Wrapper(UnsafeCell::new(None));
struct Wrapper(UnsafeCell<Option<State>>);
unsafe impl Sync for Wrapper {}

fn state() -> &'static mut State {
    unsafe { (*STATE.0.get()).as_mut().expect("jig_init runs before anything else") }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    unsafe {
        *STATE.0.get() = Some(State::init(sample_rate));
    }
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 {
    MAX_FRAMES as u32
}

#[no_mangle]
pub extern "C" fn jig_output_ptr(channel: u32) -> *const f32 {
    let s = state();
    if channel == 0 {
        s.out_l.as_ptr()
    } else {
        s.out_r.as_ptr()
    }
}

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    state().set_param(index as usize, value);
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

/// A native host silences the kit through here; a browser host sends CC 120
/// or 123 down the event buffer instead, which reaches the same reset.
#[no_mangle]
pub extern "C" fn jig_all_notes_off() {
    state().reset_all();
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    state().process(frames);
}
