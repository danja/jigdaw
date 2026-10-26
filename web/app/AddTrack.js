// web/app/AddTrack.js
//
// The "Add a track" chooser (src/ui/SoundChooser.js): sounds by what a person wants to play, each heard before it is added.
//
// A sound is one plugin or several, loaded in order onto one new track (a drum kit played by a beat generator is two). Hear loads the
// sound onto a trial track and plays a few notes through the plugin that plays notes. The trial track is made and taken away with
// recording off (the dispatcher's withoutRecording), so it never appears in the undo history, and there is at most one: hearing another
// sound first takes the last one away. Add takes the trial track away and loads the sound onto a new track as one edit, so one undo takes
// the whole track back out. Cancel, Escape, An empty track and Add all end with no trial track left behind, including when the dialog is
// dismissed while a load is still under way.
import { MAX_RESULTS } from '../../src/catalogue/limits.js'
import { createSoundChooser, groupsFrom, phraseFor } from '../../src/ui/SoundChooser.js'

export function createAddTrack (ctx) {
  const { document, log } = ctx
  let chooser = null
  let trial = null
  let busy = false

  const isOpen = () => chooser !== null

  async function removeTrial () {
    if (!trial) return
    const { nodeIds, trackId } = trial
    trial = null
    const d = ctx.dispatcher
    await d.withoutRecording(() => {
      const result = d.apply([...nodeIds.map(id => ({ op: 'removeNode', id })), { op: 'removeTrack', id: trackId }])
      if (!result.ok) log(result.message, 'error')
    })
    for (const id of nodeIds) ctx.rack.forgetNode(id)
    ctx.rack.draw()
    ctx.expose()
  }

  function close () {
    const { element } = chooser
    chooser = null
    if (element.open) element.close()
    element.remove()
  }

  /**
   * Load a sound's parts in order onto one new track. The last part is the one that plays notes, so for a sound of several parts the
   * track's MIDI input is moved to it: a clip, a key or a MIDI keyboard then plays the instrument, and the generator before it plays
   * by itself. Returns `{ trackId, nodeIds, playsId }`, or null when a part did not load, with whatever did load taken away again.
   */
  async function loadSound (sound) {
    const loaded = []
    let trackId = null
    for (const part of sound.parts) {
      const result = await ctx.loading.loadPlugin(part.load, trackId === null ? { newTrack: true } : { onto: trackId })
      if (!result) {
        if (loaded.length > 0) {
          trial = { trackId, nodeIds: loaded }
          await removeTrial()
        }
        return null
      }
      trackId = result.trackId
      loaded.push(result.nodeId)
    }
    const playsId = loaded.at(-1)
    if (loaded.length > 1) {
      const routed = ctx.dispatcher.apply([{ op: 'setTrack', id: trackId, midiInput: playsId }])
      if (!routed.ok) log(routed.message, 'error')
    }
    return { trackId, nodeIds: loaded, playsId }
  }

  /** The notes, as MIDI events at stream positions a little ahead of the clock, which is where a played note goes. */
  function play (nodeId, sound) {
    const { currentTime, sampleRate } = ctx.engine.context
    const start = Math.round((currentTime + 0.05) * sampleRate)
    const frames = seconds => start + Math.round(seconds * sampleRate)
    ctx.dispatcher.sendEvents(nodeId, phraseFor(sound).flatMap(n => [
      { frame: frames(n.at), bytes: Uint8Array.from([0x90, n.pitch, n.velocity]) },
      { frame: frames(n.at + n.length), bytes: Uint8Array.from([0x80, n.pitch, 0]) }
    ]))
  }

  async function hear (sound) {
    if (busy) return
    busy = true
    try {
      chooser.say(`Loading ${sound.label}`)
      await removeTrial()
      const d = await ctx.runtime.ensureRunning()
      // Recording off for the whole load, so the trial track, its plugins and the joins between them are none of them undo steps.
      const made = await d.withoutRecording(() => loadSound(sound))
      if (!made) {
        chooser?.say(`${sound.label} did not load. The log says why.`)
        return
      }
      trial = { trackId: made.trackId, nodeIds: made.nodeIds }
      // Dismissed while it loaded: nobody is left to want the trial track.
      if (!isOpen()) { await removeTrial(); return }
      ctx.rack.draw()
      ctx.expose()
      chooser.heard(sound.iri)
      play(made.playsId, sound)
      chooser.say(sound.generated
        ? `Playing the ${sound.parts.at(-1).label} by hand. Add keeps it, and Play then runs the beat.`
        : `Playing ${sound.label}. Add keeps it, or hear another.`)
    } catch (error) {
      log(error.message, 'error')
      chooser?.say(error.message)
    } finally {
      busy = false
    }
  }

  async function add (sound) {
    if (busy) return
    busy = true
    try {
      chooser.say(`Adding ${sound.label}`)
      await removeTrial()
      // One group, so one undo takes back the track, every plugin on it and the joins between them.
      const made = await ctx.dispatcher.grouped(() => loadSound(sound), { label: 'Add a track' })
      if (!made) { chooser?.say(`${sound.label} did not load. The log says why.`); return }
      ctx.selection.set('track', [made.trackId])
      if (isOpen()) close()
      // A sound with a generator is made to be steered, so its controls (the Feel pad) are put in front, where the step draws them.
      if (sound.generated && ctx.show.allowsTab('tracks')) ctx.tabs.select('tracks')
    } catch (error) {
      log(error.message, 'error')
      chooser?.say(error.message)
    } finally {
      busy = false
    }
  }

  async function dismiss () {
    if (!isOpen()) return
    close()
    await removeTrial()
  }

  /** Open the chooser. The sounds are asked for from the host's catalogue, the way the Browser asks. */
  async function open () {
    if (isOpen()) return
    let groups = []
    let problem = null
    try {
      const catalogue = ctx.browser.catalogue()
      const [instruments, generators] = await Promise.all([
        catalogue.search({ role: 'Instrument', limit: MAX_RESULTS }),
        catalogue.search({ role: 'MidiGenerator', produces: 'DrumMidi', limit: MAX_RESULTS })
      ])
      groups = groupsFrom({ instruments: instruments.results, generators: generators.results })
    } catch (error) {
      problem = error.message
      log(`sounds: ${error.message}`, 'error')
    }
    chooser = createSoundChooser(document, {
      groups,
      onHear: hear,
      onAdd: add,
      onEmpty: async () => { await dismiss(); await ctx.arrangement.addTrack() },
      onCancel: dismiss
    })
    document.body.append(chooser.element)
    chooser.element.showModal()
    // The first Hear, not the scrolling list the browser would otherwise land on, so a keyboard user starts on something that acts.
    chooser.element.querySelector('button')?.focus()
    if (problem) chooser.say(`The sounds could not be listed: ${problem}`)
  }

  return { open, isOpen }
}
