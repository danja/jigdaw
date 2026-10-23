// web/app/MidiRecord.js
//
// Rec MIDI: play the session and keep what is played on a MIDI keyboard, or the on-screen keys, as MIDI clips. Press it and the
// transport plays (through a count-in, as Record does); press it again, or Stop, and each track that heard something gets a clip
// from where the take began, in one edit, so one undo takes the whole take back. It keeps notes, controllers and the pitch bend
// wheel as played (src/model/MidiTake.js says how they are thinned and paired).
//
// It is separate from Record, which keeps audio: a track recorded both ways would play its notes and its own recorded sound at
// once. Which track a note belongs to is the track whose MIDI input is the plugin it was sent to, so only a plugin a track plays
// into can be recorded.
import { describeMidiTake } from '../../src/model/MidiTake.js'
import { setIcon } from '../../src/ui/Icons.js'

export function createMidiRecord (ctx) {
  const { $, log } = ctx
  // What was heard, per track, with the beat each message came at. Null when no take is running.
  let take = null

  const show = active => {
    const button = $('record-midi')
    button.setAttribute('aria-pressed', String(active))
    setIcon(ctx.document, button, active ? 'stop' : 'record', active ? 'Stop MIDI take' : 'Rec MIDI', { keepTitle: true })
  }

  /** A message sent live to a plugin: kept when a take is running and a track plays into that plugin. */
  function capture (nodeId, bytes) {
    if (!take) return
    const project = ctx.dispatcher?.project
    if (!project) return
    const beat = ctx.transport.position().beat
    for (const track of project.tracks) {
      if (track.midiInput !== nodeId) continue
      if (!take.messages.has(track.id)) take.messages.set(track.id, [])
      take.messages.get(track.id).push({ beat, bytes: [...bytes] })
    }
  }

  async function toggle () {
    if (take) { await finishTake(); return }
    await ctx.runtime.ensureRunning()
    const project = ctx.dispatcher.project
    if (!project.tracks.some(t => t.midiInput)) {
      log('nothing to record into: no track has an instrument to play. Add one, then try again', 'error')
      return
    }
    const started = ctx.transport.playing()
    if (!started) await ctx.transport.play()
    if (!started) await ctx.transport.untilStart()
    take = { startBeat: ctx.transport.position().beat, messages: new Map() }
    show(true)
    log(`recording MIDI from beat ${take.startBeat.toFixed(2)}: play the keys of an armed track, or of the selected one`)
  }

  /** Keep the take. Safe to call idle, so Stop can always call it. */
  async function finishTake () {
    if (!take) return
    const { startBeat, messages } = take
    take = null
    show(false)
    const endBeat = ctx.transport.position().beat
    let described
    try { described = describeMidiTake(ctx.dispatcher.project, messages, { startBeat, endBeat }) } catch (error) {
      log(error.message === 'nothing was played' ? 'no MIDI was played, so no clip was kept' : error.message, error.message === 'nothing was played' ? 'info' : 'error')
      return
    }
    const result = ctx.dispatcher.apply(described.changes)
    if (!result.ok) { log(`the take could not be placed: ${result.message}`, 'error'); return }
    log(`kept ${described.notes} note${described.notes === 1 ? '' : 's'} and ${described.controllers} controller event${described.controllers === 1 ? '' : 's'} on ${described.tracks} track${described.tracks === 1 ? '' : 's'} from beat ${startBeat.toFixed(2)}`, 'ok')
  }

  return { toggle, finishTake, capture, isRecording: () => take !== null }
}
