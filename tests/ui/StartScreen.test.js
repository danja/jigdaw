// tests/ui/StartScreen.test.js
//
// What the empty session offers, and what it leaves out when there is nothing to offer.
import { describe, it, expect } from 'vitest'
import { describeStart } from '../../src/ui/StartScreen.js'

const run = (log = []) => ({
  tune: name => log.push(`tune ${name}`),
  template: name => log.push(`template ${name}`),
  emptyTrack: () => log.push('empty'),
  sound: () => log.push('sound'),
  browse: () => log.push('browse'),
  open: () => log.push('open')
})

describe('the start screen', () => {
  it('offers tunes first, then a new piece, then templates, then a file, each under its own heading', () => {
    const groups = describeStart({ tunes: ['Chiptune', 'Acid'], templates: ['My band'], run: run() })
    expect(groups.map(g => g.heading)).toEqual(['Play a tune', 'Start a new piece', 'From a template', 'Open a saved piece'])
    expect(groups[0].actions.map(a => a.label)).toEqual(['Chiptune', 'Acid'])
    expect(groups[1].actions.map(a => a.label)).toEqual(['A track with a sound', 'An empty track', 'Find a plugin'])
    expect(groups[2].actions.map(a => a.label)).toEqual(['My band'])
    expect(groups[3].actions.map(a => a.label)).toEqual(['Choose a file'])
  })

  it('leaves out a group with nothing in it: no templates saved, or tunes not arrived', () => {
    const groups = describeStart({ tunes: [], templates: [], run: run() })
    expect(groups.map(g => g.heading)).toEqual(['Start a new piece', 'Open a saved piece'])
  })

  it('runs the thing that was pressed, giving a tune or a template the name it was pressed with', () => {
    const log = []
    const groups = describeStart({ tunes: ['Chiptune', 'Acid'], templates: ['My band'], run: run(log) })
    groups[0].actions[1].run()
    groups[1].actions.forEach(a => a.run())
    groups[2].actions[0].run()
    groups[3].actions[0].run()
    expect(log).toEqual(['tune Acid', 'sound', 'empty', 'browse', 'template My band', 'open'])
  })

  it('refuses a screen that cannot do something it would offer, rather than drawing a button that does nothing', () => {
    for (const key of ['tune', 'template', 'emptyTrack', 'sound', 'browse', 'open']) {
      const partial = run()
      delete partial[key]
      expect(() => describeStart({ tunes: [], templates: [], run: partial }), key).toThrow(`the start screen needs run.${key}`)
    }
  })
})
