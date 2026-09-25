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
    ctx.clipPlayer.start({ iri: clip.source, when, offset, duration, destination })
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
    log('playing', 'ok')
  }

  function stop () {
    playing = false
    // Before all-notes-off, so the notes it started get their own ends too.
    clearInterval(schedulerTimer)
    schedulerTimer = null
    scheduler?.stop()
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
   * Show the project's tempo in the tempo field, whoever changed it: this
   * field, undo, a session opening or an agent. Left alone while a person is
   * typing in it, so the field does not change under their cursor.
   */
  function showTempo () {
    const bpm = ctx.dispatcher?.project.transport.tempoPoints[0]?.bpm
    const field = $('tempo')
    if (bpm && document.activeElement !== field) field.value = String(bpm)
  }

  return { play, stop, positionLoop, meterLoop, showTempo }
}
