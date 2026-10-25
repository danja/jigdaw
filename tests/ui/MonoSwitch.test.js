// tests/ui/MonoSwitch.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createMonoSwitch } from '../../src/ui/MonoSwitch.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const click = async el => { el.dispatchEvent(new window.Event('click', { bubbles: true })); await settle() }

describe('the mono switch', () => {
  it('starts off, named for what it does, and says nothing in the ordinary case', () => {
    const mono = createMonoSwitch(document, { onChange () {} })
    expect(mono.button.getAttribute('aria-label')).toBe('Listen in mono')
    expect(mono.button.getAttribute('aria-pressed')).toBe('false')
    expect(mono.element.querySelector('.mono-said').textContent).toBe('')
    expect(mono.on).toBe(false)
  })

  it('says it is a listening aid, in the title where a pointer finds it', () => {
    const mono = createMonoSwitch(document, { onChange () {} })
    expect(mono.button.title).toMatch(/not saved/)
    expect(mono.button.title).toMatch(/not in an export or a recording/)
  })

  it('turns on and off with the button, telling the page each time, and says so in words as well as by the pressed state', async () => {
    const seen = []
    const mono = createMonoSwitch(document, { onChange: on => seen.push(on) })
    await click(mono.button)
    expect(mono.button.getAttribute('aria-pressed')).toBe('true')
    expect(mono.element.querySelector('.mono-said').textContent).toBe('Listening in mono')
    await click(mono.button)
    expect(mono.button.getAttribute('aria-pressed')).toBe('false')
    expect(mono.element.querySelector('.mono-said').textContent).toBe('')
    expect(seen).toEqual([true, false])
  })

  it('goes back and says why when the page cannot do it', async () => {
    const mono = createMonoSwitch(document, { onChange: () => { throw new Error('this context cannot sum the mix to mono') } })
    await click(mono.button)
    expect(mono.on).toBe(false)
    expect(mono.button.getAttribute('aria-pressed')).toBe('false')
    expect(mono.element.querySelector('.mono-said').textContent).toBe('this context cannot sum the mix to mono')
  })

  it('goes back when the page refuses later, on a promise', async () => {
    const mono = createMonoSwitch(document, { onChange: async () => { throw new Error('no engine') } })
    await click(mono.button)
    expect(mono.on).toBe(false)
    expect(mono.element.querySelector('.mono-said').textContent).toBe('no engine')
  })

  it('can be set from outside, as the master channel\'s menu does', async () => {
    const seen = []
    const mono = createMonoSwitch(document, { onChange: on => seen.push(on) })
    await mono.toggle()
    expect(mono.on).toBe(true)
    await mono.set(false)
    expect(seen).toEqual([true, false])
  })

  it('refuses to be built without a handler', () => {
    expect(() => createMonoSwitch(document, {})).toThrow(/needs onChange/)
  })
})
