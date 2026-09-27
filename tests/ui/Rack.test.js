// tests/ui/Rack.test.js
//
// A slot's heading names the plugin in use before the node's purpose label:
// "MelGen: Subject", never a bare "Subject" that says nothing about what is
// making the sound, and never "Pulse: Pulse" where the purpose still is the
// profile's own name.
import { describe, it, expect } from 'vitest'
import { slotTitle } from '../../web/app/Rack.js'

const node = label => ({ id: 'n', label, pluginIri: 'https://strandz.it/jigdaw/plugins/melgen/' })
const profile = label => ({ label })

describe('slotTitle', () => {
  it('puts the plugin before a purpose label', () => {
    expect(slotTitle(node('Subject'), profile('MelGen'), 'Subject')).toBe('MelGen: Subject')
  })

  it('leaves a node still carrying the profile name alone', () => {
    expect(slotTitle(node('Pulse'), profile('Pulse'), 'Pulse')).toBe('Pulse')
  })

  it('keeps the shared-name numbering after the purpose', () => {
    expect(slotTitle(node('Subject'), profile('MelGen'), 'Subject 2')).toBe('MelGen: Subject 2')
  })

  it('falls back to the name it was given with no profile or no label', () => {
    expect(slotTitle(node('Subject'), null, 'Subject')).toBe('Subject')
    expect(slotTitle(node(null), profile('MelGen'), 'https://strandz.it/jigdaw/plugins/melgen/')).toBe('https://strandz.it/jigdaw/plugins/melgen/')
  })
})
