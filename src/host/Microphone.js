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
 * Open the microphone. Resolves with the stream, or throws an Error whose message is
 * the sentence to show, with the browser's own error as `cause`.
 */
export async function openMicrophone (getUserMedia) {
  try {
    return await getUserMedia(AUDIO_CONSTRAINTS)
  } catch (error) {
    throw new Error(explain(error), { cause: error })
  }
}
