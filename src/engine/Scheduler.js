// src/engine/Scheduler.js
//
// Plays the tracks' MIDI clips against the transport. Message thread only.
//
// Every note is sent as an event at an absolute stream position, a little
// ahead of time (contract section 6.2, messaging.md 1.4), and the processor
// fires it in the block that contains it. Nothing here knows about blocks.
// A tick looks a fixed distance ahead of the clock, sends every note that
// starts inside that window, and remembers what it started so it can end it.
//
// Note offs come from that memory, not from the clips. A note deleted, moved
// or cut short while it sounds still has its off sent at the time it was
// given when it started, so no edit mid-play can leave a note held. Stopping
// ends everything still sounding, at the stop, or at the note's own start if
// that is still in the future.
//
// Looping unrolls the transport's loop into the timeline the clock runs on:
// elapsed time before the loop end plays as written, and each pass after it
// plays the loop again. A note that runs past the loop end is cut there.

const NOTE_ON = 0x90
const NOTE_OFF = 0x80

/**
 * Every note the project would play, per node it plays into: each track's
 * MIDI clips, into that track's jig:midiInput. A track with none plays its
 * clips into nothing (project-format.md "Tracks"). Beats are absolute: a
 * note's start is its clip's start plus its own, and a note running past its
 * clip's end is cut there.
 *
 * Returns Map nodeId -> [{ on, off, pitch, velocity }], in beats.
 */
export function clipNotes (project) {
  const byNode = new Map()
  for (const track of project.tracks) {
    if (!track.midiInput) continue
    for (const clip of project.clips) {
      if (clip.track !== track.id || clip.kind !== 'midi') continue
      const end = clip.startBeat + clip.lengthBeats
      for (const note of clip.notes) {
        const on = clip.startBeat + note.startBeat
        if (on >= end) continue
        const off = Math.min(on + note.lengthBeats, end)
        if (!byNode.has(track.midiInput)) byNode.set(track.midiInput, [])
        byNode.get(track.midiInput).push({ on, off, pitch: note.pitch, velocity: note.velocity })
      }
    }
  }
  return byNode
}

/**
 * Every audio clip the project would play, with where it starts and ends in
 * beats: [{ id, track, source, offsetSeconds, on, off }]. Where it plays into
 * is the page's to find, from the track.
 */
export function clipAudio (project) {
  return project.clips
    .filter(c => c.kind === 'audio')
    .map(c => ({ id: c.id, track: c.track, source: c.source, offsetSeconds: c.offsetSeconds, on: c.startBeat, off: c.startBeat + c.lengthBeats }))
}

/**
 * The stretches of elapsed time, and what part of the song each plays.
 * Yields { from, to, lo, hi, shift }: elapsed [from, to) plays song seconds
 * [lo, hi), and a song time t is heard at elapsed t + shift. Only the
 * stretches that overlap elapsed [start, end).
 */
function * segments (transport, start, end) {
  const loop = transport.loop
  if (!loop.enabled) {
    yield { from: 0, to: Infinity, lo: 0, hi: Infinity, shift: 0 }
    return
  }
  const loStart = transport.secondsAtBeat(loop.start)
  const loEnd = transport.secondsAtBeat(loop.end)
  const length = loEnd - loStart
  if (start < loEnd) yield { from: 0, to: loEnd, lo: 0, hi: loEnd, shift: 0 }
  // Straight to the first pass that matters, so an hour of looping costs the
  // same as the first pass.
  let k = start < loEnd ? 1 : 1 + Math.floor((start - loEnd) / length)
  for (;; k++) {
    const from = loEnd + (k - 1) * length
    if (from >= end) return
    yield { from, to: from + length, lo: loStart, hi: loEnd, shift: from - loStart }
  }
}

/**
 * The notes that start in elapsed [start, end), with when they start and end
 * in elapsed seconds. `notes` is one node's list from clipNotes, or the list
 * from clipAudio: anything with `on` and `off` in beats, whose other fields
 * are carried through.
 */
export function notesBetween (transport, notes, start, end) {
  const found = []
  const timed = notes.map(n => ({ ...n, onS: transport.secondsAtBeat(n.on), offS: transport.secondsAtBeat(n.off) }))
  for (const seg of segments(transport, start, end)) {
    for (const note of timed) {
      if (note.onS < seg.lo || note.onS >= seg.hi) continue
      const on = note.onS + seg.shift
      if (on < start || on >= end) continue
      const { onS, offS, ...rest } = note
      found.push({ ...rest, on, off: Math.min(offS, seg.hi) + seg.shift })
    }
  }
  return found
}

export class Scheduler {
  #now
  #sampleRate
  #lookahead
  #notes
  #transport
  #send
  #audio
  #playAudio
  #stopAudio
  #origin = null
  #until = 0
  // Started and not yet ended: { nodeId, pitch, off (elapsed), onFrame }.
  #sounding = []

