// plugins/ferrite/src/lib.rs
//
// A neural amp model and an impulse response in series: input trim, then
// nam-rs's WaveNet forward pass (the amp and preamp), then convolution against
// a loaded impulse response (src/convolver.rs), mixed with the dry signal, then
// output level. The response can be a cabinet or a room: up to 2.7 seconds.
//
// One model, run once on the mean of both input channels, because an amp is a
// mono device and a real capture is too heavy to run twice: a 295 kB
// "standard" capture measured 3.4 ms a quantum run per channel, against a
// budget of 2.67 ms, and 1.7 ms run once. The Amp switch skips it entirely,
// for a Ferrite used only to convolve.
//
// This is the first plugin here with a real external dependency rather than
// hand-written DSP throughout: nam-rs is MIT-licensed, ported from and
// numerically validated against the reference Python and C++
// implementations (see plugins/ferrite/README.md for the attribution this
// project's own conventions ask for). Reimplementing WaveNet inference from
// the .nam format's documentation alone, with no reference output to check
// against, is exactly the kind of confident-but-unverified work AGENTS.md
// warns about; using an already-validated implementation is not a shortcut
// around that, it is the same discipline pointed at a better source of
// truth.
//
// Real-time rules are unchanged by any of this. jig_process below allocates
// nothing: nam-rs's own process_buffer is documented and tested not to
// (its crate carries a dedicated no-allocation test), and every buffer this
// file owns is a fixed-size static, sized at compile time, exactly as
// plugins/boost/boost.cpp's are.
//
// static mut throughout, exactly as plugins/boost/boost.cpp's plain file
// scope globals are, for the same reason: an AudioWorkletProcessor calls
// every export from one thread, strictly in sequence, and this module is
// instantiated once per node, so nothing here is ever read and written at
// once or aliased from two call frames at the same time. static_mut_refs
// warns about the general case, a program where that is not guaranteed;
// allowed here rather than threaded through every access as `&raw`
// gymnastics, which would cost this file's whole point as something to
// read, for a hazard this specific calling discipline does not have.
#![allow(static_mut_refs)]
use nam_rs::{Model, NamModel};

mod convolver;
use convolver::{IR_MAX_LEN, MAX_FRAMES};

static mut INPUT: [[f32; MAX_FRAMES]; 2] = [[0.0; MAX_FRAMES]; 2];
static mut OUTPUT: [[f32; MAX_FRAMES]; 2] = [[0.0; MAX_FRAMES]; 2];
static mut DRY: [[f32; MAX_FRAMES]; 2] = [[0.0; MAX_FRAMES]; 2];
static mut MONO: [f32; MAX_FRAMES] = [0.0; MAX_FRAMES];
static mut MODEL: Option<Model> = None;

static mut IR: [f32; IR_MAX_LEN] = [0.0; IR_MAX_LEN];
const TOO_LONG: &str = "impulse response is longer than IR_MAX_LEN";

static mut INPUT_TRIM: f32 = 1.0;
static mut OUTPUT_LEVEL: f32 = 1.0;
static mut AMP_ON: bool = true;
static mut MIX: f32 = 1.0;

// Set once, in jig_init, and read by both loaders below: nam-rs's own
// documentation is explicit that a rate mismatch "produces silently wrong
// output, because dilations and recurrence are defined in samples, not
// seconds", and a cabinet IR captured at another rate has the same problem
// for the same reason. Neither loader resamples; both can at least say so
// rather than let it pass as a load that succeeded.
static mut HOST_SAMPLE_RATE: f32 = 0.0;

const NAM_BUF_LEN: usize = 1 << 20; // 1 MiB: generous for a "standard"-size .nam JSON file.
static mut NAM_BUF: [u8; NAM_BUF_LEN] = [0; NAM_BUF_LEN];
const IR_FILE_BUF_LEN: usize = 4 << 20; // 4 MiB of WAV bytes: 2.7 s of 32-bit stereo is 1 MiB.
static mut IR_FILE_BUF: [u8; IR_FILE_BUF_LEN] = [0; IR_FILE_BUF_LEN];

/// One WAV sample decoded to f32, whichever of the two supported formats it
/// arrived in. WAVE_FORMAT_EXTENSIBLE and anything above 32 bits is refused
/// rather than guessed at, the same reason src/rdf/Turtle.cpp refuses
/// Turtle it does not recognise instead of approximating it.
fn decode_wav(bytes: &[u8]) -> Result<alloc_free_ir::Decoded, &'static str> {
    alloc_free_ir::decode(bytes)
}

/// The convolution and WAV decoding, kept in one small module rather than
/// inlined, so jig_process's real-time path is easy to read on its own.
mod alloc_free_ir {
    pub struct Decoded {
        pub sample_rate: u32,
        pub mono_len: usize,
    }

