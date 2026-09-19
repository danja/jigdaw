// plugins/_jsfx-runtime/src/lib.rs
//
// A small stack-based bytecode VM for a restricted subset of Cockos's EEL2, the
// language REAPER JSFX effects are written in. Not a plugin itself: every
// converted JSFX effect gets its own profile pointing at a copy of this same
// module, with the compiled bytecode for ITS script delivered as a jig:asset
// (see src/jsfx/Compiler.js, which is what emits the bytecode format this reads).
//
// #![no_std], no allocator: the same real-time discipline as every other
// plugin here. The bytecode program, the variable registers, the local memory
// array and the operand stack are all fixed-size buffers, preallocated as part
// of this module's static memory, exactly like cascade's comb and allpass
// buffers. There is no dynamic loop bound either: jig_process spends a fixed
// instruction budget per call (STEP_BUDGET below) and simply stops running the
// script, rather than the block, if a script's @sample or @block section would
// otherwise run unbounded. REAPER itself caps loop()/while() around a million
// iterations for the same reason; this is tighter, because unlike REAPER this
// runs inside a render quantum with a real deadline.
//
// One deliberate departure from every sibling plugin: this crate depends on
// `libm`, a pure-Rust, no_std, allocation-free reimplementation of the C math
// library. Cascade and Pulse avoided needing one by choosing DSP that a linear
// mapping or a small lookup table covers adequately for what they specifically
// do. That choice does not exist here: an EEL2 script is arbitrary user code
// that calls sin(), cos(), exp(), log(), atan2() and expects real trigonometry
// and logarithms, not an approximation tuned for one other plugin's needs.
// Getting those wrong is not a rounding error, it is a JSFX effect that does
// not sound like the one it was converted from. libm is deterministic, bounded
// and allocates nothing, so it costs this crate nothing real-time rules
// protect against; it costs only the zero-dependency convention every other
// plugin here happens to have been able to keep.

#![no_std]

use core::cell::UnsafeCell;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const MAX_FRAMES: usize = 128;
const CHANNELS: usize = 2;

const MAX_PROGRAM_BYTES: usize = 16384;
const MAX_VARS: usize = 256;
const MAX_MEM: usize = 4096;
const MAX_STACK: usize = 64;

// Every instruction dispatched, across @init/@slider/@block and every @sample
// in the block, counts against this one budget per jig_process call. Reset at
// the start of each call. Generous for anything a simple effect script does
// (tens of thousands of instructions per block is already far more than a
// gain, a filter or a waveshaper needs) while still being a hard, checked
// bound rather than a hope.
const STEP_BUDGET: u32 = 200_000;

// Reserved variable register layout. A converted script's identifiers are
// mapped onto this file at compile time (src/jsfx/Compiler.js), never looked
// up by name at run time.
const REG_SLIDER_BASE: usize = 0; // slider1..slider64 -> 0..63
const REG_SPL_BASE: usize = 64; // spl0, spl1 -> 64, 65
const REG_SRATE: usize = 66;
const REG_NUM_CH: usize = 67;
const REG_SAMPLESBLOCK: usize = 68;
pub const REG_USER_BASE: usize = 69; // user-declared variables start here

// Opcodes. Each instruction is a one-byte tag, optionally followed by a fixed
// number of operand bytes (never a length prefix, so decoding needs no
// lookahead beyond the tag itself).
const OP_HALT: u8 = 0;
const OP_PUSH: u8 = 1; // + 8 bytes: f64 little-endian
const OP_LOAD: u8 = 2; // + 2 bytes: u16 var index
const OP_STORE: u8 = 3; // + 2 bytes: u16 var index; leaves the stored value on the stack
const OP_POP: u8 = 4;
const OP_ADD: u8 = 5;
const OP_SUB: u8 = 6;
const OP_MUL: u8 = 7;
const OP_DIV: u8 = 8;
const OP_MOD: u8 = 9;
const OP_POW: u8 = 10;
const OP_NEG: u8 = 11;
const OP_NOT: u8 = 12;
const OP_EQ: u8 = 13;
const OP_NE: u8 = 14;
const OP_LT: u8 = 15;
const OP_GT: u8 = 16;
const OP_LE: u8 = 17;
const OP_GE: u8 = 18;
const OP_JUMP: u8 = 19; // + 4 bytes: u32 absolute offset into the section
const OP_JUMPZ: u8 = 20; // pops condition; + 4 bytes
const OP_JUMPNZ: u8 = 21; // pops condition; + 4 bytes
const OP_CALL: u8 = 22; // + 1 byte: function id, arity fixed per id (see call_builtin)
const OP_LOADMEM: u8 = 23; // pops index, pushes mem[index]
const OP_STOREMEM: u8 = 24; // pops value, pops index, mem[index] = value, pushes value
const OP_TRUNC: u8 = 25; // truncate top of stack toward zero

