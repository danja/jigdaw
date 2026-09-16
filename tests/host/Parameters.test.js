// tests/host/Parameters.test.js
import { describe, it, expect } from 'vitest'
import { parameterDescriptors, clampToPort } from '../../src/host/Parameters.js'

const port = over => ({
  symbol: 'mix', name: 'Mix', defaultValue: 0.5, minimum: 0, maximum: 1,
  automationRate: 'k-rate', ...over
})

describe('parameterDescriptors', () => {
  it('derives an AudioParamDescriptor from a port', () => {
    expect(parameterDescriptors([port()])).toEqual([
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ])
  })

  it('keys on lv2:symbol, which automation and the saved project rely on', () => {
    expect(parameterDescriptors([port({ symbol: 'cutoff' })])[0].name).toBe('cutoff')
  })

  it('carries a-rate through', () => {
    expect(parameterDescriptors([port({ automationRate: 'a-rate' })])[0].automationRate).toBe('a-rate')
  })

  it('defaults an unrecognised rate to k-rate rather than passing it on', () => {
    // An invalid automationRate makes the AudioWorkletNode constructor throw,
    // which would surface as a load failure with no mention of the parameter.
    expect(parameterDescriptors([port({ automationRate: 'fast' })])[0].automationRate).toBe('k-rate')
  })

  it('refuses a port with no range', () => {
    expect(() => parameterDescriptors([port({ minimum: null })])).toThrow(/no minValue/)
  })

  it('refuses a default outside its own range', () => {
    // vocabs/shapes.ttl catches this too. Both, because a profile may reach the
    // host without having been validated by this host.
    expect(() => parameterDescriptors([port({ defaultValue: 2 })])).toThrow(/outside its range/)
  })

  it('skips a port with no symbol rather than producing a nameless parameter', () => {
    expect(parameterDescriptors([port({ symbol: null })])).toEqual([])
  })
})

describe('clampToPort', () => {
  it('clamps to the declared range', () => {
    expect(clampToPort(port(), 5)).toBe(1)
    expect(clampToPort(port(), -5)).toBe(0)
    expect(clampToPort(port(), 0.25)).toBe(0.25)
  })

  it('throws on a value that is not a number', () => {
    expect(() => clampToPort(port(), 'loud')).toThrow(/not a number/)
  })
})
