// tests/web/Bounce.test.js
//
// The page's use of the render: what Export WAV hands over, and what Freeze track changes in the project. The
// render itself is a stand-in here that returns a buffer; a real one is checked in a browser (TODO.md).
import { describe, it, expect } from 'vitest'
import { createBounce } from '../../web/app/Bounce.js'
import { Project } from '../../src/model/Project.js'
import { Transport } from '../../src/engine/Transport.js'
import { readZip } from '../../src/host/Zip.js'

const buffer = (left, right = left, sampleRate = 48000) => ({
  length: left.length, sampleRate, numberOfChannels: 2,
  getChannelData: c => (c === 0 ? left : right)
})
const tone = frames => Float32Array.from({ length: frames }, (_, i) => Math.sin(i / 20) * 0.5)

function setup ({ rendered = buffer(tone(480000)), errors = [], renderFor = null } = {}) {
  const project = new Project()
  project.apply([{ op: 'addTrack', id: 't1', label: 'Bass' }, { op: 'addTrack', id: 't2' }])
  project.label = 'My song'
  const logs = []
  const downloads = []
  const media = new Map()
  const calls = []
  const dispatcher = {
    project,
    transport: () => Transport.fromProject(project, 48000),
    apply: changes => project.apply(changes) && { ok: true },
    alignTracks: true,
    engineNode: id => ({ profile: { audioOutputs: id === 'n1' ? 1 : 0 } })
  }
  dispatcher.apply = changes => { try { project.apply(changes); return { ok: true } } catch (error) { return { ok: false, message: error.message } } }
  const ctx = {
    log: (message, kind = 'info') => logs.push({ message, kind }),
    dispatcher,
    runtime: { ensureRunning: async () => dispatcher, shapeValidator: async () => ({}) },
    hostConfig: { schedulerLookaheadMs: 200, schedulerTickMs: 50, maxTrackDelayMs: 100 },
    hostCapabilities: new Set(),
    engine: { context: { sampleRate: 48000 } },
    media: { fetchBytes: async () => new ArrayBuffer(0), iriFor: (hex, ext) => `https://s.test/media/${hex}.${ext}`, put: (iri, bytes, type) => media.set(iri, { bytes, type }) },
    rack: { trackLabel: (track, index) => track.label ?? `Track ${index + 1}` }
  }
  const bounce = createBounce(ctx, {
    download: (bytes, name, type) => downloads.push({ bytes, name, type }),
    bounceFn: async options => { calls.push(options); options.onProgress?.(0.5); const buf = renderFor ? renderFor(options.onlyTrack) : rendered; return { buffer: buf, seconds: buf.length / 48000, errors } }
  })
  return { bounce, ctx, project, logs, downloads, media, calls }
}

describe('export', () => {
  it('hands over the mix as a WAV named for the project, and says how big it is', async () => {
    const { bounce, downloads, logs, calls } = setup()
    const { bytes, name } = await bounce.exportWav()
    expect(name).toBe('My-song.wav')
    // By identity: a deep comparison of two megabytes of samples spends twenty seconds proving nothing more.
    expect(downloads).toHaveLength(1)
    expect(downloads[0].bytes).toBe(bytes)
    expect([downloads[0].name, downloads[0].type]).toEqual(['My-song.wav', 'audio/wav'])
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(calls[0].onlyTrack).toBe(null)
    expect(calls[0].seconds).toBeGreaterThan(8)
    expect(logs.at(-1).message).toMatch(/exported My-song\.wav, 10\.0 seconds/)
  })

  it('reports each ten percent as it renders, and what could not be loaded as an error', async () => {
    const { bounce, logs } = setup({ errors: ['plugin x failed'] })
    await bounce.render()
    expect(logs.some(l => /rendering 50%/.test(l.message))).toBe(true)
    expect(logs.at(-1)).toEqual({ message: 'render: plugin x failed', kind: 'error' })
  })

  it('does not start a second render while one runs, and can render again after', async () => {
    const { bounce } = setup()
    const first = bounce.render({ announce: false })
    await expect(bounce.render()).rejects.toThrow(/already running/)
    await first
    expect(bounce.busy).toBe(false)
    await bounce.render({ announce: false })
  })
})

