// tests/ui/ExampleList.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createExampleList } from '../../src/ui/ExampleList.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const examples = [
  { id: 'a', title: 'First', piece: 'acid.ttl', about: 'Does a thing.' },
  { id: 'b', title: 'Second', piece: 'chiptune.ttl', about: 'Does another.' }
]
const click = node => node.dispatchEvent(new window.Event('click', { bubbles: true }))

describe('the example list', () => {
  const make = over => {
    const calls = { edit: [], play: [] }
    const list = createExampleList(document, {
      examples,
      pieceLabel: file => ({ 'acid.ttl': 'Acid', 'chiptune.ttl': 'Chiptune' })[file],
      onEdit: e => calls.edit.push(e.id),
      onPlay: e => calls.play.push(e.id),
      ...over
    })
    document.body.append(list.element)
    return calls
  }

  it('draws a card per example with its piece named in words', () => {
    make()
    expect([...document.querySelectorAll('.example h3')].map(h => h.textContent)).toEqual(['First', 'Second'])
    expect(document.querySelector('#example-b .note').textContent).toContain('Chiptune')
  })

  it('names each button for the example it belongs to, since "Edit this" twice says nothing to a screen reader', () => {
    make()
    expect([...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Edit First', 'Play First', 'Edit Second', 'Play Second'])
  })

  it('does nothing until a button is pressed, and then only what that button says', () => {
    const calls = make()
    expect(calls).toEqual({ edit: [], play: [] })
    click(document.querySelector('#example-b .example-play'))
    click(document.querySelector('#example-a .example-edit'))
    expect(calls).toEqual({ edit: ['a'], play: ['b'] })
  })

  it('refuses to be built without its callbacks', () => {
    expect(() => createExampleList(document, { examples, pieceLabel: () => '', onEdit () {} })).toThrow(/onPlay/)
  })
})
