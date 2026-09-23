// plugins/ferrite/src/lib.rs
//
// A cabinet impulse response and a neural amp model in series: input trim,
// then nam-rs's WaveNet forward pass (the amp and preamp), then a direct
// time-domain convolution against a loaded cabinet impulse response, then
// output level. Two independent mono chains, one per channel, because
// nam_rs::model_runtime::Model holds the WaveNet's own dilated-history
// state and one instance cannot correctly process two unrelated signals.
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

const MAX_FRAMES: usize = 128;
const IR_MAX_LEN: usize = 8192; // 170 ms at 48 kHz. Longer is refused, not truncated.
const HIST_LEN: usize = IR_MAX_LEN + MAX_FRAMES;

struct Chain {
    nam: Option<Model>,
    history: [f32; HIST_LEN],
}

impl Chain {
    const fn new() -> Self {
        Chain { nam: None, history: [0.0; HIST_LEN] }
    }
}

static mut INPUT: [[f32; MAX_FRAMES]; 2] = [[0.0; MAX_FRAMES]; 2];
static mut OUTPUT: [[f32; MAX_FRAMES]; 2] = [[0.0; MAX_FRAMES]; 2];
static mut AMP_SCRATCH: [f32; MAX_FRAMES] = [0.0; MAX_FRAMES];
static mut CHAINS: [Chain; 2] = [Chain::new(), Chain::new()];

static mut IR: [f32; IR_MAX_LEN] = [0.0; IR_MAX_LEN];
static mut IR_LEN: usize = 0;

static mut INPUT_TRIM: f32 = 1.0;
static mut OUTPUT_LEVEL: f32 = 1.0;

// Set once, in jig_init, and read by both loaders below: nam-rs's own
// documentation is explicit that a rate mismatch "produces silently wrong
// output, because dilations and recurrence are defined in samples, not
// seconds", and a cabinet IR captured at another rate has the same problem
// for the same reason. Neither loader resamples; both can at least say so
// rather than let it pass as a load that succeeded.
static mut HOST_SAMPLE_RATE: f32 = 0.0;

const NAM_BUF_LEN: usize = 1 << 20; // 1 MiB: generous for a "standard"-size .nam JSON file.
static mut NAM_BUF: [u8; NAM_BUF_LEN] = [0; NAM_BUF_LEN];
const IR_FILE_BUF_LEN: usize = 1 << 20; // 1 MiB of WAV bytes, before decoding.
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

    /// Parses a PCM16 or IEEE-float32 WAV file, mixes every channel to mono
    /// by averaging, and writes the result into `super::IR`. Returns the
    /// sample rate the file declared and the number of samples written.
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
            (1, 32) => (false, 4),
            (3, 32) => (true, 4),
            _ => return Err("only PCM16, PCM32 and float32 WAV are supported"),
        };

        let channels = channels as usize;
        let frame_bytes = bytes_per_sample * channels;
        if frame_bytes == 0 { return Err("zero-width frame"); }
        let frames = data.len() / frame_bytes;
        if frames > super::IR_MAX_LEN {
            return Err("impulse response is longer than this plugin's buffer");
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

/// A block of direct time-domain convolution against the loaded IR, reading
/// and writing through a fixed-size shift buffer. O(IR_LEN) per output
/// sample, which at IR_MAX_LEN is a bound this plugin's own README states
/// the CPU cost of, not a claim that any length is free.
fn convolve(history: &mut [f32; HIST_LEN], input: &[f32], output: &mut [f32], ir: &[f32]) {
    let frames = input.len();
    // Shift the window left by `frames` and append the new block at the end.
    history.copy_within(frames.., 0);
    history[HIST_LEN - frames..].copy_from_slice(input);

    let ir_len = ir.len();
    for n in 0..frames {
        let end = HIST_LEN - frames + n + 1; // one past the sample aligned with ir[0]
        let start = end.saturating_sub(ir_len);
        let taps = &history[start..end];
        let ir_taps = &ir[..taps.len()];
        let mut acc = 0.0f32;
        for (h, k) in taps.iter().rev().zip(ir_taps.iter()) {
            acc += h * k;
        }
        output[n] = acc;
    }
}

#[no_mangle]
pub extern "C" fn jig_init(sample_rate: f32) {
    unsafe { HOST_SAMPLE_RATE = sample_rate; }
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

/// Parse the .nam JSON already copied into NAM_BUF and build both channels'
/// models from it. Allocates freely: this runs before the host takes any
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

    for chain in unsafe { CHAINS.iter_mut() } {
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
        chain.history = [0.0; HIST_LEN];
        chain.nam = Some(model);
    }
    if matches_host { 0 } else { 1 }
}

/// Parse the WAV bytes already copied into IR_FILE_BUF into the shared IR
/// kernel. Returns 0 on success, 1 if it loaded but the WAV's own sample
/// rate does not match the host's (a convolution's taps are timed in
/// samples, so this is wrong for the same reason a mismatched .nam is), or
/// a negative code on a format this plugin's small parser does not
/// understand or an impulse response longer than IR_MAX_LEN.
#[no_mangle]
pub extern "C" fn jig_load_ir(len: u32) -> i32 {
    let bytes = unsafe { &IR_FILE_BUF[..(len as usize).min(IR_FILE_BUF_LEN)] };
    match decode_wav(bytes) {
        Ok(decoded) => {
            unsafe { IR_LEN = decoded.mono_len; }
            if rate_matches(decoded.sample_rate as f64) { 0 } else { 1 }
        }
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    let frames = (frames as usize).min(MAX_FRAMES);
    let (input_trim, output_level, ir_len) = unsafe { (INPUT_TRIM, OUTPUT_LEVEL, IR_LEN) };
    let ir: &[f32] = unsafe { &IR[..ir_len] };

    for channel in 0..2 {
        let amp = unsafe { &mut AMP_SCRATCH[..frames] };
        for (a, x) in amp.iter_mut().zip(unsafe { INPUT[channel][..frames].iter() }) {
            *a = x * input_trim;
        }

        let chain = unsafe { &mut CHAINS[channel] };
        if let Some(model) = chain.nam.as_mut() {
            model.process_buffer(amp);
        }

        let output = unsafe { &mut OUTPUT[channel][..frames] };
        if ir_len > 0 {
            convolve(&mut chain.history, amp, output, ir);
        } else {
            // No impulse response loaded yet: pass the amp stage through
            // rather than producing silence for a reason nothing explains.
            output.copy_from_slice(amp);
        }
        for o in output.iter_mut() {
            *o *= output_level;
        }
    }
}
