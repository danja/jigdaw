// web/app.js
//
// The DAW page. Enter a plugin IRI, dereference it, and it is running.
import { PluginLoader } from '../src/host/PluginLoader.js'
import { parseText } from '../src/rdf/parse.js'
import { ShapeValidator } from '../src/validate/ShapeValidator.js'
import { detectCapabilities, compact } from '../src/host/Capabilities.js'
import { Engine } from '../src/engine/Engine.js'
import { createPanel } from '../src/ui/Panel.js'

const $ = id => document.getElementById(id)
const log = (message, kind = 'info') => {
  const line = document.createElement('div')
  line.className = `log-line log-${kind}`
  line.textContent = message
  $('log').prepend(line)
  console.log(`[jigdaw] ${message}`)
}

let engine = null
let validator = null
let source = null

async function ensureEngine () {
  if (engine) return engine

  // An AudioContext may only start from a user gesture, so this happens on the
  // first click rather than at load.
  const context = new AudioContext()
  await context.resume()

  if (!validator) {
    const response = await fetch('/vocabs/shapes.ttl')
    validator = new ShapeValidator(await parseText(await response.text(), 'urn:jigdaw:shapes'))
    log('shapes loaded; profiles will be validated before anything is fetched')
  }

  const capabilities = detectCapabilities(globalThis)
  log(`host offers ${[...capabilities].map(compact).join(', ')}`)

  const loader = new PluginLoader({ parse: parseText, validator, capabilities })
  engine = new Engine({ context, loader })
  $('state').textContent = `running at ${context.sampleRate} Hz`
  return engine
}

/** A short noise burst, repeating, so a reverb has something to work on. */
function makeSource (context) {
  const length = Math.floor(context.sampleRate * 2)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      // Two impulses per two seconds, so the tail is audible between them.
      const t = i / context.sampleRate
      const hit = (t % 1.0) < 0.004
      data[i] = hit ? (Math.random() * 2 - 1) * Math.exp(-((t % 1.0) * 500)) : 0
    }
  }
  const node = context.createBufferSource()
  node.buffer = buffer
  node.loop = true
  return node
}

async function loadPlugin (iri) {
  const e = await ensureEngine()
  log(`GET ${iri}`)
  try {
    const entry = await e.addPlugin(iri)
    log(`loaded ${entry.profile.label}: ${entry.profile.ports.length} parameters, latency ${entry.ready.latencyFrames} frames`, 'ok')

    e.watch(entry.id, error => log(error.message, 'error'))

    const panel = createPanel(document, entry.profile, (symbol, value) => {
      // The panel asks; the engine decides and answers. messaging.md 2.3.
      const applied = e.setParameter(entry.id, symbol, value)
      panel.update(symbol, applied)
    })
    $('panels').append(panel.element)

    if (!source) {
      source = makeSource(e.context)
      source.start()
      log('source started')
    }
    source.disconnect()
    e.connectSource(source, entry.id)
    e.connect(entry.id, 'output')
    log(`connected: source -> ${entry.profile.label} -> output`, 'ok')

    window.__jigdaw = { engine: e, entry }
  } catch (error) {
    // Contract 10.1: the step survives into the message.
    const step = error.step ? `[${error.step}] ` : ''
    log(`${step}${error.message}`, 'error')
    throw error
  }
}

$('load').addEventListener('click', () => {
  loadPlugin($('iri').value.trim()).catch(() => {})
})

$('iri').addEventListener('keydown', event => {
  if (event.key === 'Enter') $('load').click()
})

log('ready. Enter a plugin IRI and press Load.')
window.__jigdawLoad = loadPlugin
