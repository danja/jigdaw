// tests/host/mix64.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Sprout and Markov carry the VST3's 64-bit mix as pairs of 32-bit halves, since a BigInt would
// allocate in process(). Each copy is cut out of the processor source and held to a BigInt reference.
const M = (1n << 64n) - 1n
const ref = v => {
  v = (v + 0x9e3779b97f4a7c15n) & M
  v = ((v ^ (v >> 30n)) * 0xbf58476d1ce4e5b9n) & M
  v = ((v ^ (v >> 27n)) * 0x94d049bb133111ebn) & M
  return v ^ (v >> 31n)
}

function load (file) {
  const src = readFileSync(new URL(`../../plugins/${file}`, import.meta.url), 'utf8')
  const start = src.indexOf('let MIX_HI')
  const end = src.indexOf('\n}\n', src.indexOf('function randomUnit')) + 3
  expect(start).toBeGreaterThan(-1)
  return new Function(`${src.slice(start, end)}\nreturn { mix64, randomUnit, halves: () => [MIX_HI, MIX_LO] }`)()
}

// A small deterministic generator, so a failure repeats.
function lcg (seed) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0)
}

describe.each(['sprout/sprout-processor.js', 'markov/markov-processor.js'])('64-bit mix in %s', file => {
  const { mix64, randomUnit, halves } = load(file)

  it('matches the BigInt mix64 on edge values and 20000 random ones', () => {
    const next = lcg(1)
    const values = [0n, 1n, M, 1n << 63n, 0xffffffffn, 1n << 32n]
    for (let i = 0; i < 20000; i++) values.push((BigInt(next()) << 32n) | BigInt(next()))
    for (const v of values) {
      mix64(Number(v >> 32n), Number(v & 0xffffffffn))
      const [hi, lo] = halves()
      expect((BigInt(hi) << 32n) | BigInt(lo)).toBe(ref(v))
    }
  })

  it('draws the VST3 unit value for a seed and an index, negative indices wrapping as a uint64', () => {
    const next = lcg(7)
    for (let i = 0; i < 5000; i++) {
      const seed = (BigInt(next()) << 32n) | BigInt(next())
      const index = [0, 1, -1, -5, 2 ** 33 + 3][i] ?? next() - 2 ** 31
      const want = Number(ref(seed ^ ref(BigInt.asUintN(64, BigInt(index)))) >> 40n) / 16777216
      expect(randomUnit(Number(seed >> 32n), Number(seed & 0xffffffffn), index)).toBe(want)
    }
  })
})
