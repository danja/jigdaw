// web/app.js
//
// The DAW.
//
// Everything goes through the dispatcher. The page never touches the engine or
// the audio graph directly, which is the rule in architecture.md and the reason
// the agent surface can drive the same session without reimplementing anything.
import { PluginLoader } from '../src/host/PluginLoader.js'
import { parseText } from '../src/rdf/parse.js'
import { ShapeValidator } from '../src/validate/ShapeValidator.js'
import { detectCapabilities, compact } from '../src/host/Capabilities.js'
import { Engine } from '../src/engine/Engine.js'
import { OpDispatcher } from '../src/ops/OpDispatcher.js'
import { createPanel } from '../src/ui/Panel.js'
import { createKeyboard } from '../src/ui/Keyboard.js'
import { registerTools } from '../src/mcp/adapter.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const $ = id => document.getElementById(id)

const log = (message, kind = 'info') => {
  const line = document.createElement('div')
  line.className = `log-line log-${kind}`
  line.textContent = message
  $('log').prepend(line)
  console.log(`[jigdaw] ${message}`)
}

let dispatcher = null
let engine = null
let analyser = null
let source = null
let playing = false
let startedAt = 0
const panels = new Map()

/** The catalogue, as reached from the page: the host's own endpoint, not SPARQL. */
function browserCatalogue () {
  const ask = async (path, params) => {
    const response = await fetch(new URL(`catalogue/${path}?${params}`, document.baseURI))
    const isJson = (response.headers.get('content-type') ?? '').includes('json')
    if (!isJson) {
      throw new Error(response.status === 404
        ? `the catalogue endpoint is not there (${response.status}). If the page was just updated, the server needs restarting.`
        : `the catalogue answered ${response.status}`)
    }
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `catalogue returned ${response.status}`)
    return body
  }
  return {
    async search ({ text = '', limit = 25, loadable = true, ...facets } = {}) {
      const params = new URLSearchParams()
      if (text) params.set('q', text)
      for (const [k, v] of Object.entries(facets)) if (v) params.set(k, v)
      params.set('limit', String(limit))
      if (!loadable) params.set('loadable', 'false')
      return ask('search', params)
    },
    async describe (iri) { return ask('describe', new URLSearchParams({ iri })) }
  }
}

async function ensureRunning () {
  if (dispatcher) return dispatcher

  const context = new AudioContext()
  await context.resume()

  const response = await fetch(new URL('vocabs/shapes.ttl', document.baseURI))
  const validator = new ShapeValidator(await parseText(await response.text(), 'urn:jigdaw:shapes'))

  const capabilities = detectCapabilities(globalThis)
  engine = new Engine({ context, loader: new PluginLoader({ parse: parseText, validator, capabilities }) })
  dispatcher = new OpDispatcher({ engine })

  analyser = context.createAnalyser()
  analyser.fftSize = 256
  analyser.connect(context.destination)

  dispatcher.subscribe(event => {
    if (event.type === 'changed') {
      $('state').textContent = `rev ${event.revision}, ${dispatcher.project.nodes.length} nodes, ` +
        `${event.compiled.totalLatency} frames latency`
      drawRack()
    }
  })

  const registration = registerTools({
    dispatcher,
    catalogue: browserCatalogue(),
    loadPlugin: iri => dispatcher.addPlugin(iri)
  })
  log(`host offers ${[...capabilities].map(compact).join(', ')}`)
  log(`${registration.count} agent tools via ${registration.bound}`)

  meterLoop()
  positionLoop()
  return dispatcher
}

// ── Transport ──────────────────────────────────────────────────────────────

/** A repeating impulse, so an effect has something to work on. */
function makeSource (context) {
  const length = Math.floor(context.sampleRate * 2)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const phase = (i / context.sampleRate) % 1
      data[i] = phase < 0.004 ? (Math.random() * 2 - 1) * Math.exp(-phase * 500) : 0
    }
  }
  const node = context.createBufferSource()
  node.buffer = buffer
  node.loop = true
  return node
}

async function play () {
  const d = await ensureRunning()
  if (playing) return
  playing = true
  startedAt = engine.context.currentTime
  $('play').setAttribute('aria-pressed', 'true')

  // Only run the impulse source if the chain starts with an effect. An
  // instrument makes its own sound and feeding it impulses is noise.
  const first = d.project.nodes[0]
  const startsWithEffect = first && !(dispatcher.engineNode(first.id)?.profile.roles ?? [])
    .some(role => role.includes('Instrument'))

  if (startsWithEffect) {
    source = makeSource(engine.context)
    source.start()
    const entry = dispatcher.engineNode(first.id)
    if (entry) source.connect(entry.node, 0, 0)
  }

  sendTransport()
  log('playing', 'ok')
}

