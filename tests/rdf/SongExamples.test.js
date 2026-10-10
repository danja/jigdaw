// tests/rdf/SongExamples.test.js
//
// The songs under examples/songs/: each is a session file and the script that writes it. The two have to agree, and the
// file has to be a project the format accepts and the model can open. A song nobody can open is a claim about music
// that nothing checks, and a script and a file that drift apart are two songs.
import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Project } from '../../src/model/Project.js'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const songs = readdirSync(resolve(root, 'examples/songs')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''))

describe('the songs', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('are there to be checked', () => {
    expect(songs.length, 'no songs found, so this checked nothing').toBeGreaterThan(0)
  })

  for (const name of songs) {
    describe(name, () => {
      const file = resolve(root, `examples/songs/${name}.ttl`)

      it('is exactly what its script writes, and so is its bundled preset', () => {
        const dir = mkdtempSync(join(tmpdir(), 'song-'))
        const out = join(dir, `${name}.ttl`)
        const preset = join(dir, `${name}-preset.ttl`)
        const run = spawnSync(process.execPath, [resolve(root, `examples/songs/${name}.js`), out, preset], { cwd: root, encoding: 'utf8' })
        expect(run.status, run.stderr).toBe(0)
        expect(readFileSync(out, 'utf8')).toBe(readFileSync(file, 'utf8'))
        // The preset is the same piece, written for the page that serves the plugins beside it.
        expect(readFileSync(preset, 'utf8')).toBe(readFileSync(resolve(root, `web/presets/${name}.ttl`), 'utf8'))
      })

      it('conforms to the shapes', async () => {
        const report = await validator.validate(await parseText(readFileSync(file, 'utf8'), `https://strandz.it/jigdaw/sessions/${name}/`))
        expect(report.violations.map(v => `${v.focusNode} ${v.path}: ${v.message}`)).toEqual([])
      })

      it('opens as a project with what the script says is in it', async () => {
        const read = readProject(await parseText(readFileSync(file, 'utf8'), `https://strandz.it/jigdaw/sessions/${name}/`))
        const project = new Project()
        project.apply(read.changes)
        expect(read.label).toBeTruthy()
        expect(project.tracks.length).toBeGreaterThan(1)
        expect(project.clips.length).toBeGreaterThan(0)
        // Every clip's notes are inside its clip, and in the range MIDI allows, which is what a person editing would see.
        for (const clip of project.clips) {
          for (const n of clip.notes) {
            expect(n.pitch).toBeGreaterThanOrEqual(0)
            expect(n.pitch).toBeLessThanOrEqual(127)
            expect(n.startBeat + 1e-9).toBeLessThan(clip.lengthBeats)
          }
        }
        // Every track that has clips has somewhere for them to play, so none is silently dropped.
        for (const track of project.tracks.filter(t => project.clips.some(c => c.track === t.id))) {
          expect(track.midiInput, `${track.label ?? track.id} has clips and plays them into nothing`).not.toBeNull()
        }
      })
    })
  }
})
