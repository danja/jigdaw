// src/ui/Panel.js
//
// A control panel generated from a plugin's lv2:port declarations.
//
// Contract section 9.1: a plugin with no jig:ui gets this, and that is the
// expected case rather than a degraded one. It is consistent with every other
// plugin, it is accessible, and it costs the author nothing.
//
// The widget is chosen by ProfileReader.widgetFor, from the shape of the
// declaration. Nothing here inspects lv2:toggled itself.
//
// This file carries the project's whole accessibility story. AGENTS.md requires
// WCAG 2.2 AA, and almost every control a person touches in Jiggy is generated
// here: a plugin that ships no jig:ui gets exactly this. So one accessible
// generator makes every such plugin accessible, and one careless generator
// makes every one of them unusable.
//
// A continuous control is drawn as a rotary knob by src/ui/Dial.js, which is
// where the pixels and the pointer live. The element underneath is still an
// `<input type="range">`, so nothing about the keyboard or the screen reader
// changed when the look did.
import { createDial } from './Dial.js'

// Every unit any committed plugin declares must appear here and in
// SPOKEN_UNITS below. A unit this does not know is not an error anywhere: the
// control renders a bare number and nothing reports the loss, which is the
// difference between 4200 and 4200 Hz going missing in silence.
// tests/ui/Panel.test.js walks plugins/ and fails on a unit neither table
// knows.
export const UNIT_LABELS = Object.freeze({
  'http://lv2plug.in/ns/extensions/units#hz': 'Hz',
  'http://lv2plug.in/ns/extensions/units#ms': 'ms',
  'http://lv2plug.in/ns/extensions/units#db': 'dB',
  'http://lv2plug.in/ns/extensions/units#s': 's',
  'http://lv2plug.in/ns/extensions/units#pc': '%',
  'http://lv2plug.in/ns/extensions/units#semitone12TET': 'st'
})

const formatValue = (port, value) => {
  const unit = UNIT_LABELS[port.unit]
  const decimals = port.maximum - port.minimum > 20 ? 0 : 2
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`
}

/**
 * What a screen reader should say for a value.
 *
 * WCAG 4.1.2 wants a name, a role and a value. A range reports its value as a
 * bare number unless told otherwise, and "4200" and "4200 hertz" are different
 * information. Units are spelled out because an abbreviation is read as
 * letters.
 */
export const SPOKEN_UNITS = Object.freeze({
  'http://lv2plug.in/ns/extensions/units#hz': 'hertz',
  'http://lv2plug.in/ns/extensions/units#ms': 'milliseconds',
  'http://lv2plug.in/ns/extensions/units#db': 'decibels',
  'http://lv2plug.in/ns/extensions/units#s': 'seconds',
  'http://lv2plug.in/ns/extensions/units#pc': 'percent',
  'http://lv2plug.in/ns/extensions/units#semitone12TET': 'semitones'
})

const spokenValue = (port, value) => {
  const unit = SPOKEN_UNITS[port.unit]
  const decimals = port.maximum - port.minimum > 20 ? 0 : 2
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`
}

/**
 * Build a panel. `onChange(symbol, value)` is called on input; the panel does
 * not apply the value itself.
 *
 * That round trip is deliberate, per messaging.md section 2.3: a UI that
 * renders optimistically from its own input disagrees with the host the first
 * time a value is clamped, rejected, or overridden by automation.
 *
 * `onLoadAsset(key, file)` is called when a person picks a file for a
 * `jig:userReplaceable` asset (messaging.md section 1.2's `loadAsset`), one
 * per such asset the profile declares. Optional, and nothing is drawn for it
 * when a profile declares none: most plugins have nothing a person loads at
 * runtime, and this must cost them nothing, the same rule every other
 * generated control here already follows.
 */
