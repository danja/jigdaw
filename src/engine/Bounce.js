// src/engine/Bounce.js
//
// Render a project to audio in the page, faster than it plays, and without disturbing the one that is.
// A second, offline engine is built from a snapshot of the project: the same plugins loaded into an
// OfflineAudioContext, the same dispatcher, the same Scheduler driving the same notes, audio clips,
// envelopes and transport messages. The only difference is the clock: instead of a timer, the context is
// suspended every tick, the scheduler is told what time it is, and rendering resumes. Events are located by
// stream position exactly as they are live, so what comes out is what the page plays.
//
// `onlyTrack` renders one track alone (every other track silenced, the master neutral) for a freeze or a stem;
// without it every track plays through the master and the result is the mix. A plugin that cannot load is left out and reported, as opening a
// session does, rather than failing the render.
//
// What it does not do: foreign (WAM) plugins are not loaded, state restored is the snapshot's, and a chain
// that starts with an effect is not fed the impulse the live page feeds it. Recorded from the live mix
// instead, those would differ.
import { Engine } from './Engine.js'
import { Scheduler, clipNotes, clipAudio } from './Scheduler.js'
import { ClipPlayer } from './ClipPlayer.js'
import { createAutomationHost } from './AutomationHost.js'
import { OpDispatcher } from '../ops/OpDispatcher.js'
import { openProject } from '../ops/OpenProject.js'
import { changesFor } from '../model/Project.js'

const QUANTUM = 128

/** A time in seconds as whole render quanta, which is all an offline context can be suspended at. */
const quantised = (seconds, sampleRate) => Math.round((seconds * sampleRate) / QUANTUM) * QUANTUM / sampleRate

/**
 * The times the render is suspended at: every `step` seconds, on a quantum, after the start and before the end.
 * Pure, so the schedule can be tested without a context.
 */
export function suspendTimes (seconds, tickSeconds, sampleRate) {
  const step = Math.max(QUANTUM / sampleRate, quantised(tickSeconds, sampleRate))
  const times = []
  for (let t = step; t < seconds - QUANTUM / sampleRate; t += step) times.push(quantised(t, sampleRate))
  return [...new Set(times)]
}

/**
 * Returns `{ buffer, seconds, errors }`: the rendered AudioBuffer, its length, and what could not be loaded.
 *
 * - `snapshot`: `project.snapshot()`.
 * - `makeLoader()`: a PluginLoader for the offline engine, built as the live one is.
 * - `fetchBytes(iri)`: the bytes of an audio clip's file.
 * - `hostConfig`: `{ schedulerLookaheadMs, schedulerTickMs, maxTrackDelayMs }`, from web/host.json.
 * - `seconds`: how long to render. `onlyTrack`: a track id, or nothing for the mix.
 * - `OfflineContext` and `AudioWorkletNode`: the classes to render with, the page's own by default.
 */
