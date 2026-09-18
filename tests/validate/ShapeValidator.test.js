// tests/validate/ShapeValidator.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { shapeValidatorFromFile, validateFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const at = p => resolve(root, p)

// Each counterexample violates every constraint it can, once. The numbers go UP
// when a constraint is added, and the counterexample gains a defect in the same
// change. A number going DOWN on its own means a shape has stopped firing,
// which has happened twice and is why these files exist. See MISTAKES.md.
const EXPECTED = {
  'examples/reference-profile.ttl': 0,
  'examples/session-project.ttl': 0,
  'plugins/cascade/profile.ttl': 0,
  'plugins/pulse/profile.ttl': 0,
  'plugins/bassgen/profile.ttl': 0,
  'examples/reference-provenance.ttl': 0,
  'examples/counterexample-profile.ttl': 9,
  'examples/counterexample-project.ttl': 10,
  'examples/counterexample-provenance.ttl': 11
}

describe('ShapeValidator', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(at('vocabs/shapes.ttl')) })

  for (const [file, count] of Object.entries(EXPECTED)) {
    it(`${file} produces ${count} violation(s)`, async () => {
      const report = await validateFile(validator, at(file))
      const seen = report.violations.map(v => `${v.focusNode} ${v.path ?? '(node)'}`)
      expect(seen.length, `violations:\n  ${seen.join('\n  ')}`).toBe(count)
      expect(report.conforms).toBe(count === 0)
    })
  }

  it('reports a graph with only warnings as conformant', async () => {
    // SHACL section 3.6. rdf-validate-shacl reports conforms: false for a
    // warning; ShapeValidator corrects that. Without the correction, callers
    // that refuse to store a non-conformant graph would reject this one.
    const shapes = `
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix ex: <http://example.org/> .
      ex:S a sh:NodeShape ; sh:targetClass ex:Thing ;
        sh:property [ sh:path ex:label ; sh:minCount 1 ; sh:severity sh:Warning ] .`
    const data = '@prefix ex: <http://example.org/> . ex:a a ex:Thing .'

    const { parseTurtleFile } = await import('../../src/validate/files.js')
    const { writeFile, mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'jigdaw-'))
    await writeFile(join(dir, 's.ttl'), shapes)
    await writeFile(join(dir, 'd.ttl'), data)

    const v = await shapeValidatorFromFile(join(dir, 's.ttl'))
    const report = await v.validate(await parseTurtleFile(join(dir, 'd.ttl'), 'urn:t'))

    expect(report.warnings).toHaveLength(1)
    expect(report.violations).toHaveLength(0)
    expect(report.conforms).toBe(true)
  })
})