describe('freeze', () => {
  it('renders the one track, puts it on a new track as a clip from the start, and mutes the original in one edit', async () => {
    const { bounce, project, calls, media, logs } = setup()
    const result = await bounce.freezeTrack('t1')
    expect(calls[0].onlyTrack).toBe('t1')
    expect(project.tracks.map(t => [t.label, t.channel.muted])).toEqual([['Bass', true], [null, false], ['Bass (frozen)', false]])
    const clip = project.clips[0]
    expect(clip).toMatchObject({ kind: 'audio', track: result.frozen, startBeat: 0, offsetSeconds: 0 })
    expect(clip.lengthBeats).toBeCloseTo(20, 1)
    expect(media.get(clip.source).type).toBe('audio/wav')
    expect(logs.at(-1).message).toMatch(/froze Bass into "Bass \(frozen\)"; the original is muted, not removed/)
  })

  it('names a track with no label of its own by its place', async () => {
    const { bounce, project } = setup()
    await bounce.freezeTrack('t2')
    expect(project.tracks.at(-1).label).toBe('Track 2 (frozen)')
  })

  it('keeps a file by its content, so freezing the same sound twice is one file', async () => {
    const { bounce, media } = setup()
    await bounce.freezeTrack('t1')
    await bounce.freezeTrack('t1')
    expect(media.size).toBe(1)
  })

  it('freezes nothing when the track made no sound, and says so', async () => {
    const { bounce, project, logs } = setup({ rendered: buffer(new Float32Array(480000)) })
    expect(await bounce.freezeTrack('t1')).toBeNull()
    expect(project.clips).toEqual([])
    expect(project.track('t1').channel.muted).toBe(false)
    expect(logs.at(-1)).toEqual({ message: 'Bass made no sound, so nothing was frozen', kind: 'error' })
  })

  it('refuses a track that is not there', async () => {
    const { bounce } = setup()
    await expect(bounce.freezeTrack('ghost')).rejects.toThrow(/no such track/)
  })
})

describe('a range, and stems', () => {
  it('renders the loop when the loop is on, drops what comes before it, and names the file for it', async () => {
    const { bounce, project, calls, downloads, logs } = setup()
    // Four beats at 120 a minute is two seconds: the loop runs from 2 s to 6 s.
    project.apply([{ op: 'setTransport', loopStart: 4, loopEnd: 12, loopEnabled: true }])
    const { name, bytes } = await bounce.exportWav()
    expect(name).toBe('My-song-loop.wav')
    expect(calls[0].seconds).toBeCloseTo(6 + 2, 6)
    // 480000 frames rendered, the first two seconds dropped, two channels of 16 bits and a 44 byte header.
    expect(bytes.byteLength).toBe(44 + (480000 - 96000) * 4)
    expect(logs.some(l => /the loop is on/.test(l.message))).toBe(true)
    expect(downloads).toHaveLength(1)
  })

  it('renders the whole project when the loop is off', async () => {
    const { bounce, calls } = setup()
    const { name } = await bounce.exportWav()
    expect(name).toBe('My-song.wav')
    expect(calls[0].seconds).toBeCloseTo(8 + 2, 6)
  })

  it('renders each track that makes sound alone, leaves out one that is silent, and zips the rest', async () => {
    const { bounce, project, calls, downloads } = setup({ renderFor: track => (track === 't1' ? buffer(tone(48000)) : buffer(new Float32Array(48000))) })
    project.apply([{ op: 'addNode', id: 'n1', track: 't1', pluginIri: 'https://example.org/p/' }, { op: 'addNode', id: 'n2', track: 't2', pluginIri: 'https://example.org/p/' }])
    const result = await bounce.exportStems()
    expect(calls.map(c => c.onlyTrack)).toEqual(['t1'])
    expect(result.name).toBe('My-song-stems.zip')
    expect(result.entries).toEqual(['01-Bass.wav'])
    const files = await readZip(downloads[0].bytes)
    expect([...files.keys()]).toEqual(['01-Bass.wav'])
  })

  it('offers an audio clip\'s track as a stem though no plugin is on it, and keeps stems numbered in order', async () => {
    const { bounce, project } = setup()
    project.apply([{ op: 'addNode', id: 'n1', track: 't1', pluginIri: 'https://example.org/p/' },
      { op: 'addClip', track: 't2', kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/a.wav' }])
    const result = await bounce.exportStems()
    expect(result.entries).toEqual(['01-Bass.wav', '02-Track-2.wav'])
  })

  it('says so when nothing makes sound, and when every track came out silent', async () => {
    const empty = setup()
    await expect(empty.bounce.exportStems()).rejects.toThrow(/no track makes sound/)
    const quiet = setup({ renderFor: () => buffer(new Float32Array(48000)) })
    quiet.project.apply([{ op: 'addNode', id: 'n1', track: 't1', pluginIri: 'https://example.org/p/' }])
    await expect(quiet.bounce.exportStems()).rejects.toThrow(/no track made any sound/)
    expect(quiet.bounce.busy).toBe(false)
  })

  it('will not start a second render while stems are being made', async () => {
    const { bounce, project } = setup()
    project.apply([{ op: 'addNode', id: 'n1', track: 't1', pluginIri: 'https://example.org/p/' }])
    const first = bounce.exportStems()
    await expect(bounce.exportStems()).rejects.toThrow(/already running/)
    await first
  })
})

