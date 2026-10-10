// tests/web/HiddenAttribute.test.js
//
// An element left out with `hidden` stays out only if no rule gives it a display of its own that beats the
// browser's default `[hidden] { display: none }`. A class with `display: flex` does exactly that, so a MIDI
// send's Level slider was drawn with nothing behind it while every test, which reads the attribute, passed
// (MISTAKES.md, "An element was left out, and it was still on the screen"). A DOM without a renderer has no cascade, so the
// attribute is all a unit test can see and the page has to carry the rule.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

describe('the studio page', () => {
  const html = readFileSync(resolve(root, 'web/index.html'), 'utf8')

  it('keeps an element with the hidden attribute out of the page whatever display its class gives it', () => {
    expect(html).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
  })

  it('has a class that sets a display on something the interface leaves out, which is why it needs the rule', () => {
    // The rule is not decoration: .send-level is hidden for a MIDI send and sets its own display.
    const js = readFileSync(resolve(root, 'src/ui/SendsPanel.js'), 'utf8')
    expect(js).toMatch(/row\.level\.hidden = midi/)
    expect(js).toMatch(/level\.className = 'send-level'/)
  })
})