struct State {
    input: [[f32; MAX_FRAMES]; CHANNELS],
    output: [[f32; MAX_FRAMES]; CHANNELS],
    sample_rate: f32,

    program: [u8; MAX_PROGRAM_BYTES],
    program_len: usize,
    // Offsets into `program` for each section, set by jig_load_script from the
    // 16-byte header the compiled script begins with. A zero length means the
    // section is absent (an effect with no @block, say) and is skipped.
    init_off: u32,
    init_len: u32,
    slider_off: u32,
    slider_len: u32,
    block_off: u32,
    block_len: u32,
    sample_off: u32,
    sample_len: u32,

    vars: [f64; MAX_VARS],
    mem: [f64; MAX_MEM],
    stack: [f64; MAX_STACK],
    sp: usize,

    slider_dirty: bool,
    rand_state: u32,
}

impl State {
    const fn new() -> Self {
        Self {
            input: [[0.0; MAX_FRAMES]; CHANNELS],
            output: [[0.0; MAX_FRAMES]; CHANNELS],
            sample_rate: 44100.0,
            program: [0; MAX_PROGRAM_BYTES],
            program_len: 0,
            init_off: 0,
            init_len: 0,
            slider_off: 0,
            slider_len: 0,
            block_off: 0,
            block_len: 0,
            sample_off: 0,
            sample_len: 0,
            vars: [0.0; MAX_VARS],
            mem: [0.0; MAX_MEM],
            stack: [0.0; MAX_STACK],
            sp: 0,
            slider_dirty: true,
            rand_state: 0x9E3779B9,
        }
    }

    #[inline]
    fn push(&mut self, v: f64) {
        if self.sp < MAX_STACK {
            self.stack[self.sp] = v;
            self.sp += 1;
        }
    }

    #[inline]
    fn pop(&mut self) -> f64 {
        if self.sp == 0 {
            return 0.0;
        }
        self.sp -= 1;
        self.stack[self.sp]
    }

    fn rand(&mut self, max: f64) -> f64 {
        // xorshift32. Deterministic, which is what a reproducible offline test
        // wants; advancing every call is what makes it look random in use.
        let mut x = self.rand_state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.rand_state = x;
        (x as f64 / u32::MAX as f64) * max
    }

