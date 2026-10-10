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

// How many events a monitor can look back over, per route.
export const MONITOR_EVENTS = 24

export class EventRouter {
  #engine
  #routes = new Map()
  #detach = new Map()
  #dropped = new Map()
  #onDropped
  #recent = new Map()
  // For a route with a note range: the notes it let through that have not been released, by `from>to`, as
  // `channel:note`. A note-off follows its note-on, so changing the range mid-note leaves nothing sounding.
  #sounding = new Map()

  constructor ({ engine, onDropped = null }) {
    if (!engine) throw new Error('EventRouter needs an engine')
    this.#engine = engine
    this.#onDropped = onDropped
  }

  /**
   * The last few events that went from one node to another, oldest first, for a monitor. Bounded per
   * route (MONITOR_EVENTS) and kept on the message thread, where the router lives; nothing here is
   * read or written from process().
   */
  recent (fromEngineId, toEngineId) {
    return [...(this.#recent.get(`${fromEngineId}>${toEngineId}`) ?? [])]
  }

  get routes () {
    return [...this.#routes].flatMap(([from, targets]) => targets.map(({ to, lowNote, highNote }) => ({
      from, to, ...(lowNote === undefined ? {} : { lowNote }), ...(highNote === undefined ? {} : { highNote })
    })))
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
    // A route that is gone takes its history with it.
    const kept = new Set(pairs.map(({ from, to }) => `${from}>${to}`))
    for (const key of [...this.#recent.keys()]) if (!kept.has(key)) this.#recent.delete(key)
    for (const key of [...this.#sounding.keys()]) if (!kept.has(key)) this.#sounding.delete(key)
    for (const { from, to, lowNote, highNote } of pairs) {
      if (!this.#routes.has(from)) this.#routes.set(from, [])
      this.#routes.get(from).push({ to, lowNote, highNote })
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
    for (const { to, lowNote, highNote } of targets) {
      const passing = lowNote === undefined && highNote === undefined
        ? events
        : this.#withinRange(`${fromEngineId}>${to}`, events, lowNote ?? 0, highNote ?? 127)
      if (passing.length === 0) continue
      this.#remember(fromEngineId, to, passing)
      this.send(to, passing)
    }
  }

  /**
   * The events of a route with a note range that pass it: notes inside the range, with a note-off only for a
   * note-on that passed, and everything that is not a note as it came. All-notes-off and all-sound-off
   * release what the route is holding. Anything outside the range is dropped, not moved.
   */
  #withinRange (key, events, low, high) {
    let held = this.#sounding.get(key)
    if (!held) { held = new Set(); this.#sounding.set(key, held) }
    const passing = []
    for (const event of events) {
      const [status = 0, data1 = 0, data2 = 0] = event.bytes ?? []
      const kind = status & 0xf0
      const channel = status & 0x0f
      if (kind === 0x90 && data2 > 0) {
        if (data1 < low || data1 > high) continue
        held.add(`${channel}:${data1}`)
      } else if (kind === 0x80 || kind === 0x90) {
        if (!held.delete(`${channel}:${data1}`)) continue
      } else if (kind === 0xa0) {
        // Poly aftertouch is a note's own, so it follows the note.
        if (!held.has(`${channel}:${data1}`)) continue
      } else if (kind === 0xb0 && (data1 === 120 || data1 === 123)) {
        for (const note of [...held]) if (Number(note.split(':')[0]) === channel) held.delete(note)
      }
      passing.push(event)
    }
    return passing
  }

  #remember (from, to, events) {
    const key = `${from}>${to}`
    const history = this.#recent.get(key) ?? []
    for (const event of events) history.push({ frame: event.frame, bytes: Uint8Array.from(event.bytes ?? []) })
    if (history.length > MONITOR_EVENTS) history.splice(0, history.length - MONITOR_EVENTS)
    this.#recent.set(key, history)
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
