// plugins/lookahead/lookahead-processor.js
//
// The AudioWorklet processor for Lookahead, and the whole plugin: there is no
// WebAssembly module. jig:module is optional for exactly this case, a plugin
// simple enough that plain JavaScript is the implementation (Tremolo, Squelch).
//
// What this plugin exists to exercise is docs/latency.md section 2: a latency
// that changes while audio flows. Two positions, direct or held back by 512
// frames. The profile declares the worst case (512) and the processor reports
// the actual figure in ready and posts a latency message with fromFrame on
// every change, per docs/messaging.md 1.3.
//
// The real-time rules still apply in full: the delay line is allocated in the
// constructor before ready, and process() allocates nothing.

const MAX_DELAY = 512
// One slot more than the longest delay: a ring of exactly MAX_DELAY reads
// back the sample just written when asked to hold 512, which is no delay at
// all and a declared latency off by one, the wrong kind of wrong for the
// plugin whose job is reporting latency exactly.
const LINE = MAX_DELAY + 1

class LookaheadProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    // A switch, not a dial: two scale points is the two-position shape
    // (contract 5.3), and k-rate, because a delay length is not
    // audio-modulated (contract 5.2).
    return [
      { name: 'position', defaultValue: 0, minValue: 0, maxValue: 512, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.sampleRate = sampleRate
    // One ring buffer per channel, the worst case, allocated before ready.
    // The write cursor only ever advances; changing position moves the read
    // offset, which is the audible jump latency.md section 2 warns about.
    this.lines = [new Float32Array(LINE), new Float32Array(LINE)]
    this.cursor = 0
    this.delay = 0
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type !== 'init') return
    this.sampleRate = message.sampleRate ?? sampleRate
    this.ready = true
    this.port.postMessage({ type: 'ready', latencyFrames: this.delay, tailFrames: null })
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
    // The first value: position is k-rate, one value per quantum, and the
    // first is what a constant quantum carries (contract 5.2).
    const wanted = parameters.position[0]

    // A change takes effect at this quantum's first frame, never mid-quantum:
    // position is k-rate, so one value covers the whole block, and fromFrame
    // names the frame the new latency applies from, in the host's stream
    // domain (AudioWorkletGlobalScope.currentFrame), not an offset in this
    // block and not a block index (contract 6.2's two silent bugs).
    if (wanted !== this.delay) {
      this.delay = wanted
      this.port.postMessage({ type: 'latency', latencyFrames: wanted, fromFrame: currentFrame })
    }

    for (let i = 0; i < frames; i++) {
      for (let channel = 0; channel < output.length; channel++) {
        const line = this.lines[Math.min(channel, this.lines.length - 1)]
        const sample = input && input.length > 0
          ? input[Math.min(channel, input.length - 1)][i]
          : 0
        if (this.delay === 0) {
          output[channel][i] = sample
        } else {
          line[this.cursor] = sample
          output[channel][i] = line[(this.cursor - this.delay + LINE) % LINE]
        }
      }
      this.cursor = (this.cursor + 1) % LINE
    }

    return true
  }
}

registerProcessor('lookahead', LookaheadProcessor)
