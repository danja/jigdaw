// tests/web/PageStandIns.test.js
//
// The simple page and the reel page share the studio's modules and give them a stand-in for the parts of the studio page they do
// not have. A stand-in that lacks a method the shared code calls fails only when a person does the thing that calls it: opening a
// tune on the simple page threw "ctx.align?.fromSession is not a function" for as long as Sessions.js called it, since `?.` guards
// a missing object and not a missing method. This binds each stand-in to the real thing's method names.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')

const returned = source => {
  const body = source.match(/\n  return \{ ([^}]*) \}\n\}\s*$/)[1]
  return body.split(',').map(name => name.trim()).filter(Boolean).sort()
}

describe('the pages that stand in for the studio\'s align setting', () => {
  const real = returned(read('web/app/Align.js'))

  it('found the real methods, so the rest is not vacuous', () => {
    expect(real).toEqual(['fromSession', 'mount', 'preferred', 'sync'])
  })

  for (const page of ['web/simple.js', 'web/reel.js']) {
    it(`${page} has every one the shared code calls, the ones that need a checkbox aside`, () => {
      const stand = read(page).match(/\n  align: \{([\s\S]*?)\n  \},/)[1]
      const names = [...stand.matchAll(/^    (\w+)(?: \(|:)/gm)].map(m => m[1]).sort()
      // mount wires the studio page's checkbox, and neither page has one.
      expect(names).toEqual(real.filter(name => name !== 'mount'))
    })
  }

  it('is called by what opens a session, which is why the stand-ins need it', () => {
    expect(read('web/app/Sessions.js')).toMatch(/ctx\.align\?\.fromSession\(\)/)
  })
})
