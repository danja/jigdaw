// tests/bin/docs-site.test.js
//
// Runs the real site build and reads what it wrote: a document kept off the
// site must not be in the output, nothing published may link to a page that
// is not there, and a link to a hidden document must go to the repository.
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { HIDDEN_DOCS } from '../../bin/docs-hidden.js'

const root = resolve(import.meta.dirname, '../..')
// Its own folder: tests/docs/conventions.test.js builds into docs-site/, and two builds of one
// folder at once read each other's half-written pages.
const out = mkdtempSync(join(tmpdir(), 'jigdaw-docs-'))
const HIDDEN = HIDDEN_DOCS

beforeAll(() => { execFileSync('node', ['bin/build-docs-site.js'], { cwd: root, stdio: 'pipe', env: { ...process.env, DOCS_OUT: out } }) }, 60000)

describe('the documentation site', () => {
  it('leaves out the documents that are only for the repository, and they still exist there', () => {
    for (const name of HIDDEN) {
      expect(existsSync(join(root, 'docs', `${name}.md`)), `${name}.md`).toBe(true)
      expect(existsSync(join(out, `${name}.html`)), `${name}.html`).toBe(false)
    }
  })

  it('has no link to a page it did not publish', () => {
    const pages = new Set(readdirSync(out).filter(f => f.endsWith('.html')))
    const dead = []
    for (const page of pages) {
      const html = readFileSync(join(out, page), 'utf8')
      for (const [, target] of html.matchAll(/href="([a-zA-Z0-9_-]+\.html)(?:#[^"]*)?"/g)) {
        if (!pages.has(target)) dead.push(`${page} -> ${target}`)
      }
    }
    expect(dead).toEqual([])
  })

  it('sends a link to a hidden document to the repository, and keeps it out of the sidebar', () => {
    const index = readFileSync(join(out, 'index.html'), 'utf8')
    expect(index).toContain('href="https://github.com/danja/jigdaw/blob/main/docs/plan.md"')
    expect(index).not.toContain('href="plan.html"')
    expect(index).not.toMatch(/<a href="first-thoughts\.html"/)
  })
})
