// tests/web/AgentSurface.test.js
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

// The agent tools are registered when the engine is built, so the page offers them only if it builds the engine at load
// and does not wait for a user gesture to do it. A DOM test cannot see either, so this binds the two lines that decide it.
describe('the studio offers its agent tools without a click', () => {
  it('builds the engine when the page loads', () => {
    expect(read('web/app.js')).toMatch(/^ctx\.runtime\.ensureRunning\(\)\.catch/m)
  })

  it('does not wait on context.resume() unless the page has had user activation', () => {
    const runtime = read('web/app/Runtime.js')
    expect(runtime).not.toMatch(/^\s*await context\.resume\(\)/m)
    expect(runtime).toMatch(/hasBeenActive\) await context\.resume\(\)/)
    expect(runtime).toMatch(/else resumeOnGesture\(context\)/)
  })
})