  /**
   * - `now()`: the audio clock in seconds, AudioContext.currentTime.
   * - `lookahead`: seconds ahead of the clock each tick schedules to. From
   *   configuration, never defaulted here.
   * - `notes()`: clipNotes of the project as it is now, read every tick so an
   *   edit is heard at the next one.
   * - `transport()`: the Transport as it is now.
   * - `send(nodeId, events)`: deliver events, `{ frame, bytes }`.
   * - `audio()`, `playAudio(clip, { when, offset, duration })` and
   *   `stopAudio()`: the audio clips, from clipAudio, and how to start and
   *   stop them. All three or none; a host that plays no audio clips gives none.
   */
  constructor ({ now, sampleRate, lookahead, notes, transport, send, audio, playAudio, stopAudio }) {
    if (typeof now !== 'function' || typeof notes !== 'function' || typeof transport !== 'function' || typeof send !== 'function') {
      throw new Error('Scheduler needs now, notes, transport and send')
    }
    if (!(sampleRate > 0)) throw new Error('Scheduler needs a sample rate')
    if (!(lookahead > 0)) throw new Error('Scheduler needs a lookahead in seconds, from configuration')
    this.#now = now
    this.#sampleRate = sampleRate
    this.#lookahead = lookahead
    this.#notes = notes
    this.#transport = transport
    this.#send = send
    const given = [audio, playAudio, stopAudio].filter(f => f !== undefined)
    if (given.length !== 0 && (given.length !== 3 || given.some(f => typeof f !== 'function'))) {
      throw new Error('Scheduler needs all of audio, playAudio and stopAudio, or none of them')
    }
    this.#audio = audio ?? null
    this.#playAudio = playAudio ?? null
    this.#stopAudio = stopAudio ?? null
  }

  get running () { return this.#origin !== null }

  /** An absolute stream position, from elapsed seconds since the start. */
  #frame (elapsed) {
    return Math.round((this.#origin + elapsed) * this.#sampleRate)
  }

  /** Start at the clock time the transport's beat zero is heard. */
  start (atTime) {
    this.#origin = atTime
    this.#until = 0
    this.#sounding = []
  }

  /** Schedule everything up to the lookahead. Call often; a tick with nothing new sends nothing. */
  tick () {
    if (!this.running) return
    const end = this.#now() - this.#origin + this.#lookahead
    const start = this.#until
    if (end <= start) return
    const transport = this.#transport()
    const outgoing = new Map()
    const add = (nodeId, frame, bytes, order) => {
      if (!outgoing.has(nodeId)) outgoing.set(nodeId, [])
      outgoing.get(nodeId).push({ frame, bytes, order })
    }

    for (const [nodeId, notes] of this.#notes()) {
      for (const note of notesBetween(transport, notes, start, end)) {
        const onFrame = this.#frame(note.on)
        add(nodeId, onFrame, Uint8Array.from([NOTE_ON, note.pitch, note.velocity]), 1)
        this.#sounding.push({ nodeId, pitch: note.pitch, off: note.off, onFrame })
      }
    }
    // Audio clips start at the same stream positions, through the platform's
    // own scheduling: a source started at a context time, not an event.
    if (this.#audio) {
      for (const clip of notesBetween(transport, this.#audio(), start, end)) {
        this.#playAudio(clip, { when: this.#origin + clip.on, offset: clip.offsetSeconds, duration: clip.off - clip.on })
      }
    }
    this.#sounding = this.#sounding.filter(s => {
      if (s.off >= end) return true
      add(s.nodeId, Math.max(this.#frame(s.off), s.onFrame), Uint8Array.from([NOTE_OFF, s.pitch, 0]), 0)
      return false
    })
    this.#until = end
    this.#deliver(outgoing)
  }

  /** End everything still sounding, and stop. */
  stop () {
    if (!this.running) return
    const nowFrame = this.#frame(this.#now() - this.#origin)
    const outgoing = new Map()
    for (const s of this.#sounding) {
      if (!outgoing.has(s.nodeId)) outgoing.set(s.nodeId, [])
      outgoing.get(s.nodeId).push({ frame: Math.max(nowFrame, s.onFrame), bytes: Uint8Array.from([NOTE_OFF, s.pitch, 0]), order: 0 })
    }
    this.#sounding = []
    this.#origin = null
    this.#stopAudio?.()
    this.#deliver(outgoing)
  }

  /** In time order, and at one frame an off before an on, so a repeated note is retriggered rather than cut. */
  #deliver (outgoing) {
    for (const [nodeId, events] of outgoing) {
      events.sort((a, b) => a.frame - b.frame || a.order - b.order)
      this.#send(nodeId, events.map(({ frame, bytes }) => ({ frame, bytes })))
    }
  }
}
