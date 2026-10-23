// tests/ui/ProjectInfoForm.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createProjectInfoForm } from '../../src/ui/ProjectInfoForm.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const change = input => input.dispatchEvent(new window.Event('change', { bubbles: true }))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function build (onChange = async () => {}) {
  const patches = []
  const errors = []
  const form = createProjectInfoForm(document, { onChange: async p => { patches.push(p); await onChange(p) }, onError: e => errors.push(e.message) })
  document.body.append(form.element)
  return { form, patches, errors }
}

describe('the project info form', () => {
  it('has a named field for each of title, author and notes, with 16px-safe inputs of the right kind', () => {
    const { form } = build()
    expect([...document.querySelectorAll('label')].map(l => l.firstChild.textContent)).toEqual(['Title', 'Author', 'Notes'])
    expect(form.inputs.notes.tagName).toBe('TEXTAREA')
    expect(form.inputs.title.maxLength).toBe(120)
    expect(form.inputs.notes.maxLength).toBe(4000)
  })
  it('shows a project\'s info and clears fields it lacks', () => {
    const { form } = build()
    form.show({ title: 'Tide', author: null, notes: 'n' })
    expect(form.inputs.title.value).toBe('Tide')
    form.show({ title: null, author: null, notes: null })
    expect(form.inputs.title.value).toBe('')
  })
  it('sends one patch for the one field that was left', async () => {
    const { form, patches } = build()
    form.inputs.author.value = 'Dee'
    change(form.inputs.author)
    await settle()
    expect(patches).toEqual([{ author: 'Dee' }])
  })
  it('puts a refused field back to what was shown and says why', async () => {
    const { form, errors } = build(async () => { throw new Error('title is at most 120 characters') })
    form.show({ title: 'Tide', author: null, notes: null })
    form.inputs.title.value = 'x'
    change(form.inputs.title)
    await settle()
    expect(form.inputs.title.value).toBe('Tide')
    expect(errors).toEqual(['title is at most 120 characters'])
  })
})
