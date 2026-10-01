// tests/web/View.test.js
//
// Runs web/view.js as the browser does, against a stand-in window whose storage refuses what real storage
// refuses (a throw, as a blocked browser gives), and checks which page a person is sent to.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const source = readFileSync(resolve(import.meta.dirname, '../../web/view.js'), 'utf8')

function run ({ path = '/', search = '', narrow = false, stored = null, storageThrows = false, noMatchMedia = false } = {}) {
  const data = new Map(stored === null ? [] : [['jigdaw.view', stored]])
  const replaced = []
  const refuse = () => { throw new DOMException('storage is blocked', 'SecurityError') }
  const localStorage = storageThrows
    ? { getItem: refuse, setItem: refuse, removeItem: refuse }
    : { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }
  const window = {
    location: { pathname: path, search, replace: url => replaced.push(url) },
    matchMedia: noMatchMedia ? undefined : query => ({ matches: narrow && query === '(max-width: 720px)' })
  }
  Object.defineProperty(window, 'localStorage', { get () { if (storageThrows === 'access') refuse(); return localStorage } })
  vm.runInNewContext(source, { window })
  return { replaced, data }
}

describe('which page a person starts on', () => {
  it('sends a phone to the simple page, by default', () => {
    expect(run({ narrow: true }).replaced).toEqual(['simple.html'])
  })

  it('leaves a wide screen on the studio', () => {
    expect(run({ narrow: false }).replaced).toEqual([])
  })

  it('leaves a phone on the studio when it asked for it, and remembers that', () => {
    const asked = run({ narrow: true, search: '?studio' })
    expect(asked.replaced).toEqual([])
    expect(asked.data.get('jigdaw.view')).toBe('studio')
    expect(run({ narrow: true, stored: 'studio' }).replaced).toEqual([])
  })

  it('treats ?studio among other parameters as asking, and a parameter that only starts with it as not', () => {
    expect(run({ narrow: true, search: '?x=1&studio' }).replaced).toEqual([])
    expect(run({ narrow: true, search: '?studio=1' }).replaced).toEqual([])
    expect(run({ narrow: true, search: '?studios' }).replaced).toEqual(['simple.html'])
  })

  it('forgets the choice when the person is on the simple page, so the next start is simple again', () => {
    const { data, replaced } = run({ path: '/jigdaw/simple.html', narrow: true, stored: 'studio' })
    expect(data.has('jigdaw.view')).toBe(false)
    expect(replaced).toEqual([])
  })

  it('works under a path, and never redirects the simple page to itself', () => {
    expect(run({ path: '/jigdaw/', narrow: true }).replaced).toEqual(['simple.html'])
    expect(run({ path: '/simple.html', narrow: true }).replaced).toEqual([])
  })

  it('still sends a phone to the simple page when storage is blocked, and does not fail', () => {
    expect(run({ narrow: true, storageThrows: true }).replaced).toEqual(['simple.html'])
    expect(run({ narrow: true, storageThrows: 'access' }).replaced).toEqual(['simple.html'])
    expect(run({ narrow: true, storageThrows: true, search: '?studio' }).replaced).toEqual([])
  })

  it('does nothing in a browser with no media queries', () => {
    expect(run({ narrow: true, noMatchMedia: true }).replaced).toEqual([])
  })
})

describe('the pages that use it', () => {
  const page = name => readFileSync(resolve(import.meta.dirname, `../../web/${name}`), 'utf8')
  it('both load it, after the viewport is declared and before anything else is fetched', () => {
    for (const name of ['index.html', 'simple.html']) {
      const html = page(name)
      expect(html.indexOf('<meta name="viewport"'), name).toBeGreaterThan(-1)
      expect(html.indexOf('<script src="view.js"></script>'), name).toBeGreaterThan(html.indexOf('<meta name="viewport"'))
      expect(html.indexOf('<script src="view.js"></script>'), name).toBeLessThan(html.indexOf('rel="manifest"'))
    }
  })

  it('every link from the simple page to the studio asks for it, and the studio\'s link to the simple page does not', () => {
    const simple = page('simple.html')
    const toStudio = [...simple.matchAll(/<a[^>]*href="(\.\/[^"]*)"/g)].map(m => m[1])
    expect(toStudio.length).toBeGreaterThanOrEqual(2)
    expect(toStudio.every(href => href === './?studio')).toBe(true)
    expect(page('index.html')).toContain('href="simple.html"')
  })
})
