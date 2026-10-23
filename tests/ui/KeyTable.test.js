// tests/ui/KeyTable.test.js
//
// The list of shortcuts is only worth showing if it is true. Each row's keys are fired at the real control built the way the
// page builds it, and the control must react exactly once; a key the table does not list must not. A second test walks
// every source file that handles keydown, so a handler cannot be added without being listed or given a reason.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { KEY_ROWS, KEY_SCOPES, UNLISTED_KEY_FILES } from '../../src/ui/KeyTable.js'
import { createKeysOverlay } from '../../src/ui/KeysOverlay.js'
import { createClipButton } from '../../src/ui/ClipButton.js'
import { createTrackHeader } from '../../src/ui/TrackHeader.js'
import { createChainStrip } from '../../src/ui/ChainStrip.js'
import { createEnvelopeLane, LANE_HEIGHT } from '../../src/ui/EnvelopeLane.js'
import { createScriptPanel } from '../../src/ui/ScriptPanel.js'
import { createLayout } from '../../web/app/Layout.js'
import { createHistory } from '../../web/app/History.js'
import { createKeys } from '../../web/app/Keys.js'
import { isPanicShortcut } from '../../web/app/Transport.js'
import { TimeView } from '../../src/ui/TimeView.js'
import { Selection } from '../../src/model/Selection.js'

const page = () => parseHTML('<!doctype html><html><body><main></main></body></html>')
// linkedom has no KeyboardEvent: a plain event carrying the fields the handlers read.
const keydown = (window, init) => Object.assign(new window.Event('keydown', { cancelable: true, bubbles: true }), init)
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

// Each binder builds the real control and returns press(init): how many times it reacted.
const BINDERS = {
  clip () {
    return init => {
      const { document, window } = page()
      const calls = []
      const rec = name => (...a) => calls.push([name, ...a])
      const names = ['onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onMute', 'onCopy', 'onCut', 'onPaste', 'onLock', 'onTrim']
      const view = new TimeView()
      const make = createClipButton(document, { ppb: () => view.pixelsPerBeat, view, selection: new Selection(), ...Object.fromEntries(names.map(n => [n, rec(n)])) })
      const button = make({ id: 'c1', kind: 'midi', startBeat: 4, lengthBeats: 8, notes: [] }, { beatsPerBar: 4, playsIntoNothing: false, peaks: null })
      document.body.append(button)
      button.dispatchEvent(keydown(window, init))
      return calls.length
    }
  },
  track () {
    return init => {
      const { document, window } = page()
      const calls = []
      const rec = name => (...a) => calls.push([name, ...a])
      const header = createTrackHeader(document, {
        id: 't1', onSelect: rec('select'), onAdd: rec('add'), onAddAudio: rec('addAudio'), onChannel: rec('channel'), onMove: rec('move'), onArm: rec('arm'),
        onDuplicateTrack: rec('duplicate'), onSizeStep: rec('size')
      })
      document.body.append(header.element)
      header.update({ label: 'Bass', channel: { gain: 1, pan: 0, muted: false, soloed: false }, mixable: true, silent: false, at: 8, where: 'bar 3 beat 1' })
      document.getElementById('show-track-t1').dispatchEvent(keydown(window, init))
      return calls.length
    }
  },
  chain () {
    return init => {
      const { document, window } = page()
      const moved = []
      const strip = createChainStrip(document, { onSelect () {}, onBypass () {}, onMove: (id, delta) => moved.push([id, delta]) })
      document.body.append(strip.element)
      const fx = (id, label) => ({ id, label, loaded: true, failed: null, takes: ['audio'], gives: ['audio'], passesAudio: true, takesMidiFromTrack: false, takesAudioFromTrack: false, sends: [], receives: [] })
      strip.update({ nodes: [fx('a', 'EQ'), fx('b', 'Comp'), fx('c', 'Verb')] }, { label: 'Lead', selected: null })
      document.querySelectorAll('.chain-node')[1].dispatchEvent(keydown(window, init))
      return moved.length
    }
  },
  point () {
    return init => {
      const { document, window } = page()
      const changes = []
      const removed = []
      const view = new TimeView()
      view.setGrid('beat')
      const lane = createEnvelopeLane(document, { onChange: (id, pts) => changes.push(pts), onRemove: id => removed.push(id), view })
      document.body.append(lane.element)
      const points = [{ atBeat: 0, value: 50, curve: 'linear' }, { atBeat: 4, value: 50, curve: 'linear' }, { atBeat: 8, value: 50, curve: 'linear' }]
      lane.update({ id: 'e1', label: 'Synth, cutoff', min: 0, max: 100, start: 50, points, speak: v => `${v}`, where: b => `beat ${b}` }, { beatsPerBar: 4, width: 480 })
      lane.element.querySelector('.envelope-body').getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: LANE_HEIGHT })
      document.querySelectorAll('.envelope-point')[1].dispatchEvent(keydown(window, init))
      return changes.length + removed.length
    }
  },
  script () {
    return init => {
      const { document, window } = page()
      document.body.innerHTML = '<div id="mount"></div>'
      const runs = []
      const panel = createScriptPanel(document, { mount: document.getElementById('mount'), onRun: () => runs.push(1), onCheck () {}, onStop () {} })
      panel.elements.source.dispatchEvent(keydown(window, init))
      return runs.length
    }
  },
  browser () {
    return init => {
      const { document, window } = page()
      document.body.innerHTML = '<main></main><button id="toggle-browser"></button><div id="browser"><input id="q"><button id="close-browser"></button></div>'
      const ctx = { document, window, $: id => document.getElementById(id) }
      const layout = createLayout(ctx)
      layout.mount()
      layout.showBrowser(true)
      const wasOpen = !document.getElementById('browser').hidden
      document.getElementById('browser').dispatchEvent(keydown(window, init))
      return wasOpen && document.getElementById('browser').hidden ? 1 : 0
    }
  },
  everywhere () {
    // Undo and redo are the page's own handler; F1 is Keys.js; panic is the predicate web/app.js calls (the wiring in app.js is
    // asserted below by its text, since the page itself cannot be built here).
    return async init => {
      const { document, window } = page()
      document.body.innerHTML = '<div id="history-body"></div><button id="undo"></button><button id="redo"></button><button id="toggle-keys"></button>'
      const calls = []
      const dispatcher = {
        canUndo: () => true, canRedo: () => true, history: () => ({ done: [], undone: [] }),
        undo: async () => { calls.push('undo'); return { ok: true } }, redo: async () => { calls.push('redo'); return { ok: true } }
      }
      const ctx = { document, window, $: id => document.getElementById(id), log () {}, dispatcher }
      createHistory(ctx).mount()
      const keys = createKeys(ctx)
      keys.mount()
      const before = keys.overlay.element.hidden
      const event = keydown(window, init)
      document.dispatchEvent(event)
      await tick()
      const reacted = calls.length + (keys.overlay.element.hidden !== before ? 1 : 0) + (isPanicShortcut(event) ? 1 : 0)
      return reacted
    }
  }
}