    fn u16le(b: &[u8], at: usize) -> u16 { u16::from_le_bytes([b[at], b[at + 1]]) }
    fn u32le(b: &[u8], at: usize) -> u32 { u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]) }

    /// Parses a PCM16, PCM24, PCM32 or IEEE-float32 WAV file, mixes every
    /// channel to mono by averaging, and writes the result into `super::IR`.
    /// Returns the sample rate the file declared and the number of samples
    /// written.
    pub fn decode(bytes: &[u8]) -> Result<Decoded, &'static str> {
        if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
            return Err("not a RIFF/WAVE file");
        }

        let mut pos = 12;
        let (mut format, mut channels, mut sample_rate, mut bits) = (0u16, 0u16, 0u32, 0u16);
        let mut data: Option<&[u8]> = None;

        while pos + 8 <= bytes.len() {
            let id = &bytes[pos..pos + 4];
            let size = u32le(bytes, pos + 4) as usize;
            let body_start = pos + 8;
            let body_end = (body_start + size).min(bytes.len());
            let body = &bytes[body_start..body_end];

            if id == b"fmt " {
                if body.len() < 16 { return Err("fmt chunk too short"); }
                format = u16le(body, 0);
                channels = u16le(body, 2);
                sample_rate = u32le(body, 4);
                bits = u16le(body, 14);
            } else if id == b"data" {
                data = Some(body);
            }

            // Chunks are word-aligned: an odd-sized chunk has one pad byte.
            pos = body_end + (size & 1);
        }

        if channels == 0 { return Err("no fmt chunk"); }
        let data = data.ok_or("no data chunk")?;
        let (is_float, bytes_per_sample) = match (format, bits) {
            (1, 16) => (false, 2),
            (1, 24) => (false, 3),
            (1, 32) => (false, 4),
            (3, 32) => (true, 4),
            _ => return Err("only PCM16, PCM24, PCM32 and float32 WAV are supported"),
        };

        let channels = channels as usize;
        let frame_bytes = bytes_per_sample * channels;
        if frame_bytes == 0 { return Err("zero-width frame"); }
        let frames = data.len() / frame_bytes;
        if frames > super::IR_MAX_LEN {
            return Err(super::TOO_LONG);
        }

        let ir = unsafe { &mut super::IR };
        for frame in 0..frames {
            let mut sum = 0.0f32;
            for ch in 0..channels {
                let at = frame * frame_bytes + ch * bytes_per_sample;
                let sample = if is_float {
                    f32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]])
                } else if bytes_per_sample == 2 {
                    i16::from_le_bytes([data[at], data[at + 1]]) as f32 / 32768.0
                } else if bytes_per_sample == 3 {
                    // Into the top three bytes of an i32, so the sign comes along.
                    i32::from_le_bytes([0, data[at], data[at + 1], data[at + 2]]) as f32
                        / 2147483648.0
                } else {
                    i32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]]) as f32
                        / 2147483648.0
                };
                sum += sample;
            }
            ir[frame] = sum / channels as f32;
        }

        Ok(Decoded { sample_rate, mono_len: frames })
    }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    unsafe { HOST_SAMPLE_RATE = sample_rate; }
    convolver::prepare();
    // Otherwise nothing to do until a model and an impulse response actually
    // arrive; both loaders below reset every buffer they touch, so a
    // re-init before either asset is loaded is not a distinct state to
    // handle.
}

