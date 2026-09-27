// web/app/Record.js
//
// Record: play the session and keep what each track sounded like, as new
// audio clips. Press Rec and the transport plays with every track captured
// after its strip; press Stop (or Rec again) and each track's take lands as
// an audio clip where it was recorded. Remove every plugin afterwards and
// press Play: the clips play into the bare faders, and the mix is what was
// heard.
//
// A take is linear audio stored like any imported file: WAV bytes under the
// session's IRI by SHA-256, referred to by the clip and carried by the zip on
// save, so nothing about persistence is new. What is new is the capture:
// per-track AudioWorklet sinks on a buffer pool (src/engine/TrackRecorder.js)
// rather than a second render, because a second render is not what was heard.
import { TrackRecorder } from '../../src/engine/TrackRecorder.js'

/** SHA-256 over bytes, as lowercase hex. The subtle API both sides have. */
async function sha256hex (bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function createRecord (ctx, { processorUrl = null, WorkletNode = globalThis.AudioWorkletNode } = {}) {
  const { document, $, log } = ctx
  const resolvedUrl = processorUrl ?? new URL('src/engine/capture-processor.js', document.baseURI).href
  let recorder = null
  let recording = null

  function show (active) {
    const button = $('record')
    button.setAttribute('aria-pressed', String(active))
    button.textContent = active ? 'Stop take' : 'Rec'
  }

  function isRecording () { return recording !== null }

  /**
   * Start a take, starting the transport first if it is stopped. A second
   * press finishes the take and leaves the transport playing: punching out
   * without stopping the music.
   */
  async function toggle () {
    if (isRecording()) {
      await finishTake()
      return
    }
    await ctx.runtime.ensureRunning()
    const { dispatcher, engine } = ctx
    const trackIds = engine.trackIds()
    if (trackIds.length === 0) {
      log('nothing to record: there are no tracks', 'error')
      return
    }
    recorder ??= new TrackRecorder({ engine, context: engine.context, processorUrl: resolvedUrl, WorkletNode })
    const started = ctx.transport.playing()
    if (!started) await ctx.transport.play()
    // The beat under the punch, for the clips' placement; their length comes
    // from the captured frames further down, so a tempo change mid-take moves
    // the end by the beat math rather than by the clock.
    const startBeat = ctx.transport.position().beat
    await recorder.start(trackIds)
    recording = { trackIds, startBeat }
    show(true)
    log(started
      ? `recording ${trackIds.length} track(s) from beat ${startBeat.toFixed(2)}`
      : `playing and recording ${trackIds.length} track(s) from the top`)
  }

  /**
   * Stop the capture and keep every track that made a sound as an audio clip,
   * in one atomic changeset so one undo takes the whole pass back out. Safe
   * to call idle: stopping the transport when nothing records is still just
   * stopping.
   */
  async function finishTake () {
    if (!isRecording()) return
    const { trackIds, startBeat } = recording
    recording = null
    show(false)
    const { dispatcher, engine } = ctx
    const { takes, dropped } = await recorder.stop()
    for (const trackId of trackIds) {
      const count = dropped.get(trackId) ?? 0
      if (count > 0) log(`track ${trackId} dropped ${count} quanta while recording`, 'error')
    }
    const transport = dispatcher.transport()
    const sampleRate = engine.context.sampleRate
    const changes = []
    for (const trackId of takes.trackIds()) {
      if (takes.isSilent(trackId)) {
        log(`track ${trackId} was silent: no take kept`)
        continue
      }
      const frames = takes.frames(trackId)
      const bytes = takes.encode(trackId, sampleRate)
      const iri = ctx.media.iriFor(await sha256hex(bytes), 'wav')
      ctx.media.put(iri, bytes, 'audio/wav')
      const buffer = await ctx.clipPlayer.load(iri)
      if (!buffer) {
        log(`take for track ${trackId}: ${ctx.clipPlayer.failure(iri)?.message ?? 'could not be decoded'}`, 'error')
        continue
      }
      const lengthBeats = transport.beatAtSeconds(transport.secondsAtBeat(startBeat) + frames / sampleRate) - startBeat
      changes.push({ op: 'addClip', track: trackId, kind: 'audio', startBeat, lengthBeats, source: iri, offsetSeconds: 0 })
    }
    if (changes.length === 0) {
      log('nothing recorded')
      return
    }
    const result = dispatcher.apply(changes)
    if (result.ok) log(`kept ${changes.length} take(s) from beat ${startBeat.toFixed(2)}`, 'ok')
    else log(`takes could not be placed: ${result.message}`, 'error')
  }

  return { toggle, finishTake, isRecording }
}
