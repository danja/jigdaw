// web/app/Bounce.js
//
// Rendering the project to audio inside the page (src/engine/Bounce.js), and what that is used for:
// Export WAV (the mix) and Freeze track (one track as heard, kept as an audio clip on a new track while the
// original is muted, not removed). The render is an offline engine of its own, so playing is not disturbed
// and a long project takes less time than it lasts.
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { parseText } from '../../src/rdf/parse.js'
import { bounce, bounceSeconds } from '../../src/engine/Bounce.js'
import { encodeWav } from '../../src/host/Wav.js'
import { writeZip } from '../../src/host/Zip.js'

// How long reverbs and delays are given to ring out past the end of what is rendered.
const TAIL_SECONDS = 2

async function sha256hex (bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function createBounce (ctx, { download = defaultDownload, bounceFn = bounce } = {}) {
  const { log } = ctx
  let busy = false
  let stemming = false

  /** The loop, when it is on, as the part of the project to render; otherwise null for the whole of it. */
  function loopRange (project) {
    const t = project.transport
    return t.loopEnabled && t.loopEnd > t.loopStart ? { fromBeat: t.loopStart, toBeat: t.loopEnd } : null
  }

  /** A buffer's samples from `seconds` on, in the shape the encoder reads. */
  function from (buffer, seconds) {
    const start = Math.min(buffer.length, Math.round(seconds * buffer.sampleRate))
    return {
      sampleRate: buffer.sampleRate,
      length: buffer.length - start,
      getChannelData: channel => buffer.getChannelData(channel).subarray(start)
    }
  }

  /**
   * Render the mix, or one track, as an AudioBuffer plus how long it is. `range` is `{ fromBeat, toBeat }`: the
   * render still starts at beat zero, so everything is in the state it would be in playing, and what comes
   * before `fromBeat` is dropped from the result, with a tail after `toBeat` kept.
   */
  async function render ({ onlyTrack = null, announce = true, range = null } = {}) {
    if (busy) throw new Error('a render is already running')
    busy = true
    try {
      const d = await ctx.runtime.ensureRunning()
      const validator = await ctx.runtime.shapeValidator()
      const timing = d.transport()
      const seconds = range ? timing.secondsAtBeat(range.toBeat) + TAIL_SECONDS : bounceSeconds(d.project, timing, { tailSeconds: TAIL_SECONDS })
      let said = -1
      if (announce) log(`rendering ${seconds.toFixed(1)} seconds`)
      const result = await bounceFn({
        snapshot: d.project.snapshot(),
        makeLoader: () => new PluginLoader({ parse: parseText, validator, capabilities: ctx.hostCapabilities }),
        fetchBytes: iri => ctx.media.fetchBytes(iri),
        hostConfig: ctx.hostConfig,
        seconds,
        sampleRate: ctx.engine.context.sampleRate,
        onlyTrack,
        alignTracks: d.alignTracks ?? true,
        onProgress: ratio => {
          const percent = Math.floor(ratio * 10) * 10
          if (announce && percent !== said && percent > 0) { said = percent; log(`rendering ${percent}%`) }
        }
      })
      for (const error of result.errors) log(`render: ${error}`, 'error')
      if (!range) return result
      const start = timing.secondsAtBeat(range.fromBeat)
      return { ...result, buffer: from(result.buffer, start), seconds: result.seconds - start }
    } finally {
      busy = false
    }
  }

  const wavOf = buffer => encodeWav([buffer.getChannelData(0), buffer.getChannelData(1)], buffer.sampleRate)

  const baseName = () => (ctx.dispatcher.project.label ?? 'jiggy').replace(/[^\w.-]+/g, '-')

  /** The mix as a WAV file, handed to the person: the loop when the loop is on, otherwise the whole project. */
  async function exportWav () {
    await ctx.runtime.ensureRunning()
    const range = loopRange(ctx.dispatcher.project)
    if (range) log('the loop is on, so the loop is what is rendered')
    const { buffer } = await render({ range })
    const bytes = wavOf(buffer)
    const name = `${baseName()}${range ? '-loop' : ''}.wav`
    download(bytes, name, 'audio/wav')
    log(`exported ${name}, ${(buffer.length / buffer.sampleRate).toFixed(1)} seconds, ${(bytes.byteLength / 1048576).toFixed(1)} MB`, 'ok')
    return { bytes, name }
  }

  /**
   * Every track that makes sound, rendered alone, as one WAV each in a zip: the tracks as they leave their faders,
   * the master not applied, so the stems can be mixed again elsewhere. A track that is silent is left out.
   */
  async function exportStems () {
    if (stemming || busy) throw new Error('a render is already running')
    stemming = true
    try {
      const d = await ctx.runtime.ensureRunning()
      const range = loopRange(d.project)
      const makers = d.project.tracks.filter(track => d.project.nodes.some(n => n.track === track.id && (d.engineNode(n.id)?.profile?.audioOutputs ?? 0) > 0) ||
        d.project.clips.some(c => c.track === track.id && c.kind === 'audio'))
      if (makers.length === 0) throw new Error('no track makes sound, so there are no stems')
      const entries = []
      for (const [index, track] of makers.entries()) {
        const label = ctx.rack.trackLabel(track, d.project.tracks.indexOf(track))
        log(`stem ${index + 1} of ${makers.length}: ${label}`)
        const { buffer } = await render({ onlyTrack: track.id, announce: false, range })
        const peak = Math.max(...[0, 1].map(c => buffer.getChannelData(c).reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
        if (peak < 1e-5) { log(`${label} made no sound, so it is left out`); continue }
        entries.push({ name: `${String(entries.length + 1).padStart(2, '0')}-${label.replace(/[^\w.-]+/g, '-')}.wav`, bytes: wavOf(buffer) })
      }
      if (entries.length === 0) throw new Error('no track made any sound, so there are no stems')
      const zip = writeZip(entries)
      const name = `${baseName()}-stems.zip`
      download(zip, name, 'application/zip')
      log(`exported ${name}, ${entries.length} stem${entries.length === 1 ? '' : 's'}, ${(zip.byteLength / 1048576).toFixed(1)} MB`, 'ok')
      return { name, entries: entries.map(e => e.name) }
    } finally {
      stemming = false
    }
  }

  /**
   * One track as heard, through its own chain and fader, as an audio clip on a new track from beat zero. The
   * original is muted and kept, so Undo brings everything back and nothing is lost. The master is not baked in.
   */
  async function freezeTrack (trackId) {
    const d = await ctx.runtime.ensureRunning()
    const track = d.project.track(trackId)
    if (!track) throw new Error(`no such track: ${trackId}`)
    const label = ctx.rack.trackLabel(track, d.project.tracks.indexOf(track))
    const { buffer, seconds } = await render({ onlyTrack: trackId })
    const peak = Math.max(...[0, 1].map(c => buffer.getChannelData(c).reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
    if (peak < 1e-5) {
      log(`${label} made no sound, so nothing was frozen`, 'error')
      return null
    }
    const bytes = wavOf(buffer)
    const iri = ctx.media.iriFor(await sha256hex(bytes), 'wav')
    ctx.media.put(iri, bytes, 'audio/wav')
    const frozen = d.project.nextId('track')
    const lengthBeats = d.transport().beatAtSeconds(seconds)
    const result = d.apply([
      { op: 'addTrack', id: frozen, label: `${label} (frozen)` },
      { op: 'addClip', track: frozen, kind: 'audio', startBeat: 0, lengthBeats, source: iri, offsetSeconds: 0 },
      { op: 'setTrackChannel', track: trackId, muted: true }
    ])
    if (!result.ok) throw new Error(result.message)
    log(`froze ${label} into "${label} (frozen)"; the original is muted, not removed. Undo brings it back`, 'ok')
    return { frozen, iri, seconds }
  }

  return { render, exportWav, exportStems, freezeTrack, get busy () { return busy || stemming } }
}

/** Hand bytes to the person as a file, the way a link with a download name does. */
function defaultDownload (bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
