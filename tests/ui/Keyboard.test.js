// tests/ui/Keyboard.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createKeyboard, noteName, noteOn, noteOff, playable } from '../../src/ui/Keyboard.js'

let document
beforeEach(() => { ({ document } = parseHTML('<!doctype html><body></body>')) })

const build = (over = {}) => {
  const sent = []
  const keyboard = createKeyboard(document, { onNote: bytes => sent.push([...bytes]), ...over })
  return { keyboard, sent }
}

const pointer = (element, type) => {
  const Event = element.ownerDocument.defaultView.Event
  element.dispatchEvent(new Event(type))
}

describe('which plugins get a keyboard', () => {
  // Walked from plugins/ rather than listed here, so a plugin comes into
  // scope by existing. A list in a test that names the plugins goes stale the
  // day one is added, and the failure looks like the rule being wrong.
  const walk = async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve, join } = await import('node:path')
    const { parseText } = await import('../../src/rdf/parse.js')
    const { readProfile } = await import('../../src/rdf/ProfileReader.js')
    const { pluginDirs } = await import('../../src/catalogue/PluginDirectories.js')
    const root = resolve(import.meta.dirname, '../..')
    const found = []
    for (const name of await pluginDirs(join(root, 'plugins'))) {
      const file = join(root, 'plugins', name, 'profile.ttl')
      found.push({
        name,
        profile: readProfile(await parseText(readFileSync(file, 'utf8'), 'urn:jigdaw:test'))
      })
    }
    return found
  }

  it('gives one to what a person plays and to nothing else', async () => {
    // BassGen is why this exists. It accepts MIDI so that `follow` can take a
    // root note from whatever is playing, it produces MIDI and no audio, and
    // it was given two octaves of silent keys.
    const plugins = await walk()
    expect(plugins.length).toBeGreaterThan(0)
    const got = plugins.filter(p => playable(p.profile)).map(p => p.name).sort()
    const not = plugins.filter(p => !playable(p.profile)).map(p => p.name).sort()
    expect(got).toEqual(['8b8', 'drumkit', 'pulse'])
    expect(not).toEqual(['bassgen', 'boost', 'cascade', 'drumgen', 'dynamix', 'ferrite', 'jsfx-gain-trim', 'jsfx-one-pole-filter', 'jsfx-soft-clipper', 'melgen', 'quefrency', 'squelch', 'tremolo'])
  })

  it('asks whether it makes a sound, not only whether it takes a note', async () => {
    // The two conditions, separated, so a change that dropped either half
    // fails here with a reason rather than with a list.
    for (const { name, profile } of await walk()) {
      // Control changes alone play nothing: Quefrency takes MIDI and has no
      // use for a keyboard. Written out here rather than calling carriesNotes,
      // so this states the rule instead of repeating the implementation.
      const controlOnly = ['http://purl.org/stuff/transmissions/ControlMidi', 'http://purl.org/stuff/transmissions/MidiCC']
      const takesNotes = profile.accepts.some(s => s.includes('Midi') && !controlOnly.includes(s))
      const makesSound = profile.audioOutputs > 0
      expect(playable(profile), name).toBe(takesNotes && makesSound)
    }
  })

  it('refuses a profile it cannot read rather than guessing', () => {
    expect(playable(null)).toBe(false)
    expect(playable({})).toBe(false)
    expect(playable({ accepts: ['http://purl.org/stuff/transmissions/Midi'] })).toBe(false)
    expect(playable({ audioOutputs: 2, accepts: [] })).toBe(false)
    expect(playable({ audioOutputs: 2, accepts: ['http://purl.org/stuff/transmissions/Midi'] })).toBe(true)
  })
})

describe('noteName', () => {
  it('names middle C and the A above it as a musician would', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(69)).toBe('A4')
    expect(noteName(61)).toBe('C#4')
  })
})

describe('the MIDI it sends', () => {
  it('is the three bytes any MIDI source sends', () => {
    expect([...noteOn(69, 100)]).toEqual([0x90, 69, 100])
    expect([...noteOff(69)]).toEqual([0x80, 69, 0])
  })
})

