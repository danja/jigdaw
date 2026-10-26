// web/app/AddTrack.js
//
// The "Add a track" chooser (src/ui/SoundChooser.js): sounds by what a person wants to play, each heard before it is added.
//
// Hear loads the sound onto a trial track and plays a few notes through it. The trial track is made and taken away with recording
// off (the dispatcher's withoutRecording), so it never appears in the undo history, and there is at most one: hearing another sound
// first takes the last one away. Add takes the trial track away and loads the sound onto a new track as one ordinary edit, so one
// undo takes the track back out. Cancel, Escape, An empty track and Add all end with no trial track left behind, including when the
// dialog is dismissed while a load is still under way.
import { MAX_RESULTS } from '../../src/catalogue/limits.js'
import { createSoundChooser, soundsFrom, phraseFor } from '../../src/ui/SoundChooser.js'

export function createAddTrack (ctx) {
  const { document, log } = ctx
  let chooser = null
  let trial = null
  let busy = false

  const isOpen = () => chooser !== null

  async function removeTrial () {
    if (!trial) return
    const { nodeId, trackId } = trial
    trial = null
    const d = ctx.dispatcher
    await d.withoutRecording(() => {
      const result = d.apply([{ op: 'removeNode', id: nodeId }, { op: 'removeTrack', id: trackId }])
      if (!result.ok) log(result.message, 'error')
    })
    ctx.rack.forgetNode(nodeId)
    ctx.rack.draw()
    ctx.expose()
  }

  function close () {
    const { element } = chooser
    chooser = null
    if (element.open) element.close()
    element.remove()
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
      const result = await d.withoutRecording(() => d.addPlugin(sound.load))
      if (!result.ok) {
        log(`${result.step ? `[${result.step}] ` : ''}${result.message}`, 'error')
        chooser?.say(`${sound.label} did not load: ${result.message}`)
        return
      }
      trial = { nodeId: result.nodeId, trackId: result.trackId }
      // Dismissed while it loaded: nobody is left to want the trial track.
      if (!isOpen()) { await removeTrial(); return }
      ctx.rack.draw()
      ctx.expose()
      chooser.heard(sound.iri)
      play(result.nodeId, sound)
      chooser.say(`Playing ${sound.label}. Add keeps it, or hear another.`)
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
      const trackId = await ctx.loading.loadPlugin(sound.load, { newTrack: true })
      if (!trackId) { chooser?.say(`${sound.label} did not load. The log says why.`); return }
      ctx.selection.set('track', [trackId])
      if (isOpen()) close()
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
    let sounds = []
    let problem = null
    try {
      sounds = soundsFrom((await ctx.browser.catalogue().search({ role: 'Instrument', limit: MAX_RESULTS })).results)
    } catch (error) {
      problem = error.message
      log(`sounds: ${error.message}`, 'error')
    }
    chooser = createSoundChooser(document, {
      sounds,
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
