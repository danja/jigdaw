// tests/host/HostConfig.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readHostConfig, HOST_CONFIG_KEYS } from '../../src/host/HostConfig.js'

const shipped = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../web/host.json'), 'utf8'))

describe('the page settings', () => {
  it('reads the shipped file, which has every key the code asks for', () => {
    const settings = readHostConfig(shipped)
    expect(Object.keys(settings).sort()).toEqual(Object.keys(HOST_CONFIG_KEYS).sort())
  })

  it('refuses a missing key, naming it, rather than defaulting', () => {
    expect(() => readHostConfig({})).toThrow(/has no relayPerSecond/)
    const { schedulerTickMs, ...withoutTick } = shipped
    expect(schedulerTickMs).toBeDefined()
    expect(() => readHostConfig(withoutTick)).toThrow(/has no schedulerTickMs/)
  })

  it('refuses a value that is not a positive whole number', () => {
    for (const bad of [0, -1, 1.5, '60', null]) {
      expect(() => readHostConfig({ ...shipped, relayPerSecond: bad }), String(bad)).toThrow(/relayPerSecond/)
    }
  })

  it('reads alignTracks as a boolean, and refuses anything else', () => {
    expect(readHostConfig({ ...shipped, alignTracks: false }).alignTracks).toBe(false)
    for (const bad of ['true', 1, null, 0]) {
      expect(() => readHostConfig({ ...shipped, alignTracks: bad }), String(bad)).toThrow(/alignTracks/)
    }
    const { alignTracks, ...without } = shipped
    expect(alignTracks).toBe(true)
    expect(() => readHostConfig(without)).toThrow(/has no alignTracks/)
  })

  it('refuses a maximum track delay that is not a positive whole number', () => {
    for (const bad of [0, -5, 2.5, '2000']) expect(() => readHostConfig({ ...shipped, maxTrackDelayMs: bad }), String(bad)).toThrow(/maxTrackDelayMs/)
  })

  it('refuses a handoff time that is not a positive whole number of minutes', () => {
    for (const bad of [0, -1, 1.5, '30']) expect(() => readHostConfig({ ...shipped, handoffMinutes: bad }), String(bad)).toThrow(/handoffMinutes/)
    const { handoffMinutes, ...without } = shipped
    expect(handoffMinutes).toBeGreaterThan(0)
    expect(() => readHostConfig(without)).toThrow(/has no handoffMinutes/)
  })

  it('refuses a bridge port that is not a port', () => {
    expect(() => readHostConfig({ ...shipped, bridgePort: 70000 })).toThrow(/bridgePort/)
    expect(() => readHostConfig({ ...shipped, bridgePort: 0 })).toThrow(/bridgePort/)
  })

  it('refuses a lookahead no longer than the tick, which would leave gaps', () => {
    expect(() => readHostConfig({ ...shipped, schedulerLookaheadMs: 25, schedulerTickMs: 25 })).toThrow(/must exceed/)
  })

  it('refuses something that is not an object', () => {
    expect(() => readHostConfig(null)).toThrow(/not a JSON object/)
  })
})
