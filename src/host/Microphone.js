// src/host/Microphone.js
//
// Asking the browser for the microphone, and saying what happened in words a
// person can act on. `getUserMedia` is injected, so a test hands in one that
// refuses the way the real one does, with the same error names: a refusal, no
// device, a device in use.
//
// Processing is off: echo cancellation, noise suppression and automatic gain
// change a recording, and a microphone that is not monitored (the recording
// track is muted) has no echo to cancel.

export const AUDIO_CONSTRAINTS = Object.freeze({
  audio: Object.freeze({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
})

/** The constraints for one device, or for the browser's default when no id is given. `exact`: a missing device is an error, not a quiet switch. */
export const constraintsFor = deviceId => (deviceId
  ? { audio: { ...AUDIO_CONSTRAINTS.audio, deviceId: { exact: deviceId } } }
  : AUDIO_CONSTRAINTS)

/** What a browser error means to someone holding a microphone. */
export function explain (error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The browser did not let this page use the microphone. Allow it in the site settings, then try again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in, then try again.'
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone could not be opened. Another app may be using it.'
    default:
      return `The microphone could not be used: ${error?.message ?? 'unknown error'}`
  }
}

/** Whether this browser can be asked at all. Left out of the page when it cannot. */
export const microphoneAvailable = mediaDevices => typeof mediaDevices?.getUserMedia === 'function'

/**
 * The audio inputs the browser lists, as { id, name }. A browser gives no names until the page has been
 * allowed a microphone once, so an unnamed one is called "Microphone N" by its place in the list.
 */
export async function listInputs (mediaDevices) {
  const all = await mediaDevices.enumerateDevices()
  return all.filter(d => d.kind === 'audioinput' && d.deviceId !== '')
    .map((d, i) => ({ id: d.deviceId, name: d.label || `Microphone ${i + 1}` }))
}

/**
 * Open the microphone, a particular one when `deviceId` is given. Resolves with the stream, or throws an
 * Error whose message is the sentence to show, with the browser's own error as `cause`.
 */
export async function openMicrophone (getUserMedia, { deviceId = null } = {}) {
  try {
    return await getUserMedia(constraintsFor(deviceId))
  } catch (error) {
    throw new Error(explain(error), { cause: error })
  }
}
