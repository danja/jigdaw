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

  const response = await fetch('/vocabs/shapes.ttl')
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

  $('state').textContent = `running at ${context.sampleRate} Hz`
  return dispatcher
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

async function loadPlugin (iri) {
  const d = await ensureRunning()
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

$('load').addEventListener('click', () => {
  loadPlugin($('iri').value.trim()).catch(error => log(error.message, 'error'))
})

$('iri').addEventListener('keydown', event => {
  if (event.key === 'Enter') $('load').click()
})

log('ready. Enter a plugin IRI and press Load. Load twice to chain two plugins.')
window.__jigdawLoad = loadPlugin
