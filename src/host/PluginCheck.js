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
// compiled WebAssembly for operations the real-time rules forbid, and a
// wall-clock render budget against jig:blockSize, are candidates this does
// not attempt. This is the offline-render one.
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
