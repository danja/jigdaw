// tests/bin/gallery.test.js
//
// The gallery groups plugins the way the downspout page does. This binds the
// section assignment to the roles the index actually declares, so a plugin
// with a role no section covers lands in Other loudly rather than vanishing.
import { describe, it, expect } from 'vitest'
import { categoryFor, CATEGORIES } from '../../bin/build-gallery.js'
import { listLocalPlugins } from '../../bin/jig.js'

describe('categoryFor', () => {
  it('covers every plugin in the index with a named section', async () => {
    const entries = await listLocalPlugins()
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(CATEGORIES).toContain(categoryFor(entry))
    }
  })

  it('leaves no plugin in Other today', async () => {
    // A genuinely new kind of plugin belongs in a new section, decided on
    // purpose; this is the test that asks for the decision instead of
    // silently filing it under Other.
    const entries = await listLocalPlugins()
    const other = entries.filter(e => categoryFor(e) === 'Other')
    expect(other.map(e => e.label)).toEqual([])
  })

  it('maps the four downspout-style sections by role', () => {
    const entry = roles => ({ roles })
    expect(categoryFor(entry(['MidiGenerator']))).toBe('Generative')
    expect(categoryFor(entry(['MidiProcessor']))).toBe('MIDI')
    expect(categoryFor(entry(['Instrument']))).toBe('Instruments')
    expect(categoryFor(entry(['AudioInstrument']))).toBe('Instruments')
    expect(categoryFor(entry(['DrumInstrument']))).toBe('Instruments')
    expect(categoryFor(entry(['AudioEffect']))).toBe('Processors')
    expect(categoryFor(entry(['SomethingNew']))).toBe('Other')
  })
})
