# The JSFX runtime

Not a plugin: the shared bytecode VM `bin/jsfx-import.js` copies into every JSFX effect it
converts, and the module every converted plugin's `profile.ttl` declares as `jig:module`. See
[bin/jsfx-import.js](../../bin/jsfx-import.js), [src/jsfx/](../../src/jsfx/) and, for the
three worked examples, [examples/jsfx/](../../examples/jsfx/).

## What this runs

REAPER JSFX effects are EEL2 script, not compiled code, so converting one means running its
`@init`/`@slider`/`@block`/`@sample` sections inside a JigDAW plugin's real-time sandbox
rather than wrapping a binary. `src/jsfx/HeaderParser.js` reads the file's header and splits
its sections apart; `src/jsfx/Parser.js` parses each section's EEL2 into an AST; the compiler,
`src/jsfx/Compiler.js`, walks that AST into the bytecode `src/lib.rs`'s VM executes. The two
files are the one place the bytecode format, the opcode numbers and the reserved variable
registers are allowed to change, and must agree exactly, which is what
[tests/dsp/jsfx-runtime.test.js](../../tests/dsp/jsfx-runtime.test.js) checks by running real
compiled scripts through the real built VM rather than asserting on either side alone.

`spl0`/`spl1`, `srate`, `num_ch`, `samplesblock` and `slider1`..`slider64` are pre-seeded into
the VM's variable registers at the same fixed slots the host writes into and reads from, so a
script referring to them reaches the actual audio and the actual slider values.

## What is deliberately not covered

This is a restricted subset, proven against three original example effects
([examples/jsfx/](../../examples/jsfx/)) rather than claimed complete against arbitrary JSFX.
Each of the following is a real EEL2 or JSFX feature, not an oversight, and each is its own
future chunk of interpreter work should a converted effect need it:

- **User-defined `function`.** Every variable is one global register, allocated at compile
  time; there is no call stack or local scope to give a function its own.
- **Strings**, and therefore `#`-prefixed string variables and the string functions.
- **`@gfx` and `@serialize`.** Graphics have nowhere to draw in an AudioWorklet, and nothing
  here persists a plugin's extended state yet.
- **`gmem`**, the memory an effect can share with other instances of itself. Only the
  per-instance local memory array (`x[y]`) is implemented, fixed size and preallocated like
  everything else here.
- **The two-parenthesis-group form of `while`**, `while(cond) (body)`. The one-argument form,
  `while(body)`, continuing until its last statement is zero, is supported.
- **Hex and character literals** (`$x10`, `$'a'`), and **case-insensitive identifiers**: real
  EEL2 treats `Gain` and `gain` as the same variable; this parser does not.

A script using any of these fails to parse or to compile, with a message naming what it used,
rather than silently doing something other than what the original REAPER effect did.

## Real-time safety

Every buffer (the compiled program, the variable registers, the local memory array, the
operand stack) is fixed size and preallocated as part of the module's static memory, the
same discipline `plugins/cascade/src/lib.rs`'s comb and allpass buffers follow. There is no
per-construct loop bound either: `jig_process` spends one fixed instruction budget
(`STEP_BUDGET` in `src/lib.rs`) across `@block` and every `@sample` in the block, and a script
that would exceed it simply stops running for the rest of that block rather than missing the
audio thread's deadline. The frames a runaway script did not reach are written as silence,
never left stale, per contract section 4.2.

This crate depends on `libm`, unlike every sibling plugin here. `src/lib.rs`'s module
comment has the reasoning: a script calling `sin()`, `exp()` or `atan2()` has no adequate
linear mapping to fall back to, the way Cascade's damping or Pulse's pitch ratios did.
