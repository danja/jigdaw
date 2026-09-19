// src/jsfx/HeaderParser.js
//
// Reads a JSFX file's header (desc:, sliderN:, in_pin:/out_pin:) and splits
// its @init/@slider/@block/@sample sections apart, ahead of
// src/jsfx/Compiler.js compiling each section's EEL2. Verified against
// REAPER's own file-structure reference
// (https://www.reaper.fm/sdk/js/js.php): sliderN:default<min,max,step>Label,
// its named form sliderN:name=default<min,max,step>Label, and the section
// markers, each at the start of its own line.
//
// Not read: tags:, options: (gmem, maxmem and the rest), the dropdown
// `{label0,label1}` and `:log` slider suffixes, and @gfx/@serialize, none of
// which this restricted subset's converted output has anywhere to put.

const SLIDER_LINE = /^slider(\d+):(?:([A-Za-z_]\w*)=)?(-?[\d.]+)<(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)(?::[a-z]+)?>(?:\{[^}]*\})?\s*(.*)$/
const SECTION_NAMES = ['init', 'slider', 'block', 'sample']

/**
 * Parse a JSFX file's text. Returns `{ desc, sliders, inChannels,
 * outChannels, sections }`. `sliders` is ordered by slider number;
 * `sections` has one string per section name, empty when absent.
 */
export function parseHeader (source) {
  const lines = source.split(/\r?\n/)

  let desc = ''
  const sliders = []
  const inPins = []
  const outPins = []
  let sawPins = false

  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (/^@/.test(line)) break // the first section marker ends the header

    if (line.startsWith('desc:')) { desc = line.slice(5).trim(); continue }

    const slider = SLIDER_LINE.exec(line)
    if (slider) {
      const [, number, name, def, min, max, step, label] = slider
      sliders.push({
        number: Number(number),
        name: name || null,
        default: Number(def),
        minimum: Number(min),
        maximum: Number(max),
        step: Number(step),
        label: label.trim() || `Slider ${number}`
      })
      continue
    }

    if (line.startsWith('in_pin:')) { sawPins = true; if (line.slice(7).trim() !== 'none') inPins.push(line.slice(7).trim()); continue }
    if (line.startsWith('out_pin:')) { sawPins = true; if (line.slice(8).trim() !== 'none') outPins.push(line.slice(8).trim()); continue }
  }

  sliders.sort((a, b) => a.number - b.number)

  const sections = Object.fromEntries(SECTION_NAMES.map(name => [name, '']))
  let current = null
  for (; i < lines.length; i++) {
    const line = lines[i]
    const marker = /^@(\w+)/.exec(line)
    if (marker) {
      current = SECTION_NAMES.includes(marker[1]) ? marker[1] : null
      continue
    }
    if (current) sections[current] += line + '\n'
  }

  return {
    desc,
    sliders,
    // REAPER's own default when a file declares no pins at all is stereo.
    inChannels: sawPins ? inPins.length : 2,
    outChannels: sawPins ? outPins.length : 2,
    sections
  }
}
