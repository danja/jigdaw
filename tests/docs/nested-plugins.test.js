// tests/docs/nested-plugins.test.js
//
// docs/nested-plugins.md makes claims about the system, and nothing else tests sentences. These
// tests take the claims that can be checked and check them: the example is a valid composite, the
// terms it names exist, the files it points at exist, and each rule it lists is guarded by a test
// that is really there. A document that cites a test that was renamed is a rule nobody enforces.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseText } from '../../src/rdf/parse.js'
import { readComposite, checkComposite } from '../../src/rdf/CompositeReader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const spec = read('docs/nested-plugins.md')

const turtleBlocks = [...spec.matchAll(/```turtle\n([\s\S]*?)```/g)].map(m => m[1])

describe('docs/nested-plugins.md', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('has an example to check', () => {
    // Otherwise the checks below pass vacuously.
    expect(turtleBlocks.length).toBeGreaterThan(0)
  })

  it('shows a composite that validates against the shapes', async () => {
    const dataset = await parseText(turtleBlocks[0], 'https://example.org/racks/stomp/')
    const report = await validator.validate(dataset)
    expect(report.violations.map(v => `${v.focusNode} ${v.path ?? ''}: ${v.message}`)).toEqual([])
    expect(report.conforms).toBe(true)
  })

  it('shows a composite the reader finds sound, with the members and controls it describes', async () => {
    const composite = readComposite(await parseText(turtleBlocks[0], 'https://example.org/racks/stomp/'))
    expect(checkComposite(composite)).toEqual([])
    expect(composite.members.map(m => m.plugin).sort()).toEqual([
      'https://strandz.it/jigdaw/plugins/boost/', 'https://strandz.it/jigdaw/plugins/tremolo/'
    ])
    expect(composite.ports.map(p => p.symbol).sort()).toEqual(['depth', 'drive'])
    expect(composite.members.find(m => m.plugin.endsWith('/tremolo/')).settings).toEqual([{ symbol: 'rate', value: 4.5 }])
  })

  it('names only jig: terms the vocabulary declares', () => {
    const vocabulary = read('vocabs/jigdaw.ttl')
    const declared = new Set([...vocabulary.matchAll(/^jig:([A-Za-z]+)\s/gm)].map(m => m[1]))
    // A shape is minted in jig: but is not a vocabulary term (vocabs/shapes.ttl says so).
    const named = new Set([...spec.matchAll(/\bjig:([A-Za-z]+)\b/g)].map(m => m[1]).filter(name => !name.endsWith('Shape')))
    const undeclared = [...named].filter(name => !declared.has(name)).sort()
    expect(undeclared, `named in the document and not in vocabs/jigdaw.ttl: ${undeclared.join(', ')}`).toEqual([])
    // And the five terms it says are new are all there.
    for (const term of ['CompositePlugin', 'Member', 'member', 'pinnedDigest', 'drives']) expect(declared.has(term), term).toBe(true)
  })

  it('points only at source, tool and test files that exist', () => {
    const paths = new Set([...spec.matchAll(/`((?:src|bin|tests|examples|vocabs|native)\/[A-Za-z0-9_./-]+\.[a-z]+)`/g)].map(m => m[1]))
    expect(paths.size).toBeGreaterThan(5)
    const missing = [...paths].filter(path => !existsSync(resolve(root, path)))
    expect(missing, `named in the document and not in the repository: ${missing.join(', ')}`).toEqual([])
  })

  describe('the table of rules and their tests', () => {
    const rows = [...spec.matchAll(/^\| (.+?) \| ([\d., ]+) \| `([^`]+)`, "([^"]+)" \|$/gm)]
      .map(([, rule, section, file, title]) => ({ rule, section, file, title }))

    it('has a row for each rule it lists', () => {
      expect(rows.length).toBeGreaterThanOrEqual(15)
    })

    for (const row of rows) {
      it(`binds "${row.rule}" to a test that exists`, () => {
        expect(existsSync(resolve(root, row.file)), `${row.file} does not exist`).toBe(true)
        // The quoted title is a fragment of the test's name or of the file it counts, so a rename breaks this.
        expect(read(row.file), `${row.file} has no test or fixture called "${row.title}"`).toContain(row.title)
      })
    }
  })

  it('has no em dashes', () => {
    expect(spec.includes(String.fromCharCode(0x2014))).toBe(false)
  })
})
