// src/host/PluginAnalysis.js
//
// Small, reusable signal-analysis helpers for plugin benchmarking. These are
// meant for EQ-style checks and other real DSP comparisons: render a known
// input tone through a plugin, measure the output RMS and convert that to a gain
// in decibels. The helpers intentionally keep the browser/platform assumptions
// close to the existing ReferenceHost logic so they stay useful for a plugin that
// is still under test before it is published.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from './PluginLoader.js'
import { detectCapabilities } from './Capabilities.js'
import { parseText } from '../rdf/parse.js'
import { OfflineContext, OfflineWorkletNode, QUANTUM, directoryFetch } from '../testing/OfflineHost.js'

function hybridFetch (roots, realFetch = (...args) => globalThis.fetch(...args)) {
  const local = directoryFetch(roots)
  const prefixes = Object.keys(roots)
  return async (url, init) => {
    if (prefixes.some(prefix => url.startsWith(prefix))) return local(url)
    return realFetch(url, init)
  }
}

function fileProcessorUrl (dir, index) {
  return async (bytes, originalUrl) => {
    const path = join(dir, `plugin-${index}-${basename(originalUrl) || 'processor.js'}`)
    await writeFile(path, bytes)
    return pathToFileURL(path).href
  }
}

export function rms (values) {
  const list = Array.from(values)
  if (list.length === 0) return 0
  const meanSquare = list.reduce((sum, value) => sum + value * value, 0) / list.length
  return Math.sqrt(meanSquare)
}

export function gainDb (inputRms, outputRms) {
  if (inputRms <= 0) return outputRms <= 0 ? 0 : Number.POSITIVE_INFINITY
  return 20 * Math.log10(outputRms / inputRms)
}

function toneSample (frequency, sampleRate, index, amplitude) {
  return amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate)
}

function renderToneThroughNode (node, frequency, sampleRate, seconds, amplitude) {
  const frames = Math.ceil(seconds * sampleRate)
  const output = new Float32Array(frames)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    const value = toneSample(frequency, sampleRate, i, amplitude)
    left[i] = value
    right[i] = value
  }
  for (let offset = 0; offset < frames; offset += QUANTUM) {
    const length = Math.min(QUANTUM, frames - offset)
    const chunkL = left.subarray(offset, offset + length)
    const chunkR = right.subarray(offset, offset + length)
    const rendered = node.render([chunkL, chunkR])
    const channel = rendered?.[0] ?? rendered?.[1] ?? new Float32Array(length)
    output.set(channel.subarray(0, length), offset)
  }
  return output
}

export async function measureToneGain ({
  iri,
  roots = {},
  frequency = 1000,
  seconds = 0.2,
  sampleRate = 48000,
  amplitude = 0.5,
  validator = null,
  fetch: realFetch = (...args) => globalThis.fetch(...args)
}) {
  if (!iri) throw new Error('measureToneGain needs an IRI')

  const context = new OfflineContext({ sampleRate })
  const tmp = await mkdtemp(join(tmpdir(), 'jigdaw-analysis-'))
  try {
    const loader = new PluginLoader({
      fetch: hybridFetch(roots, realFetch),
      parse: parseText,
      validator,
      capabilities: detectCapabilities(globalThis),
      processorUrl: fileProcessorUrl(tmp, 0)
    })
    const { profile, granted } = await loader.loadProfile(iri)
    const { node } = await loader.instantiate(profile, granted, context, { AudioWorkletNode: OfflineWorkletNode })

    const input = Float32Array.from({ length: Math.ceil(seconds * sampleRate) }, (_, i) =>
      toneSample(frequency, sampleRate, i, amplitude))

    const output = renderToneThroughNode(node, frequency, sampleRate, seconds, amplitude)
    const inputRms = rms(input)
    const outputRms = rms(output)

    return {
      frequency,
      seconds,
      inputRms,
      outputRms,
      gainDb: gainDb(inputRms, outputRms),
      label: profile.label,
      iri
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

export async function measureFrequencyResponse ({
  iri,
  roots = {},
  frequencies = [50, 100, 200, 500, 1000, 2000, 5000, 10000],
  seconds = 0.2,
  sampleRate = 48000,
  amplitude = 0.5,
  validator = null,
  fetch: realFetch = (...args) => globalThis.fetch(...args)
}) {
  const measurements = []
  for (const frequency of frequencies) {
    measurements.push(await measureToneGain({
      iri,
      roots,
      frequency,
      seconds,
      sampleRate,
      amplitude,
      validator,
      fetch: realFetch
    }))
  }
  return measurements
}
