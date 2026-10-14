// src/ui/PortText.js
//
// How a port's value is written for the eye and for a screen reader. Shared by the generated panel
// (src/ui/Panel.js, which re-exports these so no caller changes) and the skin panel
// (src/ui/SkinPanel.js), and kept apart so neither imports the other.

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
  'http://lv2plug.in/ns/extensions/units#semitone12TET': 'st',
  'http://lv2plug.in/ns/extensions/units#cent': 'ct'
})

export const formatValue = (port, value) => {
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
  'http://lv2plug.in/ns/extensions/units#semitone12TET': 'semitones',
  'http://lv2plug.in/ns/extensions/units#cent': 'cents'
})

export const spokenValue = (port, value) => {
  const unit = SPOKEN_UNITS[port.unit]
  const decimals = port.maximum - port.minimum > 20 ? 0 : 2
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`
}
