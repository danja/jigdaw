// tests/host/Microphone.test.js
//
// The stand-in refuses the way the real getUserMedia does: with a DOMException-like
// error carrying the standard names, never a plain message.
import { describe, it, expect } from 'vitest'
import { openMicrophone, explain, microphoneAvailable, AUDIO_CONSTRAINTS } from '../../src/host/Microphone.js'

const failing = name => async () => { throw Object.assign(new Error(`browser says ${name}`), { name }) }

describe('the microphone', () => {
  it('opens with processing off and hands back the stream', async () => {
    let asked
    const stream = { id: 's' }
    const got = await openMicrophone(async constraints => { asked = constraints; return stream })
    expect(got).toBe(stream)
    expect(asked).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    expect(Object.isFrozen(AUDIO_CONSTRAINTS)).toBe(true)
  })

  it('says a refusal, a missing device and a busy one in words a person can act on, keeping the browser error as the cause', async () => {
    const cases = [['NotAllowedError', /site settings/], ['SecurityError', /site settings/], ['NotFoundError', /No microphone/], ['OverconstrainedError', /No microphone/], ['NotReadableError', /Another app/]]
    for (const [name, pattern] of cases) {
      const error = await openMicrophone(failing(name)).catch(e => e)
      expect(error.message, name).toMatch(pattern)
      expect(error.cause.name).toBe(name)
    }
  })

  it('reports an error it does not know, with what the browser said', () => {
    expect(explain(new Error('weird'))).toBe('The microphone could not be used: weird')
    expect(explain(undefined)).toMatch(/unknown error/)
  })

  it('knows whether the browser can be asked at all', () => {
    expect(microphoneAvailable({ getUserMedia () {} })).toBe(true)
    expect(microphoneAvailable({})).toBe(false)
    expect(microphoneAvailable(undefined)).toBe(false)
  })
})
