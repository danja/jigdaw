// web/app.js
//
// The DAW page. Enter a plugin IRI, dereference it, and it is running.
//
// Everything the page does goes through the dispatcher. It never touches the
// engine or the audio graph directly, which is the rule in architecture.md and
// the reason the WebMCP surface can be added later without reimplementing a
// single operation.
import { PluginLoader } from '../src/host/PluginLoader.js'
import { parseText } from '../src/rdf/parse.js'
import { ShapeValidator } from '../src/validate/ShapeValidator.js'
import { detectCapabilities, compact } from '../src/host/Capabilities.js'
import { Engine } from '../src/engine/Engine.js'
import { OpDispatcher } from '../src/ops/OpDispatcher.js'
import { createPanel } from '../src/ui/Panel.js'
import { registerTools } from '../src/mcp/adapter.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
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
let source = null
let lastNodeId = null

async function ensureRunning () {
  if (dispatcher) return dispatcher

  // An AudioContext may only start from a user gesture, so this happens on the
  // first click rather than at load.
  const context = new AudioContext()
  await context.resume()

  // Relative to the page, so the app works at the site root in development
  // and under a path in production without knowing which it is in.
  const response = await fetch(new URL('vocabs/shapes.ttl', document.baseURI))
  const validator = new ShapeValidator(await parseText(await response.text(), 'urn:jigdaw:shapes'))
  log('shapes loaded; every profile is validated before any code is fetched')

  const capabilities = detectCapabilities(globalThis)
  log(`host offers ${[...capabilities].map(compact).join(', ')}`)

  engine = new Engine({ context, loader: new PluginLoader({ parse: parseText, validator, capabilities }) })
  dispatcher = new OpDispatcher({ engine })

  dispatcher.subscribe(event => {
    if (event.type !== 'changed') return
    const { compiled } = event
    $('state').textContent =
      `revision ${event.revision}, ${dispatcher.project.nodes.length} nodes, latency ${compiled.totalLatency} frames`
    if (compiled.compensation.length > 0) {
      log(`compensating ${compiled.compensation.length} path(s): ${compiled.compensation.map(c => `${c.delayFrames} frames`).join(', ')}`)
    }
  })

  // The agent surface. Same operations as the buttons, through the same
  // dispatcher: architecture.md requires that neither implements an operation
  // of its own. What it binds to depends on the browser, so it says.
  const registration = registerTools({
    dispatcher,
    catalogue: browserCatalogue(),
    loadPlugin: iri => dispatcher.addPlugin(iri)
  })
  log(`${registration.count} agent tools registered via ${registration.bound}`)
  if (registration.warning) log(registration.warning, 'error')

  $('state').textContent = `running at ${context.sampleRate} Hz`
  return dispatcher
}

/**
 * The catalogue, as reached from the page.
 *
 * The queries live in files on the server and are never bundled, so this asks
 * the host's own endpoint rather than talking SPARQL. That also means the page
 * does not depend on an upstream endpoint's CORS headers being right, which is
 * just as well: sparql.plugin-universe.com currently sends two
 * Access-Control-Allow-Origin headers and a browser rejects that outright.
 */
function browserCatalogue () {
  const ask = async (path, params) => {
    const response = await fetch(new URL(`catalogue/${path}?${params}`, document.baseURI))
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `catalogue returned ${response.status}`)
    return body
  }
  return {
    async search ({ text = '', limit = 25, ...facets } = {}) {
      const params = new URLSearchParams()
      if (text) params.set('q', text)
      for (const [k, v] of Object.entries(facets)) if (v) params.set(k, v)
      params.set('limit', String(limit))
      return (await ask('search', params)).results
    },
    async describe (iri) {
      return ask('describe', new URLSearchParams({ iri }))
    }
  }
}

/** A repeating impulse, so a reverb tail is audible between hits. */
function makeSource (context) {
  const length = Math.floor(context.sampleRate * 2)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const t = i / context.sampleRate
      const phase = t % 1
      data[i] = phase < 0.004 ? (Math.random() * 2 - 1) * Math.exp(-phase * 500) : 0
    }
  }
  const node = context.createBufferSource()
  node.buffer = buffer
  node.loop = true
  node.start()
  return node
}

