// web/app/MidiIn.js
//
// A MIDI controller playing into a track. The MIDI in button asks the browser
// for access (which is also the user activation it needs), and says in words
// what came of it. What arrives goes to the MIDI input of each armed track, or
// of the selected track when none is armed, stamped with the frame the audio
// clock has reached, which is how the piano roll's audition sounds a note too.
import { createMidiInput, MIDI_STATUS } from '../../src/host/MidiInput.js'

const SAID = {
  [MIDI_STATUS.off]: 'MIDI in is off.',
  [MIDI_STATUS.denied]: 'MIDI in was blocked by the browser. Allow it in the site settings, then try again.',
  [MIDI_STATUS.unsupported]: 'This browser has no Web MIDI.'
}

export function createMidiIn (ctx) {
  const { $, log, window } = ctx
  // Armed tracks, for this page only: not part of a session, and forgotten on reload.
  const armed = new Set()

  const say = ({ status, inputs }) => {
    $('midi-in').setAttribute('aria-pressed', String(status === MIDI_STATUS.on))
    $('midi-state').textContent = status === MIDI_STATUS.on
      ? (inputs.length === 0 ? 'MIDI in: no controller found.' : `MIDI in: ${inputs.join(', ')}.`)
      : SAID[status]
  }

  /** The tracks a message goes to: those armed, else the selected one. */
  function targets () {
    const project = ctx.dispatcher?.project
    if (!project) return []
    const ids = [...armed].filter(id => project.track(id))
    const chosen = ids.length > 0 ? ids : (ctx.selection.kind === 'track' ? ctx.selection.ids : [])
    return chosen.map(id => project.track(id)?.midiInput).filter(Boolean)
  }

  const midi = createMidiInput({
    requestAccess: window.navigator.requestMIDIAccess ? window.navigator.requestMIDIAccess.bind(window.navigator) : null,
    onMessage: bytes => {
      const { engine, dispatcher } = ctx
      if (!engine || !dispatcher) return
      const frame = Math.round(engine.context.currentTime * engine.context.sampleRate)
      for (const nodeId of targets()) dispatcher.sendEvents(nodeId, [{ frame, bytes }])
    },
    onChange: say
  })

  function mount () {
    say({ status: midi.status, inputs: [] })
    $('midi-in').addEventListener('click', async () => {
      if (midi.status === MIDI_STATUS.on) { midi.disable(); return }
      // The engine first: a message with no audio running has nowhere to go.
      await ctx.runtime.ensureRunning().catch(error => log(error.message, 'error'))
      await midi.enable()
    })
  }

  return {
    mount,
    armed: id => armed.has(id),
    arm (id, on) { if (on) armed.add(id); else armed.delete(id) }
  }
}
