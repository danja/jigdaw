// src/engine/EventRouter.js
//
// MIDI routing, and the transport broadcast.
//
// The Web Audio graph carries audio and nothing else, so a MIDI connection in
// the project is not an audio edge: it is the host carrying messages from one
// processor's port to another's. Contract section 6.1, and the reason a plugin
// that speaks MIDI must declare trn:requires jig:MidiEvents rather than simply
// being wired up.
//
// Every event carries an absolute stream position in frames. Nothing here ever
// computes an offset within a block, because an offset is meaningless once the
// block has passed, and comparing a position for equality against a block
// boundary means an event that is not exactly on one never fires at all. Both
// halves of that are written twice in valis's MISTAKES.md.

import { vocabulary } from '../rdf/Vocabulary.js'

const MIDI_SIGNALS = new Set([
  'http://purl.org/stuff/transmissions/Midi',
  'http://purl.org/stuff/transmissions/BassMidi',
  'http://purl.org/stuff/transmissions/DrumMidi',
  'http://purl.org/stuff/transmissions/MelodyMidi',
  'http://purl.org/stuff/transmissions/HarmonyMidi',
  'http://purl.org/stuff/transmissions/MultiPartMidi',
  'http://purl.org/stuff/transmissions/ControlMidi',
  'http://purl.org/stuff/transmissions/MidiCC'
])

export const isMidi = signalKind => MIDI_SIGNALS.has(signalKind)

// MIDI that changes a plugin's settings and plays nothing: Quefrency takes
// control changes and no notes. A keyboard, a clip or a "clips play into"
// choice offered to it would be a control that reaches nothing.
const CONTROL_ONLY = new Set([vocabulary.trn.ControlMidi, vocabulary.trn.MidiCC])

/** A MIDI signal kind that can carry notes, so something can be played into it. */
export const carriesNotes = signalKind => isMidi(signalKind) && !CONTROL_ONLY.has(signalKind)

export class EventRouter {
  #engine
  #routes = new Map()
  #detach = new Map()
  #dropped = new Map()
  #onDropped

  constructor ({ engine, onDropped = null }) {
    if (!engine) throw new Error('EventRouter needs an engine')
    this.#engine = engine
    this.#onDropped = onDropped
  }

  get routes () {
    return [...this.#routes].flatMap(([from, targets]) => targets.map(to => ({ from, to })))
  }

  /** How many events a node has reported dropping, since it last said. */
  droppedFor (engineId) { return this.#dropped.get(engineId) ?? 0 }

  /**
   * Replace every route.
   *
   * Rebuilt whole rather than diffed, for the same reason the audio links are:
   * after any edit the routes are exactly what the model says, with no stale
   * target left receiving notes from a node it is no longer connected to.
   */
  setRoutes (pairs) {
    this.#routes = new Map()
    for (const { from, to } of pairs) {
      if (!this.#routes.has(from)) this.#routes.set(from, [])
      this.#routes.get(from).push(to)
      this.observe(from)
    }
  }

  /**
   * Listen to a node whether or not it has routes.
   *
   * A node reports overflow on the same channel it reports outgoing events,
   * and overflow matters regardless of how the node is wired: an instrument
   * dropping notes is worth knowing about even when nothing is listening to
   * its MIDI output. Listening only to routed nodes made that invisible.
   */
  observe (engineId) {
    if (this.#detach.has(engineId)) return
    const off = this.#engine.onMessage(engineId, message => {
      if (message?.type === 'events') this.#forward(engineId, message.events)
      else if (message?.type === 'dropped') this.#noteDropped(engineId, message)
    })
    this.#detach.set(engineId, off)
  }

  #noteDropped (engineId, message) {
    const total = (this.#dropped.get(engineId) ?? 0) + (message.count ?? 0)
    this.#dropped.set(engineId, total)
    // Overflow is a real condition and reporting it is the processor's only
    // way to say so: it cannot grow its queue and it cannot allocate.
    this.#onDropped?.({ engineId, count: message.count ?? 0, total })
  }

  #forward (fromEngineId, events) {
    const targets = this.#routes.get(fromEngineId)
    if (!targets || !events?.length) return
    for (const target of targets) this.send(target, events)
  }

  /**
   * Deliver events to one node.
   *
   * Sorted before sending, because messaging.md section 1.4 requires the host
   * to post in non-decreasing frame order and a processor is entitled to stop
   * scanning once it passes the quantum.
   */
  send (engineId, events) {
    if (!events?.length) return
    const ordered = [...events].sort((a, b) => a.frame - b.frame)
    this.#engine.post(engineId, { type: 'events', events: ordered })
  }

  /** Broadcast a transport message to every loaded node. */
  broadcastTransport (message) {
    for (const entry of this.#engine.nodes()) {
      this.#engine.post(entry.id, message)
    }
  }

  /** Stop listening to everything. */
  dispose () {
    for (const off of this.#detach.values()) off()
    this.#detach.clear()
    this.#routes.clear()
  }
}
