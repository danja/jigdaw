// tests/bin/gallery.test.js
//
// The gallery groups plugins the way the downspout page does. This binds the
// section assignment to the roles the index actually declares, so a plugin
// with a role no section covers lands in Other loudly rather than vanishing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { categoryFor, CATEGORIES, card } from '../../bin/build-gallery.js'
import { listLocalPlugins, renderPanelHTML, resolveProfile } from '../../bin/jig.js'

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

describe('gallery links survive a subpath deployment', () => {
  // Production serves the app under /jigdaw/ with the prefix stripped by the
  // proxy (docs/deployment.md), so a root-absolute href="/plugins/..." escapes
  // the application and 404s. Every link these pages draw therefore stays
  // relative. Found when the gallery's Profile cards pointed at
  // strandz.it/plugins/mop/ instead of strandz.it/jigdaw/plugins/mop/.
  const entry = {
    iri: 'https://strandz.it/jigdaw/plugins/mop/',
    label: 'Mop',
    comment: 'An instrument.',
    roles: ['Instrument'],
    accepts: ['Midi'],
    produces: ['Audio'],
    parameters: ['gain']
  }

  it('points cards at plugins beside the gallery, not above it', () => {
    const html = card(entry, true)
    expect(html).toContain('href="plugins/mop/"')
    expect(html).toContain('href="plugins/mop/profile.ttl"')
    expect(html).not.toContain('../plugins')
  })

  it('draws no root-absolute link in a card', () => {
    expect(card(entry, false)).not.toMatch(/(href|src)="\//)
  })

  it('draws no root-absolute link in a standalone panel', async () => {
    const { profile } = await resolveProfile('pulse')
    expect(await renderPanelHTML(profile)).not.toMatch(/(href|src)="\//)
  })

  it('reaches the gallery from the page by a relative link', () => {
    const page = readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')
    expect(page).toContain('href="gallery.html"')
    expect(page).not.toContain('href="/gallery.html"')
  })
})
