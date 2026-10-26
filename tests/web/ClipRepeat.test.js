// tests/web/ClipRepeat.test.js
//
// The page hands the timeline a way to repeat a clip, and the timeline hands it on to each clip. Unit tests of the clip button
// cannot see either hand-over: a clip built without them simply has no loop handle, which is correct there and silent here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')

describe('repeating a clip, wired', () => {
  const arrangement = read('web/app/Arrangement.js')
  const timeline = read('src/ui/Timeline.js')

  it('has the page ask for the one change repeatClip makes, so a repeat is one edit and one undo', () => {
    expect(arrangement).toMatch(/import \{ repeatClip \} from '\.\.\/\.\.\/src\/model\/ClipLoop\.js'/)
    expect(arrangement).toMatch(/onRepeat: \(id, lengthBeats\) => edit\(\[repeatClip\(ctx\.dispatcher\.project\.clip\(id\), lengthBeats\)\]\)/)
    expect(arrangement).toMatch(/onStopRepeat: id => edit\(\[\{ op: 'setClip', id, loopBeats: null \}\]\)/)
  })

  it('has the timeline take both and hand both to every clip it draws', () => {
    expect(timeline).toMatch(/onRepeat = null, onStopRepeat = null \}/)
    expect(timeline).toMatch(/createClipButton\(document, \{[^}]*onRepeat, onStopRepeat/)
  })

  it('puts the handlers in the object the timeline is built from, and not in some other options object further down the file', () => {
    // The first attempt put them after onLoop, which is the piano roll's, and this test passed because it only looked for the words.
    const start = arrangement.indexOf('const handlers = {')
    const end = arrangement.indexOf('createTimeline(document, handlers')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const own = arrangement.slice(start, end)
    expect(own).toMatch(/onRepeat: \(id, lengthBeats\)/)
    expect(own).toMatch(/onStopRepeat: id/)
    expect(arrangement.slice(end).match(/onRepeat:/g) ?? []).toHaveLength(0)
  })
})
