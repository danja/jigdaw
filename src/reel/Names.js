// src/reel/Names.js
//
// What a script can say about the plugins already in a piece: each name, and for each parameter the line that
// sets it. The Reel page lists these so a person on a phone taps a parameter and does not type its symbol.
//
// The line written for a parameter must be one the planner accepts, so it carries the unit the parameter
// declares and a value inside its range; tests/reel/Names.test.js plans the line for every parameter of every
// plugin in the catalogue.
import { portDimension } from './Values.js'

// The suffix Reel writes for a parameter's declared unit, by the unit's local name in lower case (Values.js
// reads the same names). A unit with no suffix is a plain number.
const SUFFIX = {
  hz: 'Hz', khz: 'kHz', ms: 'ms', s: 's', db: 'dB', semitone12tet: 'st', pc: '%', cent: 'cents'
}

/** The unit suffix to write after a number for this port, or '' for a plain number. */
export function unitSuffix (unit) {
  const dimension = portDimension(unit)
  if (!dimension) return ''
  if (dimension.dim === undefined) return ''
  return SUFFIX[dimension.name]
}

/** A number as short text, without the noise a binary float adds. */
const shown = value => String(Number(Number(value).toPrecision(6)))

/** A range as text, with the port's unit. */
export function rangeText (port) {
  const suffix = unitSuffix(port.unit)
  return `${shown(port.minimum)}${suffix} to ${shown(port.maximum)}${suffix}`
}

/** The statement that sets this parameter to its default, for the Insert button. */
export function setLine (name, port) {
  return `${name}.${port.symbol} = ${shown(port.defaultValue)}${unitSuffix(port.unit)}`
}

/**
 * The names a script can use in the open piece.
 * @param existing the Map from Host.js `existingPlugins`: name to { ports }
 * @param labelOf  (name) => the plugin's label, for display
 * @returns {{name: string, label: string, parameters: object[]}[]} in name order
 */
export function describeNames (existing, labelOf) {
  return [...existing].map(([name, { ports }]) => ({
    name,
    label: labelOf(name),
    parameters: ports.map(port => ({
      symbol: port.symbol,
      name: port.name ?? port.symbol,
      range: rangeText(port),
      line: setLine(name, port),
      choices: (port.scalePoints ?? []).map(point => ({ value: point.value, label: point.label }))
    }))
  })).sort((a, b) => a.name.localeCompare(b.name))
}