export async function bounce ({
  snapshot, makeLoader, fetchBytes, hostConfig, seconds, sampleRate = 48000, onlyTrack = null,
  alignTracks = true, OfflineContext = globalThis.OfflineAudioContext, AudioWorkletNode = globalThis.AudioWorkletNode, onProgress = () => {}
}) {
  if (!(seconds > 0)) throw new Error('a bounce needs a length above zero')
  if (typeof OfflineContext !== 'function') throw new Error('this browser has no OfflineAudioContext to render with')
  for (const key of ['schedulerLookaheadMs', 'schedulerTickMs', 'maxTrackDelayMs']) {
    if (!(hostConfig?.[key] > 0)) throw new Error(`a bounce needs ${key} from the host configuration`)
  }
  if (onlyTrack !== null && !snapshot.tracks.some(t => t.id === onlyTrack)) throw new Error(`no such track: ${onlyTrack}`)

  const frames = Math.ceil(seconds * sampleRate / QUANTUM) * QUANTUM
  const context = new OfflineContext({ numberOfChannels: 2, length: frames, sampleRate })
  const engine = new Engine({ context, loader: makeLoader(), AudioWorkletNode, maxTrackDelaySeconds: hostConfig.maxTrackDelayMs / 1000 })
  const dispatcher = new OpDispatcher({ engine, alignTracks })

  const opened = await openProject(dispatcher, { changes: changesFor(snapshot) })
  if (!opened.ok) throw new Error(`the project could not be opened for rendering: ${opened.errors.join('; ')}`)

  if (onlyTrack !== null) {
    // Others silenced, this one heard whatever its own mute says: a freeze of a muted track is still its sound.
    // The master is made neutral and its envelopes dropped: the frozen audio goes through the live master again,
    // so what the master does to it must not be baked in as well.
    const edits = [
      ...dispatcher.project.tracks.map(t => ({ op: 'setTrackChannel', track: t.id, muted: t.id !== onlyTrack ? true : false })),
      { op: 'setMaster', gain: 1, pan: 0, muted: false },
      ...dispatcher.project.envelopes.filter(e => e.target.kind === 'masterGain' || e.target.kind === 'masterPan').map(e => ({ op: 'removeEnvelope', id: e.id }))
    ]
    const done = dispatcher.apply(edits)
    if (!done.ok) throw new Error(done.message)
  }

  const clipPlayer = new ClipPlayer({ context, fetchBytes })
  const sources = [...new Set(clipAudio(dispatcher.project).map(c => c.source))]
  await Promise.all(sources.map(iri => clipPlayer.load(iri)))
  const errors = [...opened.errors, ...sources.filter(iri => clipPlayer.failure(iri)).map(iri => `audio ${iri}: ${clipPlayer.failure(iri).message}`)]

  const playAudioClip = (clip, { when, offset, duration }) => {
    const track = dispatcher.project.track(clip.track)
    if (!track) return
    const destination = track.audioInput ? dispatcher.engineNode(track.audioInput)?.node : engine.trackInput(track.id)
    if (!destination) return
    const timing = dispatcher.transport()
    const fadeIn = clip.fadeInBeats > 0 ? timing.secondsAtBeat(clip.on + clip.fadeInBeats) - timing.secondsAtBeat(clip.on) : 0
    const fadeOut = clip.fadeOutBeats > 0 ? timing.secondsAtBeat(clip.off) - timing.secondsAtBeat(clip.off - clip.fadeOutBeats) : 0
    clipPlayer.start({ iri: clip.source, when, offset, duration, destination, fadeIn, fadeOut })
  }

  const automation = createAutomationHost({ dispatcher, engine, log: message => errors.push(message) })
  const scheduler = new Scheduler({
    now: () => context.currentTime,
    sampleRate,
    lookahead: hostConfig.schedulerLookaheadMs / 1000,
    notes: () => clipNotes(dispatcher.project),
    transport: () => dispatcher.transport(),
    send: (nodeId, events) => dispatcher.sendEvents(nodeId, events),
    audio: () => clipAudio(dispatcher.project),
    playAudio: playAudioClip,
    stopAudio: () => clipPlayer.stopAll(),
    automation
  })

  const tick = time => {
    dispatcher.sendTransport(Math.round(time * sampleRate), { frame: Math.round(time * sampleRate), playing: true })
    scheduler.tick()
  }
  scheduler.start(0)
  tick(0)
  const times = suspendTimes(frames / sampleRate, hostConfig.schedulerTickMs / 1000, sampleRate)
  for (const time of times) {
    context.suspend(time).then(() => {
      tick(time)
      onProgress(time / (frames / sampleRate))
      context.resume()
    })
  }
  const buffer = await context.startRendering()
  return { buffer, seconds: frames / sampleRate, errors }
}

/**
 * How long a render should be, in seconds: the longer of the loop (when it is on), the last clip and four bars,
 * to a whole bar, with a tail for reverbs and delays to ring out.
 */
export function bounceSeconds (project, transport, { tailSeconds = 2, minimumBars = 4 } = {}) {
  const beatsPerBar = project.transport.beatsPerBar
  const loop = project.transport.loopEnabled ? project.transport.loopEnd : 0
  const lastClip = Math.max(0, ...project.clips.map(c => c.startBeat + c.lengthBeats))
  const beats = Math.max(loop, lastClip, minimumBars * beatsPerBar)
  return transport.secondsAtBeat(Math.ceil(beats / beatsPerBar) * beatsPerBar) + tailSeconds
}
