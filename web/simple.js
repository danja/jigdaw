// web/simple.js
//
// The simple page: pick a tune, press Play, change the sound while it plays.
//
// It is a second front end over the same model, dispatcher, engine, transport and
// panels as the studio page (docs/pwa.md), not a second implementation: the
// modules in web/app/ that it shares are given the same context they get there,
// with the parts that belong to the studio (the rack, the arrangement, the
// editors, undo) reduced to what the shared modules call and nothing more.
import { createMedia } from './app/Media.js'
import { createRuntime } from './app/Runtime.js'
import { createTransport } from './app/Transport.js'
import { createSessions } from './app/Sessions.js'
import { createPwa } from './app/Pwa.js'
import { createVoice } from './app/Voice.js'
import { createBounce } from './app/Bounce.js'
import { createCarry } from './app/Carry.js'
import { microphoneAvailable } from '../src/host/Microphone.js'
import { createPanel } from '../src/ui/Panel.js'
import { createTrackCards } from '../src/ui/TrackCards.js'
import { createSoundRack } from '../src/ui/SoundRack.js'
import { createTunePicker } from '../src/ui/TunePicker.js'
import { listPresets, fetchPreset } from '../src/ui/Presets.js'
import { inSignalOrder } from '../src/ops/OpenProject.js'

const $ = id => document.getElementById(id)

/** The last thing that happened, in a line under the title. Errors say so in words, not only by colour. */
const log = (message, kind = 'info') => {
  const status = $('status')
  status.textContent = kind === 'error' ? `Something went wrong: ${message}` : message
  status.classList.toggle('error', kind === 'error')
  console.log(`[jiggy simple] ${message}`)
}

let redraw = () => {}

const ctx = {
  document,
  window,
  $,
  log,
  dispatcher: null,
  engine: null,
  analyser: null,
  hostConfig: null,
  hostCapabilities: null,
  clipPlayer: null,
  // Only what the shared modules call. The studio's parts are not here.
  rack: { draw: () => redraw(), reset () {}, trackLabel: (track, index) => track.label ?? `Track ${index + 1}` },
  arrangement: { playhead () {}, reset () {} },
  editors: { parameter () {}, closeAll () {}, keepOnly () {} },
  history: { updateButtons () {} },
  // No alignment setting on this page: the starting value in web/host.json applies.
  align: { preferred: fromConfig => fromConfig, sync () {} },
  /** For the console and for a check driven from outside the page, as on the studio page. */
  expose () { window.__jigdaw = { dispatcher: ctx.dispatcher, engine: ctx.engine, bounce: ctx.bounce } }
}
ctx.media = createMedia(document)
ctx.runtime = createRuntime(ctx)
ctx.transport = createTransport(ctx)
ctx.sessions = createSessions(ctx)
ctx.pwa = createPwa(ctx)
ctx.bounce = createBounce(ctx)
ctx.carry = createCarry(ctx, { self: 'simple', offerText: 'You have a piece open in the studio. Open it here?' })

// ── the instruments ───────────────────────────────────────────────────────────

const panels = new Map()

/**
 * The generated panel for one plugin, made once and kept, shown what the model says. Kept by the plugin behind
 * the node, not by the node's id alone: a new piece reuses ids (node-1 is a different plugin in each), and a
 * panel kept by id showed the last piece's controls on the new one's.
 */
function panelFor (nodeId) {
  const d = ctx.dispatcher
  const entry = d?.engineNode(nodeId)
  const profile = entry?.profile
  if (!profile) return null
  let panel = panels.get(nodeId)
  if (panel && panel.entry !== entry) { panels.delete(nodeId); panel = null }
  if (!panel) {
    panel = createPanel(document, profile, (symbol, value) => {
      const applied = d.setParameter(nodeId, symbol, value)
      if (applied.ok) panel.update(symbol, applied.value)
    }, async (key, file) => {
      const result = d.loadAsset(nodeId, key, await file.arrayBuffer())
      if (!result.ok) log(`${key}: ${result.message}`, 'error')
    }, { scope: `panel-${nodeId}` })
    panel.element.querySelector('h3')?.remove()
    panel.entry = entry
    panels.set(nodeId, panel)
  }
  return panel.element
}

/** Push what the model holds into every panel that exists, so a change from anywhere shows. */
function syncPanels () {
  const d = ctx.dispatcher
  for (const [id, panel] of panels) {
    const node = d.project.node(id)
    const profile = d.engineNode(id)?.profile
    if (!node || !profile) continue
    for (const [symbol, value] of node.settings) panel.update(symbol, value)
    for (const port of profile.ports ?? []) if (!node.settings.has(port.symbol)) panel.update(port.symbol, port.defaultValue)
  }
}

const cards = createTrackCards(document, {
  onSwitch: (trackId, on) => {
    const result = ctx.dispatcher.setTrackChannel(trackId, { muted: !on })
    if (!result.ok) log(result.message, 'error')
  },
  onLevel: (trackId, gain) => {
    const result = ctx.dispatcher.setTrackChannel(trackId, { gain })
    if (!result.ok) log(result.message, 'error')
  },
  onOpen: trackId => openRack(trackId)
})
$('cards-mount').append(cards.element)

// ── the rack for one track ─────────────────────────────────────────────────────

// "Change the sound" takes you to a screen of its own with that track's plugins, and the browser's Back
// returns to the instruments (a history entry per visit), as a person on a phone expects.
const rack = createSoundRack(document, { onBack: () => closeRack({ fromBack: true }), panelFor })
$('rack-mount').append(rack.element)
let rackTrack = null

