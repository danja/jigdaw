// src/host/Wav.js
//
// Encode rendered audio as a WAV file: the format every platform can already
// play, so bin/host.js's output needs no native audio binding to verify by
// ear. Sixteen bit PCM, the format every WAV reader is guaranteed to accept,
// rather than float samples, which not all are.
//
// Hand rolled rather than a dependency: a WAV header is 44 bytes with a fixed
// layout, genuinely simpler to write correctly here than to vet a package for.

const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8

/** -1..1 to a signed 16 bit sample, clamped rather than wrapped: a peak over
 * 1.0 becomes full scale, not a burst of noise from integer overflow. */
function toInt16 (sample) {
  const clamped = Math.max(-1, Math.min(1, sample))
  return Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff))
}

/**
 * Encode one or more equal-length channels (Float32Array, -1..1) as a WAV
 * file. Interleaved on the way out, which is the format every WAV reader
 * expects and the one this project's own channels are already kept apart
 * from, matching `jig_output_ptr(channel)`'s per-channel buffers.
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
  const buffer = Buffer.alloc(HEADER_BYTES + dataBytes)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // fmt chunk size, 16 for PCM
  buffer.writeUInt16LE(1, 20) // audio format, 1 = PCM
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * blockAlign, 28) // byte rate
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)

  let offset = HEADER_BYTES
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < numChannels; c++) {
      buffer.writeInt16LE(toInt16(channels[c][frame]), offset)
      offset += BYTES_PER_SAMPLE
    }
  }

  return buffer
}