function stop () {
  playing = false
  $('play').setAttribute('aria-pressed', 'false')
  if (source) { try { source.stop() } catch { /* already stopped */ } source.disconnect(); source = null }
  for (const entry of engine?.nodes() ?? []) {
    // All notes off, so nothing is left sounding.
    engine.post(entry.id, { type: 'events', events: [{ frame: 0, bytes: Uint8Array.from([0xb0, 123, 0]) }] })
  }
  sendTransport()
  log('stopped')
}

function elapsedFrames () {
  if (!engine || !playing) return 0
  return Math.max(0, Math.round((engine.context.currentTime - startedAt) * engine.context.sampleRate))
}

function sendTransport () {
  if (!dispatcher) return
  dispatcher.sendTransport(elapsedFrames(), {
    frame: Math.round((engine?.context.currentTime ?? 0) * (engine?.context.sampleRate ?? 48000)),
    playing
  })
}

function positionLoop () {
  const tick = () => {
    if (dispatcher) {
      const position = dispatcher.transport().positionAtElapsed(elapsedFrames())
      const bar = Math.floor(position.bar) + 1
      const beat = Math.floor(position.beatInBar) + 1
      $('position').textContent = `${bar} . ${beat}`
      if (playing) sendTransport()
    }
    setTimeout(tick, 100)
  }
  tick()
}

function meterLoop () {
  const bars = 12
  const meter = $('meter')
  meter.textContent = ''
  for (let i = 0; i < bars; i++) meter.append(document.createElement('i'))
  const data = new Float32Array(analyser.fftSize)

  const frame = () => {
    analyser.getFloatTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v))
    const lit = Math.round(Math.min(1, peak) * bars)
    meter.querySelectorAll('i').forEach((bar, i) => {
      bar.className = i < lit ? (i >= bars - 2 ? 'hot' : 'on') : ''
    })
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

// ── The rack ───────────────────────────────────────────────────────────────

function slot (title, kind, className) {
  const element = document.createElement('div')
  element.className = `slot ${className}`
  const header = document.createElement('header')
  const heading = document.createElement('h3')
  heading.textContent = title
  const kindLabel = document.createElement('span')
  kindLabel.className = 'kind'
  kindLabel.textContent = kind
  header.append(heading, kindLabel)
  element.append(header)
  return element
}

function wire (label) {
  const element = document.createElement('div')
  element.className = 'wire'
  if (label) {
    const span = document.createElement('span')
    span.textContent = label
    element.append(span)
  }
  return element
}

