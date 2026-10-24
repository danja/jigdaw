// tests/web/Templates.test.js
//
// What the Templates section does with the store and the session code. The store is tested in
// tests/host/Templates.test.js; the sessions here are stand-ins that record what they were handed.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTemplatesPanel } from '../../web/app/Templates.js'
import { createTemplates } from '../../src/host/Templates.js'
import { fakeIndexedDB } from '../host/fakeIndexedDB.js'

function setup ({ dispatcher = { project: { label: 'Tide' } } } = {}) {
  const { document, window } = parseHTML('<!doctype html><body><div id="presets"></div></body>')
  const logs = []
  const opened = []
  const ctx = {
    document,
    $: id => document.getElementById(id),
    log: (...a) => logs.push(a),
    dispatcher,
    sessions: { pack: async () => ({ kind: 'turtle', bytes: Uint8Array.from([1, 2, 3]) }), openBytes: async bytes => { opened.push([...bytes]) } }
  }
  const store = createTemplates({ indexedDB: fakeIndexedDB() })
  const panel = createTemplatesPanel(ctx, { store })
  const submit = form => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  // A fixed wait for the fake IndexedDB's callbacks; 20 ms was too short when the whole suite runs at once (failed three times under load).
  const settle = () => new Promise(resolve => setTimeout(resolve, 200))
  return { panel, ctx, store, logs, opened, document, submit, settle, window }
}

describe('the Templates section', () => {
  it('sits after the presets, and shows only the save form until there is a template', async () => {
    const { panel, document } = setup()
    await panel.mount()
    expect(document.getElementById('presets').nextElementSibling).toBe(panel.element)
    expect(document.getElementById('template-save')).not.toBeNull()
    expect(document.querySelector('#template-pick').closest('form').hidden).toBe(true)
  })

  it('keeps the open session under the typed name, lists it, and starts a new one from it', async () => {
    const { panel, document, submit, settle, opened } = setup()
    await panel.mount()
    document.getElementById('template-name').value = 'Band'
    submit(document.getElementById('template-save').closest('form'))
    await settle()
    const pick = document.getElementById('template-pick')
    expect([...pick.options].map(o => o.value)).toEqual(['Band'])
    expect(pick.closest('form').hidden).toBe(false)
    expect(document.getElementById('template-name').value).toBe('')
    expect(document.querySelector('[role=status]').textContent).toBe('kept as template Band')
    submit(pick.closest('form'))
    await settle()
    expect(opened).toEqual([[1, 2, 3]])
    expect(document.querySelector('[role=status]').textContent).toBe('started from template Band')
  })

  it('names a template after the project title when no name is typed', async () => {
    const { panel, store, document, submit, settle } = setup()
    await panel.mount()
    submit(document.getElementById('template-save').closest('form'))
    await settle()
    expect((await store.list()).map(t => t.name)).toEqual(['Tide'])
    expect([...document.getElementById('template-pick').options].find(o => o.selected).value).toBe('Tide')
  })

  it('says why, and keeps nothing, when there is no name and no title or no session', async () => {
    const { panel, store, document, submit, settle } = setup({ dispatcher: { project: { label: null } } })
    await panel.mount()
    submit(document.getElementById('template-save').closest('form'))
    await settle()
    expect(document.querySelector('[role=status]').textContent).toBe('a template needs a name')
    expect(await store.list()).toEqual([])
    const none = setup({ dispatcher: null })
    await expect(none.panel.save('x')).rejects.toThrow(/nothing to keep/)
  })

  it('deletes the chosen template and hides the choice once none are left', async () => {
    const { panel, document, window, settle, store } = setup()
    await panel.mount()
    await panel.save('A')
    await panel.save('B')
    // The one just kept is the one chosen, so that is what the button removes.
    document.getElementById('template-remove').dispatchEvent(new window.Event('click', { bubbles: true }))
    await settle()
    expect((await store.list()).map(t => t.name)).toEqual(['A'])
    await panel.remove('A')
    expect(document.getElementById('template-pick').closest('form').hidden).toBe(true)
  })

  it('refuses to open a template that is not there', async () => {
    const { panel, opened } = setup()
    await panel.mount()
    await expect(panel.open('Ghost')).rejects.toThrow(/no template called Ghost/)
    expect(opened).toEqual([])
  })
})
