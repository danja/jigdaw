// tests/ui/Ruler.test.js
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { createRuler } from '../../src/ui/Ruler.js'

const setup = (ppb, onSeek = null) => {
  const { document, window } = parseHTML('<html><body></body></html>')
  const ruler = createRuler(document, { ppb: () => ppb, onSeek, snapBeat: beat => Math.round(beat) })
  const click = clientX => {
    const e = new window.Event('click', { bubbles: true })
    Object.defineProperty(e, 'clientX', { value: clientX })
    ruler.element.dispatchEvent(e)
  }
  return { ruler, click }
}

describe('Ruler', () => {
  it('is for the eye only and numbers bars from one, with beat ticks once a beat is wide enough', () => {
    const { ruler } = setup(24)
    ruler.draw({ bars: 3, beatsPerBar: 4, width: 288 })
    expect(ruler.element.getAttribute('aria-hidden')).toBe('true')
    expect([...ruler.element.querySelectorAll('span')].map(s => s.textContent)).toEqual(['1', '2', '3'])
    expect(ruler.element.querySelectorAll('i')).toHaveLength(9)
    expect(ruler.element.style.width).toBe('288px')
  })

  it('labels every few bars when zoomed out, and draws no ticks below 12 pixels a beat', () => {
    const { ruler } = setup(4)
    ruler.draw({ bars: 8, beatsPerBar: 4, width: 128 })
    expect([...ruler.element.querySelectorAll('span')].map(s => s.textContent)).toEqual(['1', '4', '7'])
    expect(ruler.element.querySelectorAll('i')).toHaveLength(0)
  })

  it('rewrites itself in place rather than adding to what it drew', () => {
    const { ruler } = setup(24)
    ruler.draw({ bars: 3, beatsPerBar: 4, width: 288 })
    ruler.draw({ bars: 2, beatsPerBar: 4, width: 192 })
    expect(ruler.element.querySelectorAll('span')).toHaveLength(2)
  })

  it('seeks to the snapped beat under a click, and does nothing without a seek', () => {
    const seen = []
    setup(24, beat => seen.push(beat)).click(60)
    expect(seen).toEqual([3])
    expect(() => setup(24).click(60)).not.toThrow()
  })
})
