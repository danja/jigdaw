// plugins/ferrite/src/convolver.rs
//
// Convolution against a loaded impulse response of up to IR_MAX_LEN samples,
// with no added latency, allocating nothing after load.
//
// The first HEAD taps are convolved directly, sample by sample, as the whole
// convolution used to be. Everything after them is done in the frequency
// domain, as uniformly partitioned overlap-save convolution (Stockham 1966;
// the standard description is Wefers, "Partitioned convolution algorithms
// for real-time auralization", 2015): the tail is cut into HEAD-sample
// partitions, each transformed once at load, and every HEAD input samples one
// FFT, one sum of products against a delay line of past input spectra, and
// one inverse FFT produce the tail's next HEAD output samples. The tail
// starts HEAD samples into the response, which is exactly the time it takes
// to collect one partition of input, so its output arrives when it is due
// and the direct head covers the rest. Direct convolution of a one second
// response costs some two billion multiply-adds a second; this is a few
// percent of that.
//
// Both channels share one complex transform: left in the real part, right in
// the imaginary part. The response is real, so its spectrum multiplies each
// part independently and the inverse transform hands them back separated.
// One transform per partition instead of two.

pub const HEAD: usize = 256;
const N: usize = 2 * HEAD;
pub const IR_MAX_LEN: usize = 1 << 17; // 2.73 s at 48 kHz.
const MAX_PARTS: usize = (IR_MAX_LEN - HEAD + HEAD - 1) / HEAD;
pub const MAX_FRAMES: usize = 128;
const HIST_LEN: usize = HEAD + MAX_FRAMES;

#[derive(Clone, Copy)]
struct C {
    re: f32,
    im: f32,
}

const Z: C = C { re: 0.0, im: 0.0 };

static mut TWIDDLE: [C; N / 2] = [Z; N / 2];
static mut REVERSED: [u16; N] = [0; N];

static mut HEAD_IR: [f32; HEAD] = [0.0; HEAD];
static mut HEAD_LEN: usize = 0;
static mut PARTS: usize = 0;
static mut SPECTRA: [[C; N]; MAX_PARTS] = [[Z; N]; MAX_PARTS];

static mut HISTORY: [[f32; HIST_LEN]; 2] = [[0.0; HIST_LEN]; 2];
static mut DELAY_LINE: [[C; N]; MAX_PARTS] = [[Z; N]; MAX_PARTS];
static mut NEWEST: usize = 0;
static mut PREVIOUS: [C; HEAD] = [Z; HEAD];
static mut COLLECTING: [C; HEAD] = [Z; HEAD];
static mut TAIL: [C; HEAD] = [Z; HEAD];
static mut POSITION: usize = 0;
static mut WORK: [C; N] = [Z; N];

/// Twiddle factors and the bit-reversal permutation. Called once from
/// jig_init: the only trigonometry in this file, and never on the audio path.
pub fn prepare() {
    let bits = N.trailing_zeros();
    unsafe {
        for k in 0..N / 2 {
            let angle = -2.0 * core::f64::consts::PI * k as f64 / N as f64;
            TWIDDLE[k] = C { re: angle.cos() as f32, im: angle.sin() as f32 };
        }
        for i in 0..N {
            REVERSED[i] = ((i as u32).reverse_bits() >> (32 - bits)) as u16;
        }
    }
}

