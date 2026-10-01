// tests/ui/ScriptPanel.test.js
//
// The Script tab's panel against the interface rules in CLAUDE.md, checked as rules: what a screen reader is
// told, what is reachable by keyboard, what is left out rather than shown disabled, and that no state is
// colour alone. linkedom has no renderer, so layout and focus are checked by the calls made, as in
// tests/ui/Tabs.test.js; the page itself is checked in a browser.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createScriptPanel, REEL_EXAMPLE } from '../../src/ui/ScriptPanel.js'

let document
let mount
let calls

beforeEach(() => {
  ({ document } = parseHTML('<!doctype html><body><div id="mount"></div></body>'))
  mount = document.getElementById('mount')
  calls = { run: [], check: [], stop: 0 }
})

const make = (over = {}) => createScriptPanel(document, {
  mount,
  onRun: (source, options) => calls.run.push([source, options]),
  onCheck: source => calls.check.push(source),
  onStop: () => { calls.stop++ },
  ...over
})

const event = (type, props = {}) => {
  const e = new document.defaultView.Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, props)
  return e
}
const click = node => node.dispatchEvent(event('click'))
const memoryStorage = (initial = {}) => {
  const data = { ...initial }
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v }, data }
}

describe('what it is to a screen reader', () => {
  it('gives the text area a visible label, and describes it by its help and its status', () => {
    const p = make()
    const { source } = p.elements
    const label = mount.querySelector(`label[for="${source.id}"]`)
    expect(label.textContent).toBe('Reel script')
    expect(source.getAttribute('aria-describedby')).toBe('script-help script-status')
    expect(document.getElementById('script-help')).not.toBeNull()
    expect(document.getElementById('script-status').getAttribute('role')).toBe('status')
  })

  it('names every button in words and announces the shortcuts it has', () => {
    const p = make()
    expect(p.elements.run.textContent).toBe('Run at the next bar')
    expect(p.elements.runNow.textContent).toBe('Run now')
    expect(p.elements.check.textContent).toBe('Check only')
    expect(p.elements.run.getAttribute('aria-keyshortcuts')).toBe('Control+Enter')
    expect(p.elements.runNow.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+Enter')
    expect(mount.querySelector('[role=group]').getAttribute('aria-label')).toBe('Script actions')
  })

  it('makes every button a real button, so it is in the Tab order and works from the keyboard', () => {
    const p = make()
    for (const b of mount.querySelectorAll('button')) expect(b.getAttribute('type')).toBe('button')
    expect(p.elements.source.tagName).toBe('TEXTAREA')
  })

  it('turns off the helps that fight a person typing code, so a phone does not mangle a script', () => {
    const { source } = make().elements
    expect(source.getAttribute('spellcheck')).toBe('false')
    expect(source.getAttribute('autocapitalize')).toBe('off')
    expect(source.getAttribute('autocorrect')).toBe('off')
  })

  it('explains the syntax in a disclosure, as a definition list', () => {
    make()
    expect(mount.querySelector('details summary').textContent).toBe('Syntax')
    const terms = [...mount.querySelectorAll('details dt')].map(t => t.textContent)
    expect(terms.some(t => t.startsWith('load '))).toBe(true)
    expect(terms.some(t => t.startsWith('every '))).toBe(true)
    expect(terms.some(t => t.startsWith('ramp '))).toBe(true)
  })

  it('announces the log politely, so a failing firing is heard without taking over', () => {
    expect(make().elements.logList.getAttribute('aria-live')).toBe('polite')
  })
})

describe('what is left out until it can be used', () => {
  it('has no Stop until something runs, and no problems or plan until there are some', () => {
    const p = make()
    expect(p.elements.stop.hasAttribute('hidden')).toBe(true)
    expect(p.elements.problems.hasAttribute('hidden')).toBe(true)
    expect(p.elements.plan.hasAttribute('hidden')).toBe(true)
    for (const b of mount.querySelectorAll('button')) expect(b.hasAttribute('disabled')).toBe(false)
  })

  it('shows Stop while a script runs and takes it away after', () => {
    const p = make()
    p.running(true)
    expect(p.elements.stop.hasAttribute('hidden')).toBe(false)
    p.running(false)
    expect(p.elements.stop.hasAttribute('hidden')).toBe(true)
  })
})

describe('running it', () => {
  it('runs at the next bar from the button, with the text as it stands', () => {
    const p = make()
    p.setSource('a.mix = 1')
    click(p.elements.run)
    expect(calls.run).toEqual([['a.mix = 1', { now: false }]])
  })

  it('runs now from its own button', () => {
    const p = make()
    p.setSource('a.mix = 1')
    click(p.elements.runNow)
    expect(calls.run).toEqual([['a.mix = 1', { now: true }]])
  })

  it('checks without running', () => {
    const p = make()
    p.setSource('x')
    click(p.elements.check)
    expect(calls.check).toEqual(['x'])
    expect(calls.run).toEqual([])
  })

  it('stops', () => {
    const p = make()
    p.running(true)
    click(p.elements.stop)
    expect(calls.stop).toBe(1)
  })

  it('refuses to be built without the three things it calls', () => {
    expect(() => createScriptPanel(document, { mount, onRun () {}, onCheck () {} })).toThrow(/needs onStop/)
    expect(() => createScriptPanel(document, { mount })).toThrow(/needs onRun/)
  })
})

describe('the keyboard', () => {
  const key = (p, props) => {
    const e = event('keydown', props)
    p.elements.source.dispatchEvent(e)
    return e
  }

  it('runs on Control+Enter, from inside the box, and keeps the newline out of the script', () => {
    const p = make()
    p.setSource('s')
    const e = key(p, { key: 'Enter', ctrlKey: true })
    expect(calls.run).toEqual([['s', { now: false }]])
    expect(e.defaultPrevented).toBe(true)
  })

  it('runs now on Control+Shift+Enter, and takes Command as Control on a Mac', () => {
    const p = make()
    p.setSource('s')
    key(p, { key: 'Enter', ctrlKey: true, shiftKey: true })
    key(p, { key: 'Enter', metaKey: true })
    expect(calls.run.map(c => c[1].now)).toEqual([true, false])
  })

  it('leaves a plain Enter and other keys alone, so a script can be typed', () => {
    const p = make()
    const enter = key(p, { key: 'Enter' })
    const other = key(p, { key: 'a', ctrlKey: true })
    expect(calls.run).toEqual([])
    expect(enter.defaultPrevented).toBe(false)
    expect(other.defaultPrevented).toBe(false)
  })
})

describe('the draft', () => {
  it('starts from an example with nothing to run, so pressing Run on it does no harm', () => {
    const p = make()
    expect(p.source()).toBe(REEL_EXAMPLE)
    expect(REEL_EXAMPLE.split('\n').filter(Boolean).every(l => l.startsWith('#'))).toBe(true)
  })

  it('restores what was typed last time, and keeps what is typed', () => {
    const storage = memoryStorage({ 'jigdaw.reel.draft': 'a.mix = 0.5' })
    const p = make({ storage })
    expect(p.source()).toBe('a.mix = 0.5')
    p.elements.source.value = 'a.mix = 0.9'
    p.elements.source.dispatchEvent(event('input'))
    expect(storage.data['jigdaw.reel.draft']).toBe('a.mix = 0.9')
  })

  it('works when storage throws, as it does in a private window or with site data blocked', () => {
    const storage = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') } }
    const p = make({ storage })
    expect(p.source()).toBe(REEL_EXAMPLE)
    p.setSource('x')
    expect(p.source()).toBe('x')
    p.elements.source.dispatchEvent(event('input'))
  })

  it('works with no storage at all', () => {
    expect(make({ storage: null }).source()).toBe(REEL_EXAMPLE)
  })
})

describe('problems', () => {
  it('lists each with its line and column, saying Error in words and not by colour', () => {
    const p = make()
    p.problems([{ line: 3, column: 5, message: 'no plugin called "x"' }, { line: 7, message: 'bad' }])
    const items = [...p.elements.problems.querySelectorAll('li')]
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Error')
    expect(items[0].textContent).toContain('Line 3, column 5: no plugin called "x"')
    expect(items[1].textContent).toContain('Line 7: bad')
    expect(p.elements.problems.hasAttribute('hidden')).toBe(false)
    expect(document.getElementById('script-problems-heading').textContent).toBe('Problems (2)')
  })

  it('gives each a button that moves the caret to its line, named with the line', () => {
    const p = make()
    p.setSource('first\nsecond line\nthird')
    p.problems([{ line: 2, message: 'm' }])
    const go = p.elements.problems.querySelector('button')
    expect(go.getAttribute('aria-label')).toBe('Go to line 2')
    let focused = 0
    let range = null
    p.elements.source.focus = () => { focused++ }
    p.elements.source.setSelectionRange = (a, b) => { range = [a, b] }
    click(go)
    expect(focused).toBe(1)
    expect(range).toEqual([6, 17]) // "second line", the second line
  })

  it('leaves out the button for a problem that has no line', () => {
    const p = make()
    p.problems([{ line: null, message: 'a script is limited to 500 statements' }])
    expect(p.elements.problems.querySelector('button')).toBeNull()
  })

  it('clamps a line past the end, rather than failing', () => {
    const p = make()
    p.setSource('only')
    let range = null
    p.elements.source.focus = () => {}
    p.elements.source.setSelectionRange = (a, b) => { range = [a, b] }
    p.goToLine(99)
    expect(range).toEqual([0, 4])
    p.goToLine(0)
    expect(range).toEqual([0, 4])
  })

  it('takes the section away when there are none, and replaces what was there', () => {
    const p = make()
    p.problems([{ line: 1, message: 'a' }])
    p.problems([{ line: 2, message: 'b' }])
    expect(p.elements.problems.querySelectorAll('li')).toHaveLength(1)
    p.problems(null)
    expect(p.elements.problems.hasAttribute('hidden')).toBe(true)
    p.problems([])
    expect(p.elements.problems.hasAttribute('hidden')).toBe(true)
  })
})

describe('the plan', () => {
  it('lists the loads and the steps with their lines and times', () => {
    const p = make()
    p.plan({
      loads: [{ name: 'a', iri: 'https://x/', line: 1 }],
      steps: [{ line: 2, when: 'now', do: 'set a.mix' }, { line: 3, when: 'every 4 beats', do: 'set a.cutoff' }]
    })
    const items = [...p.elements.plan.querySelectorAll('li')].map(i => i.textContent)
    expect(items).toEqual(['Line 1: load a from https://x/', 'Line 2, now: set a.mix', 'Line 3, every 4 beats: set a.cutoff'])
    expect(p.elements.plan.hasAttribute('hidden')).toBe(false)
  })

  it('says so for a script with nothing in it, and goes away when asked', () => {
    const p = make()
    p.plan({ loads: [], steps: [] })
    expect(p.elements.plan.querySelector('li').textContent).toMatch(/no statements/)
    p.plan(null)
    expect(p.elements.plan.hasAttribute('hidden')).toBe(true)
  })
})

describe('the status and the log', () => {
  it('sets and clears the status, which a screen reader announces', () => {
    const p = make()
    p.status('Waiting for the next bar line')
    expect(p.elements.status.textContent).toBe('Waiting for the next bar line')
    p.status('')
    expect(p.elements.status.textContent).toBe('')
    p.status(undefined)
    expect(p.elements.status.textContent).toBe('')
  })

  it('logs newest first and says Error in words', () => {
    const p = make()
    p.log('started')
    p.log('line 4 failed: gone', 'error')
    const items = [...p.elements.logList.querySelectorAll('li')].map(i => i.textContent)
    expect(items).toEqual(['Error: line 4 failed: gone', 'started'])
  })

  it('keeps the last fifty, so a long set does not grow the page without end', () => {
    const p = make()
    for (let i = 0; i < 80; i++) p.log(`m${i}`)
    const items = p.elements.logList.querySelectorAll('li')
    expect(items).toHaveLength(50)
    expect(items[0].textContent).toBe('m79')
    expect(items[49].textContent).toBe('m30')
  })
})
