// src/ui/PianoRoll.js
//
// A MIDI clip's notes, as a grid of pitch against time.
//
// Built for the keyboard first (CLAUDE.md: keyboard before pointer). The grid
// is one tab stop holding a cursor, a roving tabindex: arrow keys move it,
// Page Up and Page Down move it an octave, Home and End go to either end of
// the clip. Enter or Space adds a note at the cursor, or removes the one
// there, and Delete removes it. Shift with Left or Right makes the note under
// the cursor shorter or longer by a step, and Alt with Up or Down makes it
// quieter or louder.
//
// The pointer does what a piano roll's pointer is expected to. Press on an
// empty square and drag to draw a note as long as the drag; a click alone
// draws one beat. Press on a note to select it and drag to move it, in pitch
// and time; drag its last square to change its length. A double click
// removes it. The press starts on a square, and the move and the release are
// followed from wherever the pointer goes, with the release heard on the
// document: a drag that ended outside the grid would otherwise never finish.
// Nothing is sent until the release, so one drag is one edit and one undo.
//
// Notes can be chosen: S toggles the note under the cursor, Ctrl+A chooses every note, and a press on a
// note with Shift held toggles it. While any are chosen the buttons that change every note change only
// those, and Escape first lets go of the choice and only then closes. A chosen note is marked with a
// different glyph and in its label, as well as by colour. The choice is kept by start and pitch, and
// follows a note moved by drag.
//
// Shift held while pressing an empty square and dragging draws a rubber band; the notes it touches become
// the choice when the pointer is released. Nothing is edited, so there is nothing to undo.
//
// Past the end of the clip there is one more bar, dimmed. A note drawn, moved
// or stretched into it makes the clip longer, to the end of the bar it
// reaches, in the same edit.
//
// A note is sounded when it is placed, moved or chosen (`onAudition`), so
// writing one is not silent, and `playhead(beat)` shows where the transport is.
//
// Every cell says what it is: "E4, bar 1 beat 2, note, 1 beat, velocity 100",
// or "E4, bar 1 beat 2.25" where there is none. A note is marked in the cell's
// text as well as its colour, so its state is never colour alone. What an
// edit did is also said in a live region, because a note appearing is
// otherwise silent to a screen reader whose focus did not move.
//
// Every change goes out as the whole list of notes, one edit and one undo,
// and the grid draws again from what comes back.

import { barBeat } from './Timeline.js'
import { createRollScale } from './RollScale.js'
import { createRollStep, STEP_KEYS, pitchFor } from './RollStep.js'
import { createRollLane } from './RollLane.js'
import { createRollControllers } from './RollControllers.js'
import { createRollLoop } from './RollLoop.js'
import { createRollEuclid } from './RollEuclid.js'
import { createRollTools } from './RollTools.js'
import { attachRollPointer } from './RollPointer.js'
import { STEPS_PER_BEAT, NAMES, noteName, spokenName, keyOf, beats, noteAt } from './RollNotes.js'
import { inScale, snapPitch } from '../model/Scale.js'

/** How many pitches are shown at once. The cursor scrolls the window. */
export const VISIBLE_PITCHES = 24
/** How many pitches MIDI has, drawn or not. */
const PITCHES = 128

export { STEPS_PER_BEAT, noteName, spokenName } from './RollNotes.js'

/**
 * Build a piano roll.
 *
 * `onChange(clipId, notes, { lengthBeats })` sends a whole new list of notes,
 * and a new length when the notes have run past the clip's end. `onClose()`
 * is called by its Close button. `onAudition(pitch, velocity)`, if given,
 * sounds a note. `onEuclid(clipId, options)` lays a Euclidean rhythm in and returns a refusal's message (src/model/Euclidean.js). `onTransform(name, options)`, if given, asks for a whole-clip edit (src/model/NoteTransform.js);
 * without it the transform buttons are left out, not shown doing nothing. It returns a message when it refuses.
 * Returns `{ element, show, draw, hide, playhead, clipId }`.
 */
