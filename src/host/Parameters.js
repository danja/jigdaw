// src/host/Parameters.js
//
// Contract section 5.1: a parameter is declared once, as an lv2:port, and the
// host derives both the processor's parameterDescriptors and the control the
// panel draws from that one declaration. They cannot disagree because there is
// nothing for them to disagree about.

/**
 * AudioParamDescriptors for AudioWorkletProcessor.parameterDescriptors.
 *
 * lv2:symbol becomes the AudioParam name. It is what automation and the saved
 * project key on, which is why contract section 5.1 requires it to be stable
 * across versions.
 */
export function parameterDescriptors (ports) {
  return ports
    .filter(p => p.symbol !== null)
    .map(port => {
      for (const [field, value] of Object.entries({
        defaultValue: port.defaultValue,
        minValue: port.minimum,
        maxValue: port.maximum
      })) {
        if (value === null || value === undefined) {
          throw new Error(`port ${port.symbol} has no ${field}; a parameter without a range cannot be an AudioParam`)
        }
      }
      if (port.defaultValue < port.minimum || port.defaultValue > port.maximum) {
        throw new Error(
          `port ${port.symbol} has default ${port.defaultValue} outside its range ${port.minimum}..${port.maximum}`
        )
      }
      return {
        name: port.symbol,
        defaultValue: port.defaultValue,
        minValue: port.minimum,
        maxValue: port.maximum,
        automationRate: port.automationRate === 'a-rate' ? 'a-rate' : 'k-rate'
      }
    })
}

/** Clamp a value into a port's declared range. */
export function clampToPort (port, value) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${port.symbol}: not a number: ${value}`)
  return Math.min(port.maximum, Math.max(port.minimum, n))
}
