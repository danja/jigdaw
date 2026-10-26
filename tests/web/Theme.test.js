// tests/web/Theme.test.js
//
// The light and dark themes. Three things go wrong with a theme and none shows in a DOM without a renderer: the script that picks
// one misbehaves where storage refuses it, a pair of colours that read in one theme does not in the other, and a colour is written
// into a rule instead of a token and stays dark on a light page. So the script is run as the browser runs it, the contrast of the
// pairs is computed from the tokens as written, and the pages are scanned for a colour outside the tokens.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const source = read('web/theme.js')

function run ({ stored = null, dark = false, storageThrows = false, noMatchMedia = false, loading = false } = {}) {
  const data = new Map(stored === null ? [] : [['jigdaw.theme', stored]])
  const refuse = () => { throw new DOMException('storage is blocked', 'SecurityError') }
  const attrs = {}
  const meta = { content: '#14171d', setAttribute (k, v) { if (k === 'content') this.content = v } }
  const window = {
    matchMedia: noMatchMedia ? undefined : query => ({ matches: dark && query === '(prefers-color-scheme: dark)' })
  }
  const storage = storageThrows
    ? { getItem: refuse, setItem: refuse }
    : { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }
  Object.defineProperty(window, 'localStorage', { get () { if (storageThrows === 'access') refuse(); return storage } })
  // While the document is loading its <meta> is not there yet, as in a real head, and appears when the parser reaches it.
  let metaParsed = !loading
  const ready = []
  const document = {
    readyState: loading ? 'loading' : 'complete',
    documentElement: { setAttribute: (k, v) => { attrs[k] = v } },
    querySelector: selector => (selector === 'meta[name="theme-color"]' && metaParsed ? meta : null),
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') ready.push(fn) }
  }
  vm.runInNewContext(source, { window, document })
  const finishLoading = () => { metaParsed = true; ready.forEach(fn => fn()) }
  return { attrs, meta, data, theme: window.__jigdawTheme, finishLoading }
}

describe('which theme a page is drawn in', () => {
  it('is light until the person chooses, whatever the device prefers', () => {
    expect(run().attrs['data-theme']).toBe('light')
    expect(run({ dark: true }).attrs['data-theme']).toBe('light')
  })

  it('is the one chosen, and dark stays dark', () => {
    expect(run({ stored: 'dark' }).attrs['data-theme']).toBe('dark')
    expect(run({ stored: 'light', dark: true }).attrs['data-theme']).toBe('light')
  })

  it('follows the device when the choice is auto', () => {
    expect(run({ stored: 'auto', dark: true }).attrs['data-theme']).toBe('dark')
    expect(run({ stored: 'auto', dark: false }).attrs['data-theme']).toBe('light')
  })

  it('is light for auto where the browser cannot say what the device prefers', () => {
    expect(run({ stored: 'auto', noMatchMedia: true }).attrs['data-theme']).toBe('light')
  })

  it('ignores a stored value that is not a theme, rather than drawing with it', () => {
    for (const bad of ['', 'Light', 'blue', '__proto__', 'null']) expect(run({ stored: bad }).attrs['data-theme'], bad).toBe('light')
  })

  it('is light, and does not throw, where storage refuses to be read or even touched', () => {
    expect(run({ storageThrows: true }).attrs['data-theme']).toBe('light')
    expect(run({ storageThrows: 'access' }).attrs['data-theme']).toBe('light')
  })

  it('remembers a choice and draws it at once, and a refusing storage does not stop the change for this visit', () => {
    const page = run()
    expect(page.theme.choose('dark')).toBe('dark')
    expect(page.attrs['data-theme']).toBe('dark')
    expect(page.data.get('jigdaw.theme')).toBe('dark')
    const refused = run({ storageThrows: true })
    expect(refused.theme.choose('dark')).toBe('dark')
    expect(refused.attrs['data-theme']).toBe('dark')
  })

  it('refuses a choice that is not one, and changes nothing', () => {
    const page = run()
    expect(() => page.theme.choose('purple')).toThrow('no such theme: purple')
    expect(page.attrs['data-theme']).toBe('light')
    expect(page.data.has('jigdaw.theme')).toBe(false)
  })

  it('tells a browser what colour to draw its own bar, to agree with the page', () => {
    expect(run().meta.content).toBe('#f4f6f9')
    expect(run({ stored: 'dark' }).meta.content).toBe('#14171d')
  })

  it('paints the browser bar once the page has been parsed, when its meta tag was not there yet for the script that runs in the head', () => {
    const page = run({ loading: true })
    expect(page.meta.content).toBe('#14171d')
    page.finishLoading()
    expect(page.meta.content).toBe('#f4f6f9')
  })

  it('reports the choice, not the resolved theme, so a person who chose auto sees auto', () => {
    expect(run({ stored: 'auto' }).theme.current()).toBe('auto')
    expect(run().theme.current()).toBe('light')
  })
})

