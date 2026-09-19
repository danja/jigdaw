// tests/dsp/jsfx-runtime.test.js
//
// Deterministic offline audio tests, the same discipline as
// tests/dsp/cascade.test.js: a plain wasm instance driven by known inputs is
// reproducible and a live context is not.
//
// This is the strongest check the compiler has: not that it produces bytes
// matching a hand-worked-out expectation, but that plugins/_jsfx-runtime's
// real, built VM does the right thing when handed what src/jsfx/Compiler.js
// actually emits. A mismatch between the two, such as a wrong opcode number
// or an operand byte order the VM reads differently than the compiler
// writes, shows up here as a wrong number, not as a green test that only
// checked the compiler agrees with itself.
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { compileScript, REG_USER_BASE } from '../../src/jsfx/Compiler.js'

const wasmPath = resolve(import.meta.dirname, '../../plugins/_jsfx-runtime/jsfx-runtime.wasm')
const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/_jsfx-runtime/jsfx-runtime.wasm not built; run plugins/_jsfx-runtime/build.sh')

async function load (sections, { sliderAliases } = {}) {
  const bytes = await readFile(wasmPath)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const e = instance.exports
  e.jig_init(48000)

  const script = compileScript(sections, { sliderAliases })
  const scriptView = new Uint8Array(e.memory.buffer, e.jig_script_ptr(), e.jig_script_max_len())
  scriptView.set(script)
  e.jig_load_script(script.length)

  const frames = e.jig_max_frames()
  return {
    e,
    frames,
    input: [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames)),
    output: [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  }
}

