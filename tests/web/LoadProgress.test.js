// tests/web/LoadProgress.test.js
//
// The bar shown while a session opens. It is a status region with words as well as a bar, it goes away on a clean
// open, and a failure stays in words until dismissed: a preset that opened with one plugin missing used to look
// exactly like one that had opened.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { createLoadProgress, pluginName } from '../../web/app/LoadProgress.js'

function make () {
  const { document } = parseHTML('<!doctype html><body></body>')
  return { document, progress: createLoadProgress(document) }
}
const text = progress => progress.element.querySelector('span').textContent

describe('pluginName', () => {
  it('is the last part of the IRI', () => {
    expect(pluginName('https://strandz.it/jigdaw/plugins/monochord/')).toBe('monochord')
    expect(pluginName('http://localhost:8748/plugins/ferrite')).toBe('ferrite')
  })
  it('keeps something that is not an IRI as it is', () => {
    expect(pluginName('not an iri')).toBe('not an iri')
  })
})

describe('the loading bar', () => {
  it('is hidden until something loads, and is a status region', () => {
    const { progress } = make()
    expect(progress.element.hidden).toBe(true)
    expect(progress.element.getAttribute('role')).toBe('status')
  })

  it('says which plugin and how many, in words and on the bar', () => {
    const { progress } = make()
    progress.loading('https://strandz.it/jigdaw/plugins/monochord/', 2, 4)
    expect(progress.element.hidden).toBe(false)
    expect(text(progress)).toBe('Loading monochord, 2 of 4')
    const bar = progress.element.querySelector('progress')
    expect([bar.max, bar.value]).toEqual([4, 1])
    expect(bar.getAttribute('aria-label')).toBe('Loading monochord, 2 of 4')
  })

  it('goes away after a clean open', () => {
    const { progress } = make()
    progress.loading('https://x.test/plugins/a/', 1, 1)
    progress.finished({ loaded: new Set(['a']), total: 1, errors: [] })
    expect(progress.element.hidden).toBe(true)
  })

  it('stays after a failure, says how many loaded and why, and can be dismissed', () => {
    const { progress } = make()
    progress.loading('https://x.test/plugins/a/', 1, 4)
    progress.finished({ loaded: new Set(['a', 'b', 'c']), total: 4, errors: ['node-2: 404 for monochord'] })
    expect(progress.element.hidden).toBe(false)
    expect(text(progress)).toBe('Something went wrong: 3 of 4 plugins loaded. node-2: 404 for monochord')
    const dismiss = progress.element.querySelector('button')
    expect(dismiss.hidden).toBe(false)
    dismiss.click()
    expect(progress.element.hidden).toBe(true)
  })

  it('shows no dismiss button, and a fresh bar, when the next open starts', () => {
    const { progress } = make()
    progress.finished({ loaded: new Set(), total: 1, errors: ['x'] })
    progress.loading('https://x.test/plugins/b/', 1, 2)
    expect(progress.element.querySelector('button').hidden).toBe(true)
    expect(progress.element.querySelector('progress').hidden).toBe(false)
  })
})

describe('the pages that open sessions', () => {
  it('Sessions.js builds the bar and tells it about each plugin and the outcome', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../web/app/Sessions.js'), 'utf8')
    expect(source).toContain('createLoadProgress(document)')
    expect(source).toContain('progress.loading(iri, index, total)')
    expect(source).toContain('progress.finished(opened)')
  })

  it('the simple page does not call a tune with a missing plugin ready', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../web/simple.js'), 'utf8')
    expect(source).toMatch(/opened\.errors\.length > 0\) log\(`\$\{tune\.label\} opened with/)
  })
})