function drawRack () {
  const rack = $('rack')
  rack.textContent = ''

  const nodes = dispatcher?.project.nodes ?? []
  if (nodes.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'Nothing loaded. Search for a plugin, or press Load to add the synth.'
    rack.append(empty)
    return
  }

  rack.append(slot('Source', 'impulse or keyboard', 'source'))

  for (const node of nodes) {
    rack.append(wire(node === nodes[0] ? '' : 'audio'))

    const entry = dispatcher.engineNode(node.id)
    const profile = entry?.profile
    const element = slot(node.label ?? node.pluginIri, (profile?.roles ?? []).map(compact).join(', '), 'plugin')

    const remove = document.createElement('button')
    remove.className = 'remove'
    remove.type = 'button'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${node.label ?? 'plugin'}`)
    remove.addEventListener('click', () => {
      const result = dispatcher.apply([{ op: 'removeNode', id: node.id }])
      if (!result.ok) log(result.message, 'error')
      else { panels.delete(node.id); log(`removed ${node.label}`) }
    })
    element.querySelector('header').append(remove)

    if (profile) {
      let panel = panels.get(node.id)
      if (!panel) {
        panel = createPanel(document, profile, (symbol, value) => {
          const applied = dispatcher.setParameter(node.id, symbol, value)
          if (applied.ok) panel.update(symbol, applied.value)
        })
        panels.set(node.id, panel)
      }
      // The generated panel brings its own heading, which the slot already has.
      panel.element.querySelector('h3')?.remove()
      element.append(panel.element)

      // An instrument gets a keyboard, so it can be played.
      if ((profile.accepts ?? []).some(signal => signal.includes('Midi'))) {
        const keyboard = createKeyboard(document, {
          first: 48,
          octaves: 2,
          onNote: bytes => {
            dispatcher.sendEvents(node.id, [{
              frame: Math.round(engine.context.currentTime * engine.context.sampleRate),
              bytes
            }])
          }
        })
        element.append(keyboard.element)
      }
    }

    rack.append(element)
  }

  rack.append(wire('audio'), slot('Output', 'speakers', 'output'))
}

// ── Loading ────────────────────────────────────────────────────────────────

async function loadPlugin (input) {
  const d = await ensureRunning()
  const iri = new URL(input, document.baseURI).href
  log(`GET ${iri}`)

  const result = await d.addPlugin(iri)
  if (!result.ok) {
    log(`${result.step ? `[${result.step}] ` : ''}${result.message}`, 'error')
    return
  }

  const { nodeId, entry } = result
  log(`loaded ${entry.profile.label}`, 'ok')

  // Chain after the previous plugin, so loading twice builds a signal path.
  const nodes = d.project.nodes
  const previous = nodes[nodes.length - 2]
  if (previous) {
    const produces = dispatcher.engineNode(previous.id)?.profile.produces ?? []
    const kind = produces.some(s => s.includes('Midi')) && !produces.includes(AUDIO) ? MIDI : AUDIO
    const chained = d.apply([{
      op: 'addConnection',
      from: { node: previous.id, portIndex: 0 },
      to: { node: nodeId, portIndex: 0 },
      signalKind: kind
    }])
    if (!chained.ok) log(chained.message, 'error')
  }

  // The last node in the chain reaches the speakers.
  engine.get(entry.id).node.connect(analyser)
  drawRack()
  window.__jigdaw = { dispatcher: d, engine }
}

// ── Browser ────────────────────────────────────────────────────────────────

function renderResults (results, query) {
  const box = $('results')
  box.textContent = ''
  if (results.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'note'
    empty.textContent = `Nothing matched ${query}.`
    box.append(empty)
    return
  }

  const loadable = results.filter(r => r.web).length
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent = loadable === results.length
    ? `${results.length} loadable here.`
    : `${results.length} found, ${loadable} loadable here. The rest are native plugins the catalogue knows about but this host cannot run.`
  box.append(note)

  for (const result of results) {
    const row = document.createElement('div')
    // Dimmed, so the ones that can be loaded read first at a glance.
    row.className = result.web ? 'result' : 'result native'

    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = result.label ?? result.iri
    if (result.web) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = ' web'
      name.append(' ', badge)
    }
    row.append(name)

    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = [result.vendor, result.roles.join(', ')].filter(Boolean).join(' · ')
    row.append(meta)

    if (result.web) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Load'
      button.addEventListener('click', () => loadPlugin(result.homepage ?? result.iri).catch(() => {}))
      row.append(button)
    } else {
      const why = document.createElement('div')
      why.className = 'native'
      why.textContent = 'native only'
      row.append(why)
    }
    box.append(row)
  }
}

async function search () {
  const text = $('q').value.trim()
  const facet = $('facet').value
  const params = new URLSearchParams()
  if (text) params.set('q', text)
  if (facet) { const [k, v] = facet.split('='); params.set(k, v) }
  params.set('limit', '25')
  // An empty search lists what this host can run, which is the useful default
  // for a browser: it answers "what have I got" without being asked twice.


  try {
    const body = await browserCatalogue().search({
      text, limit: 25,
      loadable: !$('everything').checked,
      ...(facet ? { [facet.split('=')[0]]: facet.split('=')[1] } : {})
    })
    renderResults(body.results, text || facet)

    if (body.upstreamError) {
      // The wider catalogue being down must not hide the plugins held here.
      log(`the wider catalogue is unavailable: ${body.upstreamError}`, 'error')
    }
    if (body.loadableOnly && body.results.length === 0) {
      log('nothing loadable matched. Tick the box to include native plugins.')
    }
    log(`${body.results.length} result(s)`, 'ok')
  } catch (error) {
    log(`search failed: ${error.message}`, 'error')
  }
}

$('searchbar').addEventListener('submit', e => { e.preventDefault(); search() })
$('loadbar').addEventListener('submit', e => { e.preventDefault(); loadPlugin($('iri').value.trim()).catch(() => {}) })
$('play').addEventListener('click', () => play().catch(error => log(error.message, 'error')))
$('stop').addEventListener('click', stop)
$('tempo').addEventListener('change', async () => {
  const d = await ensureRunning()
  const result = d.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: Number($('tempo').value) }] }])
  if (!result.ok) log(result.message, 'error')
})

drawRack()
log('ready. Load the synth and press a key, or search for a plugin.')
window.__jigdawLoad = loadPlugin
