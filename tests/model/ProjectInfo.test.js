// tests/model/ProjectInfo.test.js
import { describe, it, expect } from 'vitest'
import { patchInfo, EMPTY_INFO, INFO_LIMITS } from '../../src/model/ProjectInfo.js'
import { Project } from '../../src/model/Project.js'

describe('patching the project info', () => {
  it('sets a field and leaves the others alone', () => {
    expect(patchInfo(EMPTY_INFO, { author: 'Dee' })).toEqual({ title: null, author: 'Dee', notes: null })
  })
  it('squeezes the spaces of a title and author but keeps the line breaks of notes', () => {
    expect(patchInfo(EMPTY_INFO, { title: ' a \n b ', notes: ' x\n\ny ' })).toMatchObject({ title: 'a b', notes: 'x\n\ny' })
  })
  it('takes blank text and null as none', () => {
    const had = { title: 'T', author: 'A', notes: 'N' }
    expect(patchInfo(had, { title: '   ', author: null })).toEqual({ title: null, author: null, notes: 'N' })
  })
  it('accepts a field at its limit and refuses one past it', () => {
    expect(patchInfo(EMPTY_INFO, { notes: 'n'.repeat(INFO_LIMITS.notes) }).notes).toHaveLength(INFO_LIMITS.notes)
    expect(() => patchInfo(EMPTY_INFO, { title: 't'.repeat(INFO_LIMITS.title + 1) })).toThrow(/title is at most 120/)
  })
  it('refuses an unknown field, a number, and a patch that is not an object, applying nothing', () => {
    expect(() => patchInfo(EMPTY_INFO, { mood: 'x' })).toThrow(/unknown project info field: mood/)
    expect(() => patchInfo(EMPTY_INFO, { title: 4 })).toThrow(/title is text/)
    expect(() => patchInfo(EMPTY_INFO, [])).toThrow(/object/)
  })
})

describe('a project holding info', () => {
  it('starts empty, keeps a patch whole when one field is bad, and bumps no revision', () => {
    const project = new Project()
    expect(project.info).toEqual(EMPTY_INFO)
    project.setInfo({ title: 'Tide' })
    expect(() => project.setInfo({ author: 'Dee', notes: 5 })).toThrow()
    expect(project.info).toEqual({ title: 'Tide', author: null, notes: null })
    expect(project.label).toBe('Tide')
    expect(project.revision).toBe(0)
  })
  it('hands out a copy, so changing it changes nothing', () => {
    const project = new Project()
    project.info.title = 'x'
    expect(project.info.title).toBeNull()
  })
})
