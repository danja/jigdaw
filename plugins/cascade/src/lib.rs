// plugins/cascade/src/lib.rs
//
// Cascade: a Schroeder plate reverb, and the worked example of a JigDAW plugin.
//
// Every real-time rule in AGENTS.md applies here and is visible in the shape of
// the code:
//
//   no_std and no allocator at all, so there is nothing that could allocate on
//   the audio thread even by accident. Every buffer is a fixed-size array sized
//   at compile time for the worst case.
//
//   No transcendental functions. core has no expf without linking libm, and
//   pulling one in for a damping coefficient would add a dependency to the
//   audio path for something a linear mapping does adequately.
//
// The ABI is this plugin's own, not part of the host contract. The host knows
// only the AudioWorklet processor module; what that module and this one agree
// on between themselves is their business. See cascade-processor.js.

#![no_std]

use core::cell::UnsafeCell;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // Unreachable in practice: nothing here indexes dynamically or divides by a
    // value that can be zero. If it were reached, trapping is the only honest
    // option, and the host mutes and disconnects the node.
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const CHANNELS: usize = 2;

// Comb and allpass lengths in samples at 44100 Hz, the classic Schroeder set.
// Sized for the longest they can become when size is at maximum.
const COMB_BASE: [usize; 4] = [1557, 1617, 1491, 1422];
const ALLPASS_BASE: [usize; 2] = [556, 441];
const COMB_MAX: usize = 6000;
const ALLPASS_MAX: usize = 2000;
// Right channel is detuned so the two do not sum to mono.
const STEREO_SPREAD: usize = 23;

struct Comb {
    buffer: [f32; COMB_MAX],
    index: usize,
    length: usize,
    filter_state: f32,
}

impl Comb {
    const fn new() -> Self {
        Self { buffer: [0.0; COMB_MAX], index: 0, length: 1000, filter_state: 0.0 }
    }

    #[inline]
    fn process(&mut self, input: f32, feedback: f32, damping: f32) -> f32 {
        let output = self.buffer[self.index];
        // One-pole lowpass inside the feedback loop: the damping.
        self.filter_state = output * (1.0 - damping) + self.filter_state * damping;
        self.buffer[self.index] = input + self.filter_state * feedback;
        self.index += 1;
        if self.index >= self.length {
            self.index = 0;
        }
        output
    }
}

struct Allpass {
    buffer: [f32; ALLPASS_MAX],
    index: usize,
    length: usize,
}

impl Allpass {
    const fn new() -> Self {
        Self { buffer: [0.0; ALLPASS_MAX], index: 0, length: 500 }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let buffered = self.buffer[self.index];
        let output = -input + buffered;
        self.buffer[self.index] = input + buffered * 0.5;
        self.index += 1;
        if self.index >= self.length {
            self.index = 0;
        }
        output
    }
}

struct State {
    input: [[f32; MAX_FRAMES]; CHANNELS],
    output: [[f32; MAX_FRAMES]; CHANNELS],
    combs: [[Comb; 4]; CHANNELS],
    allpasses: [[Allpass; 2]; CHANNELS],
    sample_rate: f32,
    // Parameters, in the order cascade-processor.js writes them.
    mix: f32,
    size: f32,
    damping: f32,
    freeze: f32,
    mode: f32,
}

impl State {
    const fn new() -> Self {
        Self {
            input: [[0.0; MAX_FRAMES]; CHANNELS],
            output: [[0.0; MAX_FRAMES]; CHANNELS],
            combs: [[Comb::new(), Comb::new(), Comb::new(), Comb::new()],
                    [Comb::new(), Comb::new(), Comb::new(), Comb::new()]],
            allpasses: [[Allpass::new(), Allpass::new()],
                        [Allpass::new(), Allpass::new()]],
            sample_rate: 44100.0,
            mix: 0.3,
            size: 24.0,
            damping: 4200.0,
            freeze: 0.0,
            mode: 0.0,
        }
    }

