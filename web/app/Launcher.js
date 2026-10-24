// web/app/Launcher.js
//
// The clip launcher on the page: the performance state (src/model/LauncherState.js) and the gestures that change it. A launch is
// quantised against the transport's position now, plus the scheduler's lookahead, so a slot launched "at once" is not already in
// the past by the time the scheduler looks. The state is not in the revision; the transport's stop and a session opening clear it.
import { LauncherState, QUANTISE_NAMES } from '../../src/model/LauncherState.js'
import { createLauncherGrid } from '../../src/ui/LauncherGrid.js'

export function createLauncher (ctx) {
  const state = new LauncherState()

  const project = () => ctx.dispatcher.project
  const bpb = () => project().transport.beatsPerBar

  /** `beat` moved on by `seconds` of the tempo map. */
  function ahead (beat, seconds) {
    const timing = ctx.dispatcher.transport()
    return timing.beatAtSeconds(timing.secondsAtBeat(beat) + seconds)
  }
  const lead = () => ctx.hostConfig.schedulerLookaheadMs / 1000

  /** The beat a launch is measured from: the transport's position with a lookahead on, so it is not already past when the scheduler looks. */
  const nowBeat = () => ahead(ctx.transport.position().beat, lead())

  function slotClip (clipId) {
    const clip = project().clip(clipId)
    if (!clip || clip.scene === undefined) throw new Error(`${clipId} is not a clip launcher slot`)
    if (clip.kind !== 'midi') throw new Error('only MIDI clips can be launched')
    return clip
  }

  /** The setting is the project's: the state works from it as it stands each time. */
  const sync = () => { state.quantise = project().transport.launchQuantise }

  async function launchClips (clips) {
    sync()
    const wasPlaying = ctx.transport.playing()
    // A press on a cell must be heard, so a stopped transport is started first, and the slot starts where it starts.
    if (!wasPlaying) await ctx.transport.play({})
    const base = wasPlaying ? nowBeat() : ahead(Math.max(0, ctx.transport.position().beat), 2 * lead())
    return clips.map(clip => ({ clipId: clip.id, track: clip.track, at: state.launch(clip, base, bpb(), { immediate: !wasPlaying }) }))
  }

  const { log } = ctx
  const guarded = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(error => log(error.message, 'error'))
  const edit = changes => {
    const result = ctx.dispatcher.apply(changes)
    if (!result.ok) log(result.message, 'error')
    return result
  }
  const grid = createLauncherGrid(ctx.document, {
    quantiseNames: QUANTISE_NAMES,
    menu: ctx.menu,
    onLaunch: guarded(clipId => api.launch(clipId)),
    onScene: guarded(scene => api.launchScene(scene)),
    onStopTrack: guarded(trackId => api.stop(trackId)),
    onStopAll: guarded(() => api.stop(null)),
    onQuantise: name => api.setQuantise(name),
    // An empty cell gets an empty clip one bar long; the piano roll opens on it, as a new clip on the timeline does.
    onAdd: (trackId, scene) => {
      const result = edit([{ op: 'addClip', track: trackId, kind: 'midi', startBeat: 0, lengthBeats: bpb(), scene }])
      if (result.ok) api.edit(result.results[0])
    },
    onEdit: clipId => api.edit(clipId),
    onRemove: clipId => edit([{ op: 'removeClip', id: clipId }])
  })

  function draw () {
    if (!ctx.dispatcher) return
    const tracks = project().orderedTracks.filter(t => t.midiInput).map(t => ({ id: t.id, label: ctx.rack.trackLabel(t, project().tracks.indexOf(t)) }))
    const slots = project().launcherClips
    const beat = ctx.transport.playing() ? ctx.transport.position().beat : 0
    const cells = new Map(slots.map(c => [`${c.track}|${c.scene}`, { clipId: c.id, state: state.stateOf(c.id, beat) }]))
    grid.draw({ tracks, scenes: Math.max(0, ...slots.map(c => c.scene)) + 2, cells, quantise: project().transport.launchQuantise })
  }

  const api = {
    /** A slot's notes, in the piano roll on the Arrangement tab. */
    edit: clipId => {
      ctx.tabs.select('arrangement')
      ctx.selection.set('clip', [clipId])
      ctx.dock.update()
    },
    state,
    launch: async clipId => launchClips([slotClip(clipId)]),
    launchSlot: async (trackId, scene) => {
      const clip = project().launcherClips.find(c => c.track === trackId && c.scene === scene && c.kind === 'midi')
      if (!clip) throw new Error(`no MIDI clip in scene ${scene} on that track`)
      return launchClips([clip])
    },
    launchScene: async scene => {
      const clips = project().launcherClips.filter(c => c.scene === scene && c.kind === 'midi')
      if (clips.length === 0) throw new Error(`no MIDI clip in scene ${scene}`)
      return launchClips(clips)
    },
    stop: trackId => {
      sync()
      if (!ctx.transport.playing()) { state.clear(); return null }
      if (trackId === null) return state.stopAll(nowBeat(), bpb())
      if (!project().track(trackId)) throw new Error(`no track ${trackId}`)
      return state.stopTrack(trackId, nowBeat(), bpb())
    },
    // Kept on the transport, so a reopened piece launches as it did, and one undo step like any edit to it.
    setQuantise: name => {
      const result = edit([{ op: 'setTransport', launchQuantise: name }])
      if (!result.ok) throw new Error(result.message)
    },
    quantise: () => project().transport.launchQuantise,
    /** Every slot: its scene, track and state now. */
    slots: () => {
      const beat = ctx.transport.playing() ? ctx.transport.position().beat : 0
      return project().launcherClips.map(c => ({ clipId: c.id, track: c.track, scene: c.scene, state: state.stateOf(c.id, beat) }))
    },
    /** Draw the grid from the project and the state now. */
    draw: () => draw(),
    /** Put the Launcher tab's grid on the page, and keep its states current while the transport runs. */
    mount () {
      ctx.$('launcher-mount').append(grid.element)
      state.subscribe(() => draw())
      // A slot goes from queued to playing with the clock, not with an edit, so the states are read again while playing.
      setInterval(() => { if (ctx.transport.playing()) { state.prune(ctx.transport.position().beat); draw() } }, 250)
    },
    /** Called by the transport on stop and by a session opening: nothing is playing, so nothing is waiting. */
    reset: () => state.clear()
  }
  return api
}
