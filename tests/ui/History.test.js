// tests/ui/History.test.js
//
// Undo and redo live on OpDispatcher (tests/ops/OpDispatcher.test.js covers
// the mechanism) and are only wired in the page, web/app/History.js, which has
// no AudioContext to run under vitest. So the wiring is checked in the source
// text, the same reason tests/ui/Focus.test.js reads drawRack rather than
// calling it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appFile } from './appSource.js'

const html = readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')
const history = appFile('web/app/History.js')
const runtime = appFile('web/app/Runtime.js')
const sessions = appFile('web/app/Sessions.js')

describe('the Undo and Redo controls', () => {
  it('exist as buttons, disabled by default, not only as a keyboard shortcut', () => {
    // A shortcut alone is not WCAG operable: a pointer user and a screen
    // reader user need a control that is actually there.
    expect(html).toMatch(/<button id="undo"[^>]*disabled[^>]*>Undo<\/button>/)
    expect(html).toMatch(/<button id="redo"[^>]*disabled[^>]*>Redo<\/button>/)
  })

  it('are wired to the dispatcher, not to a second implementation', () => {
    expect(history).toMatch(/\$\('undo'\)\.addEventListener\('click'/)
    expect(history).toMatch(/\$\('redo'\)\.addEventListener\('click'/)
    // Through the dispatcher's own undo()/redo(), the one mechanism, not a
    // changeset built by hand here that could drift from it.
    const undoFn = history.slice(history.indexOf('async function undo'), history.indexOf('async function redo'))
    expect(undoFn).toMatch(/dispatcher\.undo\(\)/)
    const redoFn = history.slice(history.indexOf('async function redo'), history.indexOf('function mount'))
    expect(redoFn).toMatch(/dispatcher\.redo\(\)/)
  })

  it('responds to Ctrl/Cmd+Z and to Ctrl/Cmd+Shift+Z or +Y for redo', () => {
    const handler = history.slice(history.indexOf("document.addEventListener('keydown'"))
    expect(handler).toMatch(/ctrlKey \|\| event\.metaKey/)
    expect(handler).toMatch(/shiftKey/)
    expect(handler).toMatch(/redo\(\)/)
    expect(handler).toMatch(/undo\(\)/)
  })

  it('leaves the shortcut to the browser while an editable control has focus', () => {
    // Otherwise Ctrl+Z while typing a tempo or an IRI reaches past the field
    // to the project instead of undoing the character just typed.
    const handler = history.slice(history.indexOf("document.addEventListener('keydown'"))
    expect(handler).toMatch(/tagName === 'INPUT'/)
    expect(handler).toMatch(/tagName === 'TEXTAREA'/)
    expect(handler).toMatch(/isContentEditable/)
  })

  it('keeps the buttons in step with the dispatcher on every change', () => {
    // canUndo()/canRedo() are read fresh, not cached, so a button enabled by
    // one edit and disabled again by undoing it does not go stale.
    const subscribed = runtime.slice(runtime.indexOf('dispatcher.subscribe'), runtime.indexOf('const registration ='))
    expect(subscribed).toMatch(/ctx\.history\.updateButtons\(\)/)
    expect(history).toMatch(/updateButtons: updateHistoryButtons/)

    const fn = history.slice(history.indexOf('function updateHistoryButtons'))
    expect(fn.slice(0, fn.indexOf('}'))).toMatch(/canUndo\(\)/)
    expect(fn.slice(0, fn.indexOf('}'))).toMatch(/canRedo\(\)/)
  })

  it('clears history when a different session is opened, not only when one is applied', () => {
    // Otherwise "Undo" right after opening a file tries to step back into
    // whatever was open before it, one restored node at a time.
    // The clearing itself is openProject's, and tests/ops/OpenProject.test.js
    // checks it by behaviour; this checks the page goes through it and then
    // redraws the buttons, which is the half no behavioural test here reaches.
    const start = sessions.indexOf('async function openSession')
    const openSession = sessions.slice(start, start + sessions.slice(start).indexOf('\n  }\n') + 5)
    expect(openSession).toMatch(/await openProject\(d, /)
    expect(openSession).toMatch(/ctx\.history\.updateButtons\(\)/)
  })
})
