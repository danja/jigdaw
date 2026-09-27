// tests/host/Wav.test.js
import { describe, it, expect } from 'vitest'
import { encodeWav } from '../../src/host/Wav.js'

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to))
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

describe('encodeWav', () => {
  it('writes the RIFF/WAVE/fmt /data header fields for a known buffer', () => {
    const left = Float32Array.from([0, 0.5, -1, 1])
    const right = Float32Array.from([0, -0.5, 1, -1])
    const bytes = encodeWav([left, right], 48000)
    const view = viewOf(bytes)

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(ascii(bytes, 8, 12)).toBe('WAVE')
    expect(ascii(bytes, 12, 16)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16) // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(48000) // sample rate
    expect(view.getUint16(32, true)).toBe(4) // block align: 2 channels * 2 bytes
    expect(view.getUint32(28, true)).toBe(48000 * 4) // byte rate
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(ascii(bytes, 36, 40)).toBe('data')

    const dataBytes = 4 /* frames */ * 4 /* block align */
    expect(view.getUint32(40, true)).toBe(dataBytes)
    expect(view.getUint32(4, true)).toBe(36 + dataBytes) // RIFF chunk size
    expect(bytes.length).toBe(44 + dataBytes)
  })

  it('interleaves channels, left sample then right sample per frame', () => {
    const left = Float32Array.from([1, 0])
    const right = Float32Array.from([0, 1])
    const bytes = encodeWav([left, right], 44100)
    const view = viewOf(bytes)
    // Frame 0: left=1.0 (0x7fff), right=0.0. Frame 1: left=0.0, right=1.0.
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(0)
    expect(view.getInt16(48, true)).toBe(0)
    expect(view.getInt16(50, true)).toBe(0x7fff)
  })

  it('clamps a sample beyond +-1 rather than wrapping it', () => {
    const bytes = encodeWav([Float32Array.from([2.5, -3])], 44100)
    const view = viewOf(bytes)
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
  })

  it('refuses channels of different lengths rather than truncating silently', () => {
    expect(() => encodeWav([Float32Array.from([0, 0]), Float32Array.from([0])], 44100))
      .toThrow(/same length/)
  })

  it('refuses an empty channel list rather than writing a header for no data', () => {
    expect(() => encodeWav([], 44100)).toThrow(/at least one channel/)
  })

  it('writes a correct header for mono audio', () => {
    const bytes = encodeWav([Float32Array.from([0, 0, 0])], 22050)
    const view = viewOf(bytes)
    expect(view.getUint16(22, true)).toBe(1) // channels
    expect(view.getUint16(32, true)).toBe(2) // block align: 1 channel * 2 bytes
    expect(view.getUint32(40, true)).toBe(3 * 2) // 3 frames * 2 bytes
  })
})
