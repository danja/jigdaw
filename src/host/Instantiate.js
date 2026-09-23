// src/host/Instantiate.js
//
// Contract section 3.1, steps 4 to 8: fetch, verify, register, construct, init,
// await ready. Everything between having a profile and having a node that is
// safe to connect.
//
// Split out of PluginLoader, which stays the front door and delegates here, so
// that callers do not change. The seam is real rather than chosen by line
// count: nothing below this line knows what RDF is. PluginLoader reaches
// ProfileReader and therefore @zazuko/env, which reaches node's `stream` and
// `util` and cannot be bundled for a browser without shims. A caller that
// already has a profile, such as the WAM package bin/wam.js emits, needs these
// steps and must not pay for a parser it will never call. Measured: this chain
// bundles to 6 KB, the other to 1.7 MB and two shims.
import { verifyIntegrity } from './Integrity.js'
import { parameterDescriptors } from './Parameters.js'
import { LoadError, STEPS } from './LoadError.js'

/**
 * Steps 4 to 8. Returns a connected-ready AudioWorkletNode.
 *
 * The node is NOT connected to anything here. Contract section 3.1 forbids
 * connecting before ready, and this returns after ready, so the caller
 * connects. Doing it here would take the decision away from the graph.
 */
export async function instantiate (profile, granted, context, {
  fetchVerified,
  AudioWorkletNode = globalThis.AudioWorkletNode,
  validate = bytes => WebAssembly.validate(bytes),
  processorUrl = null,
  state = null
} = {}) {
  const processorBytes = await fetchVerified(profile.processor, { kind: 'processor' })

  let moduleBytes = null
  if (profile.module) {
    moduleBytes = await fetchVerified(profile.module, { kind: 'module' })

    // Validated here, not compiled. Validation is cheap and gives an error
    // naming the module, rather than a generic instantiation failure from
    // inside the worklet where there is less context to report.
    if (!validate(moduleBytes)) {
      throw new LoadError(STEPS.compileModule,
        `the file at ${profile.module.location} is not valid WebAssembly`)
    }
  }

  // jig:asset: any further file the plugin needs, verified the same way as
  // its module and its processor because AudioWorkletGlobalScope has no
  // fetch and nothing here trusts an unverified byte. Keyed by the fragment
  // of the resource's own IRI (`<#script>` becomes "script"), which is
  // already how a profile names one resource among several without a
  // dedicated jig:name predicate. Declared and read into profile.assets for
  // a while before anything actually delivered the bytes to a running
  // plugin; this is that delivery, generic rather than specific to any one
  // asset's purpose, so a future plugin wanting a wavetable or an impulse
  // response gets it for free.
  const assets = {}
  for (const asset of profile.assets ?? []) {
    const name = asset.iri?.split('#').pop() ?? asset.iri
    assets[name] = await fetchVerified(asset, { kind: `asset "${name}"` })
  }

  const url = await resolveProcessorUrl(processorBytes, profile.processor.location, processorUrl)
  try {
    await context.audioWorklet.addModule(url)
  } catch (cause) {
    throw new LoadError(STEPS.registerProcessor,
      `the processor at ${profile.processor.location} failed to register: ${cause.message}`,
      { cause })
  }

  const name = profile.processor.registeredName
  if (!name) {
    throw new LoadError(STEPS.constructNode,
      'the profile declares no jig:registeredName, and a worklet cannot be asked what it registered')
  }

  let node
  try {
    // A plugin with no audio at all still has to be rendered: a MIDI
    // generator does its work in process(). Web Audio pulls from the
    // destination, so a node with no outputs and no inputs is attached to
    // nothing and is never called. Giving it one input lets the host feed it
    // silence, which is what keeps it running. The module never reads that
    // input and does not know it is there.
    const driven = profile.audioOutputs === 0 && profile.audioInputs === 0
    node = new AudioWorkletNode(context, name, {
      numberOfInputs: driven ? 1 : profile.audioInputs,
      numberOfOutputs: profile.audioOutputs,
      outputChannelCount: profile.audioOutputs > 0
        ? Array(profile.audioOutputs).fill(profile.outputChannels)
        : undefined,
      parameterData: {},
      processorOptions: {
        capabilities: granted,
        sampleRate: context.sampleRate,
        quantum: profile.renderQuantum ?? 128
      }
    })
    if (driven) node.jigdawNeedsDriving = true
  } catch (cause) {
    throw new LoadError(STEPS.constructNode,
      `could not construct "${name}": ${cause.message}. The processor module may register a different name.`,
      { cause })
  }

  const ready = await init(node, moduleBytes, assets, granted, context, profile, state)

  // Derived here so a descriptor mismatch is reported against the profile
  // rather than surfacing later as a missing AudioParam.
  const descriptors = parameterDescriptors(profile.ports)

  return { node, ready, descriptors }
}