    /// Run one section (by byte offset and length within `program`), spending
    /// from `*budget` and returning early, leaving whatever the stack holds,
    /// if it runs out. Never panics, never indexes out of bounds: every
    /// operand and every stack access is clamped, because a malformed or
    /// truncated script must degrade to doing less, not to a trap.
    fn run(&mut self, offset: u32, len: u32, budget: &mut u32) {
        if len == 0 {
            return;
        }
        let start = offset as usize;
        let end = (start + len as usize).min(self.program_len);
        let mut pc = start;

        while pc < end {
            if *budget == 0 {
                return;
            }
            *budget -= 1;

            let op = self.program[pc];
            pc += 1;

            match op {
                OP_HALT => return,
                OP_PUSH => {
                    let mut bytes = [0u8; 8];
                    bytes.copy_from_slice(&self.program[pc..pc + 8]);
                    self.push(f64::from_le_bytes(bytes));
                    pc += 8;
                }
                OP_LOAD => {
                    let idx = u16::from_le_bytes([self.program[pc], self.program[pc + 1]]) as usize;
                    pc += 2;
                    self.push(self.vars[idx.min(MAX_VARS - 1)]);
                }
                OP_STORE => {
                    let idx = u16::from_le_bytes([self.program[pc], self.program[pc + 1]]) as usize;
                    pc += 2;
                    let v = self.pop();
                    self.vars[idx.min(MAX_VARS - 1)] = v;
                    self.push(v);
                }
                OP_POP => { self.pop(); }
                OP_ADD => { let b = self.pop(); let a = self.pop(); self.push(a + b); }
                OP_SUB => { let b = self.pop(); let a = self.pop(); self.push(a - b); }
                OP_MUL => { let b = self.pop(); let a = self.pop(); self.push(a * b); }
                OP_DIV => {
                    let b = self.pop(); let a = self.pop();
                    self.push(if b == 0.0 { 0.0 } else { a / b });
                }
                OP_MOD => {
                    let b = self.pop(); let a = self.pop();
                    let bi = b as i64;
                    self.push(if bi == 0 { 0.0 } else { ((a as i64) % bi) as f64 });
                }
                OP_POW => { let b = self.pop(); let a = self.pop(); self.push(libm::pow(a, b)); }
                OP_NEG => { let a = self.pop(); self.push(-a); }
                OP_NOT => { let a = self.pop(); self.push(if a == 0.0 { 1.0 } else { 0.0 }); }
                OP_EQ => { let b = self.pop(); let a = self.pop(); self.push(bool01(libm::fabs(a - b) < 0.00001)); }
                OP_NE => { let b = self.pop(); let a = self.pop(); self.push(bool01(libm::fabs(a - b) >= 0.00001)); }
                OP_LT => { let b = self.pop(); let a = self.pop(); self.push(bool01(a < b)); }
                OP_GT => { let b = self.pop(); let a = self.pop(); self.push(bool01(a > b)); }
                OP_LE => { let b = self.pop(); let a = self.pop(); self.push(bool01(a <= b)); }
                OP_GE => { let b = self.pop(); let a = self.pop(); self.push(bool01(a >= b)); }
                OP_JUMP => {
                    let target = read_u32(&self.program, pc);
                    pc = start + (target as usize);
                }
                OP_JUMPZ => {
                    let target = read_u32(&self.program, pc);
                    pc += 4;
                    if self.pop() == 0.0 { pc = start + (target as usize); }
                }
                OP_JUMPNZ => {
                    let target = read_u32(&self.program, pc);
                    pc += 4;
                    if self.pop() != 0.0 { pc = start + (target as usize); }
                }
                OP_CALL => {
                    let id = self.program[pc];
                    pc += 1;
                    self.call_builtin(id);
                }
                OP_LOADMEM => {
                    let idx = self.pop();
                    let i = clamp_index(idx, MAX_MEM);
                    self.push(self.mem[i]);
                }
                OP_STOREMEM => {
                    let idx = self.pop();
                    let v = self.pop();
                    let i = clamp_index(idx, MAX_MEM);
                    self.mem[i] = v;
                    self.push(v);
                }
                OP_TRUNC => {
                    let a = self.pop();
                    self.push(libm::trunc(a));
                }
                _ => return, // an unrecognised opcode is a corrupt script; stop rather than guess
            }
        }
    }

    fn call_builtin(&mut self, id: u8) {
        // Arity is fixed per function: how many operands CALL consumes is
        // decided here, by id, and matched by src/jsfx/Compiler.js when it
        // emits a call.
        match id {
            0 => { let x = self.pop(); self.push(libm::sin(x)); }
            1 => { let x = self.pop(); self.push(libm::cos(x)); }
            2 => { let x = self.pop(); self.push(libm::tan(x)); }
            3 => { let x = self.pop(); self.push(libm::asin(x)); }
            4 => { let x = self.pop(); self.push(libm::acos(x)); }
            5 => { let x = self.pop(); self.push(libm::atan(x)); }
            6 => { let y = self.pop(); let x = self.pop(); self.push(libm::atan2(x, y)); }
            7 => { let x = self.pop(); self.push(libm::exp(x)); }
            8 => { let y = self.pop(); let x = self.pop(); self.push(libm::pow(x, y)); }
            9 => { let x = self.pop(); self.push(libm::log(x)); }
            10 => { let x = self.pop(); self.push(libm::log10(x)); }
            11 => { let x = self.pop(); self.push(libm::sqrt(x.max(0.0))); }
            12 => { let x = self.pop(); self.push(x * x); }
            13 => { let x = self.pop(); self.push(libm::fabs(x)); }
            14 => { let b = self.pop(); let a = self.pop(); self.push(if a < b { a } else { b }); }
            15 => { let b = self.pop(); let a = self.pop(); self.push(if a > b { a } else { b }); }
            16 => { let x = self.pop(); self.push(if x > 0.0 { 1.0 } else if x < 0.0 { -1.0 } else { 0.0 }); }
            17 => { let x = self.pop(); self.push(libm::floor(x)); }
            18 => { let x = self.pop(); self.push(libm::ceil(x)); }
            19 => { let x = self.pop(); self.push(if x > 0.0 { 1.0 / libm::sqrt(x) } else { 0.0 }); }
            20 => { let max = self.pop(); let v = self.rand(max); self.push(v); }
            _ => self.push(0.0),
        }
    }
}

