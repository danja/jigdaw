// src/host/Wav.js
//
// Encode rendered audio as a WAV file: the format every platform can already
// play, so bin/host.js's output needs no native audio binding to verify by
// ear, and recorded takes need no codec to play back. Sixteen bit PCM, the
// format every WAV reader is guaranteed to accept, rather than float samples,
// which not all are.
//
// Written over DataView rather than node's Buffer, so the one implementation
// runs in the page as well as in node: takes are encoded where they are
// captured. Hand rolled rather than a dependency: a WAV header is 44 bytes
// with a fixed layout, genuinely simpler to write correctly here than to vet
// a package for.

const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8

/** -1..1 to a signed 16 bit sample, clamped rather than wrapped: a peak over
 * 1.0 becomes full scale, not a burst of noise from integer overflow. */
function toInt16 (sample) {
  const clamped = Math.max(-1, Math.min(1, sample))
  return Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff))
}

function writeAscii (view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/**
 * Encode one or more equal-length channels (Float32Array, -1..1) as a WAV
 * file, returned as a Uint8Array. Interleaved on the way out, which is the
 * format every WAV reader expects and the one this project's own channels
 * are already kept apart from, matching `jig_output_ptr(channel)`'s
 * per-channel buffers.
 */
export function encodeWav (channels, sampleRate) {
  if (channels.length === 0) throw new Error('encodeWav needs at least one channel')
  const frames = channels[0].length
  for (const channel of channels) {
    if (channel.length !== frames) throw new Error('every channel must be the same length')
  }

  const numChannels = channels.length
  const blockAlign = numChannels * BYTES_PER_SAMPLE
  const dataBytes = frames * blockAlign
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(bytes.buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size, 16 for PCM
  view.setUint16(20, 1, true) // audio format, 1 = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = HEADER_BYTES
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, toInt16(channels[c][frame]), true)
      offset += BYTES_PER_SAMPLE
    }
  }

  return bytes
}
