// web/app.js
//
// The DAW.
//
// Everything goes through the dispatcher. The page never touches the engine or
// the audio graph directly, which is the rule in architecture.md and the reason
// the agent surface can drive the same session without reimplementing anything.
//
// This file builds the page context and wires its parts together, and nothing
// else. Each part is in web/app/, one per thing a person uses, and each takes
// the context, reading what it needs from it at the moment it needs it: the
// dispatcher and the engine do not exist until the first thing that needs
// sound (web/app/Runtime.js), so nothing can hold them any earlier.
import { createBounce } from './app/Bounce.js'
import { createLauncher } from './app/Launcher.js'
import { createContextMenu } from '../src/ui/ContextMenu.js'
import { createMidiExport } from './app/MidiExport.js'
import { createMidiImport } from './app/MidiImport.js'
import { createMidiRecord } from './app/MidiRecord.js'
import { createTapper } from '../src/model/TapTempo.js'
import { createCarry } from './app/Carry.js'
import { createRecoveryCopy } from './app/Recovery.js'
import { applyIcons } from '../src/ui/Icons.js'
import { createTabs } from '../src/ui/Tabs.js'
import { createMedia } from './app/Media.js'
import { createRuntime } from './app/Runtime.js'
import { createTransport, isPanicShortcut } from './app/Transport.js'
import { createRecord } from './app/Record.js'
import { createRack } from './app/Rack.js'
import { createEditors } from './app/Editors.js'
import { createSkins } from './app/Skins.js'
import { createArrangement } from './app/Arrangement.js'
import { createDockPanel } from './app/Dock.js'
import { createMatrix } from './app/Matrix.js'
import { Selection } from '../src/model/Selection.js'
import { createLoading } from './app/Loading.js'
import { createAddTrack } from './app/AddTrack.js'
import { createBrowser } from './app/Browser.js'
import { createSessions } from './app/Sessions.js'
import { createHistory } from './app/History.js'
import { createProjectInfo } from './app/ProjectInfo.js'
import { createTemplatesPanel } from './app/Templates.js'
import { createAgent } from './app/Agent.js'
import { createBridgeLink } from './app/Bridge.js'
import { createLayout } from './app/Layout.js'
import { createKeys } from './app/Keys.js'
import { createSwap } from './app/Swap.js'
import { createMidiIn } from './app/MidiIn.js'
import { createMicIn } from './app/MicIn.js'
import { microphoneAvailable } from '../src/host/Microphone.js'
import { createAlign } from './app/Align.js'
import { createMaster } from './app/Master.js'
import { createMeters } from './app/Meters.js'
import { createPwa } from './app/Pwa.js'
import { createScript } from './app/Script.js'
import { createShow } from './app/Show.js'
import { createTheme } from './app/Theme.js'

const $ = id => document.getElementById(id)

const log = (message, kind = 'info') => {
  const line = document.createElement('div')
  line.className = `log-line log-${kind}`
  line.textContent = message
  $('log').prepend(line)
  console.log(`[jigdaw] ${message}`)
}

