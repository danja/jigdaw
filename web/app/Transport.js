// web/app/Transport.js
//
// Play and Stop, the position readout and the output meter. While the
// transport runs, the scheduler plays the tracks' clips (src/engine/Scheduler.js)
// and every plugin is told where the transport is (contract section 7).
import { Scheduler, clipNotes, clipAudio } from '../../src/engine/Scheduler.js'

/** A repeating impulse, so an effect has something to work on. */
function makeSource (context) {
  const length = Math.floor(context.sampleRate * 2)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const phase = (i / context.sampleRate) % 1
      data[i] = phase < 0.004 ? (Math.random() * 2 - 1) * Math.exp(-phase * 500) : 0
    }
  }
  const node = context.createBufferSource()
  node.buffer = buffer
  node.loop = true
  return node
}

export function createTransport (ctx) {
  const { document, $, log } = ctx
  let playing = false
  let startedAt = 0
  let source = null
  // Plays the tracks' clips while the transport runs, and its timer.
  let scheduler = null
  let schedulerTimer = null
  // The playhead's animation, while the transport runs.
  let playheadFrame = null

  /** Move the playheads to the transport's beat, every frame while it runs. */
  function followPlayhead () {
    if (!playing) return
    const position = ctx.dispatcher.transport().positionAtElapsed(elapsedFrames())
    ctx.arrangement.playhead(position.beat)
    playheadFrame = requestAnimationFrame(followPlayhead)
  }

  /**
   * Start one audio clip, into its track's audio input if it names one and
   * straight into its fader if not (project-format.md "Tracks").
   */
  function playAudioClip (clip, { when, offset, duration }) {
    const track = ctx.dispatcher.project.track(clip.track)
    if (!track) return
    const destination = track.audioInput
      ? ctx.dispatcher.engineNode(track.audioInput)?.node
      : ctx.engine.trackInput(track.id)
    if (!destination) return
    // Fade lengths are beats in the file and seconds at the clock: read off the tempo map at the clip's edges.
    const transport = ctx.dispatcher.transport()
    const fadeIn = clip.fadeInBeats > 0 ? transport.secondsAtBeat(clip.on + clip.fadeInBeats) - transport.secondsAtBeat(clip.on) : 0
    const fadeOut = clip.fadeOutBeats > 0 ? transport.secondsAtBeat(clip.off) - transport.secondsAtBeat(clip.off - clip.fadeOutBeats) : 0
    ctx.clipPlayer.start({ iri: clip.source, when, offset, duration, destination, fadeIn, fadeOut })
  }

  async function play () {
    const d = await ctx.runtime.ensureRunning()
    const { engine, clipPlayer, hostConfig } = ctx
    if (playing) return
    playing = true
    startedAt = engine.context.currentTime
    $('play').setAttribute('aria-pressed', 'true')

    // Only run the impulse source if the chain starts with something that takes
    // audio. An instrument or a MIDI generator makes its own signal, and
    // feeding it impulses is noise, or nothing.
    const first = d.project.nodes[0]
    const startsWithEffect = first && (d.engineNode(first.id)?.profile.audioInputs ?? 0) > 0

    if (startsWithEffect) {
      source = makeSource(engine.context)
      source.start()
      const entry = d.engineNode(first.id)
      if (entry) source.connect(entry.node, 0, 0)
    }

    sendTransport()
    // The clips. Beat zero is heard at startedAt, and the scheduler sends each
    // note that far ahead of the clock, located by stream position.
    scheduler ??= new Scheduler({
      now: () => engine.context.currentTime,
      sampleRate: engine.context.sampleRate,
      lookahead: hostConfig.schedulerLookaheadMs / 1000,
      notes: () => clipNotes(d.project),
      transport: () => d.transport(),
      send: (nodeId, events) => d.sendEvents(nodeId, events),
      audio: () => clipAudio(d.project),
      playAudio: (clip, at) => playAudioClip(clip, at),
      stopAudio: () => clipPlayer.stopAll()
    })
    // Every audio clip's file decoded before the clock starts, so the first
    // pass plays them; one that cannot be had is said once and left silent.
    const sources = [...new Set(clipAudio(d.project).map(c => c.source))]
    await Promise.all(sources.map(iri => clipPlayer.load(iri)))
    const failed = sources.filter(iri => clipPlayer.failure(iri))
    for (const iri of failed) log(`audio clip source ${iri}: ${clipPlayer.failure(iri).message}`, 'error')
    // So each clip that cannot play says so where it is drawn, too.
    if (failed.length > 0) ctx.rack.draw()
    scheduler.start(startedAt)
    scheduler.tick()
    schedulerTimer = setInterval(() => scheduler.tick(), hostConfig.schedulerTickMs)
    followPlayhead()
    log('playing', 'ok')
  }

  function stop () {
    playing = false
    // Before all-notes-off, so the notes it started get their own ends too.
    clearInterval(schedulerTimer)
    schedulerTimer = null
    scheduler?.stop()
    cancelAnimationFrame(playheadFrame)
    ctx.arrangement.playhead(null)
    $('play').setAttribute('aria-pressed', 'false')
    if (source) { try { source.stop() } catch { /* already stopped */ } source.disconnect(); source = null }
    const { engine } = ctx
    for (const entry of engine?.nodes() ?? []) {
      // All notes off, so nothing is left sounding.
      engine.post(entry.id, { type: 'events', events: [{ frame: 0, bytes: Uint8Array.from([0xb0, 123, 0]) }] })
    }
    sendTransport()
    log('stopped')
  }

  function elapsedFrames () {
    const { engine } = ctx
    if (!engine || !playing) return 0
    return Math.max(0, Math.round((engine.context.currentTime - startedAt) * engine.context.sampleRate))
  }
  function sendTransport () {
    const { dispatcher, engine } = ctx
    if (!dispatcher) return
    dispatcher.sendTransport(elapsedFrames(), {
      frame: Math.round((engine?.context.currentTime ?? 0) * (engine?.context.sampleRate ?? 48000)),
      playing
    })
  }

  function positionLoop () {
    const tick = () => {
      if (ctx.dispatcher) {
        const position = ctx.dispatcher.transport().positionAtElapsed(elapsedFrames())
        const bar = Math.floor(position.bar) + 1
        const beat = Math.floor(position.beatInBar) + 1
        $('position').textContent = `${bar} . ${beat}`
        if (playing) sendTransport()
      }
      setTimeout(tick, 100)
    }
    tick()
  }

  function meterLoop () {
    const bars = 12
    const meter = $('meter')
    meter.textContent = ''
    for (let i = 0; i < bars; i++) meter.append(document.createElement('i'))
    const { analyser } = ctx
    const data = new Float32Array(analyser.fftSize)

    const frame = () => {
      analyser.getFloatTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v))
      const lit = Math.round(Math.min(1, peak) * bars)
      meter.querySelectorAll('i').forEach((bar, i) => {
        bar.className = i < lit ? (i >= bars - 2 ? 'hot' : 'on') : ''
      })
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  /**
   * Show the project's tempo, signature and loop in the transport bar, whoever
   * changed them: these controls, undo, a session opening or an agent. A field
   * is left alone while a person is typing in it, so it does not change under
   * their cursor.
   */
  function showTransport () {
    const t = ctx.dispatcher?.project.transport
    if (!t) return
    const bpm = t.tempoPoints[0]?.bpm
    const field = $('tempo')
    if (bpm && field && document.activeElement !== field) field.value = String(bpm)
    // The studio page has these; the simple page has not, and shows only what it has.
    const signature = $('signature')
    if (signature && document.activeElement !== signature) signature.value = `${t.beatsPerBar}/${t.beatUnit}`
    $('loop')?.setAttribute('aria-pressed', String(Boolean(t.loopEnabled)))
  }

  /** Turn the loop on or off. Turning it on with no range sets one: the clips, or four bars. */
  function toggleLoop () {
    const d = ctx.dispatcher
    if (!d) return
    const t = d.project.transport
    const change = { op: 'setTransport', loopEnabled: !t.loopEnabled }
    if (!t.loopEnabled && !(t.loopEnd > t.loopStart)) {
      const last = Math.max(0, ...d.project.clips.map(c => c.startBeat + c.lengthBeats))
      change.loopStart = 0
      change.loopEnd = Math.max(t.beatsPerBar * 4, Math.ceil(last / t.beatsPerBar) * t.beatsPerBar)
    }
    const result = d.apply([change])
    if (!result.ok) log(result.message, 'error')
  }

  /** Read "3/4" and set it; anything else is refused with the reason, and the field goes back. */
  function setSignature (text) {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text)
    if (!m) { log(`a time signature is two whole numbers with a slash, like 3/4: ${text}`, 'error'); showTransport(); return }
    const result = ctx.dispatcher.apply([{ op: 'setTransport', beatsPerBar: Number(m[1]), beatUnit: Number(m[2]) }])
    if (!result.ok) log(result.message, 'error')
    showTransport()
  }

  /** A new loop range from the timeline: set, and turned on. */
  function setLoopRange ({ start, end }) {
    const result = ctx.dispatcher.apply([{ op: 'setTransport', loopStart: start, loopEnd: end, loopEnabled: true }])
    if (!result.ok) log(result.message, 'error')
  }

  return { play, stop, positionLoop, meterLoop, showTransport, toggleLoop, setSignature, setLoopRange, playing: () => playing, position: () => ctx.dispatcher.transport().positionAtElapsed(elapsedFrames()) }
}
