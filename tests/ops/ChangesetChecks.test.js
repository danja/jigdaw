// tests/ops/ChangesetChecks.test.js
//
// What the dispatcher says about a changeset before and after it is tried: an unwireable connection or audio input is refused with the reason,
// a plugin not yet loaded is not refused, and each kind of thrown error becomes the result a caller reads.
import { describe, it, expect } from 'vitest'
import { unroutableChange, failureResult } from '../../src/ops/ChangesetChecks.js'
import { RevisionConflict, ChangeError } from '../../src/model/Project.js'

const profiles = {
  synth: { audioInputs: 0, audioOutputs: 1, accepts: ['trn:MIDI'], produces: [] },
  verb: { audioInputs: 1, audioOutputs: 1 }
}
const profileOf = id => profiles[id]

describe('unroutableChange', () => {
  it('refuses an audio input on a node with none, for a track and for the master', () => {
    expect(unroutableChange([{ op: 'setTrack', id: 't', audioInput: 'synth' }], profileOf)).toBe('synth has no audio input, so audio cannot arrive at it')
    expect(unroutableChange([{ op: 'setMaster', audioInput: 'synth' }], profileOf)).toContain('no audio input')
    expect(unroutableChange([{ op: 'setTrack', id: 't', audioInput: 'verb' }], profileOf)).toBeNull()
  })

  it('does not refuse a node that has not loaded, which cannot be checked', () => {
    expect(unroutableChange([{ op: 'setTrack', id: 't', audioInput: 'later' }], profileOf)).toBeNull()
    expect(unroutableChange([{ op: 'addConnection', from: { node: 'later', portIndex: 0 }, to: { node: 'later2', portIndex: 0 }, signalKind: 'audio' }], profileOf)).toBeNull()
  })

  it('refuses a connection to a port the node does not have, naming it', () => {
    const message = unroutableChange([{ op: 'addConnection', from: { node: 'verb', portIndex: 0 }, to: { node: 'synth', portIndex: 0 }, signalKind: 'audio' }], profileOf)
    expect(message).toMatch(/has no/)
  })

  it('finds nothing in nothing, and ignores changes of other kinds', () => {
    expect(unroutableChange(undefined, profileOf)).toBeNull()
    expect(unroutableChange([{ op: 'addTrack' }, null], profileOf)).toBeNull()
  })
})

describe('failureResult', () => {
  it('says a conflict with what was expected, and a refused change with where in the list', () => {
    expect(failureResult(new RevisionConflict(2, 5), 5)).toMatchObject({ ok: false, kind: 'conflict', revision: 5, expected: 2 })
    expect(failureResult(new ChangeError(1, 'addNode', 'no track'), 5)).toMatchObject({ ok: false, kind: 'change', revision: 5, index: 1 })
  })

  it('throws what is neither, since that is a defect and not a refusal', () => {
    expect(() => failureResult(new TypeError('boom'), 1)).toThrow('boom')
  })
})
