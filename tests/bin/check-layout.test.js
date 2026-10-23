// tests/bin/check-layout.test.js
//
// bin/check-layout.js measures the page in a real Chrome and takes about two minutes, so `npm test` does not run it
// (run `npm run check:layout`). What is checked here is the part that must hold without Chrome: a check that cannot run
// says so with exit 3 and checked nothing, rather than exiting 0, and the widths it covers include a phone and the
// 720px boundary the interface rules name.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { WIDTHS, PAGES } from '../../bin/check-layout.js'

const root = resolve(import.meta.dirname, '../..')

describe('the layout check', () => {
  it('exits 3 and says nothing was checked when there is no Chrome', () => {
    const run = spawnSync(process.execPath, ['bin/check-layout.js'], { cwd: root, encoding: 'utf8', env: { ...process.env, CHROME_BIN: '/nonexistent/chrome' } })
    expect(run.status).toBe(3)
    expect(run.stdout).toContain('Nothing was checked')
  })

  it('covers a small phone, the 720px boundary and a desktop, on the studio forced open and on the simple page', () => {
    expect(Math.min(...WIDTHS)).toBeLessThanOrEqual(360)
    expect(WIDTHS).toContain(720)
    expect(Math.max(...WIDTHS)).toBeGreaterThanOrEqual(1280)
    // Below 720px the bare address redirects to the simple page, so the studio is only measured with ?studio.
    expect(PAGES).toContain('/?studio')
    expect(PAGES).toContain('/simple.html')
  })
})