/** Every ArrayBuffer reachable through a structured-cloneable value's own
 * plain objects and arrays, so it can be listed as a transfer rather than
 * copied. `state` is shaped however the plugin that produced it likes, so
 * this walks rather than assumes a shape the way the flat `assets` map does
 * not need to. */
function transferablesIn (value, into = [], seen = new Set()) {
  if (value instanceof ArrayBuffer) { into.push(value); return into }
  if (value === null || typeof value !== 'object' || seen.has(value)) return into
  seen.add(value)
  for (const item of Array.isArray(value) ? value : Object.values(value)) transferablesIn(item, into, seen)
  return into
}

/** Post init and await ready. Contract section 3.1 step 7. */
function init (node, moduleBytes, assets, granted, context, profile, state) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      node.port.onmessage = null
      reject(new LoadError(STEPS.ready,
        `"${profile.processor.registeredName}" did not report ready. A processor must post { type: "ready" } once its buffers exist.`))
    }, 10000)

    node.port.onmessage = event => {
      const message = event.data
      if (message?.type === 'ready') {
        clearTimeout(timeout)
        node.port.onmessage = null
        resolve({ latencyFrames: message.latencyFrames ?? 0, tailFrames: message.tailFrames ?? null })
      } else if (message?.type === 'error' && message.fatal !== false) {
        // A non-fatal error during init (messaging.md 1.3: an asset that
        // failed to restore, for instance) is reported by the processor as
        // a warning of its own choosing and does not stop it reaching
        // ready; only a fatal one aborts the load.
        clearTimeout(timeout)
        node.port.onmessage = null
        reject(new LoadError(STEPS.ready, `${message.phase ?? 'instantiate'}: ${message.message}`))
      }
    }

    // Bytes, never a compiled WebAssembly.Module. A Module posted to an
    // AudioWorklet is silently never delivered: postMessage does not throw,
    // nothing arrives, and this promise times out ten seconds later naming
    // nothing useful. Contract section 3.3.
    const buffer = moduleBytes
      ? moduleBytes.buffer.slice(moduleBytes.byteOffset, moduleBytes.byteOffset + moduleBytes.byteLength)
      : null

    // Same reasoning as the module buffer: a slice of its own, transferred
    // rather than copied, so the worklet gets bytes it owns.
    const assetBuffers = {}
    for (const [name, bytes] of Object.entries(assets ?? {})) {
      assetBuffers[name] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }

    const transfer = [
      ...(buffer ? [buffer] : []),
      ...Object.values(assetBuffers),
      ...transferablesIn(state)
    ]

    node.port.postMessage({
      type: 'init',
      module: buffer,
      assets: assetBuffers,
      capabilities: granted,
      sampleRate: context.sampleRate,
      quantum: profile.renderQuantum ?? 128,
      ...(state !== null && state !== undefined ? { state } : {})
    }, transfer)
  })
}

/**
 * A URL addModule can load, with the verified bytes rather than a second
 * fetch.
 *
 * Contract section 3.2: where the browser does not support the integrity
 * option on addModule, the host fetches and verifies itself and hands over a
 * blob URL. Re-fetching by URL would verify one response and execute another.
 */
async function resolveProcessorUrl (bytes, originalUrl, override) {
  // Injectable because a host without Blob URLs, such as an offline test
  // harness, still has to give addModule something it can load. Overriding
  // it does not skip verification: the bytes handed here are the verified
  // ones either way.
  if (override) return override(bytes, originalUrl)
  if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return originalUrl
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
}
