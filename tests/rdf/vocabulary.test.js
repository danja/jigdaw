// tests/rdf/vocabulary.test.js
//
// Binds the vocabulary to everything that uses it, in both directions. This
// walks the repository rather than naming a file, so that adding a vocabulary
// or an example brings it into scope automatically. A guard that names a file
// goes blind the moment the thing it guards moves.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const JIG = 'http://purl.org/stuff/jigdaw/'
const TRN = 'http://purl.org/stuff/transmissions/'

/** Local names used with a prefix in a Turtle file, ignoring comments. */
function terms (path, namespace, prefix) {
  const found = new Set()
  for (let line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trimStart().startsWith('@')) line = line.split('#')[0]
    for (const m of line.matchAll(new RegExp(`\\b${prefix}:([A-Za-z][A-Za-z0-9_]*)`, 'g'))) found.add(m[1])
    for (const m of line.matchAll(new RegExp(`<${namespace}([A-Za-z][A-Za-z0-9_]*)>`, 'g'))) found.add(m[1])
  }
  return found
}

const allExamples = readdirSync(join(root, 'examples'))
  .filter(f => f.endsWith('.ttl'))
  .map(f => join(root, 'examples', f))

// A counterexample exists to contain invalid content, and some of that content
// is a term the vocabulary does not declare. So it is exempt from the "every
// term is declared" direction, and only from that one.
const valid = allExamples.filter(f => !f.includes('counterexample'))

const shapesFile = join(root, 'vocabs/shapes.ttl')
const vocabFile = join(root, 'vocabs/jigdaw.ttl')

describe('the jig: vocabulary', () => {
  it('has at least one example and one shape file to check against', () => {
    // Otherwise every assertion below passes vacuously.
    expect(valid.length).toBeGreaterThan(0)
    expect(allExamples.length).toBeGreaterThan(valid.length)
    expect(terms(shapesFile, JIG, 'jig').size).toBeGreaterThan(0)
  })

  it('declares every term the shapes and examples use', () => {
    const declared = terms(vocabFile, JIG, 'jig')
    const used = new Set([shapesFile, ...valid].flatMap(f => [...terms(f, JIG, 'jig')]))

    // Shape IRIs are minted in jig: following plugin-universe's pu:PluginShape,
    // but they are not vocabulary terms and are deliberately absent from the
    // vocabulary. vocabs/shapes.ttl says so in its header.
    const shapeNames = [...used].filter(t => t.endsWith('Shape') || t.endsWith('Shape_'))
    for (const name of shapeNames) used.delete(name)

    const missing = [...used].filter(t => !declared.has(t)).sort()
    expect(missing, `used but not declared in vocabs/jigdaw.ttl: ${missing.join(', ')}`).toEqual([])
  })

  it('does not use a trn: term that upstream does not declare, except known gaps', () => {
    // trn: is the shared vocabulary. Using a term it does not define means either
    // a typo or an extension that has to be proposed upstream rather than forked.
    const upstream = [
      '/home/danny/github/transmission/vocabs/profile.ttl',
      '/home/danny/github/plugin-universe/vocabs/trn-profile.ttl',
      '/home/danny/github/plugin-universe/vocabs/trn-extensions.ttl'
    ].filter(p => { try { readFileSync(p); return true } catch { return false } })

    if (upstream.length === 0) return // sibling repositories not present

    const declared = new Set(upstream.flatMap(p => [...terms(p, TRN, 'trn')]))
    const used = new Set([shapesFile, ...allExamples].flatMap(f => [...terms(f, TRN, 'trn')]))

    // Known gap, tracked in TODO.md: there is no web plugin format term upstream.
    used.delete('WebAudio')

    const missing = [...used].filter(t => !declared.has(t)).sort()
    expect(missing, `trn: terms not declared upstream: ${missing.join(', ')}`).toEqual([])
  })
})