function pluginsOf (trackId) {
  const d = ctx.dispatcher
  const { project } = d
  return inSignalOrder(project.nodes.filter(n => n.track === trackId), project.connections).map(node => {
    const profile = d.engineNode(node.id)?.profile
    return { id: node.id, label: node.label ?? profile?.label ?? node.id, about: about(profile) }
  })
}

function openRack (trackId, { push = true } = {}) {
  const d = ctx.dispatcher
  const track = d?.project.track(trackId)
  if (!track) return
  rackTrack = trackId
  rack.show({ label: track.label ?? `Track ${d.project.tracks.indexOf(track) + 1}`, plugins: pluginsOf(trackId) })
  $('instruments').hidden = true
  if (push) history.pushState({ rack: trackId }, '', '#sound')
  syncPanels()
  rack.focus()
}

/** Back to the instruments. From the Back button this steps the history back, so the browser's Back does the same. */
function closeRack ({ fromBack = false } = {}) {
  if (rackTrack === null) return
  const id = rackTrack
  rackTrack = null
  rack.hide()
  $('instruments').hidden = false
  if (fromBack && history.state?.rack) history.back()
  $(`open-${id}`)?.focus()
}
window.addEventListener('popstate', () => { if (rackTrack !== null && !history.state?.rack) closeRack() })

/** A sentence to say what a plugin is, from its own description, kept short. */
const about = profile => {
  const text = (profile?.comment ?? '').trim().split(/(?<=[.!?])\s/)[0] ?? ''
  return text.length > 140 ? `${text.slice(0, 137)}...` : text || null
}

redraw = () => {
  const d = ctx.dispatcher
  if (!d) return
  const { project } = d
  const made = project.tracks
  cards.draw(project.orderedTracks.map(track => ({
    id: track.id,
    label: track.label ?? `Track ${made.indexOf(track) + 1}`,
    on: !track.channel.muted,
    level: track.channel.gain
  })))
  // The rack follows the piece: its plugins redrawn if they changed, and closed if its track has gone.
  if (rackTrack !== null) {
    if (project.track(rackTrack)) rack.update(pluginsOf(rackTrack))
    else closeRack()
  }
  syncPanels()
  showSpeed()
}

// ── speed ─────────────────────────────────────────────────────────────────────

function showSpeed () {
  const bpm = Number($('tempo').value)
  $('tempo-value').textContent = `${bpm} beats a minute`
  $('tempo').setAttribute('aria-valuetext', `${bpm} beats a minute`)
}
$('tempo').addEventListener('input', async () => {
  showSpeed()
  const d = await ctx.runtime.ensureRunning()
  const result = d.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: Number($('tempo').value) }] }])
  if (!result.ok) log(result.message, 'error')
})

// ── tunes ─────────────────────────────────────────────────────────────────────

let tunes = []
let current = null
const picker = createTunePicker(document, { onPick: tune => openTune(tune).catch(error => log(error.message, 'error')) })
$('tunes-mount').append(picker.element)

async function openTune (tune) {
  // A new piece starts at the instruments: the rack was for a track of the old one, and its history entry goes too.
  if (rackTrack !== null) {
    rackTrack = null
    rack.hide()
    $('instruments').hidden = false
    if (history.state?.rack) history.replaceState(null, '', location.pathname + location.search)
  }
  log(`Opening ${tune.label}...`)
  const text = await fetchPreset({ fetch: url => fetch(url), url: tune.url })
  await ctx.sessions.openSession(text, tune.url)
  current = tune.url
  picker.draw(tunes, { current })
  $('now').hidden = false
  $('playing').textContent = `Now playing: ${tune.label}`
  panels.clear()
  redraw()
  log(`${tune.label} is ready. Press Play.`)
}

listPresets({ fetch: url => fetch(url), index: new URL('presets/index.json', document.baseURI).href })
  .then(found => {
    // Chiptune first: the one to start with.
    tunes = [...found].sort((a, b) => (b.label === 'Chiptune') - (a.label === 'Chiptune'))
    picker.draw(tunes, { current })
  })
  .catch(error => log(`the tunes could not be listed: ${error.message}`, 'error'))

// ── play ──────────────────────────────────────────────────────────────────────

$('play').addEventListener('click', () => ctx.transport.play().catch(error => log(error.message, 'error')))
$('stop').addEventListener('click', () => ctx.transport.stop())
$('save').addEventListener('click', () => ctx.sessions.saveSession().catch(error => log(error.message, 'error')))
// The whole piece as a WAV, rendered in the page faster than it plays; the status line says how far it is.
$('export').addEventListener('click', () => ctx.bounce.exportWav().catch(error => log(error.message, 'error')))

// ── voice ─────────────────────────────────────────────────────────────────────

// Left out of the page when the browser cannot ask for a microphone. A check from
// outside may set `window.__jigdawMicrophone` to a function returning a stream.
const getUserMedia = constraints => (window.__jigdawMicrophone ?? (c => navigator.mediaDevices.getUserMedia(c)))(constraints)
if (window.__jigdawMicrophone || microphoneAvailable(navigator.mediaDevices)) {
  const voice = createVoice(ctx, {
    getUserMedia,
    onState: on => {
      $('voice').setAttribute('aria-pressed', String(on))
      $('voice').textContent = on ? 'Stop recording' : 'Record my voice'
    }
  })
  $('voice').hidden = false
  $('voice').addEventListener('click', () => voice.toggle().catch(error => log(error.message, 'error')))
}

// A link to the studio carries the piece with it, and the studio offers it.
for (const link of document.querySelectorAll('a[href="./?studio"]')) ctx.carry.carryOnClick(link)
ctx.carry.offer()
ctx.pwa.mount()
showSpeed()
