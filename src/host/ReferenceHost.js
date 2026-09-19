// src/host/ReferenceHost.js
//
// A minimal, standalone host: load a chain of plugins by IRI and render real
// audio, in Node, with no browser and no DAW around it. Where
// src/testing/OfflineHost.js supplies the two things Node does not have (an
// AudioContext, an AudioWorkletNode) by really running a plugin's processor,
// this is what a person building their own host from scratch would write on
// top of it, which is the point: it talks to PluginLoader and a plugin's own
// port directly, posting MIDI as `{ type: 'events', events }` per
// messaging.md section 6, rather than through this project's own
// OpDispatcher/Engine, which are this app's convenience layer and not part
// of the contract a third-party host has to implement.
//
// Deliberately not this project's graph engine: a chain, not a graph. Each
// plugin's output feeds the next; there is no branching and no mixing. See
// docs/for-hosts.md and TODO.md for why: OfflineContext's fake gain and delay
// nodes only record connections for a test to inspect, they do not actually
// mix audio during a render, and building a second thing that does so here
// would duplicate src/compiler/GraphCompiler.js's topological order and
// compensation logic in a place it can drift from the one the app itself
// uses.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from './PluginLoader.js'
import { detectCapabilities } from './Capabilities.js'
import { parseText } from '../rdf/parse.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch, QUANTUM } from '../testing/OfflineHost.js'

/**
 * A fetch that serves a local directory for any IRI starting with one of
 * `roots`' prefixes, and reaches the real network for everything else. So an
 * IRI that is actually published just works, and a plugin under test before
 * it is published works the same way, through the same code path
 * (directoryFetch, the same one the test suite drives PluginLoader with).
 */
function hybridFetch (roots, realFetch) {
  const local = directoryFetch(roots)
  const prefixes = Object.keys(roots)
  return async (url, init) => {
    if (prefixes.some(prefix => url.startsWith(prefix))) return local(url)
    return realFetch(url, init)
  }
}

/**
 * A processorUrl override writing verified bytes to a temp file and handing
 * back its file: URL. Needed because Node cannot import() a Blob URL, and
 * cannot reliably import() an https: one without an experimental flag,
 * exactly the reason tests/host/integration.test.js already needs one.
 */
function fileProcessorUrl (dir, index) {
  return async (bytes, originalUrl) => {
    const path = join(dir, `plugin-${index}-${basename(originalUrl) || 'processor.js'}`)
    await writeFile(path, bytes)
    return pathToFileURL(path).href
  }
}

/**
 * Load a chain of plugins by IRI (or a local path via `roots`) and render
 * `seconds` of audio through them in series: the first plugin's output feeds
 * the second's input, and so on. `notes`, MIDI events for the first plugin,
 * are posted to its port at the exact frame they are due, contract section
 * 6's stream-position rule rather than a block index, so a note due mid
 * quantum still lands in the quantum that contains it.
 *
 * Returns `{ channels: [Float32Array, Float32Array], loaded }`, stereo,
 * `loaded` naming what was actually instantiated in case a caller wants to
 * report it.
 */
export async function renderChain ({
  iris,
  seconds = 2,
  notes = [],
  sampleRate = 48000,
  roots = {},
  validator = null,
  fetch: realFetch = (...args) => globalThis.fetch(...args)
}) {
  if (!iris || iris.length === 0) throw new Error('renderChain needs at least one plugin IRI')

  const fetchImpl = hybridFetch(roots, realFetch)
  const capabilities = detectCapabilities(globalThis)
  const context = new OfflineContext({ sampleRate })
  const tmp = await mkdtemp(join(tmpdir(), 'jigdaw-host-'))

  try {
    const nodes = []
    const loaded = []
    for (const [index, iri] of iris.entries()) {
      const loader = new PluginLoader({
        fetch: fetchImpl,
        parse: parseText,
        validator,
        capabilities,
        processorUrl: fileProcessorUrl(tmp, index)
      })
      const { profile, granted } = await loader.loadProfile(iri)
      const { node } = await loader.instantiate(profile, granted, context, {
        AudioWorkletNode: OfflineWorkletNode
      })
      nodes.push(node)
      loaded.push({ iri, label: profile.label, audioInputs: profile.audioInputs })
    }

    const sortedNotes = [...notes].sort((a, b) => a.frame - b.frame)
    let nextNote = 0

    const frames = Math.ceil(seconds * sampleRate)
    const outLeft = new Float32Array(frames)
    const outRight = new Float32Array(frames)

    // A chain starting with an audio effect rather than an instrument has
    // nothing feeding it on its own, the same reason web/app.js's own
    // makeSource() exists: without something to work on, an effect's tail
    // and decay are silence, not a demonstration of anything. One frame at
    // full scale, once, at the very start, is enough to show a reverb's tail
    // or a filter's response without it being mistaken for a real source.
    const startsWithEffect = (loaded[0]?.audioInputs ?? 0) > 0 && notes.length === 0
    let impulsePending = startsWithEffect

    for (let start = 0; start < frames; start += QUANTUM) {
      const blockEnd = start + QUANTUM
      // Deliver every note due in this quantum before it runs, located by
      // its own absolute frame, not by which iteration this is: a note due
      // at frame 200 belongs to the block starting at 128, not the one that
      // happens to be current when a loop variable reaches 200.
      const due = []
      while (nextNote < sortedNotes.length && sortedNotes[nextNote].frame < blockEnd) {
        due.push(sortedNotes[nextNote])
        nextNote++
      }
      if (due.length > 0 && nodes[0]) {
        nodes[0].port.postMessage({
          type: 'events',
          events: due.map(n => ({
            frame: n.frame,
            bytes: n.off
              ? Uint8Array.from([0x80, n.note, 0])
              : Uint8Array.from([0x90, n.note, n.velocity ?? 100])
          }))
        })
        // OfflinePort delivers via queueMicrotask, same as a real MessagePort
        // delivers asynchronously; render() runs synchronously right after,
        // so without a real turn of the event loop the event would still be
        // in flight and land one quantum late.
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      let signal = null
      if (impulsePending) {
        const impulseL = new Float32Array(QUANTUM)
        const impulseR = new Float32Array(QUANTUM)
        impulseL[0] = 1
        impulseR[0] = 1
        signal = [impulseL, impulseR]
        impulsePending = false
      }
      for (const node of nodes) {
        const output = node.render(signal)
        signal = output
      }

      const used = Math.min(QUANTUM, frames - start)
      for (let i = 0; i < used; i++) {
        outLeft[start + i] = signal?.[0]?.[i] ?? 0
        outRight[start + i] = signal?.[1]?.[i] ?? signal?.[0]?.[i] ?? 0
      }
    }

    return { channels: [outLeft, outRight], loaded }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