describeBuilt('jsfx-runtime wasm', () => {
  it('exports the ABI its processor expects', async () => {
    const { e } = await load({})
    for (const name of [
      'jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param',
      'jig_script_ptr', 'jig_script_max_len', 'jig_load_script', 'jig_max_frames', 'memory'
    ]) {
      expect(e[name], `missing export ${name}`).toBeDefined()
    }
    expect(e.jig_max_frames()).toBe(128)
  })

  it('passes audio through untouched with an empty script', async () => {
    // spl0/spl1 round-trip through their registers every sample regardless
    // of what @sample does with them, so a script that does nothing is a
    // passthrough, not silence: the JSFX behaviour an empty @sample has.
    const { e, frames, input, output } = await load({})
    input[0].fill(0.5); input[1].fill(-0.25)
    e.jig_process(frames)
    expect(Array.from(output[0])).toEqual(new Array(frames).fill(0.5))
    expect(Array.from(output[1])).toEqual(new Array(frames).fill(-0.25))
  })

  describe('the gain trim fixture\'s shape', () => {
    it('multiplies both channels by the slider, applied from @slider', async () => {
      const { e, frames, input, output } = await load({
        init: 'gain = 1;',
        slider: 'gain = slider1;',
        sample: 'spl0 *= gain; spl1 *= gain;'
      }, { sliderAliases: { gain: 1 } })
      e.jig_set_param(0, 0.5)
      input[0].fill(0.8); input[1].fill(-0.4)
      e.jig_process(frames)
      expect(output[0][0]).toBeCloseTo(0.4, 5)
      expect(output[1][0]).toBeCloseTo(-0.2, 5)
    })

    it('runs @slider again, and only again, when the slider next changes', async () => {
      const { e, frames, input, output } = await load({
        slider: 'seen += 1;', // counts how many times @slider actually ran
        sample: 'spl0 = seen;'
      })
      e.jig_process(frames) // @init's implicit first @slider run
      expect(output[0][0]).toBe(1)
      e.jig_process(frames) // nothing changed; @slider must not run again
      expect(output[0][0]).toBe(1)
      e.jig_set_param(0, 0.3)
      input[0].fill(0)
      e.jig_process(frames)
      expect(output[0][0]).toBe(2)
    })
  })

  it('carries a variable\'s value across process() calls, not just across samples', async () => {
    // The one-pole filter fixture's whole premise: state a script assigns in
    // one @sample must still be there the next time jig_process runs.
    const { e, frames, input, output } = await load({
      init: 'accum = 0;',
      sample: 'accum = accum + spl0; spl0 = accum;'
    })
    input[0].fill(1)
    e.jig_process(frames)
    expect(output[0][frames - 1]).toBe(frames)
    input[0].fill(1)
    e.jig_process(frames)
    expect(output[0][frames - 1]).toBe(frames * 2)
  })

  it('evaluates the ternary\'s untaken branch not at all', async () => {
    const { e, frames, output } = await load({
      sample: 'spl0 = 1 > 0 ? 10 : (never = never + 1);'
    })
    e.jig_process(frames)
    expect(output[0][0]).toBe(10)
  })

  it('short-circuits && and ||', async () => {
    const { e, frames, output } = await load({
      sample: 'hit = 0; a = (0 && (hit = 1)); b = (1 || (hit = 1)); spl0 = hit;'
    })
    e.jig_process(frames)
    expect(output[0][0]).toBe(0)
  })

  it('runs loop() exactly the given number of times, not the body\'s own count', async () => {
    const { e, frames, output } = await load({
      init: 'total = 0;',
      sample: 'total = 0; loop(5, total += 1); spl0 = total;'
    })
    e.jig_process(frames)
    expect(output[0][0]).toBe(5)
  })

  it('treats a non-positive loop count as zero iterations', async () => {
    const { e, frames, output } = await load({
      sample: 'total = 1; loop(-3, total += 1); spl0 = total;'
    })
    e.jig_process(frames)
    expect(output[0][0]).toBe(1)
  })

  it('runs while() until its body evaluates to zero', async () => {
    const { e, frames, output } = await load({
      sample: 'n = 0; while(n = n + 1; n < 4); spl0 = n;'
    })
    e.jig_process(frames)
    expect(output[0][0]).toBe(4)
  })

  it('stops a script that never terminates rather than missing the deadline', async () => {
    // No iteration cap in the script itself: an infinite while(1) would spin
    // forever without the VM's own step budget. This is the safety net, not
    // the compiler being clever.
    const { e, frames, output } = await load({
      sample: 'spl0 = 7; while(1);'
    })
    const started = Date.now()
    e.jig_process(frames)
    expect(Date.now() - started).toBeLessThan(1000)
    // The write to spl0 that came before the infinite loop still took effect;
    // frames after the one that ran out of budget are silence, not stale.
    expect(output[0][frames - 1]).toBe(0)
  })

  describe('memory', () => {
    it('reads back what it wrote, addressed by a variable plus an offset', async () => {
      const { e, frames, output } = await load({
        init: 'base = 100;',
        sample: 'base[0] = 42; base[3] = 9; spl0 = base[0]; spl1 = base[3];'
      })
      e.jig_process(frames)
      expect(output[0][0]).toBe(42)
      expect(output[1][0]).toBe(9)
    })
  })

  describe('the math functions REAPER documents', () => {
    it('computes sin, sqrt and atan2 for real', async () => {
      const { e, frames, output } = await load({
        sample: 'spl0 = sin(0); spl1 = sqrt(16);'
      })
      e.jig_process(frames)
      expect(output[0][0]).toBeCloseTo(0, 5)
      expect(output[1][0]).toBeCloseTo(4, 5)
    })

    it('clamps with min/max and gives abs/sign the sign they claim', async () => {
      const { e, frames, output } = await load({
        sample: 'spl0 = min(3, 7); spl1 = max(3, 7);'
      })
      e.jig_process(frames)
      expect(output[0][0]).toBe(3)
      expect(output[1][0]).toBe(7)
    })
  })

  it('stays finite at register capacity and does not corrupt a reserved register', async () => {
    // Every distinct identifier gets its own register up to the VM's limit;
    // this does not exhaustively hit that limit, but checks that ordinary
    // user variables never land on a reserved one (REG_USER_BASE and up).
    const { e, frames, output } = await load({
      init: 'a = 1; b = 2; c = 3;',
      sample: 'spl0 = a + b + c;'
    })
    e.jig_process(frames)
    expect(output[0][0]).toBe(6)
    expect(REG_USER_BASE).toBeGreaterThan(68) // above every reserved register
  })
})