/// In place, radix 2. The inverse is unscaled; the caller divides by N.
fn fft(buffer: &mut [C; N], inverse: bool) {
    let (twiddle, reversed) = unsafe { (&TWIDDLE, &REVERSED) };
    for i in 0..N {
        let j = reversed[i] as usize;
        if j > i {
            buffer.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= N {
        let half = len / 2;
        let step = N / len;
        let mut start = 0;
        while start < N {
            for k in 0..half {
                let w = twiddle[k * step];
                let w_im = if inverse { -w.im } else { w.im };
                let a = buffer[start + k];
                let b = buffer[start + k + half];
                let t = C { re: b.re * w.re - b.im * w_im, im: b.re * w_im + b.im * w.re };
                buffer[start + k] = C { re: a.re + t.re, im: a.im + t.im };
                buffer[start + k + half] = C { re: a.re - t.re, im: a.im - t.im };
            }
            start += len;
        }
        len <<= 1;
    }
}

/// Take a new response, already decoded and normalised, and transform its
/// tail. Clears all running state, so the old response's reverberation does
/// not ring on through the new one. Not called from jig_process.
pub fn load(ir: &[f32]) {
    let len = ir.len().min(IR_MAX_LEN);
    unsafe {
        HEAD_LEN = len.min(HEAD);
        HEAD_IR = [0.0; HEAD];
        HEAD_IR[..HEAD_LEN].copy_from_slice(&ir[..HEAD_LEN]);

        PARTS = if len > HEAD { (len - HEAD + HEAD - 1) / HEAD } else { 0 };
        for part in 0..PARTS {
            let from = HEAD + part * HEAD;
            let to = (from + HEAD).min(len);
            let spectrum = &mut SPECTRA[part];
            *spectrum = [Z; N];
            for (slot, &tap) in spectrum.iter_mut().zip(ir[from..to].iter()) {
                slot.re = tap;
            }
            fft(spectrum, false);
        }

        HISTORY = [[0.0; HIST_LEN]; 2];
        for part in 0..PARTS {
            DELAY_LINE[part] = [Z; N];
        }
        NEWEST = 0;
        PREVIOUS = [Z; HEAD];
        COLLECTING = [Z; HEAD];
        TAIL = [Z; HEAD];
        POSITION = 0;
    }
}

pub fn loaded() -> bool {
    unsafe { HEAD_LEN > 0 }
}

/// Direct convolution of one channel's block against the head taps, through a
/// shift buffer holding the last HEAD inputs.
fn convolve_head(history: &mut [f32; HIST_LEN], input: &[f32], output: &mut [f32], taps: &[f32]) {
    let frames = input.len();
    history.copy_within(frames.., 0);
    history[HIST_LEN - frames..].copy_from_slice(input);
    for n in 0..frames {
        let end = HIST_LEN - frames + n + 1;
        let window = &history[end - taps.len()..end];
        let mut acc = 0.0f32;
        for (h, k) in window.iter().rev().zip(taps.iter()) {
            acc += h * k;
        }
        output[n] = acc;
    }
}

/// One partition of input has been collected: the tail's next HEAD outputs.
fn advance_tail() {
    unsafe {
        let parts = PARTS;
        let work = &mut WORK;
        work[..HEAD].copy_from_slice(&PREVIOUS);
        work[HEAD..].copy_from_slice(&COLLECTING);
        PREVIOUS = COLLECTING;
        fft(work, false);

        NEWEST = if NEWEST == 0 { parts - 1 } else { NEWEST - 1 };
        DELAY_LINE[NEWEST] = *work;

        *work = [Z; N];
        for part in 0..parts {
            let input = &DELAY_LINE[(NEWEST + part) % parts];
            let response = &SPECTRA[part];
            for bin in 0..N {
                let x = input[bin];
                let h = response[bin];
                work[bin].re += x.re * h.re - x.im * h.im;
                work[bin].im += x.re * h.im + x.im * h.re;
            }
        }
        fft(work, true);
        let scale = 1.0 / N as f32;
        for n in 0..HEAD {
            TAIL[n] = C { re: work[HEAD + n].re * scale, im: work[HEAD + n].im * scale };
        }
    }
}

/// Convolve a stereo block. `left` and `right` in, `wet` out, `frames` at most
/// MAX_FRAMES. Allocates nothing.
pub fn process(left: &[f32], right: &[f32], wet: &mut [[f32; MAX_FRAMES]; 2], frames: usize) {
    unsafe {
        let taps = &HEAD_IR[..HEAD_LEN];
        convolve_head(&mut HISTORY[0], &left[..frames], &mut wet[0][..frames], taps);
        convolve_head(&mut HISTORY[1], &right[..frames], &mut wet[1][..frames], taps);
        if PARTS == 0 {
            return;
        }
        for n in 0..frames {
            wet[0][n] += TAIL[POSITION].re;
            wet[1][n] += TAIL[POSITION].im;
            COLLECTING[POSITION] = C { re: left[n], im: right[n] };
            POSITION += 1;
            if POSITION == HEAD {
                POSITION = 0;
                advance_tail();
            }
        }
    }
}