export function createPanel (document, profile, onChange, onLoadAsset) {
  const root = document.createElement('section')
  root.className = 'panel'

  const heading = document.createElement('h3')
  heading.textContent = profile.label ?? profile.iri
  const headingId = `${profile.iri}-heading`.replace(/[^\w-]/g, '_')
  heading.id = headingId
  // A group per plugin, named by its own heading, so a panel is one landmark a
  // reader can skip rather than a flat run of controls from several plugins.
  root.setAttribute('role', 'group')
  root.setAttribute('aria-labelledby', headingId)
  root.append(heading)

  // Contract section 12.5. A foreign plugin runs in this document with this
  // document's privileges, and a person who consented once and came back a
  // week later has no other way to tell. The mark is text inside the heading
  // rather than a class on the panel, because section 12.5 requires it to
  // reach assistive technology and forbids carrying it by colour alone: a
  // border a stylesheet draws is invisible to a screen reader and to anyone
  // who cannot see the border.
  if (profile.kind === 'foreign') {
    const mark = document.createElement('span')
    mark.className = 'foreign'
    mark.textContent = 'foreign'
    mark.title = 'Runs in this page with this page\'s privileges. It is not sandboxed.'
    heading.append(' ', mark)
    root.classList.add('is-foreign')
  }

  // No description. rdfs:comment is three lines of prose above the controls,
  // it is the same three lines every time the plugin is loaded, and the
  // browser and the catalogue both already show it where someone is choosing
  // a plugin rather than playing one. Screen area is the scarce thing in a
  // rack.

  const setters = new Map()

  // The controls share one grid, so knobs pack across the width they are
  // given instead of taking a row each. A panel of 42 controls was 2000
  // pixels tall as sliders and is one screen as knobs.
  const controls = document.createElement('div')
  controls.className = 'controls'
  root.append(controls)

  for (const port of profile.ports) {
    const row = document.createElement('div')
    row.className = `control control-${port.widget}`

    const label = document.createElement('label')
    const id = `${profile.iri}#${port.symbol}`.replace(/[^\w-]/g, '_')
    // setAttribute rather than the htmlFor property: the property is an alias
    // that not every DOM implementation provides, and the association is the
    // whole point of the label.
    label.setAttribute('for', id)
    label.textContent = port.name ?? port.symbol
    row.append(label)

    const readout = document.createElement('span')
    readout.className = 'value'

    let input
    // What goes in the row: the input itself for a switch or a selector, and
    // the knob that wraps the input for a dial.
    let knob = null
    if (port.widget === 'switch') {
      input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = port.defaultValue >= 0.5
      input.addEventListener('change', () => onChange(port.symbol, input.checked ? port.maximum : port.minimum))
      setters.set(port.symbol, v => {
        const on = v >= 0.5
        input.checked = on
        // WCAG 1.4.1: the readout is the non-colour signal for the state.
        readout.textContent = on ? 'on' : 'off'
      })
    } else if (port.widget === 'selector') {
      input = document.createElement('select')
      for (const point of port.scalePoints) {
        const option = document.createElement('option')
        option.value = String(point.value)
        option.textContent = point.label ?? String(point.value)
        input.append(option)
      }
      // Selecting by marking the option rather than assigning select.value,
      // which is a setter some DOM implementations do not provide.
      const select = value => {
        for (const option of input.options ?? input.children) {
          option.selected = Number(option.value) === Number(value)
        }
      }
      select(port.defaultValue)
      input.addEventListener('change', () => onChange(port.symbol, Number(input.value)))
      setters.set(port.symbol, v => {
        select(v)
        readout.textContent = port.scalePoints.find(p => p.value === v)?.label ?? String(v)
      })
    } else {
      const dial = createDial(document, port, id)
      input = dial.input
      // One listener for both, because a drag dispatches the same event an
      // arrow key does. Nothing here knows which happened.
      input.addEventListener('input', () => onChange(port.symbol, Number(input.value)))
      setters.set(port.symbol, v => {
        input.value = String(v)
        readout.textContent = formatValue(port, v)
        // aria-valuetext, because a range otherwise announces the raw number
        // and loses the unit entirely.
        input.setAttribute('aria-valuetext', spokenValue(port, v))
        dial.render(v)
      })
      knob = dial.element
    }

    input.id = id
    // The readout is the accessible description rather than a separate node a
    // reader has to go and find.
    const readoutId = `${id}-value`
    readout.id = readoutId
    input.setAttribute('aria-describedby', readoutId)
    if (port.comment) input.title = port.comment
    // The full name, because a knob's caption is narrow and a long one wraps
    // or is read in pieces. The accessible name is the label and is never
    // shortened; this is for a pointer.
    else if (port.name) input.title = port.name
    row.append(knob ?? input, readout)
    controls.append(row)

    // Render the declared default through the same path a host update takes.
    setters.get(port.symbol)(port.defaultValue)
  }

  // One file picker per jig:userReplaceable asset, after the parameters:
  // loading a different model or impulse response is a rarer action than
  // turning a knob, and the panel reads top to bottom in the order a person
  // is most likely to want it.
  for (const asset of profile.assets ?? []) {
    if (!asset.userReplaceable) continue
    const key = asset.iri.split('#').pop()

    const row = document.createElement('div')
    row.className = 'control control-asset'

    const label = document.createElement('label')
    const id = `${profile.iri}#${key}-asset`.replace(/[^\w-]/g, '_')
    label.setAttribute('for', id)
    label.textContent = key
    row.append(label)

    const input = document.createElement('input')
    input.type = 'file'
    input.id = id
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file) onLoadAsset?.(key, file)
    })
    row.append(input)
    controls.append(row)
  }

  return {
    element: root,
    /** Called by the host when a value actually changed. */
    update (symbol, value) { setters.get(symbol)?.(value) }
  }
}
