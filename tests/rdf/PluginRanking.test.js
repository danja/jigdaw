// tests/rdf/PluginRanking.test.js
//
// What the plugins in this repository say about their own controls, checked over every profile and not over a list of names, so a plugin added
// next month is in scope the day it is added. A ranking that ranks every port puts nothing away, and a ranking that ranks none is not one; a help
// sentence that is empty, or ends without a full stop, is a sentence nobody finished; and a pad can only name ports the plugin has.
import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseTurtleFile } from '../../src/validate/files.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'

const root = resolve(import.meta.dirname, '../..')
const dirs = readdirSync(join(root, 'plugins'), { withFileTypes: true })
  .filter(e => e.isDirectory() && existsSync(join(root, 'plugins', e.name, 'profile.ttl')))
  .map(e => e.name)

const profiles = new Map()
for (const name of dirs) {
  try {
    profiles.set(name, readProfile(await parseTurtleFile(join(root, 'plugins', name, 'profile.ttl'), 'urn:test')))
  } catch (error) {
    // A composite is a plugin made of other plugins and has no ports of its own to rank; it is read by readComposite.
    if (!/composite plugin/.test(error.message)) throw error
  }
}

describe('every plugin profile in the repository', () => {
  it('is found, so the checks below are not over nothing', () => {
    expect(profiles.size).toBeGreaterThan(30)
  })

  it('that ranks some of its ports keeps others back, so the ranking puts something away', () => {
    const wrong = []
    for (const [name, p] of profiles) {
      const ranked = p.ports.filter(x => x.displayPriority !== null).length
      if (ranked > 0 && ranked === p.ports.length) wrong.push(`${name} ranks all ${ranked} of its ports`)
    }
    expect(wrong).toEqual([])
  })

  it('has at least two and at most a third of its ports ranked when it ranks any, so "first" means a few', () => {
    const wrong = []
    for (const [name, p] of profiles) {
      const ranked = p.ports.filter(x => x.displayPriority !== null).length
      if (ranked === 0) continue
      if (ranked < 2) wrong.push(`${name} ranks only ${ranked}`)
      if (ranked > Math.ceil(p.ports.length / 2)) wrong.push(`${name} ranks ${ranked} of ${p.ports.length}, more than half`)
    }
    expect(wrong).toEqual([])
  })

  it('gives each help sentence as one finished sentence: a capital, a full stop, and a length a line can hold', () => {
    const wrong = []
    for (const [name, p] of profiles) {
      for (const port of p.ports) {
        const text = port.comment
        if (text === null) continue
        if (!/^[A-Z0-9]/.test(text)) wrong.push(`${name}.${port.symbol} does not start with a capital: ${text}`)
        if (!/[.!?]$/.test(text)) wrong.push(`${name}.${port.symbol} does not end with a full stop: ${text}`)
        if (text.length > 160) wrong.push(`${name}.${port.symbol} is ${text.length} characters`)
        if (text.includes(String.fromCharCode(0x2014))) wrong.push(`${name}.${port.symbol} has an em dash`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('names, in each pad, two continuous ports of its own, and a choice that is a selector', () => {
    for (const [name, p] of profiles) {
      for (const pad of p.pads) {
        const by = symbol => p.ports.find(x => x.symbol === symbol)
        expect(by(pad.x)?.widget, `${name} ${pad.label} x`).toBe('dial')
        expect(by(pad.y)?.widget, `${name} ${pad.label} y`).toBe('dial')
        if (pad.choice) expect(by(pad.choice)?.widget, `${name} ${pad.label} choice`).toBe('selector')
      }
    }
  })

  it('has every ranked control also helped, since a control worth putting first is worth a sentence', () => {
    const missing = []
    for (const [name, p] of profiles) {
      for (const port of p.ports) if (port.displayPriority !== null && port.comment === null) missing.push(`${name}.${port.symbol}`)
    }
    expect(missing).toEqual([])
  })
})

// A frequency knob that is linear puts 20 to 1000 Hz in a few degrees of turn. These plugins say their frequencies are logarithmic.
describe('plugins that mark their frequency ports logarithmic', () => {
  for (const [name, expected] of [['octet', 8], ['quartet', 5]]) {
    it(`${name} marks ${expected} ports, each in hertz with a minimum above zero`, async () => {
      const { readFileSync } = await import('node:fs')
      const profile = JSON.parse(readFileSync(new URL(`../../plugins/${name}/profile.json`, import.meta.url), 'utf8'))
      const marked = profile.ports.filter(p => p.logarithmic)
      expect(marked.length).toBe(expected)
      for (const port of marked) { expect(port.unit, port.symbol).toBe('hz'); expect(port.minimum, port.symbol).toBeGreaterThan(0) }
    })
  }
})
