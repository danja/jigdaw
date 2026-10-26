// web/app/MicIn.js
//
// A microphone playing into a track. The Mic in button takes the selected track and feeds it a live input, which is heard
// through that track's fader like anything else on it, so muting the track keeps a person out of the speakers; Record takes
// a track with an input before its fader, so the take survives the mute. Which microphone is the person's choice when the
// browser lists more than one. The browser only gives device names once the page has been allowed a microphone, so the list
// is drawn after the first time it is asked for.
import { openMicrophone, listInputs } from '../../src/host/Microphone.js'

/** `getUserMedia` is injected so a check from outside the page can hand in a stream the page made itself. */
export function createMicIn (ctx, { getUserMedia, mediaDevices, available }) {
  const { $, log, document } = ctx
  // The track fed and the device chosen: this page only, not part of a session.
  let live = null

  const devices = document.createElement('label')
  devices.className = 'mic-devices'
  devices.hidden = true
  const select = document.createElement('select')
  select.id = 'mic-device'
  devices.append('Microphone ', select)

  const say = text => { $('mic-state').textContent = text }
  const trackLabel = id => ctx.dispatcher?.project.track(id)?.label ?? id

  function show () {
    $('mic-in').setAttribute('aria-pressed', String(live !== null))
    if (live) {
      const name = [...select.options].find(o => o.selected)?.textContent
      say(`Mic in${name ? `: ${name}` : ''}, into ${trackLabel(live.track)}.`)
    }
  }

  const chosen = () => [...select.options].find(o => o.selected)?.value ?? null

  async function drawDevices (current) {
    const list = await listInputs(mediaDevices)
    devices.hidden = list.length < 2
    select.replaceChildren(...list.map(d => {
      const option = document.createElement('option')
      option.value = d.id
      option.textContent = d.name
      return option
    }))
    const match = [...select.options].find(o => o.value === current)
    if (match) match.selected = true
  }

  /** Open `deviceId` (the browser's default when null) on `track`, replacing what that track had. */
  async function open (track, deviceId) {
    await ctx.runtime.ensureRunning()
    const stream = await openMicrophone(getUserMedia, { deviceId })
    try {
      if (live && live.track !== track) ctx.engine.closeInput(live.track)
      ctx.engine.openInput(track, stream)
    } catch (error) {
      for (const t of stream.getTracks?.() ?? []) t.stop()
      throw error
    }
    // The device actually opened, which for the default is not known until it is.
    const opened = stream.getAudioTracks?.()[0]?.getSettings?.().deviceId ?? deviceId
    live = { track, deviceId: opened }
    await drawDevices(opened)
    show()
  }

  function off () {
    if (!live) return
    ctx.engine.closeInput(live.track)
    live = null
    show()
    say('Mic in is off.')
  }

  /** Called when the project changes: a track removed takes its input with it, and the button must say so. */
  function refresh () {
    if (live && !ctx.engine?.inputTrackIds().includes(live.track)) {
      live = null
      show()
      say('Mic in is off: the track it was feeding is gone.')
    }
  }

  async function toggle () {
    if (live) { off(); return }
    const track = ctx.selection.kind === 'track' ? ctx.selection.ids[0] : null
    if (!track) { say('Select a track first, then press Mic in.'); return }
    await open(track, null)
  }

  function mount () {
    // Left out of the page when the browser cannot be asked for a microphone.
    if (!available) return
    $('mic-in').hidden = false
    $('mic-state').after(devices)
    $('mic-in').addEventListener('click', () => toggle().catch(error => { say(error.message); log(error.message, 'error') }))
    select.addEventListener('change', () => {
      if (!live) return
      const was = live
      open(was.track, chosen()).catch(error => {
        // The old input is still running: put the list back to match it, then say why the change did not happen.
        log(error.message, 'error')
        drawDevices(was.deviceId).then(() => { show(); say(`${error.message} The previous microphone is still in use.`) })
      })
    })
  }

  return {
    mount,
    refresh,
    active: () => live !== null,
    /** Whether the browser can be asked for a microphone at all: the button is left out of the page when not. */
    available: Boolean(available),
    /** Feed `track` from the default microphone, for a caller that has just made the track (the Add a track chooser). */
    listen: track => open(track, null)
  }
}