/// Whether `rate` is close enough to the host's own sample rate to trust
/// without resampling. A percent, not an exact match, because a captured
/// device's declared 48000 and a host's 48000.0 can differ in the last bit
/// without meaning anything.
fn rate_matches(rate: f64) -> bool {
    let host = unsafe { HOST_SAMPLE_RATE } as f64;
    host <= 0.0 || (rate - host).abs() <= host * 0.01
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 { MAX_FRAMES as u32 }

#[no_mangle]
pub extern "C" fn jig_input_ptr(channel: u32) -> u32 {
    unsafe { INPUT[(channel as usize).min(1)].as_ptr() as u32 }
}

#[no_mangle]
pub extern "C" fn jig_output_ptr(channel: u32) -> u32 {
    unsafe { OUTPUT[(channel as usize).min(1)].as_ptr() as u32 }
}

#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    unsafe {
        match index {
            0 => INPUT_TRIM = value,
            1 => OUTPUT_LEVEL = value,
            2 => AMP_ON = value >= 0.5,
            3 => MIX = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}

/// Where the processor writes the .nam file's bytes before calling
/// jig_load_nam. A convention between this module and its own processor,
/// not part of the host contract, the same as plugins/_jsfx-runtime's
/// jig_script_ptr.
#[no_mangle]
pub extern "C" fn jig_nam_ptr() -> u32 { (&raw const NAM_BUF).cast::<u8>() as u32 }
#[no_mangle]
pub extern "C" fn jig_nam_max_len() -> u32 { NAM_BUF_LEN as u32 }

#[no_mangle]
pub extern "C" fn jig_ir_ptr() -> u32 { (&raw const IR_FILE_BUF).cast::<u8>() as u32 }
#[no_mangle]
pub extern "C" fn jig_ir_max_len() -> u32 { IR_FILE_BUF_LEN as u32 }

/// Parse the .nam JSON already copied into NAM_BUF and build the model. Allocates freely: this runs before the host takes any
/// pointer or view, the same step src/jsfx/... 's jig_load_script runs at.
/// Returns 0 on success, 1 if it loaded but the model's own declared sample
/// rate does not match the host's (nam-rs does not resample, so this is a
/// real problem, not a formality), or a negative code on failure to parse
/// or build it at all.
#[no_mangle]
pub extern "C" fn jig_load_nam(len: u32) -> i32 {
    let bytes = unsafe { &NAM_BUF[..(len as usize).min(NAM_BUF_LEN)] };
    let text = match core::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let file = match NamModel::from_json_str(text) {
        Ok(f) => f,
        Err(_) => return -2,
    };
    let matches_host = rate_matches(file.expected_sample_rate());

    {
        let mut model = match Model::from_nam(&file) {
            Ok(m) => m,
            Err(_) => return -3,
        };
        // Settle the WaveNet's dilated history against silence before any
        // real audio reaches it, exactly as nam-rs's own documentation
        // describes: without this the first receptive_field() samples are a
        // startup transient rather than the model's real response.
        let receptive_field = model.receptive_field().min(MAX_FRAMES * 64);
        let mut warmup = [0.0f32; MAX_FRAMES];
        let mut remaining = receptive_field;
        while remaining > 0 {
            let n = remaining.min(MAX_FRAMES);
            model.process_buffer(&mut warmup[..n]);
            remaining -= n;
        }
        unsafe { MODEL = Some(model); }
    }
    if matches_host { 0 } else { 1 }
}

/// Parse the WAV bytes already copied into IR_FILE_BUF, normalise them, and
/// hand them to the convolver.
///
/// Normalised to unit energy, so a response sets the tone and not the level.
/// A cabinet response is roughly unit energy already. A room's is not: a
/// second of reverberation at full scale sums to some twenty-five decibels
/// of gain, which arrives all at once the moment the file is loaded. Returns 0 on success, 1 if it loaded but the WAV's own sample
/// rate does not match the host's (a convolution's taps are timed in
/// samples, so this is wrong for the same reason a mismatched .nam is), or
/// a negative code on a format this plugin's small parser does not
/// understand (-1), a response that is all zeros (-2), or one longer than
/// IR_MAX_LEN (-3).
#[no_mangle]
pub extern "C" fn jig_load_ir(len: u32) -> i32 {
    let bytes = unsafe { &IR_FILE_BUF[..(len as usize).min(IR_FILE_BUF_LEN)] };
    match decode_wav(bytes) {
        Ok(decoded) => {
            let ir = unsafe { &mut IR[..decoded.mono_len] };
            let energy: f64 = ir.iter().map(|&x| (x as f64) * (x as f64)).sum();
            if energy <= 0.0 {
                return -2;
            }
            let scale = (1.0 / energy.sqrt()) as f32;
            for tap in ir.iter_mut() {
                *tap *= scale;
            }
            convolver::load(ir);
            if rate_matches(decoded.sample_rate as f64) { 0 } else { 1 }
        }
        Err(TOO_LONG) => -3,
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    let frames = (frames as usize).min(MAX_FRAMES);
    let (trim, level, amp_on, mix) = unsafe { (INPUT_TRIM, OUTPUT_LEVEL, AMP_ON, MIX) };
    let (input, dry, output) = unsafe { (&INPUT, &mut DRY, &mut OUTPUT) };

    match unsafe { MODEL.as_mut() }.filter(|_| amp_on) {
        Some(model) => {
            let mono = unsafe { &mut MONO[..frames] };
            for n in 0..frames {
                mono[n] = 0.5 * (input[0][n] + input[1][n]) * trim;
            }
            model.process_buffer(mono);
            dry[0][..frames].copy_from_slice(mono);
            dry[1][..frames].copy_from_slice(mono);
        }
        None => {
            for channel in 0..2 {
                for n in 0..frames {
                    dry[channel][n] = input[channel][n] * trim;
                }
            }
        }
    }

    if convolver::loaded() {
        convolver::process(&dry[0][..frames], &dry[1][..frames], output, frames);
        for channel in 0..2 {
            for n in 0..frames {
                output[channel][n] = (dry[channel][n] * (1.0 - mix) + output[channel][n] * mix) * level;
            }
        }
    } else {
        // No impulse response loaded yet: pass the amp stage through rather
        // than producing silence for a reason nothing explains.
        for channel in 0..2 {
            for n in 0..frames {
                output[channel][n] = dry[channel][n] * level;
            }
        }
    }
}