// The page context. The runtime fills in the dispatcher, the engine and the
// rest when audio starts; the parts are added below, and each reaches the
// others through here rather than importing one another.
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
  mcpSurface: null,
  /** For the console, and for a check driven from outside the page. */
  expose () { window.__jigdaw = { dispatcher: ctx.dispatcher, engine: ctx.engine, bounce: ctx.bounce } }
}
ctx.media = createMedia(document)
ctx.align = createAlign(ctx)
ctx.runtime = createRuntime(ctx)
ctx.transport = createTransport(ctx)
ctx.record = createRecord(ctx)
ctx.midiRecord = createMidiRecord(ctx)
ctx.editors = createEditors(ctx)
ctx.skins = createSkins(ctx)
ctx.selection = new Selection()
// One context menu for the page (src/ui/ContextMenu.js); every surface that offers one is handed it.
ctx.menu = createContextMenu(document)
ctx.dock = createDockPanel(ctx)
ctx.arrangement = createArrangement(ctx)
ctx.matrix = createMatrix(ctx)
ctx.bounce = createBounce(ctx)
ctx.carry = createCarry(ctx, { self: 'studio', offerText: 'You have a piece open on the simple page. Open it here?' })
ctx.master = createMaster(ctx)
ctx.meters = createMeters(ctx)
ctx.pwa = createPwa(ctx)
ctx.rack = createRack(ctx)
ctx.skins.onReady(() => ctx.rack.draw())
ctx.loading = createLoading(ctx)
ctx.browser = createBrowser(ctx)
ctx.addTrack = createAddTrack(ctx)
ctx.sessions = createSessions(ctx)
ctx.history = createHistory(ctx)
ctx.projectInfo = createProjectInfo(ctx)
ctx.templates = createTemplatesPanel(ctx)
ctx.agent = createAgent(ctx)
ctx.bridge = createBridgeLink(ctx)
ctx.layout = createLayout(ctx)
ctx.keys = createKeys(ctx)
ctx.swap = createSwap(ctx)
ctx.midiIn = createMidiIn(ctx)
// A check from outside may set `window.__jigdawMicrophone` to a function returning a stream, as on the simple page.
ctx.micIn = createMicIn(ctx, {
  getUserMedia: constraints => (window.__jigdawMicrophone ?? (c => navigator.mediaDevices.getUserMedia(c)))(constraints),
  mediaDevices: navigator.mediaDevices,
  available: Boolean(window.__jigdawMicrophone) || microphoneAvailable(navigator.mediaDevices)
})
ctx.launcher = createLauncher(ctx)
ctx.script = createScript(ctx)

const { loading, browser, transport } = ctx

$('searchbar').addEventListener('submit', e => { e.preventDefault(); browser.search() })
$('agentbar').addEventListener('submit', e => { e.preventDefault(); ctx.agent.askAgent() })
$('loadbar').addEventListener('submit', e => { e.preventDefault(); loading.loadPlugin($('iri').value.trim()).catch(() => {}) })
$('collectionbar').addEventListener('submit', e => {
  e.preventDefault()
  browser.openCollection($('collection').value.trim()).catch(error => log(error.message, 'error'))
})
$('play').addEventListener('click', () => transport.play().catch(error => log(error.message, 'error')))
$('stop').addEventListener('click', () => {
  // The take first, so nothing after the last captured quantum trails in,
  // then the transport. Idle when nothing records: still just stopping.
  Promise.all([ctx.record.finishTake(), ctx.midiRecord.finishTake()])
    .catch(error => log(error.message, 'error'))
    .finally(() => transport.stop())
})
$('panic').addEventListener('click', () => transport.panic())
// Ctrl or Cmd with the full stop: Panic from anywhere, since a stuck note is not waited on while a field has focus.
document.addEventListener('keydown', event => {
  if (isPanicShortcut(event)) { event.preventDefault(); transport.panic() }
})
$('record').addEventListener('click', () => ctx.record.toggle().catch(error => log(error.message, 'error')))
$('record-midi').addEventListener('click', () => ctx.midiRecord.toggle().catch(error => log(error.message, 'error')))
const setTempo = async bpm => {
  const d = await ctx.runtime.ensureRunning()
  const result = d.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm }] }])
  if (!result.ok) log(result.message, 'error')
}
$('tempo').addEventListener('change', () => setTempo(Number($('tempo').value)))
// Taps set the tempo as the field does, one edit a tap once there are two, so the click and the clips follow as the person taps.
const tapper = createTapper({ now: () => performance.now() })
$('tap-tempo').addEventListener('click', () => {
  const bpm = tapper.tap()
  if (bpm === null) { $('tap-said').textContent = 'Tap again to set the tempo'; return }
  $('tempo').value = String(bpm)
  $('tap-said').textContent = `Tempo ${bpm}`
  setTempo(bpm)
})
$('loop').addEventListener('click', () => transport.toggleLoop())
$('metronome').addEventListener('click', () => transport.setClick($('metronome').getAttribute('aria-pressed') !== 'true'))
$('count-in').addEventListener('change', () => transport.setCountIn(Number($('count-in').value)))
$('signature').addEventListener('change', async () => {
  await ctx.runtime.ensureRunning()
  transport.setSignature($('signature').value)
})
applyIcons(document)
$('export').addEventListener('click', () => ctx.bounce.exportWav().catch(error => log(error.message, 'error')))
$('export-stems').addEventListener('click', () => ctx.bounce.exportStems().catch(error => log(error.message, 'error')))
ctx.midiExport = createMidiExport(ctx)
$('export-midi').addEventListener('click', () => { try { ctx.midiExport.exportMidi() } catch (error) { log(error.message, 'error') } })
const midiImport = createMidiImport(ctx)
$('import-midi').addEventListener('click', () => $('midifile').click())
$('midifile').addEventListener('change', async event => {
  const file = event.target.files?.[0]
  // Cleared so that choosing the same file twice in a row still fires a change.
  event.target.value = ''
  if (file) await midiImport.importFile(file).catch(error => log(error.message, 'error'))
})
ctx.sessions.mount()
ctx.history.mount()
ctx.projectInfo.mount()
ctx.templates.mount()
ctx.arrangement.mount()
ctx.matrix.mount()
ctx.master.mount()
// The link to the simple page carries the piece with it, and the simple page offers it.
for (const link of document.querySelectorAll('a[href="simple.html"]')) ctx.carry.carryOnClick(link)
ctx.carry.offer()
ctx.recovery = createRecoveryCopy(ctx)
ctx.recovery.offer()
ctx.recovery.start()
ctx.pwa.mount()
ctx.rack.mount()
ctx.launcher.mount()
ctx.meters.start()
ctx.bridge.mount()
ctx.layout.mount()
ctx.keys.mount()
ctx.swap.mount()
ctx.midiIn.mount()
ctx.micIn.mount()
ctx.align.mount()

