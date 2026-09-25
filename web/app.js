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
import { createTabs } from '../src/ui/Tabs.js'
import { createMedia } from './app/Media.js'
import { createRuntime } from './app/Runtime.js'
import { createTransport } from './app/Transport.js'
import { createRack } from './app/Rack.js'
import { createEditors } from './app/Editors.js'
import { createArrangement } from './app/Arrangement.js'
import { createLoading } from './app/Loading.js'
import { createBrowser } from './app/Browser.js'
import { createSessions } from './app/Sessions.js'
import { createHistory } from './app/History.js'
import { createAgent } from './app/Agent.js'
import { createBridgeLink } from './app/Bridge.js'
import { createLayout } from './app/Layout.js'

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
  expose () { window.__jigdaw = { dispatcher: ctx.dispatcher, engine: ctx.engine } }
}
ctx.media = createMedia(document)
ctx.runtime = createRuntime(ctx)
ctx.transport = createTransport(ctx)
ctx.editors = createEditors(ctx)
ctx.arrangement = createArrangement(ctx)
ctx.rack = createRack(ctx)
ctx.loading = createLoading(ctx)
ctx.browser = createBrowser(ctx)
ctx.sessions = createSessions(ctx)
ctx.history = createHistory(ctx)
ctx.agent = createAgent(ctx)
ctx.bridge = createBridgeLink(ctx)
ctx.layout = createLayout(ctx)

const { loading, browser, transport } = ctx

$('searchbar').addEventListener('submit', e => { e.preventDefault(); browser.search() })
$('agentbar').addEventListener('submit', e => { e.preventDefault(); ctx.agent.askAgent() })
$('loadbar').addEventListener('submit', e => { e.preventDefault(); loading.loadPlugin($('iri').value.trim()).catch(() => {}) })
$('collectionbar').addEventListener('submit', e => {
  e.preventDefault()
  browser.openCollection($('collection').value.trim()).catch(error => log(error.message, 'error'))
})
$('play').addEventListener('click', () => transport.play().catch(error => log(error.message, 'error')))
$('stop').addEventListener('click', transport.stop)
$('tempo').addEventListener('change', async () => {
  const d = await ctx.runtime.ensureRunning()
  const result = d.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: Number($('tempo').value) }] }])
  if (!result.ok) log(result.message, 'error')
})
ctx.sessions.mount()
ctx.history.mount()
ctx.arrangement.mount()
ctx.rack.mount()
ctx.bridge.mount()
ctx.layout.mount()

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
ctx.tabs = createTabs(document, [
  { id: 'arrangement', label: 'Arrangement', panel: $('arrangement-panel') },
  { id: 'tracks', label: 'Plugins', panel: $('tracks-panel') },
  { id: 'mixer', label: 'Mixer', panel: $('mixer-panel') }
])
$('tabs-mount').append(ctx.tabs.element)

ctx.rack.draw()
log('ready. Load the synth and press a key, or search for a plugin.')
window.__jigdawLoad = loading.loadPlugin
