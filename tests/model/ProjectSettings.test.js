// tests/model/ProjectSettings.test.js
import { describe, it, expect } from 'vitest'
import { patchSettings, EMPTY_SETTINGS } from '../../src/model/ProjectSettings.js'
import { Project } from '../../src/model/Project.js'

describe('patching the project settings', () => {
  it('starts as not stated, which is neither true nor false', () => {
    expect(EMPTY_SETTINGS).toEqual({ alignTracks: null })
    expect(Object.isFrozen(EMPTY_SETTINGS)).toBe(true)
  })

  it('takes true, false and null, and a later patch replaces an earlier one', () => {
    const on = patchSettings(EMPTY_SETTINGS, { alignTracks: true })
    expect(on.alignTracks).toBe(true)
    expect(patchSettings(on, { alignTracks: false }).alignTracks).toBe(false)
    expect(patchSettings(on, { alignTracks: null }).alignTracks).toBeNull()
  })

  it('refuses what is not a boolean, an unknown setting and a patch that is not an object, applying nothing', () => {
    for (const bad of ['yes', 1, 0, {}, []]) expect(() => patchSettings(EMPTY_SETTINGS, { alignTracks: bad })).toThrow(/alignTracks is true or false/)
    expect(() => patchSettings(EMPTY_SETTINGS, { volume: 1 })).toThrow(/unknown project setting: volume/)
    expect(() => patchSettings(EMPTY_SETTINGS, [])).toThrow(/object/)
    expect(() => patchSettings(EMPTY_SETTINGS, null)).toThrow(/object/)
  })
})

describe('a project holding settings', () => {
  it('starts not stated, bumps no revision, and is not an undo step', () => {
    const project = new Project()
    expect(project.settings).toEqual({ alignTracks: null })
    project.setSettings({ alignTracks: false })
    expect(project.settings.alignTracks).toBe(false)
    expect(project.revision).toBe(0)
  })

  it('hands out a copy, so changing it changes nothing', () => {
    const project = new Project()
    project.settings.alignTracks = true
    expect(project.settings.alignTracks).toBeNull()
  })
})
