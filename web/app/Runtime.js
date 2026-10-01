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
    // Kept, because a script's `load` is validated through the same loader a person's is, before it runs.
    ctx.loader = new PluginLoader({ parse: parseText, validator, capabilities })
    ctx.engine = new Engine({
      context,
      loader: ctx.loader,
      output: analyser,
      maxTrackDelaySeconds: ctx.hostConfig.maxTrackDelayMs / 1000
    })
    // Decodes and plays audio clips, from the session's own files first.
    ctx.clipPlayer = new ClipPlayer({ context, fetchBytes: iri => ctx.media.fetchBytes(iri) })

    // Contract section 12. Built here and nowhere else: a host that never
    // constructs one loads no foreign plugins and conforms, so this line is the
    // whole of the decision to support them.
    const { ForeignSupport } = await import('../../src/host/ForeignSupport.js')
    const dispatcher = new OpDispatcher({
      engine: ctx.engine,
      foreign: new ForeignSupport({ validator }),
      // The person's own choice, when they have made one, else web/host.json's.
      alignTracks: ctx.align.preferred(ctx.hostConfig.alignTracks)
    })
    ctx.dispatcher = dispatcher
    ctx.align.sync()

    // Track order, colour and lane size are not edits and raise no 'changed', so
    // the editor graph says when to draw again.
    dispatcher.project.editor.subscribe(() => ctx.rack.draw())
    dispatcher.subscribe(event => {
      // What was applied, told to an open editor, whoever applied it: the editor
      // itself, the panel, undo, a session opening or an agent. messaging.md 2.3.
      if (event.type === 'parameter') ctx.editors.parameter(event.nodeId, event.symbol, event.value)
      if (event.type === 'changed') {
        const state = $('state')
        if (state) state.textContent = `rev ${event.revision}, ${dispatcher.project.nodes.length} nodes, ` +
          `${event.compiled.totalLatency} frames latency`
        ctx.rack.draw()
        ctx.history.updateButtons()
        ctx.transport.showTransport()
      }
    })

    // The agent surface belongs to the studio page, which has a catalogue to offer it.
    // A page that has none (the simple one) offers no tools rather than a surface with nothing behind it.
    if (ctx.browser) {
      const registration = registerTools({
        dispatcher,
        catalogue: ctx.browser.catalogue(),
        loadPlugin: (iri, options) => dispatcher.addPlugin(iri, options),
        openCollection: iri => ctx.browser.loadCollection(iri),
        onPlay: () => ctx.transport.play(),
        onStop: async () => { ctx.transport.stop() },
        // script_run, built before the reel exists and calling it once it does.
        reel: ctx.script.agentReel()
      })
      ctx.mcpSurface = registration.surface
      // Reel runs a script through these same tools, so it is made after them.
      ctx.script.attach({ dispatcher, tools: registration.surface.tools, loader: ctx.loader })
      log(`host offers ${[...capabilities].map(compact).join(', ')}`)
      log(`${registration.count} agent tools via ${registration.bound}`)
    }

    ctx.transport.meterLoop()
    ctx.transport.positionLoop()
    ctx.expose()
    return dispatcher
  }

  return { ensureRunning, shapeValidator }
}
