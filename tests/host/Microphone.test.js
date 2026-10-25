// tests/host/Microphone.test.js
//
// The stand-in refuses the way the real getUserMedia does: with a DOMException-like
// error carrying the standard names, never a plain message.
import { describe, it, expect } from 'vitest'
import { openMicrophone, explain, microphoneAvailable, listInputs, constraintsFor, AUDIO_CONSTRAINTS } from '../../src/host/Microphone.js'

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

  it('asks for one device by exact id, so a missing one is an error and not a quiet switch to another', async () => {
    let asked
    await openMicrophone(async constraints => { asked = constraints; return {} }, { deviceId: 'usb-1' })
    expect(asked).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: 'usb-1' } } })
    expect(constraintsFor(null)).toBe(AUDIO_CONSTRAINTS)
    const gone = await openMicrophone(failing('OverconstrainedError'), { deviceId: 'usb-1' }).catch(e => e)
    expect(gone.message).toMatch(/No microphone/)
  })

  it('lists only audio inputs, names an unnamed one by its place, and leaves out the placeholder entry', async () => {
    const mediaDevices = {
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'a', label: 'Desk mic' },
        { kind: 'audiooutput', deviceId: 'o', label: 'Speakers' },
        { kind: 'videoinput', deviceId: 'v', label: 'Camera' },
        { kind: 'audioinput', deviceId: 'b', label: '' },
        { kind: 'audioinput', deviceId: '', label: '' }
      ]
    }
    expect(await listInputs(mediaDevices)).toEqual([{ id: 'a', name: 'Desk mic' }, { id: 'b', name: 'Microphone 2' }])
  })
})
