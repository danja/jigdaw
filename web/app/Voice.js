// web/app/Voice.js
//
// One-button recording of the microphone, for the simple page. A muted
// "Microphone" track carries the live stream so it is not heard in the
// speakers, and is recorded before its fader (so its mute does not silence the
// take). When the take ends the carrier track is removed and the sound is
// kept as a new track, "Recording N", holding one audio clip, in one changeset.
import { TrackRecorder } from '../../src/engine/TrackRecorder.js'
import { openMicrophone } from '../../src/host/Microphone.js'

async function sha256hex (bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * `getUserMedia` is injected so a check from outside the page can hand in a
 * stream made by the page itself, and a test can refuse the way the browser does.
 */
export function createVoice (ctx, { getUserMedia, processorUrl = null, WorkletNode = globalThis.AudioWorkletNode, onState = () => {} }) {
  const { document, log } = ctx
  const resolvedUrl = processorUrl ?? new URL('src/engine/capture-processor.js', document.baseURI).href
  let recorder = null
  let live = null

  const recording = () => live !== null

  async function start () {
    if (live) return
    await ctx.runtime.ensureRunning()
    const { dispatcher, engine } = ctx
    // Asked for before anything is changed: a refusal leaves the piece as it was.
    const stream = await openMicrophone(getUserMedia)
    const carrier = dispatcher.project.nextId('track')
    try {
      const added = dispatcher.apply([{ op: 'addTrack', id: carrier, label: 'Microphone', channel: { muted: true } }])
      if (!added.ok) throw new Error(added.message)
      engine.openInput(carrier, stream)
      recorder ??= new TrackRecorder({ engine, context: engine.context, processorUrl: resolvedUrl, WorkletNode })
      const wasPlaying = ctx.transport.playing()
      if (!wasPlaying) await ctx.transport.play()
      const startBeat = ctx.transport.position().beat
      await recorder.start([carrier], { pre: [carrier] })
      live = { carrier, startBeat, stream }
    } catch (error) {
      engine.closeInput(carrier)
      stream.getTracks().forEach(t => t.stop())
      if (dispatcher.project.track(carrier)) dispatcher.apply([{ op: 'removeTrack', id: carrier }])
      throw error
    }
    onState(true)
    log('Recording. Press Stop recording when you are done.')
  }

  async function stop () {
    if (!live) return null
    const { carrier, startBeat } = live
    live = null
    onState(false)
    const { dispatcher, engine } = ctx
    const { takes } = await recorder.stop()
    engine.closeInput(carrier)
    const silent = takes.isSilent(carrier)
    let changes = [{ op: 'removeTrack', id: carrier }]
    let made = null
    if (silent) {
      log('Nothing was heard, so nothing was kept. Check the microphone is not muted.', 'error')
    } else {
      const sampleRate = engine.context.sampleRate
      const bytes = takes.encode(carrier, sampleRate)
      const iri = ctx.media.iriFor(await sha256hex(bytes), 'wav')
      ctx.media.put(iri, bytes, 'audio/wav')
      const buffer = await ctx.clipPlayer.load(iri)
      if (!buffer) throw new Error(ctx.clipPlayer.failure(iri)?.message ?? 'the recording could not be decoded')
      const transport = dispatcher.transport()
      const lengthBeats = transport.beatAtSeconds(transport.secondsAtBeat(startBeat) + takes.frames(carrier) / sampleRate) - startBeat
      const count = dispatcher.project.tracks.filter(t => /^Recording \d+$/.test(t.label ?? '')).length + 1
      made = dispatcher.project.nextId('track')
      // Both in one changeset: one undo takes back the pair.
      changes = [
        { op: 'addTrack', id: made, label: `Recording ${count}` },
        { op: 'addClip', track: made, kind: 'audio', startBeat, lengthBeats, source: iri, offsetSeconds: 0 },
        ...changes
      ]
    }
    const result = dispatcher.apply(changes)
    if (!result.ok) throw new Error(result.message)
    if (made) log('Kept your recording as a new track.', 'ok')
    return made
  }

  return { start, stop, recording, toggle: () => (live ? stop() : start()) }
}
