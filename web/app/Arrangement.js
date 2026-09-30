// web/app/Arrangement.js
//
// The arrangement: a lane of clips per track, the notes of the clip open in
// the piano roll, and audio files a person brings in. Every edit is a request
// to the dispatcher; the drawing follows from what the project then says, on
// the next 'changed'.
import { createTimeline } from '../../src/ui/Timeline.js'
import { createPianoRoll } from '../../src/ui/PianoRoll.js'
import { preserveFocus } from '../../src/ui/Focus.js'
import { mixable } from '../../src/ui/Mixer.js'
import { describeChain } from '../../src/ui/ChainModel.js'
import { describeRouting } from '../../src/ui/SendsModel.js'

export function createArrangement (ctx) {
  const { document, $, log } = ctx

  const edit = changes => {
    const result = ctx.dispatcher.apply(changes)
    if (!result.ok) log(result.message, 'error')
    return result
  }

  // Where the next imported audio file goes, while the file picker is open.
  let pendingAudio = null
  // Sources already asked to load for drawing, so a redraw asks once.
  const waveformsRequested = new Set()

  const timeline = createTimeline(document, {
    onAdd: (trackId, startBeat) => {
      const result = edit([{ op: 'addClip', track: trackId, kind: 'midi', startBeat, lengthBeats: ctx.dispatcher.project.transport.beatsPerBar }])
      if (result.ok) openClip(result.results[0])
    },
    onAddAudio: (trackId, startBeat) => {
      pendingAudio = { trackId, startBeat }
      $('audiofile').click()
    },
    onMove: (id, startBeat) => edit([{ op: 'setClip', id, startBeat }]),
    onResize: (id, lengthBeats) => edit([{ op: 'setClip', id, lengthBeats }]),
    // The timeline has already selected it; the dock shows what that calls for.
    onOpen: id => openClip(id),
    onSetLoop: range => ctx.transport.setLoopRange(range),
    onArm: (trackId, on) => { ctx.midiIn.arm(trackId, on); ctx.rack.draw() },
    // Order is layout, not an edit: no revision, no undo, and the editor graph tells the page.
    onMoveTrack: (trackId, delta) => ctx.dispatcher.project.moveTrack(trackId, delta),
    onChannel: (trackId, change) => {
      const result = ctx.dispatcher.setTrackChannel(trackId, change)
      if (!result.ok) log(result.message, 'error')
    },
    onRemove: id => {
      if (pianoRoll.clipId === id) pianoRoll.hide()
      edit([{ op: 'removeClip', id }])
    }
  }, { selection: ctx.selection })

  /**
   * Sound a note through the open clip's track, as it is placed or chosen: a
   * quarter of a second, at the stream position the clock has reached. Into
   * the track's MIDI input, where the clip itself plays, and into nothing on a
   * track without one, which is also what the clip would do.
   */
  function audition (pitch, velocity) {
    const { dispatcher, engine } = ctx
    const clip = dispatcher?.project.clip(pianoRoll.clipId)
    const nodeId = clip && dispatcher.project.track(clip.track)?.midiInput
    if (!nodeId || !engine) return
    const { currentTime, sampleRate } = engine.context
    const frame = Math.round(currentTime * sampleRate)
    dispatcher.sendEvents(nodeId, [
      { frame, bytes: Uint8Array.from([0x90, pitch, velocity]) },
      { frame: frame + Math.round(0.25 * sampleRate), bytes: Uint8Array.from([0x80, pitch, 0]) }
    ])
  }

  const pianoRoll = createPianoRoll(document, {
    // A note drawn past the clip's end brings the clip's new length with it,
    // and both go as one edit, so one undo takes back both.
    onChange: (id, notes, { lengthBeats } = {}) => edit([
      ...(lengthBeats === undefined ? [] : [{ op: 'setClip', id, lengthBeats }]),
      { op: 'setClipNotes', id, notes }
    ]),
    onAudition: audition,
    onClose: () => {
      const id = pianoRoll.clipId
      pianoRoll.hide()
      ctx.selection.clear()
      ctx.dock.update()
      document.getElementById(`clip-${id}`)?.focus()
    }
  })

  /** Select a clip and let the dock show it. */
  function openClip (id) {
    ctx.selection.set('clip', [id])
    ctx.dock.update()
  }

  /** A clip's notes, in the piano roll, for a person to edit. */
  function showInRoll (id) {
    const { project } = ctx.dispatcher
    const clip = project.clip(id)
    if (!clip || clip.kind !== 'midi') return
    const track = project.tracks.find(t => t.id === clip.track)
    pianoRoll.show(clip, { beatsPerBar: project.transport.beatsPerBar, label: ctx.rack.trackLabel(track, project.tracks.indexOf(track)) })
  }

  /**
   * The timeline, and the piano roll if a clip is open in it. Redrawn on every
   * change like the rack, with the focus put back on the same clip; the piano
   * roll keeps its own cursor and focus across a redraw.
   */
  function draw (tracks, labelOfTrack) {
    const project = ctx.dispatcher?.project
    const { clipPlayer } = ctx
    const restore = preserveFocus(timeline.element)
    const nodes = project?.nodes ?? []
    const latencies = new Map((ctx.dispatcher?.trackLatencies() ?? []).map(l => [l.trackId, l]))
    const sampleRate = ctx.engine?.context.sampleRate ?? null
    const silent = new Map((ctx.dispatcher?.audibility() ?? []).map(a => [a.trackId, a.silent]))
    timeline.draw({
      tracks,
      // The same two questions the Mixer tab asks, so a strip there and a
      // header here agree on which tracks have anything to hear.
      mixable: track => mixable(track, nodes, id => ctx.dispatcher.engineNode(id)?.profile?.audioOutputs),
      silent: track => silent.get(track.id) === true,
      clips: project?.clips ?? [],
      beatsPerBar: project?.transport.beatsPerBar ?? 4,
      // What to do first, as buttons over the requests the page already makes.
      empty: {
        text: 'No tracks yet. Start from a preset, or load one plugin.',
        actions: [
          { label: 'Browse plugins', run: () => ctx.layout.showBrowser(true) },
          { label: 'Open the Chiptune preset', run: () => ctx.sessions.openPreset('Chiptune') },
          { label: 'Load the Pulse synth', run: () => ctx.loading.loadPlugin(new URL('plugins/pulse/', document.baseURI).href).catch(() => {}) }
        ]
      },
      layoutFor: track => project.trackLayout(track.id),
      chainFor: track => describeChain(project, track.id, {
        profileOf: id => ctx.dispatcher.engineNode(id)?.profile,
        labelOf: id => { const n = project.node(id); return n?.label ?? ctx.dispatcher.engineNode(id)?.profile?.label ?? id },
        failedOf: id => ctx.dispatcher.engineNode(id)?.failed ?? null,
        trackLabelOf: id => ctx.rack.trackLabel(project.track(id), project.tracks.indexOf(project.track(id)))
      }),
      routingFor: track => describeRouting(project, track.id, id => ctx.rack.trackLabel(project.track(id), project.tracks.indexOf(project.track(id)))),
      canArm: track => Boolean(track.midiInput),
      armed: track => ctx.midiIn.armed(track.id),
      latencyFor: track => {
        const found = latencies.get(track.id)
        return found === undefined ? null : { frames: found.frames, alignFrames: found.alignFrames, rate: sampleRate }
      },
      loop: project ? { start: project.transport.loopStart, end: project.transport.loopEnd, enabled: project.transport.loopEnabled } : null,
      labelFor: labelOfTrack,
      playsIntoNothing: track => !track.midiInput,
      peaksFor: (clip, count) => {
        if (!clipPlayer) return null
        const peaks = clipPlayer.peaks(clip.source, count)
        if (!peaks && !waveformsRequested.has(clip.source)) {
          waveformsRequested.add(clip.source)
          // Asked once, so a file that will not load does not ask again on
          // every redraw. Drawn again either way: with its waveform, or saying
          // it cannot play.
          clipPlayer.load(clip.source).then(() => ctx.rack.draw())
        }
        return peaks
      },
      unplayable: clip => clipPlayer?.failure(clip.source)?.message ?? null
    })
    restore()
    if (pianoRoll.clipId) {
      const clip = project?.clip(pianoRoll.clipId)
      if (clip) pianoRoll.draw(clip)
      else pianoRoll.hide()
    }
    // A clip or track that has gone leaves the selection, and the dock follows.
    ctx.selection.prune((kind, id) => (kind === 'clip' ? project?.clip(id) : kind === 'node' ? project?.node(id) : project?.track(id)) != null)
    ctx.dock.update()
  }

  /**
   * Take an audio file a person chose into the session: kept under the
   * session's IRI by its SHA-256, so the same file imported twice is one file,
   * decoded to learn its length, and placed as a clip that long.
   */
  async function importAudio (file, { trackId, startBeat }) {
    await ctx.runtime.ensureRunning()
    if (!file.type.startsWith('audio/')) { log(`${file.name} is not an audio file`, 'error'); return }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const hex = [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
    const extension = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'audio').toLowerCase()
    const iri = ctx.media.iriFor(hex, extension)
    ctx.media.put(iri, bytes, file.type)
    const buffer = await ctx.clipPlayer.load(iri)
    if (!buffer) { log(`${file.name}: ${ctx.clipPlayer.failure(iri).message}`, 'error'); return }
    const transport = ctx.dispatcher.transport()
    const from = transport.secondsAtBeat(startBeat)
    const lengthBeats = transport.beatAtSeconds(from + buffer.duration) - startBeat
    const result = edit([{ op: 'addClip', track: trackId, kind: 'audio', startBeat, lengthBeats, source: iri, offsetSeconds: 0 }])
    if (result.ok) log(`added ${file.name}, ${buffer.duration.toFixed(2)} seconds`, 'ok')
  }

  /** Wire the file picker and put the timeline and piano roll on the page. */
  function mount () {
    $('audiofile').addEventListener('change', event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      const target = pendingAudio
      pendingAudio = null
      if (!file || !target) return
      importAudio(file, target).catch(error => log(`${file.name}: ${error.message}`, 'error'))
    })
    $('timeline-mount').append(timeline.element)
    ctx.dock.slot('midi').append(pianoRoll.element)
    $('dock-mount').append(ctx.dock.element)
  }

  return {
    draw,
    mount,
    /** Show where the transport is, as a beat, or null when it is stopped. */
    playhead (beat) { timeline.playhead(beat); pianoRoll.playhead(beat) },
    /** Forget what was drawn for the session being replaced. */
    reset () { pianoRoll.hide(); ctx.selection.clear(); waveformsRequested.clear() },
    showInRoll,
    hideRoll: () => pianoRoll.hide(),
    get rollClipId () { return pianoRoll.clipId }
  }
}
