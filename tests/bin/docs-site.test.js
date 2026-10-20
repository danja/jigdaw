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

  it('publishes every document that is not hidden, so a new one is in or out on purpose', () => {
    const docs = readdirSync(join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
    const published = readdirSync(out).filter(f => f.endsWith('.html')).map(f => f.slice(0, -5))
    // catalogue.html is generated from plugins/index.json, not from a document.
    expect(published.sort()).toEqual([...docs.filter(n => !HIDDEN.includes(n)), 'catalogue'].sort())
    // Design notes under docs/plugins/ are working notes and have no page.
    expect(published.filter(n => n.endsWith('-design'))).toEqual([])
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
    const architecture = readFileSync(join(out, 'architecture.html'), 'utf8')
    expect(architecture).toMatch(/href="https:\/\/github.com\/danja\/jigdaw\/blob\/main\/docs\/(plan|first-thoughts|local-references)\.md"/)
    expect(architecture).not.toContain('href="plan.html"')
    expect(architecture).not.toMatch(/<a href="first-thoughts\.html"/)
  })

  it('lists every plugin in plugins/index.json on the catalogue page, with its screenshot', () => {
    const { plugins } = JSON.parse(readFileSync(join(root, 'plugins/index.json'), 'utf8'))
    const html = readFileSync(join(out, 'catalogue.html'), 'utf8')
    for (const { iri, label } of plugins) {
      const name = iri.replace(/\/$/, '').split('/').pop()
      expect(html, label).toContain(`plugins/${name}/profile.ttl`)
      expect(existsSync(join(out, 'shots', `${name}.png`)), `shots/${name}.png`).toBe(true)
    }
  })

  it('gives the home page its five links', () => {
    const index = readFileSync(join(out, 'index.html'), 'utf8')
    for (const href of ['host-plugin-contract.html', 'for-hosts.html', 'for-plugin-authors.html', 'catalogue.html', 'https://strandz.it/jigdaw/simple.html']) {
      expect(index, href).toContain(`href="${href}"`)
    }
  })
})
