// src/testing/ChainRender.js
//
// Play a project through the offline host, quantum by quantum, and report how
// loud each track's input got. What the other offline tests do not cover is the
// chain: MIDI from a generator through a processor to a synth, and audio from
// that synth to its track. Each plugin passed alone while a plugin in the middle
// of a chain never ran in a browser (MISTAKES.md, Dice). This drives the real
// transport messages and the real event router, and routes audio between the
// offline nodes along the connections the engine actually made.
//
// Not a mixer: only the first audio input of a node is fed, a track's level is
// the peak of what reaches its input, and faders, sends and the master are not
// applied. It answers "does anything reach this track", not "how loud is it".

const settle = () => new Promise(resolve => setImmediate(resolve))

/**
 * Returns a Map trackId -> peak of the audio that reached that track's input.
 * `quanta` render quanta of 128 frames are played from beat zero.
 */
export async function renderChain (dispatcher, engine, { quanta = 1500, quantum = 128 } = {}) {
  const entries = engine.nodes()
  const byNode = new Map(entries.map(e => [e.node, e]))
  const trackOf = new Map(dispatcher.project.tracks.map(t => [engine.trackInput(t.id), t.id]))
  const peaks = new Map(dispatcher.project.tracks.map(t => [t.id, 0]))

  // Order: a node after everything that feeds it, by audio connections the engine made and MIDI
  // connections the model holds.
  const feeds = new Map(entries.map(e => [e.node, new Set()]))
  for (const { node } of entries) {
    for (const c of node.connections ?? []) if (byNode.has(c.destination)) feeds.get(c.destination).add(node)
  }
  for (const c of dispatcher.project.connections) {
    const from = dispatcher.engineNode(c.from.node)?.node
    const to = dispatcher.engineNode(c.to.node)?.node
    if (from && to && from !== to) feeds.get(to)?.add(from)
  }
  const order = []
  const placed = new Set()
  const visit = node => {
    if (placed.has(node)) return
    placed.add(node)
    for (const before of feeds.get(node) ?? []) visit(before)
    order.push(node)
  }
  for (const { node } of entries) visit(node)

  for (let q = 0; q < quanta; q++) {
    dispatcher.sendTransport(q * quantum, { frame: q * quantum, playing: true })
    await settle()
    const arriving = new Map()
    for (const node of order) {
      const input = arriving.get(node) ?? null
      const output = node.render(input)
      if (!output || output.length === 0) continue
      for (const c of node.connections ?? []) {
        if (c.input !== 0 || c.output !== 0) continue
        const track = trackOf.get(c.destination)
        if (track !== undefined) {
          for (const channel of output) for (const v of channel) peaks.set(track, Math.max(peaks.get(track), Math.abs(v)))
        } else if (byNode.has(c.destination)) {
          const sum = arriving.get(c.destination) ?? output.map(() => new Float32Array(quantum))
          output.forEach((channel, i) => { const into = sum[Math.min(i, sum.length - 1)]; for (let s = 0; s < quantum; s++) into[s] += channel[s] })
          arriving.set(c.destination, sum)
        }
      }
    }
    await settle()
  }
  return peaks
}
