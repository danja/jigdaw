// tests/docs/conventions.test.js
//
// The rules in AGENTS.md that a careful reader would otherwise have to enforce.
// AGENTS.md says a rule worth stating is worth a test; these are those tests.
//
// Every check walks the repository through `git ls-files` rather than naming
// files, so adding a document brings it into scope automatically. A guard that
// names a file goes blind the moment the thing it guards moves.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join, dirname, extname } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean)

const read = p => readFileSync(join(root, p), 'utf8')
const byExt = (...exts) => tracked.filter(f => exts.includes(extname(f)))

describe('repository conventions', () => {
  it('finds the tracked files it is meant to check', () => {
    // Otherwise every assertion below passes vacuously, which is the failure
    // mode these guards exist to prevent in the first place.
    expect(tracked.length).toBeGreaterThan(20)
    expect(byExt('.md').length).toBeGreaterThan(10)
  })

  // AGENTS.md, documentation rules: "Technical plain English. No em dashes."
  it('uses no em dashes', () => {
    const offenders = []
    for (const f of byExt('.md', '.ttl', '.js')) {
      read(f).split('\n').forEach((line, i) => {
        if (line.includes('—')) offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders, `em dashes at:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  // A published link that does not resolve is the "contact page that 404s"
  // failure from plugin-universe's table, in miniature.
  it('has no broken internal markdown links', () => {
    const broken = []
    for (const f of byExt('.md')) {
      const body = read(f)
      for (const m of body.matchAll(/\]\(([^)#\s]+\.md)(#[^)\s]*)?\)/g)) {
        const target = m[1]
        if (/^https?:/.test(target)) continue
        const candidates = [join(root, dirname(f), target), join(root, target)]
        if (!candidates.some(existsSync)) broken.push(`${f} -> ${target}`)
      }
    }
    expect(broken, `broken links:\n  ${broken.join('\n  ')}`).toEqual([])
  })

  // A document nothing links to is reachable only by knowing it is there.
  it('leaves no document unreferenced', () => {
    const docs = tracked.filter(f => f.startsWith('docs/') && f.endsWith('.md'))
    const orphans = docs.filter(doc => {
      const name = doc.slice('docs/'.length)
      return !tracked
        .filter(f => f.endsWith('.md') && f !== doc)
        .some(f => read(f).includes(name))
    })
    expect(orphans, `unreferenced: ${orphans.join(', ')}`).toEqual([])
  })

  // AGENTS.md, repository conventions: "Every source file opens with a path
  // comment, as `// src/rdf/Vocabulary.js`."
  it('opens every source file with its own path', () => {
    const wrong = []
    for (const f of byExt('.js')) {
      const first = read(f).split('\n')[0].trim()
      if (first !== `// ${f}`) wrong.push(`${f} starts with ${JSON.stringify(first)}`)
    }
    expect(wrong, `path comments:\n  ${wrong.join('\n  ')}`).toEqual([])
  })
})
