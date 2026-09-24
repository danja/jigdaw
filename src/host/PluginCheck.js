// src/host/PluginCheck.js
//
// A pre-publish check of what a plugin's code actually does, as opposed to
// what its profile claims or its digest matches. Complements jig:integrity
// checks, SHACL validation and Inspections.js
// (host-plugin-contract.md section 3.2, src/validate/ShapeValidator.js):
// none of those run the code. This renders the chain through
// ReferenceHost.js, once as asked and, for an instrument given notes, once
// more with none, and compares the two.
//
// TODO.md, "more ways of verifying a plugin": a static check of the
// compiled WebAssembly for operations the real-time rules forbid is a
// candidate this does not attempt (src/validate/WasmAbi.js does the easier
// half of that, elsewhere). checkRenderBudget below is the wall-clock one.
import { renderChain } from './ReferenceHost.js'

const peakOf = channels => Math.max(...channels.map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
const allFinite = channels => channels.every(c => c.every(v => Number.isFinite(v)))

/**
 * Render a plugin chain and report what it actually did, rather than what
 * was declared.
 *
 * @param iris, roots, seconds, sampleRate, notes, validator  as renderChain.
 * @param peakBound  a sample whose magnitude exceeds this is reported as
 *   clipping. Default 1, full scale.
 * @returns {ok, loaded, peak, silentPeak, checks}. `checks.respondsToMidi`
 *   is `null`, not a failure, when nothing was given to respond to (no
 *   notes) or nothing in the chain could (the first plugin is not an
 *   instrument): the check did not apply, rather than passed or failed.
 */
export async function checkPlugin ({
  iris, roots = {}, seconds = 2, sampleRate = 48000, notes = [], validator = null, peakBound = 1
}) {
  const rendered = await renderChain({ iris, roots, seconds, sampleRate, notes, validator })
  const { channels, loaded } = rendered
  const measuredPeak = peakOf(channels)
  const finite = allFinite(channels)

  // Only an instrument (audioInputs 0) makes anything of a note on its own;
  // an effect fed nothing gets ReferenceHost's own impulse instead (see
  // renderChain), which is a different question from whether it plays MIDI.
  const checkingMidi = notes.length > 0 && (loaded[0]?.audioInputs ?? 0) === 0
  let respondsToMidi = null
  let silentPeak = null
  if (checkingMidi) {
    const silent = await renderChain({ iris, roots, seconds, sampleRate, notes: [], validator })
    silentPeak = peakOf(silent.channels)
    respondsToMidi = measuredPeak > silentPeak + 1e-6
  }

  const checks = {
    producesAudio: measuredPeak > 1e-6,
    withinPeakBound: finite && measuredPeak <= peakBound,
    respondsToMidi
  }

  return {
    ok: checks.producesAudio && checks.withinPeakBound && checks.respondsToMidi !== false,
    loaded,
    peak: measuredPeak,
    silentPeak,
    checks
  }
}

/**
 * A coarse sanity check that rendering keeps up with real time, not a
 * prediction of real-time capacity: this runs in Node, offline, on
 * whichever machine happens to run it, not on a real audio thread at a
 * fixed priority, so it can only ever be off by orders of magnitude before
 * it means anything. What it catches is the failure a person actually hits
 * by accident: an unbounded loop or a pathologically slow algorithm that
 * renders a great deal slower than real time everywhere, not a plugin that
 * is merely tight on a slow device.
 *
 * Measured as a slope between two render lengths, after a discarded warm-up
 * render, rather than one measurement divided by its own duration: Node's
 * module loading and JIT warm-up are a fixed cost paid once, and folding
 * them into a single short measurement overstates the plugin's own
 * per-second cost by whatever multiple the render happened to be short.
 *
 * @param marginFactor  ok unless the plugin renders slower than real time
 *   by more than this multiple. Default 4, generous on purpose.
 * @returns {ok, millisecondsPerSecond, realTimeMultiple}
 */
export async function checkRenderBudget ({
  iris, roots = {}, sampleRate = 48000, notes = [], validator = null, marginFactor = 4
}) {
  const render = seconds => renderChain({ iris, roots, seconds, sampleRate, notes, validator })
  await render(0.1) // warm-up, discarded

  const short = 0.5
  const long = 2
  const t0 = performance.now()
  await render(short)
  const shortMs = performance.now() - t0
  const t1 = performance.now()
  await render(long)
  const longMs = performance.now() - t1

  const millisecondsPerSecond = Math.max(0, (longMs - shortMs) / (long - short))
  const realTimeMultiple = millisecondsPerSecond / 1000
  return {
    ok: realTimeMultiple < marginFactor,
    millisecondsPerSecond,
    realTimeMultiple
  }
}
