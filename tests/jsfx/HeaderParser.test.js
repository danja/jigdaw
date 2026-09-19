// tests/jsfx/HeaderParser.test.js
import { describe, it, expect } from 'vitest'
import { parseHeader } from '../../src/jsfx/HeaderParser.js'

describe('parseHeader', () => {
  it('reads desc as the plugin name', () => {
    const h = parseHeader('desc:My Effect\n\n@sample\nspl0 = spl0;\n')
    expect(h.desc).toBe('My Effect')
  })

  it('reads an unnamed slider', () => {
    const h = parseHeader('desc:x\nslider1:0<-24,24,0.1>Gain (dB)\n\n@init\n')
    expect(h.sliders).toEqual([{
      number: 1, name: null, default: 0, minimum: -24, maximum: 24, step: 0.1, label: 'Gain (dB)'
    }])
  })

  it('reads a named slider, giving a script an alias for slider1', () => {
    const h = parseHeader('desc:x\nslider1:gain=0<-24,24,0.1>Gain (dB)\n\n@init\n')
    expect(h.sliders[0].name).toBe('gain')
    expect(h.sliders[0].number).toBe(1)
  })

  it('orders sliders by number regardless of the order in the file', () => {
    const h = parseHeader([
      'desc:x',
      'slider3:0<0,1,0.1>Third',
      'slider1:0<0,1,0.1>First',
      'slider2:0<0,1,0.1>Second',
      '',
      '@init'
    ].join('\n'))
    expect(h.sliders.map(s => s.number)).toEqual([1, 2, 3])
  })

  it('defaults to stereo when no in_pin/out_pin lines are present', () => {
    const h = parseHeader('desc:x\n\n@init\n')
    expect(h.inChannels).toBe(2)
    expect(h.outChannels).toBe(2)
  })

  it('counts in_pin/out_pin lines when they are present', () => {
    const h = parseHeader('desc:x\nin_pin:Left\nin_pin:Right\nout_pin:Mono\n\n@init\n')
    expect(h.inChannels).toBe(2)
    expect(h.outChannels).toBe(1)
  })

  it('treats in_pin:none as zero channels rather than one named "none"', () => {
    const h = parseHeader('desc:x\nin_pin:none\nout_pin:Mono\n\n@init\n')
    expect(h.inChannels).toBe(0)
    expect(h.outChannels).toBe(1)
  })

  it('splits @init/@slider/@block/@sample apart, each ending at the next section', () => {
    const h = parseHeader([
      'desc:x',
      '',
      '@init',
      'a = 1;',
      '@slider',
      'b = 2;',
      '@sample',
      'spl0 = a + b;'
    ].join('\n'))
    expect(h.sections.init.trim()).toBe('a = 1;')
    expect(h.sections.slider.trim()).toBe('b = 2;')
    expect(h.sections.block.trim()).toBe('')
    expect(h.sections.sample.trim()).toBe('spl0 = a + b;')
  })

  it('ignores @gfx and @serialize, which this restricted subset does not run', () => {
    const h = parseHeader([
      'desc:x',
      '@sample',
      'spl0 = 1;',
      '@gfx',
      'gfx_r = 1;',
      '@serialize',
      'file_var(0, x);'
    ].join('\n'))
    expect(h.sections.sample.trim()).toBe('spl0 = 1;')
    expect(Object.values(h.sections).some(s => s.includes('gfx_r'))).toBe(false)
    expect(Object.values(h.sections).some(s => s.includes('file_var'))).toBe(false)
  })

  it('gives an unlabelled slider a fallback label rather than an empty name', () => {
    const h = parseHeader('desc:x\nslider1:0<0,1,0.1>\n\n@init\n')
    expect(h.sliders[0].label).toBe('Slider 1')
  })
})
