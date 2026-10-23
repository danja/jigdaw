// tests/web/MidiImport.test.js
//
// What the Import MIDI button does with a file: reads it, applies it in one edit, says what happened, and changes nothing
// when it cannot. The parsing and the changes are tested in tests/model/MidiImport.test.js.
import { describe, it, expect } from 'vitest'
import { createMidiImport, MAX_MIDI_BYTES } from '../../web/app/MidiImport.js'
import { Project } from '../../src/model/Project.js'
import { writeMidiFile } from '../../src/model/MidiFile.js'

function source () {
  const project = new Project()
  project.apply([
    { op: 'addTrack', label: 'Lead' },
    { op: 'addClip', track: 'track-1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }, { startBeat: 2, lengthBeats: 1, pitch: 64, velocity: 90 }] }
  ])
  return writeMidiFile(project).bytes
}
const fileOf = (bytes, name = 'tune.mid', size = bytes.length) => ({ name, size, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })

function setup () {
  const project = new Project()
  const logs = []
  const applied = []
  const dispatcher = { project, apply: changes => { applied.push(changes); return project.apply(changes) && { ok: true } } }
  const ctx = { dispatcher, log: (...a) => logs.push(a), runtime: { ensureRunning: async () => {} } }
  return { project, logs, applied, importer: createMidiImport(ctx) }
}

describe('the MIDI import', () => {
  it('adds the parts as tracks in one edit, and says how many notes and that the timing came too', async () => {
    const { importer, project, logs, applied } = setup()
    await importer.importFile(fileOf(source()))
    expect(applied).toHaveLength(1)
    expect(project.tracks.map(t => t.label)).toEqual(['Lead'])
    expect(project.clips[0].notes).toHaveLength(2)
    expect(logs.at(-1)).toEqual(['imported tune.mid: 2 notes on 1 new track, with its tempo and time signature', 'ok'])
  })

  it('refuses a file that is not MIDI, saying why, and changes nothing', async () => {
    const { importer, project, applied } = setup()
    await expect(importer.importFile(fileOf(new Uint8Array(40), 'x.mid'))).rejects.toThrow(/not a MIDI file/)
    expect(applied).toEqual([])
    expect(project.tracks).toEqual([])
  })

  it('refuses a file over the size limit before reading it', async () => {
    const { importer, applied } = setup()
    const big = { name: 'big.mid', size: MAX_MIDI_BYTES + 1, arrayBuffer: async () => { throw new Error('read') } }
    await expect(importer.importFile(big)).rejects.toThrow(/8 MB/)
    expect(applied).toEqual([])
  })

  it('says so when the project already had music and the timing was left alone', async () => {
    const { importer, project, logs } = setup()
    await importer.importFile(fileOf(source()))
    await importer.importFile(fileOf(source(), 'again.mid'))
    expect(project.tracks).toHaveLength(2)
    expect(logs.map(l => l[0]).some(m => /not applied/.test(m))).toBe(true)
    expect(logs.at(-1)[0]).toBe('imported again.mid: 2 notes on 1 new track')
  })
})