export function createPianoRoll (document, { onChange, onClose, onAudition = () => {}, onTransform = null, onEuclid = null, onControllers = null, onLoop = null, now = () => Date.now() }) {
  if (typeof onChange !== 'function' || typeof onClose !== 'function') {
    throw new Error('createPianoRoll needs onChange and onClose')
  }
  // Always on the page, so it can be found: with no clip open it says how to
  // open one, rather than being absent until somebody already knows it exists.
  // Keys (start:pitch) of the notes chosen to be changed together.
  let chosen = new Set()
  const element = document.createElement('section')
  element.className = 'piano-roll'

  const header = document.createElement('header')
  const heading = document.createElement('h3')
  heading.id = 'piano-roll-heading'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.addEventListener('click', () => onClose())
  header.append(heading, close)

  const help = document.createElement('p')
  help.className = 'note'
  help.id = 'piano-roll-help'
  help.textContent = 'Click a square for a one-beat note, or drag across to draw it longer. Drag a note to move it, ' +
    'or its last square to change its length. Double-click a note, or press Delete, to remove it. ' +
    'Drawing into the dimmed bar makes the clip longer. Keys: arrows move, Enter adds or removes, ' +
    'Shift with Left or Right changes length, Alt with Up or Down velocity, Page Up and Page Down an octave, S chooses a note to change with others (or Shift-click it), Shift-drag across empty squares chooses the notes it touches, Ctrl+A chooses all, ' +
    'Escape lets go of the choice, then closes.'

  const status = document.createElement('p')
  status.className = 'visually-hidden'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  const scroller = document.createElement('div')
  scroller.className = 'piano-roll-scroll'
  const grid = document.createElement('div')
  grid.className = 'piano-roll-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-labelledby', 'piano-roll-heading')
  grid.setAttribute('aria-describedby', 'piano-roll-help')
  const head = document.createElement('div')
  head.className = 'playhead'
  head.setAttribute('aria-hidden', 'true')
  head.hidden = true
  // Each note's velocity as a bar under its column, to see them together and set them by drag or by key (RollLane.js).
  const velocityLane = createRollLane(document, {
    id: 'roll-lane-velocity',
    label: 'Velocity',
    min: 1,
    max: 127,
    onSet: (item, velocity) => setVelocity(item.key, velocity)
  })
  // Controller and pitch bend lanes, in place of the velocity one, when the page can store them: a control nobody can use is
  // left out, so no chooser is drawn for a host that gives no `onControllers`.
  const lanes = onControllers
    ? createRollControllers(document, { onEvents: list => onControllers(clip.id, list), place: beat => barBeat(beat, options.beatsPerBar) })
    : null
  scroller.append(grid, velocityLane.element)
  if (lanes) scroller.append(lanes.host)
  const empty = document.createElement('p')
  empty.className = 'note piano-roll-empty'
  empty.textContent = 'No clip is open. Choose Add clip on a track above, or choose a MIDI clip, and its notes appear here to edit.'
  // Edits made from a rule over every note of the clip. Left out when nothing can be done with them (RollTools.js).
  const rollTools = onTransform
    ? createRollTools(document, {
      onTransform, now, keyOf, getClip: () => clip, getChosen: () => chosen, setChosen: set => { chosen = set }, getScale: () => rollScale.current,
      say: message => say(message), draw: () => draw(), chooseAll: () => chooseAll()
    })
    : null
  const tools = rollTools ? rollTools.element : document.createElement('div')
  if (!rollTools) { tools.className = 'piano-roll-tools'; tools.hidden = true }
  const fitButton = rollTools ? rollTools.fitButton : document.createElement('button')
  const selectAll = rollTools?.selectAll ?? null
  const selectNone = rollTools?.selectNone ?? null
  // Left out for a host that cannot store a loop: a control nobody can use is not drawn.
  const loop = onLoop ? createRollLoop(document, { onLoop: beats => onLoop(clip.id, beats) }) : null
  // A rhythm to lay into the clip, left out for a host that cannot edit notes.
  const euclid = onEuclid ? createRollEuclid(document, { onEuclid: options => onEuclid(clip.id, options), nameOf: noteName }) : null
  // With a scale chosen, rows outside it are marked and drawn or dragged notes land inside it.
  const rollScale = createRollScale(document, { onChange: () => { fitButton.hidden = rollScale.current === null; draw() } })
  const snap = pitch => (rollScale.current ? snapPitch(pitch, rollScale.current.root, rollScale.current.scale) : pitch)
  // Step input: notes entered one at a time at the cursor, which moves on by the chosen length (see RollStep.js).
  const stepInput = createRollStep(document, {
    onNote: (pitch, { advance }) => enterStep(pitch, { advance }),
    onRest: () => stepRest(),
    onBack: () => stepBack(),
    onChange: () => { if (clip) draw() }
  })
  element.append(header, empty, help, rollScale.element, stepInput.element, ...(loop ? [loop.element] : []), ...(euclid ? [euclid.element] : []), ...(lanes ? [lanes.element] : []), tools, scroller, status)
  if (lanes) lanes.onChoice = () => { if (clip) draw() }

  /** Open or closed: the grid and its controls, or the note saying how to open one. */
  function showOpen (open) {
    empty.hidden = open
    help.hidden = !open
    scroller.hidden = !open
    rollScale.element.hidden = !open
    stepInput.element.hidden = !open
    if (loop) loop.element.hidden = !open
    if (euclid) euclid.element.hidden = !open
    if (lanes) lanes.element.hidden = !open
    tools.hidden = !open || clip === null || clip.notes.length === 0
    // Close is left out with nothing to close, not shown disabled.
    close.hidden = !open
    if (!open) heading.textContent = 'Piano roll'
  }
  showOpen(false)

  let clip = null
  let options = null
  let cursor = { pitch: 60, step: 0 }
  let low = 48
  // What a drag in progress would make, drawn but not yet sent.
  let preview = null
  // A rubber band in progress, as two cells, drawn but not yet chosen.
  let band = null
  // Drops the gesture in progress without committing it. A cancelled touch never sends a release,
  // and a stale gesture would otherwise commit on the next one's release.
  let abandon = null

  const say = message => { status.textContent = message }
  // The clip's own steps, and the bar past its end that drawing into extends it.
  const clipSteps = () => Math.round(clip.lengthBeats * STEPS_PER_BEAT)
  const steps = () => clipSteps() + options.beatsPerBar * STEPS_PER_BEAT
  const beatOf = step => step / STEPS_PER_BEAT
  const where = step => barBeat(beatOf(step), options.beatsPerBar)
  const shown = () => preview ?? clip.notes
  const chooseAll = () => {
    chosen = new Set(clip.notes.map(keyOf))
    draw()
    say(`${chosen.size} note${chosen.size === 1 ? '' : 's'} chosen`)
  }
  const toggleChosen = note => {
    const key = keyOf(note)
    if (!chosen.delete(key)) chosen.add(key)
    draw()
    say(`${spokenName(note.pitch)} at ${barBeat(note.startBeat, options.beatsPerBar)} ${chosen.has(key) ? 'chosen' : 'not chosen'}, ${chosen.size} in all`)
  }
  const same = (a, b) => a.startBeat === b.startBeat && a.pitch === b.pitch

  /** Keep the cursor inside the clip and the window around the cursor. */
  function clampCursor () {
    cursor.pitch = Math.max(0, Math.min(127, cursor.pitch))
    cursor.step = Math.max(0, Math.min(steps() - 1, cursor.step))
    if (cursor.pitch < low) low = cursor.pitch
    if (cursor.pitch >= low + VISIBLE_PITCHES) low = cursor.pitch - VISIBLE_PITCHES + 1
    low = Math.max(0, Math.min(128 - VISIBLE_PITCHES, low))
  }

  function describe (pitch, step) {
    const note = noteAt(shown(), pitch, beatOf(step))
    const past = step >= clipSteps() ? ', past the end of the clip' : ''
    const base = `${spokenName(pitch)}, ${where(step)}${past}`
    if (!note) return base
    const start = note.startBeat === beatOf(step) ? 'note' : 'inside a note'
    return `${base}, ${start}, ${beats(note.lengthBeats)}, velocity ${note.velocity}${note.chance === undefined ? '' : `, ${Math.round(note.chance * 100)} percent chance of sounding`}${chosen.has(keyOf(note)) ? ', chosen' : ''}`
  }

  function draw (next = clip) {
    clip = next
    if (!clip) return
    loop?.show(clip)
    // Nothing to change in an empty clip, so the buttons are not drawn.
    tools.hidden = clip.notes.length === 0 || !onTransform
    // A choice only holds notes that still exist.
    const present = new Set(clip.notes.map(keyOf))
    chosen = new Set([...chosen].filter(k => present.has(k)))
    if (selectAll) {
      selectAll.hidden = chosen.size === clip.notes.length
      selectNone.hidden = chosen.size === 0
    }
    const hadFocus = grid.contains(document.activeElement)
    clampCursor()
    const notes = shown()
    const selected = noteAt(notes, cursor.pitch, beatOf(cursor.step))
    grid.textContent = ''
    // Only part of the 128 pitches is drawn, so say how many there are and where each row sits among them (the highest
    // pitch is row 1). The row header is the first column, so the squares start at column 2.
    grid.setAttribute('aria-rowcount', String(PITCHES))
    grid.setAttribute('aria-colcount', String(steps() + 1))
    for (let pitch = low + VISIBLE_PITCHES - 1; pitch >= low; pitch--) {
      const row = document.createElement('div')
      row.className = `piano-roll-row${NAMES[pitch % 12].includes('#') ? ' black' : ''}`
      row.setAttribute('role', 'row')
      row.setAttribute('aria-rowindex', String(PITCHES - pitch))
      const label = document.createElement('span')
      label.className = 'piano-roll-key'
      label.setAttribute('role', 'rowheader')
      label.setAttribute('aria-colindex', '1')
      label.textContent = noteName(pitch)
      // Marked in words and in a dot, so a row outside the scale is not shown by shade alone.
      if (rollScale.current && !inScale(pitch, rollScale.current.root, rollScale.current.scale)) {
        row.classList.add('off-scale')
        label.textContent += ' ·'
        label.setAttribute('aria-label', `${spokenName(pitch)}, outside the scale`)
      }
      row.append(label)
      for (let step = 0; step < steps(); step++) {
        const cell = document.createElement('div')
        cell.setAttribute('role', 'gridcell')
        cell.setAttribute('aria-colindex', String(step + 2))
        cell.id = `roll-${pitch}-${step}`
        cell.dataset.pitch = String(pitch)
        cell.dataset.step = String(step)
        const note = noteAt(notes, pitch, beatOf(step))
        const starts = note && note.startBeat === beatOf(step)
        const ends = note && note.startBeat + note.lengthBeats === beatOf(step + 1)
        const classes = ['piano-roll-cell']
        if (note) classes.push('on')
        if (starts) classes.push('start')
        if (ends) classes.push('end')
        if (note && note === selected) classes.push('selected')
        const isChosen = note && chosen.has(keyOf(note))
        if (isChosen) classes.push('chosen')
        if (step % STEPS_PER_BEAT === 0) classes.push('beat')
        if (step >= clipSteps()) classes.push('beyond')
        if (band && pitch >= Math.min(band.from.pitch, band.to.pitch) && pitch <= Math.max(band.from.pitch, band.to.pitch) &&
          step >= Math.min(band.from.step, band.to.step) && step <= Math.max(band.from.step, band.to.step)) classes.push('band')
        cell.className = classes.join(' ')
        // Marked in text too, so a note is not shown by colour alone.
        cell.textContent = starts ? (isChosen ? '▣' : note.chance !== undefined ? '◩' : '■') : note ? '–' : ''
        cell.setAttribute('aria-label', describe(pitch, step))
        const here = pitch === cursor.pitch && step === cursor.step
        cell.tabIndex = here ? 0 : -1
        if (here) cell.classList.add('cursor')
        row.append(cell)
      }
      grid.append(row)
    }
    grid.append(head)
    // Nothing to show for a clip with no notes, so the lane is left out rather than drawn empty.
    velocityLane.element.hidden = notes.length === 0 || (lanes !== null && !lanes.velocity)
    lanes?.draw({ list: clip.controllers ?? [], columns: steps(), perBeat: STEPS_PER_BEAT })
    velocityLane.element.style.setProperty('--steps', String(steps()))
    velocityLane.draw(notes.map(n => ({
      key: keyOf(n),
      beat: n.startBeat,
      value: n.velocity,
      chosen: chosen.has(keyOf(n)),
      name: `Velocity of ${spokenName(n.pitch)} at ${barBeat(n.startBeat, options.beatsPerBar)}`,
      text: `${n.velocity}, ${spokenName(n.pitch)} at ${barBeat(n.startBeat, options.beatsPerBar)}`
    })))
    if (hadFocus) document.getElementById(`roll-${cursor.pitch}-${cursor.step}`)?.focus({ preventScroll: true })
  }

  /**
   * Send notes. If they now run past the clip's end, the clip grows to the end
   * of the bar the last one reaches, in the same edit.
   */
  function send (notes, message) {
    say(message)
    const end = Math.max(0, ...notes.map(n => n.startBeat + n.lengthBeats))
    const bar = options.beatsPerBar
    const lengthBeats = end > clip.lengthBeats ? Math.ceil(end / bar) * bar : undefined
    onChange(clip.id, notes, lengthBeats === undefined ? {} : { lengthBeats })
  }

  function remove (note) {
    send(clip.notes.filter(n => !same(n, note)), `Removed ${spokenName(note.pitch)} at ${barBeat(note.startBeat, options.beatsPerBar)}`)
  }

  function toggle () {
    const beat = beatOf(cursor.step)
    const here = noteAt(clip.notes, cursor.pitch, beat)
    if (here) {
      remove(here)
    } else {
      const note = { startBeat: beat, lengthBeats: 1, pitch: snap(cursor.pitch), velocity: 100 }
      onAudition(note.pitch, note.velocity)
      send([...clip.notes, note], `Added ${spokenName(note.pitch)} at ${where(cursor.step)}, 1 beat`)
    }
  }

  const stepSteps = () => Math.max(1, Math.round(stepInput.lengthBeats * STEPS_PER_BEAT))

  /** A note of the step length at the cursor, then on to the next step unless `advance` is false (a chord). */
  function enterStep (pitch, { advance = true } = {}) {
    if (!(pitch >= 0 && pitch <= 127)) { say(`${pitch} is outside the range of notes`); return }
    const startBeat = beatOf(cursor.step)
    const note = { startBeat, lengthBeats: stepInput.lengthBeats, pitch: snap(pitch), velocity: 100 }
    // Entering the same note again at the same place replaces it rather than doubling it.
    const rest = clip.notes.filter(n => !(n.startBeat === startBeat && n.pitch === note.pitch))
    onAudition(note.pitch, note.velocity)
    const at = cursor.step
    cursor = { pitch: note.pitch, step: cursor.step + (advance ? stepSteps() : 0) }
    send([...rest, note], `Entered ${spokenName(note.pitch)} at ${where(at)}, ${beats(note.lengthBeats)}${advance ? '' : ', staying for a chord'}`)
  }

  function stepRest () {
    cursor = { ...cursor, step: cursor.step + stepSteps() }
    draw()
    say(`Rest, now at ${where(cursor.step)}`)
  }

  /** Back one step, and clear the notes that start where it lands. */
  function stepBack () {
    const to = Math.max(0, cursor.step - stepSteps())
    const startBeat = beatOf(to)
    cursor = { ...cursor, step: to }
    const kept = clip.notes.filter(n => n.startBeat !== startBeat)
    if (kept.length === clip.notes.length) { draw(); say(`Back at ${where(to)}`); return }
    send(kept, `Back at ${where(to)}, cleared ${clip.notes.length - kept.length} note${clip.notes.length - kept.length === 1 ? '' : 's'}`)
  }

  /** The keys of step input; true when the key was one of them. */
  function stepKey (event) {
    const { key } = event
    const semitone = STEP_KEYS[key.toLowerCase()]
    if (semitone !== undefined && key.length === 1) {
      event.preventDefault()
      enterStep(pitchFor(stepInput.octave, semitone), { advance: !(event.shiftKey || stepInput.chord) })
    } else if (key === 'z' || key === 'Z' || key === 'x' || key === 'X') {
      event.preventDefault()
      stepInput.setOctave(stepInput.octave + (key.toLowerCase() === 'x' ? 1 : -1))
      say(`Octave ${stepInput.octave}`)
    } else if (key === ' ') { event.preventDefault(); stepRest() }
    else if (key === 'Backspace') { event.preventDefault(); stepBack() }
    else return false
    return true
  }

  function setVelocity (key, velocity) {
    const note = clip.notes.find(n => keyOf(n) === key)
    if (!note) return
    send(clip.notes.map(n => (n === note ? { ...n, velocity } : n)), `Velocity ${velocity}, ${spokenName(note.pitch)} at ${barBeat(note.startBeat, options.beatsPerBar)}`)
  }

  function adjust (change, message) {
    const here = noteAt(clip.notes, cursor.pitch, beatOf(cursor.step))
    if (!here) { say(`No note at ${spokenName(cursor.pitch)}, ${where(cursor.step)}`); return }
    const next = change(here)
    if (!next) return
    send(clip.notes.map(n => (n === here ? next : n)), message(next))
  }

  grid.addEventListener('keydown', event => {
    if (!clip) return
    const move = (pitch, step) => { event.preventDefault(); cursor = { pitch: cursor.pitch + pitch, step: cursor.step + step }; draw() }
    const { key, shiftKey, altKey } = event
    if (stepInput.active && !event.ctrlKey && !event.metaKey && !altKey && stepKey(event)) return
    if (altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault()
      const by = key === 'ArrowUp' ? 10 : -10
      adjust(n => {
        const velocity = Math.max(1, Math.min(127, n.velocity + by))
        return velocity === n.velocity ? null : { ...n, velocity }
      }, n => `Velocity ${n.velocity}`)
    } else if (shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault()
      const by = (key === 'ArrowRight' ? 1 : -1) / STEPS_PER_BEAT
      adjust(n => {
        const lengthBeats = n.lengthBeats + by
        return lengthBeats <= 0 ? null : { ...n, lengthBeats }
      }, n => `Length ${beats(n.lengthBeats)}`)
    } else if (key === 'ArrowUp') move(1, 0)
    else if (key === 'ArrowDown') move(-1, 0)
    else if (key === 'ArrowLeft') move(0, -1)
    else if (key === 'ArrowRight') move(0, 1)
    else if (key === 'PageUp') move(12, 0)
    else if (key === 'PageDown') move(-12, 0)
    else if (key === 'Home') move(0, -cursor.step)
    // The clip's own last step; the arrows reach the bar past it.
    else if (key === 'End') move(0, clipSteps() - 1 - cursor.step)
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); toggle() }
    // A drag in progress is not closed under the pointer; Escape then leaves the drag to its own release.
    else if (key === 'Escape' && preview === null) {
      event.preventDefault()
      if (chosen.size > 0) { chosen = new Set(); draw(); say('No notes chosen') } else onClose()
    } else if (key === 's' || key === 'S') {
      event.preventDefault()
      const here = noteAt(clip.notes, cursor.pitch, beatOf(cursor.step))
      if (here) toggleChosen(here)
      else say(`No note at ${spokenName(cursor.pitch)}, ${where(cursor.step)}`)
    } else if ((key === 'a' || key === 'A') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      chooseAll()
    }
    else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault()
      const here = noteAt(clip.notes, cursor.pitch, beatOf(cursor.step))
      if (here) remove(here)
      else say(`No note at ${spokenName(cursor.pitch)}, ${where(cursor.step)}`)
    }
  })

  // The pointer: draw, move, resize and remove a note, and a rubber band to choose several (RollPointer.js). The roll's state is lent to it.
  const gesture = {
    clip: () => clip,
    options: () => options,
    get cursor () { return cursor },
    set cursor (value) { cursor = value },
    get preview () { return preview },
    set preview (value) { preview = value },
    get band () { return band },
    set band (value) { band = value },
    get abandon () { return abandon },
    set abandon (value) { abandon = value },
    get chosen () { return chosen },
    set chosen (value) { chosen = value }
  }
  attachRollPointer(grid, { document, g: gesture, now, onAudition, snap, draw, say, send, remove, toggleChosen, where })

  return {
    element,
    get clipId () { return clip?.id ?? null },
    /** Open on a clip. The cursor starts on its first note, or middle C. */
    show (next, { beatsPerBar, label }) {
      options = { beatsPerBar }
      heading.textContent = `Notes of the clip at ${barBeat(next.startBeat, beatsPerBar)} on ${label}`
      close.setAttribute('aria-label', `Close the notes of the clip on ${label}`)
      abandon?.()
      chosen = new Set()
      band = null
      const first = next.notes[0]
      cursor = first ? { pitch: first.pitch, step: Math.round(first.startBeat * STEPS_PER_BEAT) } : { pitch: 60, step: 0 }
      low = cursor.pitch - Math.floor(VISIBLE_PITCHES / 2)
      showOpen(true)
      draw(next)
      document.getElementById(`roll-${cursor.pitch}-${cursor.step}`)?.focus()
    },
    draw,
    /**
     * Show where the transport is, as a beat of the arrangement, or null to
     * show nothing. Drawn only while it is inside this clip and its extra bar.
     */
    playhead (beat) {
      if (!clip || beat === null) { head.hidden = true; return }
      const step = (beat - clip.startBeat) * STEPS_PER_BEAT
      head.hidden = !(step >= 0 && step < steps())
      head.style.setProperty('--at', String(step))
    },
    /** Close the clip, leaving the note that says how to open one. */
    hide () {
      abandon?.()
      stepInput.reset()
      clip = null
      chosen = new Set()
      preview = null
      grid.textContent = ''
      head.hidden = true
      showOpen(false)
    }
  }
}
