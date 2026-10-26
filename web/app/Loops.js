// web/app/Loops.js
//
// The Loops dialog (src/ui/LoopLibrary.js): starter MIDI loops, heard through the instrument on the selected track and added as a clip.
//
// Add puts the loop at the playhead on the selected track when that track has an instrument that suits it (drums to a drum kit, anything else to
// anything but one). With no such track, it makes a
// new one with a sound to suit the kind of loop (a drum kit for drums, and so on, chosen in LoopLibrary.KINDS) and puts the clip at the start.
// Either way it is one group, so one undo takes back the clip and the track made for it. A set (a deep house starter: drums, bass, stabs, pad) is
// several loops each on a track of its own, again as one group, with the tempo it asks for when the project has no tracks yet and so nothing to
// be put out of time by it. Hear needs an instrument to play through, so it is
// offered only when there is one, and the dialog says what to do when there is not.
import { MAX_RESULTS } from '../../src/catalogue/limits.js'
import { soundsFrom } from '../../src/ui/SoundChooser.js'
import { directoryOf } from '../../src/ui/SoundRecipes.js'
import { KINDS, loopsFromIndex, setsFromIndex, groupsOf, addClipChange, eventsFor, createLoopBrowser } from '../../src/ui/LoopLibrary.js'

export function createLoops (ctx) {
  const { document, log } = ctx
  let browser = null
  let library = null
  let busy = false
  // The instruments this host can run, asked for once a visit to the dialog, since a set looks one up for each of its loops.
  let instruments = null

  const isOpen = () => browser !== null

  /** The library, read once and checked. A file that cannot be read or is malformed is an error with the reason, not an empty dialog. */
  async function load () {
    if (library) return library
    const response = await fetch(new URL('loops/index.json', document.baseURI))
    if (!response.ok) throw new Error(`the loop library answered ${response.status}`)
    const index = await response.json()
    const loops = loopsFromIndex(index)
    library = { loops, sets: setsFromIndex(index, loops) }
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
  async function voiceFor (kind, voice = null) {
    const directory = voice ?? KINDS.find(k => k.kind === kind).voice
    instruments ??= (await ctx.browser.catalogue().search({ role: 'Instrument', limit: MAX_RESULTS })).results
    const sound = soundsFrom(instruments).find(s => directoryOf(s.iri) === directory)
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
        // The level a loop suggests is for a track made for it. A person's own track keeps its fader, and so does the mix around it.
        const level = []
        if (track) {
          trackId = track.id
          startBeat = Math.max(0, Math.round(ctx.transport.position().beat))
        } else {
          const voice = await voiceFor(loop.kind, loop.voice)
          const loaded = await ctx.loading.loadPlugin(voice.load, { newTrack: true })
          if (!loaded) throw new Error(`${voice.label} did not load, so there is nothing to play ${loop.label}. The log says why.`)
          trackId = loaded.trackId
          startBeat = 0
          if (loop.gain !== undefined) level.push({ op: 'setTrackChannel', track: trackId, gain: loop.gain })
        }
        const applied = d.apply([...level, addClipChange({ loop, track: trackId, startBeat })])
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

  /**
   * Add every loop of a set, each on a track of its own named for it, as one group. The tempo is set to the set's when there are no tracks yet,
   * and left alone when there are, since changing it would move the person's own work off the beat; the log says which.
   */
  async function addSet (set) {
    if (busy) return
    busy = true
    try {
      browser.say(`Adding ${set.label}`)
      const d = await ctx.runtime.ensureRunning()
      const parts = set.loops.map(id => library.loops.find(l => l.id === id))
      const trackIds = await d.grouped(async () => {
        if (d.project.tracks.length === 0) {
          const tempo = d.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: set.bpm }] }])
          if (!tempo.ok) throw new Error(tempo.message)
        } else {
          log(`kept the tempo you have: ${set.label} is written for ${set.bpm} BPM`, 'info')
        }
        const made = []
        for (const loop of parts) {
          const voice = await voiceFor(loop.kind, loop.voice)
          const loaded = await ctx.loading.loadPlugin(voice.load, { newTrack: true })
          if (!loaded) throw new Error(`${voice.label} did not load, so there is nothing to play ${loop.label}. The log says why.`)
          const applied = d.apply([
            { op: 'setTrack', id: loaded.trackId, label: loop.label },
            ...(loop.gain === undefined ? [] : [{ op: 'setTrackChannel', track: loaded.trackId, gain: loop.gain }]),
            addClipChange({ loop, track: loaded.trackId, startBeat: 0 })
          ])
          if (!applied.ok) throw new Error(applied.message)
          made.push(loaded.trackId)
        }
        return made
      }, { label: `Add ${set.label}` })
      ctx.selection.set('track', [trackIds[0]])
      if (isOpen()) close()
      log(`added ${set.label}`, 'ok')
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
    instruments = null
    let loops = []
    let sets = []
    let problem = null
    try {
      ;({ loops, sets } = await load())
    } catch (error) {
      problem = error.message
      log(`loops: ${error.message}`, 'error')
    }
    browser = createLoopBrowser(document, {
      groups: groupsOf(loops),
      sets,
      loops,
      canHear: loop => targetTrack(loop) !== null,
      beatsPerBar: ctx.dispatcher?.project.transport.beatsPerBar,
      onHear: hear,
      onAdd: add,
      onAddSet: addSet,
      onClose: () => { if (isOpen()) close() }
    })
    document.body.append(browser.element)
    browser.element.showModal()
    browser.element.querySelector('button')?.focus()
    if (problem) browser.say(`The loops could not be read: ${problem}`)
  }

  return { open, isOpen }
}