// Show the whole IRI, not a path. A plugin is identified by an absolute IRI,
// and the box is the clearest place to say so: what goes in it is the same
// thing that would be published, pasted into another host, or curled. It is
// computed rather than written into the HTML because it depends on where this
// host is served from.
$('iri').value = new URL($('iri').value, document.baseURI).href
$('collection').value = new URL($('collection').value, document.baseURI).href

// ?collection=<url> opens one on arrival, so a collection can be shared as a
// link to this page rather than as a URL and an instruction.
const linked = new URLSearchParams(location.search).get('collection')
if (linked) {
  $('collection').value = new URL(linked, document.baseURI).href
  browser.openCollection(linked).catch(error => log(error.message, 'error'))
}

// The tabs, built once over the panels already in the markup: every redraw
// only ever changes what is inside them, never which one is showing, so this
// does not belong in the rack's redraw with everything that runs on every
// change. The arrangement first, because it is what a DAW opens on: the tracks
// and what they play. A track's plugins are one tab along, and each track's
// name in the arrangement leads there.
const TABS = [
  { id: 'arrangement', label: 'Arrangement', panel: $('arrangement-panel') },
  { id: 'tracks', label: 'Plugins', panel: $('tracks-panel') },
  { id: 'routing', label: 'Routing', panel: $('routing-panel') },
  { id: 'mixer', label: 'Mixer', panel: $('mixer-panel') },
  { id: 'launcher', label: 'Launcher', panel: $('launcher-panel') },
  { id: 'script', label: 'Script', panel: $('script-panel') },
  { id: 'settings', label: 'Settings', panel: $('settings-panel') }
]
// Which tabs the step draws is Show's to say, so it is asked, and told when a tab was wanted that it does not draw.
ctx.show = createShow(ctx)
ctx.tabs = createTabs(document, TABS, { allowed: id => ctx.show.allowsTab(id), onRefused: id => ctx.show.refuseTab(id) })
$('tabs-mount').append(ctx.tabs.element)
ctx.show.mount(TABS, ctx.tabs)
createTheme(ctx).mount()

ctx.rack.draw()
log('ready. Load the synth and press a key, or search for a plugin.')
window.__jigdawLoad = loading.loadPlugin
