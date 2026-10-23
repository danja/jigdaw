// tests/web/MidiExport.test.js
//
// What the MIDI button hands over and says. The file's contents are tested in tests/model/MidiFile.test.js.
import { describe, it, expect } from 'vitest'
import { createMidiExport } from '../../web/app/MidiExport.js'
import { Project } from '../../src/model/Project.js'

function setup (label = 'My song / take 2') {
  const project = new Project()
  project.apply([
    { op: 'addTrack', label: 'Lead' },
    { op: 'addClip', track: 'track-1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }] }
  ])
  project.label = label
  const logs = []
  const downloads = []
  const ctx = { dispatcher: { project }, log: (...a) => logs.push(a) }
  const exporter = createMidiExport(ctx, { download: (...a) => downloads.push(a) })
  return { project, ctx, exporter, logs, downloads }
}

describe('the MIDI export', () => {
  it('downloads a .mid named for the project with a safe name, and says what went in', () => {
    const { exporter, logs, downloads } = setup()
    const { name } = exporter.exportMidi()
    expect(name).toBe('My-song-take-2.mid')
    expect(downloads).toHaveLength(1)
    const [bytes, given, type] = downloads[0]
    expect([given, type]).toEqual(['My-song-take-2.mid', 'audio/midi'])
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd')
    expect(logs).toEqual([['exported My-song-take-2.mid: 1 note on 1 track', 'ok']])
  })

  it('exports one track under its own name, or the selected tracks together', () => {
    const { project, exporter, downloads } = setup()
    project.apply([{ op: 'addTrack', label: 'Bass line' }, { op: 'addClip', track: 'track-2', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [{ startBeat: 0, lengthBeats: 1, pitch: 36, velocity: 100 }] }])
    expect(exporter.exportMidi({ trackIds: ['track-2'] }).name).toBe('My-song-take-2-Bass-line.mid')
    expect(exporter.exportMidi({ trackIds: ['track-1', 'track-2'] }).name).toBe('My-song-take-2-selected.mid')
    expect(downloads.map(d => d[1])).toEqual(['My-song-take-2-Bass-line.mid', 'My-song-take-2-selected.mid'])
    // One track and the conductor.
    expect(downloads[0][0][11]).toBe(2)
  })

  it('says why, and downloads nothing, when there are no notes or no project yet', () => {
    const { project, exporter, downloads, ctx } = setup()
    project.apply([{ op: 'removeClip', id: 'clip-1' }])
    expect(() => exporter.exportMidi()).toThrow(/no MIDI notes/)
    ctx.dispatcher = null
    expect(() => exporter.exportMidi()).toThrow(/nothing to export/)
    expect(downloads).toEqual([])
  })
})
