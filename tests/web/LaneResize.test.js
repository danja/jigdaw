// tests/web/LaneResize.test.js
//
// The page keeps a dragged lane height with the track's layout, and choosing a size puts it away, from every place a size is chosen. The unit tests of
// the grip cannot see either: a lane built without the page's handlers simply has no grip, and a size chosen in the dock that left the old height behind
// would look like a size that did nothing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const arrangement = read('web/app/Arrangement.js')
const dock = read('web/app/Dock.js')

describe('lane height, wired', () => {
  it('keeps a dragged height with the track layout, and puts it back on a reset', () => {
    expect(arrangement).toMatch(/onLaneHeight: \(trackId, height\) => ctx\.dispatcher\.project\.setTrackLayout\(trackId, \{ laneHeight: height \}\)/)
    expect(arrangement).toMatch(/onLaneReset: trackId => ctx\.dispatcher\.project\.setTrackLayout\(trackId, \{ laneHeight: null \}\)/)
  })

  it('puts it in the object the timeline is built from, and not in some other options object', () => {
    const start = arrangement.indexOf('const handlers = {')
    const end = arrangement.indexOf('createTimeline(document, handlers')
    const own = arrangement.slice(start, end)
    expect(own).toMatch(/onLaneHeight:/)
    expect(own).toMatch(/onLaneReset:/)
  })

  it('puts a dragged height away whenever a size is chosen: by plus and minus, by expanding a collapsed lane, and in the dock for one track or several', () => {
    expect(arrangement).toMatch(/laneSize: next, laneHeight: null/)
    expect(arrangement).toMatch(/laneSize: 'small', laneHeight: null/)
    expect(dock).toMatch(/onSize: laneSize => \{ for \(const id of ctx\.selection\.ids\) layoutOf\(id, \{ laneSize, laneHeight: null \}\) \}/)
    expect(dock).toMatch(/onSize: \(id, laneSize\) => layoutOf\(id, \{ laneSize, laneHeight: null \}\)/)
  })

  it('has a grip style that is hidden on a collapsed lane and larger for a finger', () => {
    const html = read('web/index.html')
    expect(html).toMatch(/\.lane-resize \{[^}]*cursor:row-resize/)
    expect(html).toMatch(/@media \(pointer: coarse\) \{ \.lane-resize \{ height:16px; \} \}/)
    expect(html).toMatch(/\.timeline-row\[data-size="collapsed"\] \.lane-resize \{ display:none; \}/)
  })
})
