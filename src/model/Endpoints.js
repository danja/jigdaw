// src/model/Endpoints.js
//
// What a node can be connected from and to, read from its profile.
//
// This was in src/ui/Routing.js, where it drew the buttons, and nowhere else.
// The dispatcher did not have it, so a connection to a port that does not
// exist passed every check the model makes, was committed, and then threw out
// of the Web Audio API when the engine came to build it:
//
//     IndexSizeError: Failed to execute 'connect' on 'AudioNode':
//     input index (0) exceeds number of inputs (0)
//
// which escaped whatever was applying the change. The application auto-chains
// each plugin to the one before it, so loading a reverb and then an instrument
// was enough: the instrument has no audio input. It left a half drawn slot,
// because the throw came out in the middle of loading.
//
// So this lives in the model, where both the interface that offers a
// connection and the dispatcher that accepts one can read the same answer. A
// second implementation of "which ports are there" would agree with the first
// until the day a profile grew something.
const MIDI_SIGNAL = 'http://purl.org/stuff/transmissions/Midi'
const AUDIO_SIGNAL = 'http://purl.org/stuff/transmissions/Audio'

/** A signal kind that is MIDI, by IRI rather than by an exact match. */
export const isMidiSignal = signal => typeof signal === 'string' && signal.includes('Midi')

/** What a plugin can be connected from, read from its profile. */
export function outputsOf (profile) {
  const found = []
  for (let i = 0; i < (profile?.audioOutputs ?? 0); i++) {
    found.push({ kind: AUDIO_SIGNAL, portIndex: i, name: `Audio out ${i + 1}` })
  }
  if ((profile?.produces ?? []).some(isMidiSignal)) {
    found.push({ kind: MIDI_SIGNAL, portIndex: 0, name: 'MIDI out' })
  }
  return found
}

/**
 * What a plugin can be connected to.
 *
 * Parameters are targets as well as ports: an endpoint carries either a
 * jig:portIndex or a jig:portSymbol, and the symbol form is modulation. It is
 * listed here because it is now honoured, having been expressible and
 * undelivered for as long as the format has existed.
 */
export function inputsOf (profile) {
  const found = []
  for (let i = 0; i < (profile?.audioInputs ?? 0); i++) {
    found.push({ kind: AUDIO_SIGNAL, portIndex: i, name: `Audio in ${i + 1}` })
  }
  if ((profile?.accepts ?? []).some(isMidiSignal)) {
    found.push({ kind: MIDI_SIGNAL, portIndex: 0, name: 'MIDI in' })
  }
  for (const port of profile?.ports ?? []) {
    found.push({
      kind: AUDIO_SIGNAL,
      portSymbol: port.symbol,
      name: `${port.name || port.symbol} (modulate)`
    })
  }
  return found
}

/** Whether two ends can be joined, so a refusal is visible before it is tried. */
export function compatible (from, to) {
  if (!from || !to) return false
  // A modulation target takes a signal, not a message: a MIDI stream cannot
  // drive an AudioParam, and connecting it would be connecting nothing.
  if (to.portSymbol !== undefined) return from.kind === AUDIO_SIGNAL
  return from.kind === to.kind
}

/**
 * Find the port one end of a connection names, or say what is wrong.
 *
 * `direction` is 'from' or 'to'. `signalKind` is the edge's own, because a
 * node can have an audio output and a MIDI output at the same index and they
 * are different ports.
 *
 * Returns `{ ok: true, port }`, or `{ ok: false, message }` saying what the
 * node does have. A profile that is not known returns ok: nothing can be
 * checked against a profile nobody has, and refusing on that basis would
 * refuse every edge in a project being loaded before its plugins are.
 */
export function findPort (profile, endpoint, direction, signalKind) {
  if (!profile) return { ok: true, port: null }

  const ports = direction === 'from' ? outputsOf(profile) : inputsOf(profile)
  const what = direction === 'from' ? 'output' : 'input'
  const label = profile.label ?? 'the plugin'

  const port = endpoint.portSymbol !== undefined && endpoint.portSymbol !== null
    ? ports.find(p => p.portSymbol === endpoint.portSymbol)
    : ports.find(p => p.portSymbol === undefined &&
        p.portIndex === endpoint.portIndex && p.kind === signalKind)

  if (port) return { ok: true, port }

  const named = endpoint.portSymbol !== undefined && endpoint.portSymbol !== null
    ? `parameter "${endpoint.portSymbol}"`
    : `${signalKind === MIDI_SIGNAL ? 'MIDI' : 'audio'} ${what} at index ${endpoint.portIndex}`
  const has = ports.length === 0
    ? `${label} has nothing to connect ${direction === 'from' ? 'from' : 'to'}.`
    : `It has: ${ports.map(p => p.name).join(', ')}.`
  return { ok: false, message: `${label} has no ${named}. ${has}` }
}
