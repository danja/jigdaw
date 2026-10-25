// tests/bin/check-alignment.test.js
//
// bin/check-alignment.js renders in a real Chrome (`npm run check:alignment`), so `npm test` does not run it. What is
// held here is what must be true without Chrome: a check that cannot run says so with exit 3 and checked nothing, and the
// verdict fails for each way the render can be wrong, so a pass means the clicks really were found where they should be.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { judge, SCENARIOS, LATENCY_FRAMES, BUS_FRAMES } from '../../bin/check-alignment.js'

const root = resolve(import.meta.dirname, '../..')
const START = 24000
const good = () => ({
  startFrame: START,
  aligned: { clicks: [[START + LATENCY_FRAMES], [START + LATENCY_FRAMES]], errors: [] },
  unaligned: { clicks: [[START, START + LATENCY_FRAMES], [START, START + LATENCY_FRAMES]], errors: [] }
})

describe('the alignment check', () => {
  it('exits 3 and says nothing was checked when there is no Chrome', () => {
    const run = spawnSync(process.execPath, ['bin/check-alignment.js'], { cwd: root, encoding: 'utf8', env: { ...process.env, CHROME_BIN: '/nonexistent/chrome' } })
    expect(run.status).toBe(3)
    expect(run.stdout).toContain('Nothing was checked')
  })

  it('passes when the clicks coincide with alignment on and sit one latency apart with it off', () => {
    const { code, lines } = judge(good())
    expect(code).toBe(0)
    expect(lines.every(l => l.startsWith('ok'))).toBe(true)
  })

  it('fails when the plain track was not held back', () => {
    const m = good()
    m.aligned.clicks = [[START, START + LATENCY_FRAMES], [START, START + LATENCY_FRAMES]]
    const { code, lines } = judge(m)
    expect(code).toBe(1)
    expect(lines.filter(l => l.startsWith('FAIL')).length).toBe(2)
  })

  it('fails when one channel is aligned and the other is not', () => {
    const m = good()
    m.aligned.clicks[1] = [START]
    expect(judge(m).code).toBe(1)
  })

  it('fails when the control cannot see a misalignment, since then a pass proves nothing', () => {
    const m = good()
    m.unaligned.clicks = [[START + LATENCY_FRAMES], [START + LATENCY_FRAMES]]
    const { code, lines } = judge(m)
    expect(code).toBe(1)
    expect(lines.some(l => l.startsWith('FAIL') && l.includes('the control'))).toBe(true)
  })

  it('fails on a render that reported an error, whatever it found', () => {
    const m = good()
    m.aligned.errors = ['audio data:...: could not decode']
    expect(judge(m).code).toBe(1)
  })

  it('fails when the click lands at the wrong frame even though there is one', () => {
    const m = good()
    m.aligned.clicks = [[START + LATENCY_FRAMES + 128], [START + LATENCY_FRAMES + 128]]
    expect(judge(m).code).toBe(1)
  })

  it('fails when the control differs between the channels', () => {
    const m = good()
    m.unaligned.clicks[1] = [START, START + LATENCY_FRAMES + 1]
    const { code, lines } = judge(m)
    expect(code).toBe(1)
    expect(lines.some(l => l.startsWith('FAIL') && l.includes('same in both channels'))).toBe(true)
  })

  it('fails when the control finds a stray extra click, not exactly the two', () => {
    const m = good()
    m.unaligned.clicks = [[START, START + LATENCY_FRAMES, START + LATENCY_FRAMES + 64], [START, START + LATENCY_FRAMES, START + LATENCY_FRAMES + 64]]
    expect(judge(m).code).toBe(1)
  })

  it('knows two scenarios, parallel tracks and through a bus, and that a bus adds its own latency to the meeting point', () => {
    expect(SCENARIOS.map(s => s.name)).toEqual(['parallel tracks', 'through a bus'])
    expect(SCENARIOS[1].offsets).toEqual({ aligned: [LATENCY_FRAMES + BUS_FRAMES], unaligned: [0, BUS_FRAMES, LATENCY_FRAMES + BUS_FRAMES] })
  })
})

describe('the alignment verdict through a bus', () => {
  const { offsets } = SCENARIOS[1]
  const meet = START + LATENCY_FRAMES + BUS_FRAMES
  const bus = () => ({
    startFrame: START,
    aligned: { clicks: [[meet], [meet]], errors: [] },
    unaligned: { clicks: [[START, START + BUS_FRAMES, meet], [START, START + BUS_FRAMES, meet]], errors: [] }
  })

  it('passes when all three meet after the slowest path plus the bus, and are three apart without alignment', () => {
    const { code } = judge(bus(), offsets)
    expect(code).toBe(0)
  })

  it('fails when the bus\'s own latency was left out of the meeting point', () => {
    const m = bus()
    m.aligned.clicks = [[START + BUS_FRAMES, meet], [START + BUS_FRAMES, meet]]
    expect(judge(m, offsets).code).toBe(1)
  })

  it('fails when the control does not show the three paths', () => {
    const m = bus()
    m.unaligned.clicks = [[START, meet], [START, meet]]
    expect(judge(m, offsets).code).toBe(1)
  })

  it('is judged against the offsets it is given: the parallel verdict rejects a bus render', () => {
    expect(judge(bus()).code).toBe(1)
  })
})