// WCAG 2.x contrast of two #rrggbb colours.
const full = hex => (/^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex)
const lum = value => {
  const hex = full(value)
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

/** The tokens a block sets, as { name: value }. */
const tokens = block => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))

const index = read('web/index.html')
const darkBlock = index.match(/  :root \{([\s\S]*?)\n  \}/)[1]
const lightBlock = index.match(/html\[data-theme="light"\] \{([\s\S]*?)\n  \}/)[1]
const THEMES = { dark: tokens(darkBlock), light: tokens(lightBlock) }

// [foreground token or colour, background token, least ratio, what it is]. 4.5 is text, 3 is a line or an outline.
const PAIRS = [
  ['fg', 'bg', 4.5, 'text on the page'], ['fg', 'panel', 4.5, 'text on a panel'], ['fg', 'lane', 4.5, 'text on a lane'],
  ['fg', 'raised', 4.5, 'text on a raised surface'], ['fg', 'control', 4.5, 'a button label'], ['fg', 'control-hover', 4.5, 'a hovered button label'],
  ['fg', 'field', 4.5, 'text in a field'], ['fg', 'clip-midi', 4.5, 'a MIDI clip label'], ['fg', 'clip-audio', 4.5, 'an audio clip label'],
  ['fg', 'notice-warn', 4.5, 'the recovery notice'], ['fg', 'notice-info', 4.5, 'the carried-over notice'],
  ['dim', 'bg', 4.5, 'quiet text on the page'], ['dim', 'panel', 4.5, 'quiet text on a panel'], ['dim', 'lane', 4.5, 'quiet text on a lane'],
  ['dim', 'raised', 4.5, 'quiet text on a raised surface'],
  ['ok-ink', 'bg', 4.5, 'a success message'], ['ok-ink', 'panel', 4.5, 'a success message on a panel'],
  ['err-ink', 'bg', 4.5, 'an error message'], ['err-ink', 'panel', 4.5, 'an error message on a panel'], ['err-ink', 'lane', 4.5, 'an error message on a lane'],
  ['on-accent', 'accent', 4.5, 'a label on an accent button'], ['#fff', 'accent', 4.5, 'white on an accent button'],
  ['#111', 'err', 4.5, 'a label on a mute or arm fill'], ['#111', 'solo', 4.5, 'a label on a solo fill'],
  ['hilite', 'bg', 3, 'the playhead and selection on the page'], ['hilite', 'lane', 3, 'the playhead and selection on a lane'],
  ['focus', 'bg', 3, 'the focus ring on the page'], ['focus', 'lane', 3, 'the focus ring on a lane'], ['focus', 'panel', 3, 'the focus ring on a panel'],
  ['accent', 'bg', 3, 'an accent border'], ['accent', 'panel', 3, 'an accent border on a panel'],
  ['outline-strong', 'lane', 3, 'a strong outline on a lane'],
  ['play-ink', 'control', 3, 'the green Play icon on its button'], ['rec-ink', 'control', 3, 'the red Record icon on its button'],
  ['#fff', 'play-fill', 3, 'the white Play icon on its filled button'], ['#fff', 'rec-fill', 3, 'the white Record icon on its filled button']
]

