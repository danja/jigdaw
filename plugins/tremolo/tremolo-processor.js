// plugins/tremolo/tremolo-processor.js
//
// The AudioWorklet processor for Tremolo, and the whole plugin: there is no
// WebAssembly module. jig:module is optional (vocabs/shapes.ttl warns rather
// than refuses its absence) for exactly this case, a plugin simple enough
// that plain JavaScript is the implementation rather than a stand-in for one.
//
// The contract does not relax for that. init/ready still applies (contract
// section 3.1 step 8: a host connects only after ready, and does not know or
// care what a processor did to get there), and process() still allocates
// nothing and takes no unpredictable lock: those are Web Audio's own rules,
// not WebAssembly's.

class TremoloProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'rate', defaultValue: 5, minValue: 0.1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.phase = 0
    this.sampleRate = sampleRate
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type !== 'init') return
    // No module to compile and no buffer to allocate: everything process()
    // needs already exists. The handshake still runs, because a host that
    // connected before ready would be the bug this rule exists to prevent,
    // not a shortcut this plugin happens to be able to take.
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
    const rateValues = parameters.rate
    const depthValues = parameters.depth
    const twoPi = 2 * Math.PI

    for (let i = 0; i < frames; i++) {
      const rate = rateValues.length === 1 ? rateValues[0] : rateValues[i]
      const depth = depthValues.length === 1 ? depthValues[0] : depthValues[i]

      // A sine LFO from 0 to 1, then scaled so depth 0 leaves the signal
      // untouched and depth 1 pulls the trough to silence rather than to
      // inversion.
      const lfo = 0.5 - 0.5 * Math.sin(this.phase * twoPi)
      const gain = 1 - depth * lfo

      for (let channel = 0; channel < output.length; channel++) {
        const inputChannel = input && input.length > 0
          ? input[Math.min(channel, input.length - 1)]
          : null
        output[channel][i] = (inputChannel ? inputChannel[i] : 0) * gain
      }

      this.phase += rate / this.sampleRate
      if (this.phase >= 1) this.phase -= 1
    }

    return true
  }
}

registerProcessor('tremolo', TremoloProcessor)
