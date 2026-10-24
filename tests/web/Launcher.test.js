// tests/web/Launcher.test.js
//
// The page's launcher: launches quantised against the transport's position and a lookahead, starts a stopped transport, and keeps
// its state out of the revision.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { Project } from '../../src/model/Project.js'
import { createLauncher } from '../../web/app/Launcher.js'

// 120 bpm: two beats a second.
const timing = { beatAtSeconds: s => s * 2, secondsAtBeat: b => b / 2 }

function setup ({ playing = true, beat = 5.2 } = {}) {
  const { document } = parseHTML('<!doctype html><html><body><div id="launcher-mount"></div></body></html>')
  const project = new Project()
  project.apply([
    { op: 'addTrack', id: 't1' }, { op: 'addNode', id: 'n1', track: 't1', pluginIri: 'https://example.org/p/' }, { op: 'setTrack', id: 't1', midiInput: 'n1' },
    { op: 'addClip', id: 'c1', track: 't1', kind: 'midi', startBeat: 0, lengthBeats: 4, scene: 0, notes: [] },
    { op: 'addClip', id: 'c2', track: 't1', kind: 'midi', startBeat: 0, lengthBeats: 4, scene: 1, notes: [] },
    { op: 'addClip', id: 'song', track: 't1', kind: 'midi', startBeat: 0, lengthBeats: 4 }
  ])
  const logs = []
  const state = { playing, beat, played: 0 }
  const ctx = {
    document, $: id => document.getElementById(id), menu: null,
    log: (message, kind) => logs.push([kind, message]),
    hostConfig: { schedulerLookaheadMs: 100 },
    dispatcher: { project, transport: () => timing, apply: changes => project.apply(changes) && { ok: true, results: [] } },
    transport: {
      playing: () => state.playing,
      position: () => ({ beat: state.beat }),
      play: async () => { state.played += 1; state.playing = true; state.beat = 0 }
    },
    rack: { trackLabel: t => t.label ?? t.id },
    tabs: { select () {} }, selection: { set () {} }, dock: { update () {} }
  }
  return { launcher: createLauncher(ctx), state, logs, project, document }
}

describe('launching', () => {
  it('lands on the next bar after the position and the lookahead', async () => {
    const { launcher } = setup({ beat: 5.2 })
    const [one] = await launcher.launch('c1')
    // 5.2 beats plus 0.1 s (0.2 beat) is 5.4, so the next bar of four is 8.
    expect(one).toEqual({ clipId: 'c1', track: 't1', at: 8 })
    expect(launcher.slots().find(s => s.clipId === 'c1').state).toBe('queued')
  })

  it('does not launch an arrangement clip, or a clip that is not there', async () => {
    const { launcher } = setup()
    await expect(launcher.launch('song')).rejects.toThrow(/not a clip launcher slot/)
    await expect(launcher.launch('nope')).rejects.toThrow(/not a clip launcher slot/)
  })

  it('starts a stopped transport and plays the slot from where the transport starts, not a bar later', async () => {
    const { launcher, state } = setup({ playing: false })
    const [one] = await launcher.launch('c1')
    expect(state.played).toBe(1)
    expect(one.at).toBeCloseTo(0.4, 5)
  })

  it('launches a whole scene, or says there is nothing in it', async () => {
    const { launcher } = setup()
    expect((await launcher.launchScene(1)).map(l => l.clipId)).toEqual(['c2'])
    await expect(launcher.launchScene(7)).rejects.toThrow(/no MIDI clip in scene 7/)
  })
})

describe('stopping, the setting and the state', () => {
  it('stops a track at the next boundary, and everything with no track', async () => {
    const { launcher } = setup({ beat: 0 })
    await launcher.launch('c1')
    expect(launcher.stop('t1')).toBe(4)
    expect(launcher.stop(null)).toBe(4)
    expect(() => launcher.stop('nope')).toThrow(/no track/)
  })

  it('forgets everything when stopped with the transport stopped, and on reset', async () => {
    const { launcher, state } = setup()
    await launcher.launch('c1')
    state.playing = false
    expect(launcher.stop(null)).toBeNull()
    expect(launcher.state.runs).toEqual([])
    state.playing = true
    await launcher.launch('c1')
    launcher.reset()
    expect(launcher.state.runs).toEqual([])
  })

  it('reads and sets the quantisation on the project\'s transport, and refuses a name it does not know', () => {
    const { launcher, project } = setup()
    expect(launcher.quantise()).toBe('bar')
    launcher.setQuantise('beat')
    expect(launcher.quantise()).toBe('beat')
    expect(project.transport.launchQuantise).toBe('beat')
    expect(() => launcher.setQuantise('bogus')).toThrow(/launchQuantise is one of/)
  })

  it('launches on the saved setting', async () => {
    const { launcher } = setup({ beat: 5.2 })
    launcher.setQuantise('beat')
    const [one] = await launcher.launch('c1')
    expect(one.at).toBe(6)
  })

  it('does not touch the project\'s revision by launching or stopping', async () => {
    const { launcher, project } = setup()
    const before = project.revision
    await launcher.launch('c1')
    launcher.stop('t1')
    expect(project.revision).toBe(before)
  })
})

describe('the grid it draws', () => {
  it('shows a column for a track with a MIDI input and a cell for each slot, in the state it is in', async () => {
    const { launcher, document } = setup()
    launcher.mount()
    launcher.draw()
    expect(document.getElementById('cell-t1-0').getAttribute('aria-label')).toBe('t1, scene 1, stopped')
    expect(document.getElementById('cell-t1-2').getAttribute('aria-label')).toContain('empty')
    await launcher.launch('c1')
    expect(document.getElementById('cell-t1-0').dataset.state).toBe('queued')
  })
})
