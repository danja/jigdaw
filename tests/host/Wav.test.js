// tests/host/Wav.test.js
import { describe, it, expect } from 'vitest'
import { encodeWav } from '../../src/host/Wav.js'

describe('encodeWav', () => {
  it('writes the RIFF/WAVE/fmt /data header fields for a known buffer', () => {
    const left = Float32Array.from([0, 0.5, -1, 1])
    const right = Float32Array.from([0, -0.5, 1, -1])
    const buffer = encodeWav([left, right], 48000)

    expect(buffer.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buffer.toString('ascii', 8, 12)).toBe('WAVE')
    expect(buffer.toString('ascii', 12, 16)).toBe('fmt ')
    expect(buffer.readUInt32LE(16)).toBe(16) // fmt chunk size
    expect(buffer.readUInt16LE(20)).toBe(1) // PCM
    expect(buffer.readUInt16LE(22)).toBe(2) // channels
    expect(buffer.readUInt32LE(24)).toBe(48000) // sample rate
    expect(buffer.readUInt16LE(32)).toBe(4) // block align: 2 channels * 2 bytes
    expect(buffer.readUInt32LE(28)).toBe(48000 * 4) // byte rate
    expect(buffer.readUInt16LE(34)).toBe(16) // bits per sample
    expect(buffer.toString('ascii', 36, 40)).toBe('data')

    const dataBytes = 4 /* frames */ * 4 /* block align */
    expect(buffer.readUInt32LE(40)).toBe(dataBytes)
    expect(buffer.readUInt32LE(4)).toBe(36 + dataBytes) // RIFF chunk size
    expect(buffer.length).toBe(44 + dataBytes)
  })

  it('interleaves channels, left sample then right sample per frame', () => {
    const left = Float32Array.from([1, 0])
    const right = Float32Array.from([0, 1])
    const buffer = encodeWav([left, right], 44100)
    // Frame 0: left=1.0 (0x7fff), right=0.0. Frame 1: left=0.0, right=1.0.
    expect(buffer.readInt16LE(44)).toBe(0x7fff)
    expect(buffer.readInt16LE(46)).toBe(0)
    expect(buffer.readInt16LE(48)).toBe(0)
    expect(buffer.readInt16LE(50)).toBe(0x7fff)
  })

  it('clamps a sample beyond +-1 rather than wrapping it', () => {
    const buffer = encodeWav([Float32Array.from([2.5, -3])], 44100)
    expect(buffer.readInt16LE(44)).toBe(0x7fff)
    expect(buffer.readInt16LE(46)).toBe(-0x8000)
  })

  it('refuses channels of different lengths rather than truncating silently', () => {
    expect(() => encodeWav([Float32Array.from([0, 0]), Float32Array.from([0])], 44100))
      .toThrow(/same length/)
  })

  it('refuses an empty channel list rather than writing a header for no data', () => {
    expect(() => encodeWav([], 44100)).toThrow(/at least one channel/)
  })

  it('writes a correct header for mono audio', () => {
    const buffer = encodeWav([Float32Array.from([0, 0, 0])], 22050)
    expect(buffer.readUInt16LE(22)).toBe(1) // channels
    expect(buffer.readUInt16LE(32)).toBe(2) // block align: 1 channel * 2 bytes
    expect(buffer.readUInt32LE(40)).toBe(3 * 2) // 3 frames * 2 bytes
  })
})
