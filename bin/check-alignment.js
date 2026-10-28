// bin/check-alignment.js
//
// Measures that audio clips arrive aligned. The offline render in node has no real audio, so whether the delay that lines
// tracks up (docs/latency.md, "Between tracks") really puts a clip's sound in step with another's has to be heard in a real
// Chrome. Tracks play the same one-sample click from the same beat, some through a Lookahead plugin set to a known latency
// as the track's audio input, and the page's own render (`bounce.render`, which is what Export uses) is read for where the
// clicks land. Two scenarios, each rendered with alignment on and with it off:
//
//   parallel tracks  a track holding 512 frames and a plain one: on, one click 512 frames after the start; off, two
//   through a bus    tracks of 512 and 0 frames into a bus holding 256, and a plain track straight to the master: on, one
//                    click 768 frames after the start; off, three (the plain track at 0, through the bus alone at 256,
//                    and through both at 768)
//
// The "off" render is the positive control: a measure that could not see a misalignment would pass "on" for nothing.
//
//   npm run check:alignment   exit 0 aligned, 1 not aligned or the page failed, 3 Chrome is not available
import { withChrome } from './chrome-session.js'
import { isMain } from './is-main.js'

export const LATENCY_FRAMES = 512
export const BUS_FRAMES = 256

// Run inside the page once the audio runtime is up. Returns where each render put the clicks, as frames. `build` is the
// scenario's own part: it makes the tracks and puts a click clip on each that should sound.
const measure = build => `(async () => {
  const j = window.__jigdaw, d = j.dispatcher
  const n = 4800, bytes = new Uint8Array(44 + n * 2), v = new DataView(bytes.buffer)
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, 1, true); v.setUint32(24, 48000, true); v.setUint32(28, 96000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, n * 2, true); v.setInt16(44, 16384, true)
  const source = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...bytes))
  const must = (what, r) => { if (!r.ok) throw new Error(what + ': ' + (r.message ?? 'refused')); return r }
  // A Lookahead on a track, held back by \`frames\`, and made the place the track's clips play into.
  const delayed = async (track, frames) => {
    must('add plugin', await d.addPlugin(location.origin + '/plugins/lookahead/', { track }))
    const id = d.project.nodes.find(n => n.track === track).id
    must('audio input', d.apply([{ op: 'setTrack', id: track, audioInput: id }]))
    must('latency', d.setParameter(id, 'position', frames))
  }
  const clicks = tracks => must('clips', d.apply(tracks.map(track => ({ op: 'addClip', track, kind: 'audio', startBeat: 1, lengthBeats: 1, source, offsetSeconds: 0 }))))
  ${build}
  const rate = j.engine.context.sampleRate
  const startFrame = Math.round(d.transport().secondsAtBeat(1) * rate)
  const found = buffer => [0, 1].map(c => { const x = buffer.getChannelData(c), at = []; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.01) at.push(i); return at })
  const out = { startFrame, rate }
  for (const on of [true, false]) {
    d.setAlignTracks(on)
    const { buffer, errors } = await j.bounce.render({ announce: false })
    out[on ? 'aligned' : 'unaligned'] = { clicks: found(buffer), errors }
  }
  return out
})()`

// Two scenarios, each in a fresh page so one cannot leave anything for the other.
export const SCENARIOS = Object.freeze([
  {
    name: 'parallel tracks',
    // Track 1 is held back 512 frames and a plain track is not.
    build: `must('add track', d.apply([{ op: 'addTrack', id: 'plain' }])); await delayed('track-1', ${LATENCY_FRAMES}); clicks(['track-1', 'plain'])`,
    // Without alignment: the plain track on time, the other late by what it holds.
    offsets: { aligned: [LATENCY_FRAMES], unaligned: [0, LATENCY_FRAMES] }
  },
  {
    name: 'through a bus',
    // Tracks a (512 frames) and b (none) feed a bus holding 256 frames, and d (none) goes straight to the master. What
    // comes out of the bus is as late as a plus the bus, and b and d are held back to meet it (docs/latency.md).
    build: `must('tracks', d.apply(['b', 'bus', 'd'].map(id => ({ op: 'addTrack', id }))))
      await delayed('track-1', ${LATENCY_FRAMES}); await delayed('bus', ${BUS_FRAMES})
      must('routing', d.apply([{ op: 'setTrack', id: 'track-1', output: 'bus' }, { op: 'setTrack', id: 'b', output: 'bus' }]))
      clicks(['track-1', 'b', 'd'])`,
    offsets: { aligned: [LATENCY_FRAMES + BUS_FRAMES], unaligned: [0, BUS_FRAMES, LATENCY_FRAMES + BUS_FRAMES] }
  }
])

/**
 * What the two renders of one scenario must show, as lines and whether it held: with alignment on every click at the one
 * frame, and with it off the clicks at the offsets the scenario gives, which is the control. Pure, so it can be tested
 * without a browser. `offsets` are frames after `startFrame`.
 */
export function judge ({ startFrame, aligned, unaligned }, offsets = SCENARIOS[0].offsets) {
  const lines = []
  let failed = false
  const say = (ok, text) => { if (!ok) failed = true; lines.push(`${ok ? 'ok  ' : 'FAIL'} ${text}`) }
  for (const [name, r] of [['aligned', aligned], ['unaligned', unaligned]]) say(r.errors.length === 0, `${name} render had no errors${r.errors.length ? `: ${r.errors.join('; ')}` : ''}`)
  say(unaligned.clicks[0].join() === unaligned.clicks[1].join(), 'the control render is the same in both channels')
  const wanted = offsets.unaligned.map(o => startFrame + o)
  say(unaligned.clicks[0].join() === wanted.join(), `alignment off: clicks at ${wanted.join(', ')} (the control; found ${unaligned.clicks[0].join(', ') || 'none'})`)
  const meet = startFrame + offsets.aligned[0]
  for (const [channel, found] of aligned.clicks.entries()) {
    say(found.length === 1 && found[0] === meet, `alignment on, channel ${channel}: one click at ${meet} (found ${found.join(', ') || 'none'})`)
  }
  return { code: failed ? 1 : 0, lines }
}

export async function checkAlignment () {
  return withChrome(async ({ base, send, session, evaluate }) => {
    const lines = []
    let code = 0
    for (const scenario of SCENARIOS) {
      await send('Page.navigate', { url: `${base}/?studio` }, session)
      // The audio runtime starts on a click, as for a person: the Add track button, found by its words.
      await new Promise(done => setTimeout(done, 3500))
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add track').click()`, { gesture: true })
      const ready = await evaluate(`new Promise(done => { const t = setInterval(() => { if (window.__jigdaw?.dispatcher) { clearInterval(t); done(true) } }, 100); setTimeout(() => { clearInterval(t); done(false) }, 15000) })`)
      if (!ready) return { code: 1, lines: [...lines, `${scenario.name}: the audio runtime did not start, so nothing was measured`] }
      const verdict = judge(await evaluate(measure(scenario.build)), scenario.offsets)
      lines.push(`${scenario.name}:`, ...verdict.lines.map(l => `  ${l}`))
      code = Math.max(code, verdict.code)
    }
    return { code, lines }
  }, { flags: ['--autoplay-policy=no-user-gesture-required'] })
}

if (isMain(import.meta.url)) {
  const { code, lines } = await checkAlignment()
  for (const l of lines) console.log(l)
  process.exit(code)
}