describe('the list of shortcuts', () => {
  it('has a binder for every scope it names, and a scope for every row', () => {
    expect(Object.keys(BINDERS).sort()).toEqual(Object.keys(KEY_SCOPES).sort())
    for (const row of KEY_ROWS) expect(Object.keys(KEY_SCOPES), row.keys).toContain(row.scope)
  })

  for (const row of KEY_ROWS) {
    it(`${row.scope}: ${row.keys} does what it says (${row.does})`, async () => {
      expect(row.press.length).toBeGreaterThan(0)
      const press = BINDERS[row.scope]()
      for (const init of row.press) expect(await press(init), JSON.stringify(init)).toBe(1)
    })
  }

  it('is not fooled: a key nobody handles makes no control react', async () => {
    for (const scope of Object.keys(BINDERS)) expect(await BINDERS[scope]()({ key: 'q' }), scope).toBe(0)
  })

  it('has the panic key wired in web/app.js to the predicate the table was checked against', () => {
    const text = readFileSync('web/app.js', 'utf8')
    expect(text).toMatch(/addEventListener\('keydown', event => \{\s*if \(isPanicShortcut\(event\)\)/)
  })
})

describe('every handler of keydown', () => {
  const listed = ['src/ui/ClipButton.js', 'src/ui/TrackHeader.js', 'src/ui/ChainStrip.js', 'src/ui/EnvelopeLane.js', 'src/ui/ScriptPanel.js',
    'web/app/Layout.js', 'web/app/History.js', 'web/app/Keys.js', 'web/app.js', 'src/ui/KeysOverlay.js']
  const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return path.endsWith('.js') && !path.includes('.bundle.') && !path.endsWith('precache.js') ? [path] : []
  })

  it('is either listed or given a reason, so a new shortcut cannot go unlisted unseen', () => {
    const found = [...walk('src'), ...walk('web')].filter(path => /['"]keydown['"]/.test(readFileSync(path, 'utf8')))
    const unknown = found.filter(path => !listed.includes(path) && !(path in UNLISTED_KEY_FILES))
    expect(unknown).toEqual([])
    // And a stale entry says a file still handles keys when it no longer does.
    const stale = [...listed, ...Object.keys(UNLISTED_KEY_FILES)].filter(path => !found.includes(path))
    expect(stale).toEqual([])
  })
})

describe('the overlay', () => {
  it('lists every row under its scope, hidden at first, and returns the focus when closed', () => {
    const { document, window } = page()
    const overlay = createKeysOverlay(document)
    document.body.innerHTML = '<button id="opener"></button>'
    document.body.append(overlay.element)
    expect(overlay.element.hidden).toBe(true)
    expect(overlay.element.getAttribute('role')).toBe('dialog')
    expect(overlay.element.querySelectorAll('dt')).toHaveLength(KEY_ROWS.length)
    expect(overlay.element.querySelectorAll('h3')).toHaveLength(Object.keys(KEY_SCOPES).length)
    // linkedom does not track focus, so the calls to focus() are what is checked.
    const opener = document.getElementById('opener')
    const close = overlay.element.querySelector('#close-keys')
    const focused = []
    opener.focus = () => focused.push('opener')
    close.focus = () => focused.push('close')
    Object.defineProperty(document, 'activeElement', { value: opener, configurable: true })
    overlay.show(true)
    expect(overlay.element.hidden).toBe(false)
    expect(focused).toEqual(['close'])
    overlay.element.dispatchEvent(keydown(window, { key: 'Escape' }))
    expect(overlay.element.hidden).toBe(true)
    expect(focused).toEqual(['close', 'opener'])
  })

  it('keeps Tab on its one button', () => {
    const { document, window } = page()
    const overlay = createKeysOverlay(document)
    document.body.append(overlay.element)
    const tab = keydown(window, { key: 'Tab' })
    overlay.element.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
  })
})
