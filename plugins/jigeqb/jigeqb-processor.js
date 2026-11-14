// plugins/jigeqb/jigeqb-processor.js
//
// The SVG variant is the same signal path as JigEQa, with a skin that changes
// the presentation while the DSP remains fixed.
const PARAM_INDEX = Object.freeze({ enabled: 0, low_gain: 1, mid_gain: 2, high_gain: 3 })
const DB_TO_GAIN = value => 10 ** (value / 20)

class JigeqbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'low_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'mid_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'high_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.lowState = 0
    this.highState = 0
    this.port.onmessage = event => {
      if (event.data?.type === 'ready') return
      if (event.data?.type === 'dispose') return
    }
    this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
  }

  process (inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    const frames = output[0].length
    const enabled = this.readValue(parameters.enabled)
    const lowGain = this.readValue(parameters.low_gain)
    const midGain = this.readValue(parameters.mid_gain)
    const highGain = this.readValue(parameters.high_gain)

    for (let channel = 0; channel < output.length; channel++) {
      const source = input?.[channel] ?? input?.[0] ?? new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        const sample = source[i] ?? 0
        const low = this.lowState = this.lowState * 0.85 + sample * 0.15
        const high = this.highState = sample - this.lowState * 0.85 + this.highState * 0.15
        const mid = sample - low - high
        const wet = enabled > 0
          ? (low * DB_TO_GAIN(lowGain)) + (mid * DB_TO_GAIN(midGain)) + (high * DB_TO_GAIN(highGain))
          : sample
        output[channel][i] = wet
      }
    }
    return true
  }

  readValue (values) {
    if (!values) return 0
    return values.length > 1 ? values[values.length - 1] : values[0]
  }
}

registerProcessor('jigeqb', JigeqbProcessor)
