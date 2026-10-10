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
// The clips are played too, by the real Scheduler on a clock the render owns, so a piece made of clips is heard and not
// only a piece of generators; and the routing between tracks is followed: a send, and a track's output sent to another
// track, arrive at the receiving track's audio input node, or at its fader when it has none.
//
// Not a mixer: only the first audio input of a node is fed, a track's level is
// the peak of what reaches its input, and faders and the master are not
// applied (a send's own level is). It answers "does anything reach this track", not "how loud is it".

import { Scheduler, clipNotes } from '../engine/Scheduler.js'

const settle = () => new Promise(resolve => setImmediate(resolve))

/**
 * Returns a Map trackId -> peak of the audio that reached that track's input.
 * `quanta` render quanta of 128 frames are played from beat zero. `clips: false` leaves the clips unplayed.
 */
export async function renderChain (dispatcher, engine, { quanta = 1500, quantum = 128, clips = true, lookaheadSeconds = 0.12 } = {}) {
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
  // What one track sends to another, and a track's output into a bus: where it arrives is the receiving track's audio input
  // node when it has one, so that node comes after every node of the tracks that feed it.
  const { project } = dispatcher
  const arrivals = new Map()
  const arrive = (to, from, level) => arrivals.set(to, [...(arrivals.get(to) ?? []), { from, level }])
  for (const send of project.sends) if ((send.kind ?? 'audio') === 'audio') arrive(send.to, send.from, send.level)
  for (const track of project.tracks) if (track.output) arrive(track.output, track.id, 1)
  const takesArrivals = new Map()
  const nodesOn = id => project.nodes.filter(n => n.track === id).map(n => dispatcher.engineNode(n.id)?.node).filter(Boolean)
  for (const [to, sources] of arrivals) {
    const node = project.track(to)?.audioInput ? dispatcher.engineNode(project.track(to).audioInput)?.node : null
    if (!node || !feeds.has(node)) continue
    takesArrivals.set(node, to)
    for (const { from } of sources) for (const source of nodesOn(from)) feeds.get(node).add(source)
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

  // The clips, played against the transport on the render's own clock.
  let clock = 0
  const scheduler = clips
    ? new Scheduler({
      now: () => clock,
      sampleRate: engine.context.sampleRate,
      lookahead: lookaheadSeconds,
      notes: () => clipNotes(project),
      transport: () => dispatcher.transport(),
      send: (nodeId, events) => dispatcher.sendEvents(nodeId, events)
    })
    : null
  scheduler?.start(0)

  const silent = () => [new Float32Array(quantum), new Float32Array(quantum)]
  const addInto = (sum, channels, level = 1) => {
    channels.forEach((channel, i) => { const into = sum[Math.min(i, sum.length - 1)]; for (let s = 0; s < quantum; s++) into[s] += channel[s] * level })
  }

  for (let q = 0; q < quanta; q++) {
    dispatcher.sendTransport(q * quantum, { frame: q * quantum, playing: true })
    clock = (q * quantum) / engine.context.sampleRate
    scheduler?.tick()
    await settle()
    const arriving = new Map()
    // What each track put at its fader this quantum, which is what a send takes.
    const atFader = new Map()
    for (const node of order) {
      let input = arriving.get(node) ?? null
      if (takesArrivals.has(node)) {
        const mixed = silent()
        for (const { from, level } of arrivals.get(takesArrivals.get(node))) if (atFader.has(from)) addInto(mixed, atFader.get(from), level)
        if (input) addInto(mixed, input)
        input = mixed
      }
      const output = node.render(input)
      if (!output || output.length === 0) continue
      for (const c of node.connections ?? []) {
        if (c.input !== 0 || c.output !== 0) continue
        const track = trackOf.get(c.destination)
        if (track !== undefined) {
          for (const channel of output) for (const v of channel) peaks.set(track, Math.max(peaks.get(track), Math.abs(v)))
          if (!atFader.has(track)) atFader.set(track, silent())
          addInto(atFader.get(track), output)
        } else if (byNode.has(c.destination)) {
          const sum = arriving.get(c.destination) ?? output.map(() => new Float32Array(quantum))
          output.forEach((channel, i) => { const into = sum[Math.min(i, sum.length - 1)]; for (let s = 0; s < quantum; s++) into[s] += channel[s] })
          arriving.set(c.destination, sum)
        }
      }
    }
    // A track fed by others with no audio input node takes what is sent to it straight to its fader.
    for (const [to, sources] of arrivals) {
      if (project.track(to) === null || project.track(to).audioInput) continue
      for (const { from, level } of sources) {
        for (const channel of atFader.get(from) ?? []) for (const v of channel) peaks.set(to, Math.max(peaks.get(to), Math.abs(v) * level))
      }
    }
    await settle()
  }
  scheduler?.stop()
  return peaks
}