#[inline]
fn bool01(b: bool) -> f64 { if b { 1.0 } else { 0.0 } }

#[inline]
fn read_u32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

#[inline]
fn clamp_index(idx: f64, max: usize) -> usize {
    if idx <= 0.0 { 0 } else if idx as usize >= max { max - 1 } else { idx as usize }
}

struct Shared(UnsafeCell<State>);
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
    s.rand_state = (sample_rate as u32).wrapping_mul(2654435761).wrapping_add(1);
}

#[no_mangle]
pub extern "C" fn jig_input_ptr(channel: u32) -> *mut f32 {
    state().input[(channel as usize).min(CHANNELS - 1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_output_ptr(channel: u32) -> *mut f32 {
    state().output[(channel as usize).min(CHANNELS - 1)].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_max_frames() -> u32 { MAX_FRAMES as u32 }

/// Where the host writes a compiled script's bytes before calling
/// jig_load_script. A fixed buffer, sized generously for the restricted
/// subset this VM runs (see the module comment): nothing here ever grows it.
#[no_mangle]
pub extern "C" fn jig_script_ptr() -> *mut u8 {
    state().program.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn jig_script_max_len() -> u32 { MAX_PROGRAM_BYTES as u32 }

/// Parse the 16-byte section header src/jsfx/Compiler.js writes ahead of the
/// bytecode, reset every register and memory cell, and run @init once. Called
/// after the host has written `len` bytes at jig_script_ptr().
#[no_mangle]
pub extern "C" fn jig_load_script(len: u32) {
    let s = state();
    s.program_len = (len as usize).min(MAX_PROGRAM_BYTES);
    if s.program_len < 16 {
        s.program_len = 0;
        return;
    }
    s.init_off = read_u32(&s.program, 0);
    s.init_len = read_u32(&s.program, 4);
    s.slider_off = read_u32(&s.program, 8);
    s.slider_len = read_u32(&s.program, 12);
    // A second header quad follows for @block/@sample, immediately after the
    // first: the format is 8 u32s total, not 4, so the offsets below read past
    // the first 16 bytes deliberately.
    s.block_off = read_u32(&s.program, 16);
    s.block_len = read_u32(&s.program, 20);
    s.sample_off = read_u32(&s.program, 24);
    s.sample_len = read_u32(&s.program, 28);

    for v in s.vars.iter_mut() { *v = 0.0; }
    for m in s.mem.iter_mut() { *m = 0.0; }
    s.sp = 0;
    s.slider_dirty = true;

    let mut budget = STEP_BUDGET;
    s.run(s.init_off, s.init_len, &mut budget);
}

/// A slider moved. Stored immediately; @slider itself runs at the start of
/// the next jig_process, once per block no matter how many sliders changed,
/// matching REAPER's own "after @init or when slider parameter changes."
#[no_mangle]
pub extern "C" fn jig_set_param(index: u32, value: f32) {
    let s = state();
    let i = REG_SLIDER_BASE + (index as usize).min(63);
    s.vars[i] = value as f64;
    s.slider_dirty = true;
}

#[no_mangle]
pub extern "C" fn jig_process(frames: u32) {
    let s = state();
    let frames = (frames as usize).min(MAX_FRAMES);
    let mut budget = STEP_BUDGET;

    if s.slider_dirty {
        s.slider_dirty = false;
        s.run(s.slider_off, s.slider_len, &mut budget);
    }

    s.vars[REG_SRATE] = s.sample_rate as f64;
    s.vars[REG_NUM_CH] = CHANNELS as f64;
    s.vars[REG_SAMPLESBLOCK] = frames as f64;

    s.run(s.block_off, s.block_len, &mut budget);

    for frame in 0..frames {
        s.vars[REG_SPL_BASE] = s.input[0][frame] as f64;
        s.vars[REG_SPL_BASE + 1] = s.input[1][frame] as f64;

        s.run(s.sample_off, s.sample_len, &mut budget);

        s.output[0][frame] = s.vars[REG_SPL_BASE] as f32;
        s.output[1][frame] = s.vars[REG_SPL_BASE + 1] as f32;

        if budget == 0 {
            // Out of budget mid-block: the frames already written stand: the
            // rest are silence, contract section 4.2's "write zeroes where
            // there is nothing to say", not stale or uninitialised.
            for later in (frame + 1)..frames {
                s.output[0][later] = 0.0;
                s.output[1][later] = 0.0;
            }
            break;
        }
    }
}
