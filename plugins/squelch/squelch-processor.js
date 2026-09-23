// plugins/squelch/squelch-processor.js
//
// The AudioWorklet processor for Squelch, and the whole plugin: a resonant
// lowpass whose cutoff an envelope follower pushes up on every note, which is
// the acid bass sweep without needing to see the notes themselves. Plain
// JavaScript, no WebAssembly module, for the reason Tremolo gives.
//
// The filter is the trapezoidal state variable filter from Andrew Simper's
// "Linear Trap Optimised SVF" (Cytomic, 2013), chosen because it stays stable
// while its cutoff moves every sample, which is exactly what the envelope does
// to it. A naive biquad recomputed per sample does not.
//
// Resonance is capped short of self-oscillation, and the output passes a tanh,
// because at full resonance a note sitting on the peak is some twenty decibels
// louder than one that is not, and a generated panel lets anyone turn the knob
// to the end. Nothing leaves this plugin outside plus or minus one.

// k is the SVF's damping: 2 is no resonance, and it is not allowed below this.
const MIN_DAMPING = 0.12

class SquelchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'cutoff', defaultValue: 600, minValue: 40, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'resonance', defaultValue: 75, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'envelope', defaultValue: 3, minValue: 0, maxValue: 6, automationRate: 'k-rate' },
      { name: 'decay', defaultValue: 180, minValue: 10, maxValue: 2000, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.sampleRate = sampleRate
    this.follower = 0
    // Two integrator states per channel, for stereo. Allocated here, never in
    // process().
    this.ic1 = new Float64Array(2)
    this.ic2 = new Float64Array(2)
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type !== 'init') return
    this.sampleRate = message.sampleRate ?? sampleRate
    this.ready = true
    this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
  }

  process (inputs, outputs, parameters) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    if (!this.ready) {
      for (const channel of output) channel.fill(0)
      return true
    }

    const input = inputs[0]
    const frames = output[0].length
    const rate = this.sampleRate
    const cutoff = parameters.cutoff[0]
    const damping = 2 - (2 - MIN_DAMPING) * (parameters.resonance[0] / 100)
    const envelope = parameters.envelope[0]
    const release = Math.exp(-1 / (parameters.decay[0] * 0.001 * rate))
    const ceiling = 0.45 * rate
    const channels = Math.min(output.length, 2)

    for (let i = 0; i < frames; i++) {
      // The follower hears the loudest input channel: instant attack, so the
      // filter opens on the note rather than after it, and an exponential
      // decay the Decay control sets.
      let level = 0
      if (input && input.length > 0) {
        for (let c = 0; c < input.length; c++) level = Math.max(level, Math.abs(input[c][i]))
      }
      this.follower = level > this.follower ? level : this.follower * release

      const frequency = Math.min(cutoff * Math.pow(2, envelope * this.follower), ceiling)
      const g = Math.tan(Math.PI * frequency / rate)
      const a1 = 1 / (1 + g * (g + damping))
      const a2 = g * a1
      const a3 = g * a2

      for (let c = 0; c < channels; c++) {
        const source = input && input.length > 0 ? input[Math.min(c, input.length - 1)] : null
        const v0 = source ? source[i] : 0
        const v3 = v0 - this.ic2[c]
        const v1 = a1 * this.ic1[c] + a2 * v3
        const v2 = this.ic2[c] + a2 * this.ic1[c] + a3 * v3
        this.ic1[c] = 2 * v1 - this.ic1[c]
        this.ic2[c] = 2 * v2 - this.ic2[c]
        output[c][i] = Math.tanh(v2)
      }
      for (let c = channels; c < output.length; c++) output[c][i] = output[0][i]
    }

    return true
  }
}

registerProcessor('squelch', SquelchProcessor)