describe('layout', () => {
  it('draws seven white keys and five black ones per octave', () => {
    const { keyboard } = build({ octaves: 2 })
    expect(keyboard.element.querySelectorAll('.key-white')).toHaveLength(14)
    expect(keyboard.element.querySelectorAll('.key-black')).toHaveLength(10)
  })

  it('starts where it is told', () => {
    const { keyboard } = build({ first: 60, octaves: 1 })
    const notes = [...keyboard.element.querySelectorAll('.key')].map(k => Number(k.dataset.note))
    expect(Math.min(...notes)).toBe(60)
    expect(Math.max(...notes)).toBe(71)
  })

  it('names every key for a screen reader, which cannot see a piano', () => {
    const { keyboard } = build({ first: 60, octaves: 1 })
    for (const key of keyboard.element.querySelectorAll('.key')) {
      expect(key.getAttribute('aria-label')).toMatch(/^[A-G]#?-?\d$/)
    }
  })

  it('uses buttons, so every key is reachable by tab', () => {
    const { keyboard } = build()
    const tags = new Set([...keyboard.element.querySelectorAll('.key')].map(k => k.tagName.toLowerCase()))
    expect([...tags]).toEqual(['button'])
  })
})

describe('playing', () => {
  it('sends note on when pressed and note off when released', () => {
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    const c = keyboard.element.querySelector('[data-note="60"]')
    pointer(c, 'pointerdown')
    expect(sent).toEqual([[0x90, 60, 100]])
    pointer(c, 'pointerup')
    expect(sent[1]).toEqual([0x80, 60, 0])
  })

  it('does not retrigger a key that is already down', () => {
    // A pointer that moves within a key fires more than once, and a synth that
    // retriggers on each one sounds like a stutter.
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    const c = keyboard.element.querySelector('[data-note="60"]')
    pointer(c, 'pointerdown')
    pointer(c, 'pointerdown')
    expect(sent).toHaveLength(1)
  })

  it('sends nothing on releasing a key that was not held', () => {
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    pointer(keyboard.element.querySelector('[data-note="60"]'), 'pointerup')
    expect(sent).toEqual([])
  })

  it('releases a note when the pointer leaves the key', () => {
    // Otherwise dragging off a key leaves it sounding for ever.
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    const c = keyboard.element.querySelector('[data-note="60"]')
    pointer(c, 'pointerdown')
    pointer(c, 'pointerleave')
    expect(sent[1]).toEqual([0x80, 60, 0])
    expect(keyboard.held).toEqual([])
  })

  it('tracks what is held', () => {
    const { keyboard } = build({ first: 60, octaves: 1 })
    pointer(keyboard.element.querySelector('[data-note="60"]'), 'pointerdown')
    pointer(keyboard.element.querySelector('[data-note="64"]'), 'pointerdown')
    expect(keyboard.held.sort((a, b) => a - b)).toEqual([60, 64])
  })

  it('releases everything on request, so a removed instrument is not left sounding', () => {
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    pointer(keyboard.element.querySelector('[data-note="60"]'), 'pointerdown')
    pointer(keyboard.element.querySelector('[data-note="64"]'), 'pointerdown')
    keyboard.allNotesOff()
    expect(keyboard.held).toEqual([])
    expect(sent.filter(m => m[0] === 0x80)).toHaveLength(2)
  })
})

describe('octavesForWidth', () => {
  it('shows two octaves when the keys stay big enough to hit', async () => {
    const { octavesForWidth } = await import('../../src/ui/Keyboard.js')
    // 14 keys at 24px each needs 336px.
    expect(octavesForWidth(400)).toBe(2)
    expect(octavesForWidth(336)).toBe(2)
  })

  it('drops to one octave rather than showing keys nobody can press', async () => {
    // WCAG 2.5.8 asks for 24px. Two octaves in a 320px phone gives 17.6px keys,
    // which is what this exists to prevent.
    const { octavesForWidth } = await import('../../src/ui/Keyboard.js')
    expect(octavesForWidth(320)).toBe(1)
    expect(octavesForWidth(280)).toBe(1)
  })

  it('never returns zero octaves, however narrow', async () => {
    const { octavesForWidth } = await import('../../src/ui/Keyboard.js')
    expect(octavesForWidth(10)).toBe(1)
    expect(octavesForWidth(0)).toBe(1)
  })

  it('keeps every key at or above the minimum when it can', async () => {
    const { octavesForWidth, MIN_KEY_WIDTH } = await import('../../src/ui/Keyboard.js')
    for (const width of [280, 320, 360, 390, 430, 560, 768]) {
      const octaves = octavesForWidth(width)
      if (octaves > 1) {
        expect(width / (octaves * 7), `${width}px`).toBeGreaterThanOrEqual(MIN_KEY_WIDTH)
      }
    }
  })
})

describe('the keyboard stylesheet', () => {
  it('sizes keys by proportion, not by a fixed number of pixels', async () => {
    // Fixed widths overflowed a phone by 88px: fourteen 30px keys in a 390px
    // viewport, and max-width could not help because flex children with a set
    // width do not shrink.
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const page = readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')

    const whiteKey = /\.key-white\s*\{([^}]*)\}/.exec(page)
    expect(whiteKey, 'no .key-white rule').not.toBeNull()
    expect(whiteKey[1], '.key-white has a fixed width again').not.toMatch(/\bwidth:\s*\d+px/)
    expect(whiteKey[1]).toMatch(/flex:/)

    const keyboard = /\.keyboard\s*\{([^}]*)\}/.exec(page)
    expect(keyboard[1]).toMatch(/width:\s*100%/)
  })
})