async function loadPlugin (input) {
  const d = await ensureRunning()
  // A plugin is identified by an absolute IRI, but a person typing one into
  // the box should be able to write a path. Resolving here means the model and
  // the profile both see the same absolute IRI whatever was typed.
  const iri = new URL(input, document.baseURI).href
  log(`GET ${iri}`)

  const result = await d.addPlugin(iri)
  if (!result.ok) {
    // Contract 10.1: the step that failed survives into the message.
    log(`${result.step ? `[${result.step}] ` : ''}${result.message}`, 'error')
    return
  }

  const { nodeId, entry } = result
  log(`loaded ${entry.profile.label}: ${entry.profile.ports.length} parameters, latency ${entry.ready.latencyFrames} frames`, 'ok')

  const panel = createPanel(document, entry.profile, (symbol, value) => {
    const applied = d.setParameter(nodeId, symbol, value)
    // Render what the host applied, not what was asked for.
    if (applied.ok) panel.update(symbol, applied.value)
  })
  panel.element.dataset.node = nodeId
  $('panels').append(panel.element)

  for (const [symbol, value] of d.project.node(nodeId).settings) panel.update(symbol, value)

  // Chain each new plugin after the previous one, so loading twice makes a
  // graph rather than two unconnected nodes.
  if (lastNodeId) {
    const chained = d.apply([{
      op: 'addConnection',
      from: { node: lastNodeId, portIndex: 0 },
      to: { node: nodeId, portIndex: 0 },
      signalKind: AUDIO
    }])
    if (chained.ok) log(`connected ${lastNodeId} -> ${nodeId}`, 'ok')
    else log(chained.message, 'error')
  }

  if (!source) {
    source = makeSource(engine.context)
    log('source started')
  }
  source.disconnect()
  const firstNode = d.engineNode(d.project.nodes[0].id)
  source.connect(firstNode.node, 0, 0)

  engine.get(entry.id).node.connect(engine.context.destination)
  lastNodeId = nodeId

  window.__jigdaw = { dispatcher: d, engine }
}

/** Show what the catalogue found, and let a loadable one be loaded. */
function renderResults (results, query) {
  const box = $('results')
  box.textContent = ''

  if (results.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'results-note'
    empty.textContent = `Nothing matched ${query}.`
    box.append(empty)
    return
  }

  const loadable = results.filter(r => r.web).length
  const note = document.createElement('p')
  note.className = 'results-note'
  // Being honest about this matters. The catalogue knows about every plugin;
  // only the ones declaring themselves jig:WebPlugin can run in a browser, and
  // hiding the rest would misrepresent what is out there.
  note.textContent = `${results.length} found, ${loadable} of them loadable here. ` +
    'The rest are real plugins this host cannot run: they are native, and the catalogue knows about them anyway.'
  box.append(note)

  for (const result of results) {
    const row = document.createElement('div')
    row.className = 'result'

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = result.label ?? result.iri
    row.append(name)

    if (result.web) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = 'web'
      row.append(badge)
    }

    const meta = document.createElement('span')
    meta.className = 'meta'
    meta.textContent = [result.vendor, result.roles.join(', '), result.formats.join(', ')]
      .filter(Boolean).join(' · ')
    row.append(meta)

    if (result.web) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Load'
      button.addEventListener('click', () => {
        $('iri').value = result.homepage ?? result.iri
        loadPlugin($('iri').value).catch(() => {})
      })
      row.append(button)
    } else {
      const why = document.createElement('span')
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
  if (facet) {
    const [name, value] = facet.split('=')
    params.set(name, value)
  }
  params.set('limit', '25')

  if (![...params.keys()].some(k => k !== 'limit')) {
    log('type something to search for, or pick a filter')
    return
  }

  log(`searching the catalogue for ${text || facet}`)
  try {
    const response = await fetch(new URL(`catalogue/search?${params}`, document.baseURI))
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `catalogue returned ${response.status}`)
    renderResults(body.results, text || facet)
    log(`${body.results.length} result(s)`, 'ok')
  } catch (error) {
    log(`search failed: ${error.message}`, 'error')
  }
}

$('searchbar').addEventListener('submit', event => {
  event.preventDefault()
  search()
})

$('load').addEventListener('click', () => {
  loadPlugin($('iri').value.trim()).catch(error => log(error.message, 'error'))
})

$('iri').addEventListener('keydown', event => {
  if (event.key === 'Enter') $('load').click()
})

log('ready. Enter a plugin IRI and press Load. Load twice to chain two plugins.')
window.__jigdawLoad = loadPlugin
