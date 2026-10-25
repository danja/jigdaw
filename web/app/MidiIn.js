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

// Which controllers are turned off is the viewer's own setting, kept in this browser and never in a session: the same
// session on another machine meets other controllers. Where storage is blocked it is forgotten on reload and nothing breaks.
const STORE_KEY = 'jigdaw.midi.off'
function loadOff (window) {
  try {
    const list = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter(id => typeof id === 'string') : []
  } catch { return [] }
}
function saveOff (window, ids) { try { window.localStorage.setItem(STORE_KEY, JSON.stringify(ids)) } catch { /* private window: kept for this visit only */ } }

export function createMidiIn (ctx) {
  const { $, log, window, document } = ctx
  // Armed tracks, for this page only: not part of a session, and forgotten on reload.
  const armed = new Set()

  // One checkbox per controller, drawn only when there is a choice to make: with one controller a list of one is a control
  // that cannot change anything.
  const devices = document.createElement('fieldset')
  devices.id = 'midi-devices'
  devices.className = 'midi-devices'
  devices.hidden = true
  const legend = document.createElement('legend')
  legend.textContent = 'Play from'
  devices.append(legend)

  function drawDevices (list) {
    devices.hidden = list.length < 2
    const boxes = list.map(device => {
      const label = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = device.enabled
      box.dataset.device = device.id
      box.addEventListener('change', () => { midi.setEnabled(device.id, box.checked); saveOff(window, midi.disabled) })
      label.append(box, document.createTextNode(` ${device.name}`))
      return label
    })
    devices.replaceChildren(legend, ...boxes)
  }

  const say = ({ status, inputs, devices: list = [] }) => {
    $('midi-in').setAttribute('aria-pressed', String(status === MIDI_STATUS.on))
    const off = list.filter(d => !d.enabled).length
    $('midi-state').textContent = status === MIDI_STATUS.on
      ? (inputs.length === 0 ? 'MIDI in: no controller found.'
        : `MIDI in: ${list.filter(d => d.enabled).map(d => d.name).join(', ') || 'every controller is turned off'}${off > 0 ? `, ${off} turned off` : ''}.`)
      : SAID[status]
    drawDevices(status === MIDI_STATUS.on ? list : [])
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
      for (const nodeId of targets()) {
        dispatcher.sendEvents(nodeId, [{ frame, bytes }])
        ctx.midiRecord.capture(nodeId, bytes)
      }
    },
    onChange: say,
    disabled: loadOff(window)
  })

  function mount () {
    $('midi-state').after(devices)
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
