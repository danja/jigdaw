// web/app/Loops.js
//
// The Loops dialog (src/ui/LoopLibrary.js): starter MIDI loops, heard through the instrument on the selected track and added as a clip.
//
// Add puts the loop at the playhead on the selected track when that track has an instrument that suits it (drums to a drum kit, anything else to
// anything but one). With no such track, it makes a
// new one with a sound to suit the kind of loop (a drum kit for drums, and so on, chosen in LoopLibrary.KINDS) and puts the clip at the start.
// Either way it is one group, so one undo takes back the clip and the track made for it. Hear needs an instrument to play through, so it is
// offered only when there is one, and the dialog says what to do when there is not.
import { MAX_RESULTS } from '../../src/catalogue/limits.js'
import { soundsFrom } from '../../src/ui/SoundChooser.js'
import { directoryOf } from '../../src/ui/SoundRecipes.js'
import { KINDS, loopsFromIndex, groupsOf, addClipChange, eventsFor, createLoopBrowser } from '../../src/ui/LoopLibrary.js'

export function createLoops (ctx) {
  const { document, log } = ctx
  let browser = null
  let library = null
  let busy = false

  const isOpen = () => browser !== null

  /** The library, read once and checked. A file that cannot be read or is malformed is an error with the reason, not an empty dialog. */
  async function load () {
    if (library) return library
    const response = await fetch(new URL('loops/index.json', document.baseURI))
    if (!response.ok) throw new Error(`the loop library answered ${response.status}`)
    library = loopsFromIndex(await response.json())
    return library
  }

  /**
   * The selected track, if it has an instrument that suits `loop`: a drum loop wants a drum kit and a pitched loop wants anything else, since
   * a bass line played through a drum kit is a scatter of drums. A track with no instrument is not a target, as a clip on it plays into nothing.
   */
  function targetTrack (loop) {
    const { selection, dispatcher } = ctx
    if (selection.kind !== 'track') return null
    const track = dispatcher?.project.track(selection.ids[0])
    if (!track?.midiInput) return null
    const roles = dispatcher.engineNode(track.midiInput)?.profile?.roles ?? []
    const isDrumKit = roles.some(role => role.endsWith('DrumInstrument'))
    return isDrumKit === (loop.kind === 'drums') ? track : null
  }

  /** The instrument that suits a kind of loop, found among the plugins this host can run. */
  async function voiceFor (kind) {
    const directory = KINDS.find(k => k.kind === kind).voice
    const { results } = await ctx.browser.catalogue().search({ role: 'Instrument', limit: MAX_RESULTS })
    const sound = soundsFrom(results).find(s => directoryOf(s.iri) === directory)
    if (!sound) throw new Error(`there is no ${directory} here to play a ${kind} loop`)
    return { load: sound.load, label: sound.label }
  }

  function close () {
    const { element } = browser
    browser = null
    if (element.open) element.close()
    element.remove()
  }

  async function hear (loop) {
    if (busy) return
    busy = true
    try {
      const track = targetTrack(loop)
      if (!track) { browser?.say('Select a track with an instrument that suits this loop to hear it.'); return }
      const d = await ctx.runtime.ensureRunning()
      const { currentTime, sampleRate } = ctx.engine.context
      const bpm = d.project.transport.tempoPoints[0].bpm
      d.sendEvents(track.midiInput, eventsFor(loop, { bpm, sampleRate, startFrame: Math.round((currentTime + 0.05) * sampleRate) }))
      browser?.say(`Playing ${loop.label} through ${track.label ?? track.id}.`)
    } catch (error) {
      log(error.message, 'error')
      browser?.say(error.message)
    } finally {
      busy = false
    }
  }

  async function add (loop) {
    if (busy) return
    busy = true
    try {
      browser.say(`Adding ${loop.label}`)
      const d = await ctx.runtime.ensureRunning()
      const made = await d.grouped(async () => {
        const track = targetTrack(loop)
        let trackId
        let startBeat
        if (track) {
          trackId = track.id
          startBeat = Math.max(0, Math.round(ctx.transport.position().beat))
        } else {
          const voice = await voiceFor(loop.kind)
          const loaded = await ctx.loading.loadPlugin(voice.load, { newTrack: true })
          if (!loaded) throw new Error(`${voice.label} did not load, so there is nothing to play ${loop.label}. The log says why.`)
          trackId = loaded.trackId
          startBeat = 0
        }
        const applied = d.apply([addClipChange({ loop, track: trackId, startBeat })])
        if (!applied.ok) throw new Error(applied.message)
        return { trackId }
      }, { label: 'Add a loop' })
      ctx.selection.set('track', [made.trackId])
      if (isOpen()) close()
      log(`added ${loop.label}`, 'ok')
    } catch (error) {
      log(error.message, 'error')
      browser?.say(error.message)
    } finally {
      busy = false
    }
  }

  /** Open the dialog. */
  async function open () {
    if (isOpen()) return
    let loops = []
    let problem = null
    try {
      loops = await load()
    } catch (error) {
      problem = error.message
      log(`loops: ${error.message}`, 'error')
    }
    browser = createLoopBrowser(document, {
      groups: groupsOf(loops),
      canHear: loop => targetTrack(loop) !== null,
      beatsPerBar: ctx.dispatcher?.project.transport.beatsPerBar,
      onHear: hear,
      onAdd: add,
      onClose: () => { if (isOpen()) close() }
    })
    document.body.append(browser.element)
    browser.element.showModal()
    browser.element.querySelector('button')?.focus()
    if (problem) browser.say(`The loops could not be read: ${problem}`)
  }

  return { open, isOpen }
}
