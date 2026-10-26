// tests/web/StartScreen.test.js
//
// The start screen offers the tunes the simple page offers, and is drawn again when the things it offers arrive. Both are wiring
// that a unit test of the groups cannot see: the index is read in two places, and the lists arrive after the first draw.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const simple = read('web/simple.js')
const sessions = read('web/app/Sessions.js')
const arrangement = read('web/app/Arrangement.js')
const templates = read('web/app/Templates.js')

describe('the start screen wiring', () => {
  it('reads the tunes from the index the simple page reads, so the two pages name the same pieces', () => {
    const index = /presets\/index\.json/
    expect(simple).toMatch(index)
    expect(sessions).toMatch(index)
  })

  it('is given the tune names and the template names, not lists of its own', () => {
    expect(arrangement).toMatch(/tunes: ctx\.sessions\.presetNames\(\)/)
    expect(arrangement).toMatch(/templates: ctx\.templates\.names\(\)/)
    expect(arrangement).toMatch(/describeStart\(/)
  })

  it('is drawn again when the presets arrive and when the templates are listed', () => {
    expect(sessions).toMatch(/listedPresets = found\.map[\s\S]*ctx\.rack\?\.draw\(\)/)
    expect(templates).toMatch(/listed = names[\s\S]*ctx\.rack\?\.draw\(\)/)
  })

  it('makes an empty track with one function, which the chooser reaches through the arrangement and not by a second copy', () => {
    expect(arrangement).toMatch(/emptyTrack: \(\) => addTrack\(\)/)
    expect(arrangement).toMatch(/\n    addTrack,\n/)
    expect(arrangement.match(/op: 'addTrack'/g)).toHaveLength(1)
    expect(read('web/app/AddTrack.js')).toMatch(/ctx\.arrangement\.addTrack\(\)/)
    expect(read('web/app/AddTrack.js')).not.toMatch(/op: 'addTrack'/)
  })

  it('opens the sound chooser from the toolbar button and from the start screen', () => {
    expect(arrangement).toMatch(/onAddTrack: \(\) => ctx\.addTrack\.open\(\)/)
    expect(arrangement).toMatch(/sound: \(\) => ctx\.addTrack\.open\(\)/)
  })

  it('opens a file through the same file input the Open button uses', () => {
    expect(arrangement).toMatch(/document\.getElementById\('openfile'\)\.click\(\)/)
    expect(sessions).toMatch(/\$\('open'\)\.addEventListener\('click', \(\) => \$\('openfile'\)\.click\(\)\)/)
  })
})
