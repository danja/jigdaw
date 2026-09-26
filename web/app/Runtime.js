// web/app/Runtime.js
//
// Starting the audio: the context, the engine, the dispatcher, the clip
// player and the agent surface, built once, on the first thing a person does
// that needs sound. Everything built here is put on the page context, where
// every other part of the page reads it.
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { parseText } from '../../src/rdf/parse.js'
import { ShapeValidator } from '../../src/validate/ShapeValidator.js'
import { detectCapabilities, compact } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { ClipPlayer } from '../../src/engine/ClipPlayer.js'
import { readHostConfig } from '../../src/host/HostConfig.js'
import { registerTools } from '../../src/mcp/adapter.js'

export function createRuntime (ctx) {
  const { document, $, log } = ctx

  // The shapes, parsed once. Opening a collection needs them before anything has
  // asked for audio, and ensureRunning needs them after, so neither owns them.
  let shapes = null
  function shapeValidator () {
    shapes ??= fetch(new URL('vocabs/shapes.ttl', document.baseURI))
      .then(response => response.text())
      .then(text => parseText(text, 'urn:jigdaw:shapes'))
      .then(dataset => new ShapeValidator(dataset))
    return shapes
  }

  // The promise, not the result: a second click while the first is still inside
  // context.resume() used to find no dispatcher yet and build a second engine,
  // so the first click's plugin landed somewhere nothing drew.
  let starting = null
  function ensureRunning () {
    starting ??= start().catch(error => { starting = null; throw error })
    return starting
  }

  async function start () {
    const context = new AudioContext()
    await context.resume()

    const validator = await shapeValidator()

    // The meter taps the mix, so it is built before the engine and handed to it.
    // The engine connects its master through this on the way to the speakers,
    // which means one meter measures what you actually hear rather than one voice
    // of several.
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.connect(context.destination)
    ctx.analyser = analyser

    // web/host.json. Nothing here has a default.
    const response = await fetch(new URL('host.json', document.baseURI))
    if (!response.ok) throw new Error(`web/host.json could not be read: ${response.status}`)
    ctx.hostConfig = readHostConfig(await response.json())

    const capabilities = detectCapabilities(globalThis)
    ctx.hostCapabilities = capabilities
    ctx.engine = new Engine({
      context,
      loader: new PluginLoader({ parse: parseText, validator, capabilities }),
      output: analyser
    })
    // Decodes and plays audio clips, from the session's own files first.
    ctx.clipPlayer = new ClipPlayer({ context, fetchBytes: iri => ctx.media.fetchBytes(iri) })

    // Contract section 12. Built here and nowhere else: a host that never
    // constructs one loads no foreign plugins and conforms, so this line is the
    // whole of the decision to support them.
    const { ForeignSupport } = await import('../../src/host/ForeignSupport.js')
    const dispatcher = new OpDispatcher({
      engine: ctx.engine,
      foreign: new ForeignSupport({ validator })
    })
    ctx.dispatcher = dispatcher

    dispatcher.subscribe(event => {
      // What was applied, told to an open editor, whoever applied it: the editor
      // itself, the panel, undo, a session opening or an agent. messaging.md 2.3.
      if (event.type === 'parameter') ctx.editors.parameter(event.nodeId, event.symbol, event.value)
      if (event.type === 'changed') {
        $('state').textContent = `rev ${event.revision}, ${dispatcher.project.nodes.length} nodes, ` +
          `${event.compiled.totalLatency} frames latency`
        ctx.rack.draw()
        ctx.history.updateButtons()
        ctx.transport.showTempo()
      }
    })

    const registration = registerTools({
      dispatcher,
      catalogue: ctx.browser.catalogue(),
      loadPlugin: (iri, options) => dispatcher.addPlugin(iri, options),
      openCollection: iri => ctx.browser.loadCollection(iri),
      onPlay: () => ctx.transport.play(),
      onStop: async () => { ctx.transport.stop() }
    })
    ctx.mcpSurface = registration.surface
    log(`host offers ${[...capabilities].map(compact).join(', ')}`)
    log(`${registration.count} agent tools via ${registration.bound}`)

    ctx.transport.meterLoop()
    ctx.transport.positionLoop()
    ctx.expose()
    return dispatcher
  }

  return { ensureRunning, shapeValidator }
}