    /// Retune the delay lines. Called when size or the sample rate changes,
    /// never per sample.
    fn retune(&mut self) {
        // Mode scales the whole structure: plate, hall, bloom.
        let mode_scale = match self.mode as i32 {
            1 => 1.6,
            2 => 2.4,
            _ => 1.0,
        };
        let scale = (self.size / 24.0) * mode_scale * (self.sample_rate / 44100.0);

        for channel in 0..CHANNELS {
            let spread = if channel == 0 { 0 } else { STEREO_SPREAD };
            for i in 0..4 {
                let length = ((COMB_BASE[i] as f32 * scale) as usize + spread).clamp(1, COMB_MAX);
                let comb = &mut self.combs[channel][i];
                if length != comb.length {
                    comb.length = length;
                    if comb.index >= length {
                        comb.index = 0;
                    }
                }
            }
            for i in 0..2 {
                let length = ((ALLPASS_BASE[i] as f32 * scale) as usize + spread).clamp(1, ALLPASS_MAX);
                let allpass = &mut self.allpasses[channel][i];
                if length != allpass.length {
                    allpass.length = length;
                    if allpass.index >= length {
                        allpass.index = 0;
                    }
                }
            }
        }
    }
}

struct Shared(UnsafeCell<State>);
// Sound because wasm32-unknown-unknown without the threads proposal is
// single-threaded, and this module is instantiated once per processor.
unsafe impl Sync for Shared {}

static STATE: Shared = Shared(UnsafeCell::new(State::new()));

#[inline]
#[allow(clippy::mut_from_ref)]
fn state() -> &'static mut State {
    unsafe { &mut *STATE.0.get() }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    let s = state();
    s.sample_rate = if sample_rate > 0.0 { sample_rate } else { 44100.0 };
    s.retune();
}

/// Pointer to the input scratch buffer for a channel. The processor writes the
/// quantum here before calling jig_process.
#[no_mangle]
pub extern "C" fn jig_input_ptr(channel: u32) -> *mut f32 {
    let s = state();
    s.input[(channel as usize).min(CHANNELS - 1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_output_ptr(channel: u32) -> *mut f32 {
    let s = state();
    s.output[(channel as usize).min(CHANNELS - 1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 {
    MAX_FRAMES as u32
}

/// Set a parameter by index. Retuning happens here, on a parameter change,
/// rather than per sample in jig_process.
#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    let retune = match index {
        0 => { s.mix = value; false }
        1 => { s.size = value; true }
        2 => { s.damping = value; false }
        3 => { s.freeze = value; false }
        4 => { s.mode = value; true }
        _ => false,
    };
    if retune {
        s.retune();
    }
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    let s = state();
    let frames = (frames as usize).min(MAX_FRAMES);

    // Freeze holds the tail: full feedback, no new input, no damping.
    let frozen = s.freeze >= 0.5;
    let feedback = if frozen { 1.0 } else { 0.86 };
    let input_gain = if frozen { 0.0 } else { 0.015 };

    // Damping as a normalised coefficient. A linear map of cutoff onto 0..1
    // rather than a one-pole coefficient from expf, which would mean linking
    // libm into the audio path for a control that is adjusted by ear anyway.
    let nyquist = s.sample_rate * 0.5;
    let damping = if frozen {
        0.0
    } else {
        (1.0 - (s.damping / nyquist)).clamp(0.0, 0.98)
    };

    let wet = s.mix.clamp(0.0, 1.0);
    let dry = 1.0 - wet;

    for channel in 0..CHANNELS {
        for frame in 0..frames {
            let input = s.input[channel][frame];
            let fed = input * input_gain;

            let mut accumulated = 0.0;
            for comb in s.combs[channel].iter_mut() {
                accumulated += comb.process(fed, feedback, damping);
            }
            for allpass in s.allpasses[channel].iter_mut() {
                accumulated = allpass.process(accumulated);
            }

            s.output[channel][frame] = input * dry + accumulated * wet;
        }
    }
}