describe('the two themes in the studio page', () => {
  it('set exactly the same tokens, so no colour is defined for one theme only', () => {
    expect(Object.keys(THEMES.light).sort()).toEqual(Object.keys(THEMES.dark).sort())
    expect(Object.keys(THEMES.dark).length).toBeGreaterThan(30)
  })

  for (const theme of ['light', 'dark']) {
    for (const [fg, bg, least, what] of PAIRS) {
      it(`${theme}: ${what} (${fg} on ${bg}) reads at ${least} to 1 or better`, () => {
        const t = THEMES[theme]
        const a = fg.startsWith('#') ? fg : t[fg]
        const b = t[bg]
        expect(a, `${fg} is a colour`).toMatch(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
        expect(b, `${bg} is a colour`).toMatch(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
        expect(contrast(a, b)).toBeGreaterThanOrEqual(least)
      })
    }
  }
})

describe('the other pages', () => {
  for (const page of ['web/simple.html', 'web/reel.html']) {
    const text = read(page)
    it(`${page} sets the same tokens in both themes, and loads theme.js before its styles`, () => {
      const dark = tokens(text.match(/  :root \{([\s\S]*?)\n  \}/)[1])
      const light = tokens(text.match(/html\[data-theme="light"\] \{([\s\S]*?)\n  \}/)[1])
      const missing = Object.keys(dark).filter(k => !(k in light) && !['play', 'play-hover', 'rec', 'rec-hover', 'warn'].includes(k))
      expect(missing).toEqual([])
      expect(text.indexOf('<script src="theme.js"></script>')).toBeGreaterThan(-1)
      expect(text.indexOf('<script src="theme.js"></script>')).toBeLessThan(text.indexOf('<style>'))
    })
  }

  it('the studio loads theme.js before its styles too, so the page is never drawn in the wrong theme first', () => {
    expect(index.indexOf('<script src="theme.js"></script>')).toBeGreaterThan(-1)
    expect(index.indexOf('<script src="theme.js"></script>')).toBeLessThan(index.indexOf('<style>'))
  })
})

describe('a colour written into a rule instead of a token', () => {
  // What stays literal on purpose: white and near-black for text on a coloured fill, which reads on both themes, the amber of a
  // chosen note, the dark tick on a swatch, which sits on the person's own colour, and the blue half of a skin's two-colour focus ring,
  // which is white beside it, so one of the two reads on any page.
  const ALLOWED = new Set(['#fff', '#ffffff', '#111', '#000', '#f5a524', '#0b1220', '#1d4ed8'])
  const files = ['web/index.html', 'web/simple.html', 'web/reel.html', 'web/panel.css', 'web/script.css']

  for (const file of files) {
    it(`${file} has no colour outside its theme tokens but the few that read on both`, () => {
      let css = read(file)
      // The token blocks are where colours are allowed to be written.
      css = css.replace(/  :root \{[\s\S]*?\n  \}\n/, '').replace(/  html\[data-theme="light"\] \{[\s\S]*?\n  \}\n/, '')
      css = css.replace(/<meta[^>]*>/g, '').replace(/<[^>]*(href|src)=[^>]*>/g, '')
      const stray = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0].toLowerCase()).filter(c => !ALLOWED.has(c))
      // A hex colour in markup that is not CSS (an id, an anchor) would show up here, so each is told apart by what follows.
      expect([...new Set(stray)].filter(c => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c) || /^#[0-9a-f]{3}$/.test(c))).toEqual([])
    })
  }
})

describe('the Theme control', () => {
  it('offers the choices theme.js accepts, in a labelled select in Settings', () => {
    const options = [...index.matchAll(/<select id="theme-choice">([\s\S]*?)<\/select>/g)][0][1]
    expect([...options.matchAll(/value="([a-z]+)"/g)].map(m => m[1])).toEqual(run().theme.choices)
    expect(index).toMatch(/<label for="theme-choice">Theme<\/label>/)
    expect(index.indexOf('id="theme-choice"')).toBeGreaterThan(index.indexOf('id="settings-panel"'))
  })

  it('is mounted by the page, after the tabs exist', () => {
    const app = read('web/app.js')
    expect(app).toMatch(/createTheme\(ctx\)\.mount\(\)/)
    expect(app.indexOf('createTheme(ctx).mount()')).toBeGreaterThan(app.indexOf('ctx.show.mount(TABS, ctx.tabs)'))
  })

  it('is cached for offline use, with the other classic scripts', () => {
    expect(read('web/precache.js')).toContain('"path": "theme.js"')
  })
})
