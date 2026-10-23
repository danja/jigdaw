// src/model/MidiTake.js
//
// What was played while recording MIDI, as clips. Pure: the page keeps the messages it heard (each with the beat it came at)
// and this turns them into one MIDI clip a track, in one changeset, so one undo takes the whole take back.
//
// Notes are paired as a keyboard sends them: a note on with a velocity, ended by a note off (or a note on of velocity 0) for
// the same pitch. A note still held when the take ends stops there. Controller and pitch bend messages become events, thinned
// as a hand on a wheel sends far more than anyone wants to edit: they are placed on a grid of 96 to the beat, one event for a
// controller on one point of it (the last), and one that only repeats the value before it is dropped. The channel messages
// (controller 120 and up: all notes off and the rest) are not music and are left out.

/** The shortest note a take keeps, in beats: a key struck and released at once still sounds. */
const MIN_NOTE_BEATS = 0.05
const GRID = 96

/** `{ notes, controllers }` in absolute beats from `[{ beat, bytes }]` in the order heard. */
export function readTake (messages, { endBeat }) {
  const notes = []
  const open = new Map()
  const events = new Map()
  const stop = (pitch, beat) => {
    const started = open.get(pitch)?.shift()
    if (started) notes.push({ startBeat: started.beat, lengthBeats: Math.max(MIN_NOTE_BEATS, beat - started.beat), pitch, velocity: started.velocity })
  }
  for (const { beat, bytes } of messages) {
    const [status, a, b] = bytes
    const kind = status & 0xf0
    if (kind === 0x90 && b > 0) {
      if (!open.has(a)) open.set(a, [])
      open.get(a).push({ beat, velocity: Math.min(127, b) })
    } else if (kind === 0x80 || (kind === 0x90 && b === 0)) stop(a, beat)
    else if (kind === 0xb0 && a < 120) events.set(`${a}@${Math.round(beat * GRID)}`, { atBeat: Math.round(beat * GRID) / GRID, controller: a, value: b })
    else if (kind === 0xe0) events.set(`bend@${Math.round(beat * GRID)}`, { atBeat: Math.round(beat * GRID) / GRID, controller: 'pitchBend', value: ((b << 7) | a) - 8192 })
  }
  for (const pitch of open.keys()) while (open.get(pitch).length > 0) stop(pitch, endBeat)
  // In time order, each controller alone, so a value that repeats the one before it can be seen and dropped.
  const last = new Map()
  const controllers = [...events.values()].sort((x, y) => x.atBeat - y.atBeat).filter(e => {
    if (last.get(e.controller) === e.value) return false
    last.set(e.controller, e.value)
    return true
  })
  notes.sort((x, y) => x.startBeat - y.startBeat || x.pitch - y.pitch)
  return { notes, controllers }
}

/**
 * The changes that keep a take: for each track in `captured` (a Map of track id to the messages it heard) with anything in it, one
 * MIDI clip from `startBeat`, long enough to hold it in whole bars. Throws an Error saying why when nothing was played.
 */
export function describeMidiTake (project, captured, { startBeat, endBeat }) {
  const bar = project.transport.beatsPerBar
  const changes = []
  let notes = 0
  let controllers = 0
  for (const [track, messages] of captured) {
    if (!project.track(track)) continue
    const heard = readTake(messages, { endBeat })
    if (heard.notes.length === 0 && heard.controllers.length === 0) continue
    const end = Math.max(endBeat, ...heard.notes.map(n => n.startBeat + n.lengthBeats)) - startBeat
    changes.push({
      op: 'addClip',
      track,
      kind: 'midi',
      startBeat,
      lengthBeats: Math.max(1, Math.ceil(end / bar)) * bar,
      notes: heard.notes.map(n => ({ ...n, startBeat: Math.max(0, n.startBeat - startBeat) })),
      controllers: heard.controllers.map(e => ({ ...e, atBeat: Math.max(0, e.atBeat - startBeat) }))
    })
    notes += heard.notes.length
    controllers += heard.controllers.length
  }
  if (changes.length === 0) throw new Error('nothing was played')
  return { changes, tracks: changes.length, notes, controllers }
}
