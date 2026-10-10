// examples/songs/glass-hours.js
//
// Glass Hours: a 40 bar piece in D minor for six instrument tracks, a reverb return and a glue compressor on
// the master. It was made by an agent through the WebMCP tools, in the browser, and then balanced by playing it
// and reading the meters; this script is that same work as the model's own operations, so the file it writes is
// what the page held. Run it from the repository root:
//
//   node examples/songs/glass-hours.js [session file [preset file]]
//
// and open examples/songs/glass-hours.ttl in Jiggy with Open. That file names the plugins by their canonical addresses, so
// they must be served there (they are, since 2026-10-10). The same script writes web/presets/glass-hours.ttl, the piece as a
// bundled preset: the plugins are the ones served beside the page, by relative address, and there is no @base, for the reason
// web/presets/amp-into-room.ttl gives.
//
// What is in it: Drums (DrumKit), Bass (Pulse, its filter automated), Pad (Canticle), Pluck (Canticle),
// Bells and lead (Moka), Chip (8-Bit 8asterd, only in the last section), and a Reverb return (Cascade) that the pad,
// pluck, lead and chip send to. The master has Dynamix as its audio input. The tempo holds at 104 and slows over
// the last four bars, and the master fades over the last.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Project } from '../../src/model/Project.js'
import { writeProject } from '../../src/rdf/ProjectWriter.js'

const here = import.meta.dirname
const PLUGINS = 'https://strandz.it/jigdaw/plugins/'
const plugin = name => `${PLUGINS}${name}/`

// ── time ─────────────────────────────────────────────────────────────────────────────────────────────
const bar = b => 4 * (b - 1)
const note = (startBeat, lengthBeats, pitch, velocity) => ({ startBeat, lengthBeats, pitch, velocity })

// ── harmony: D minor, one chord for two bars ─────────────────────────────────────────────────────────
const CHORD = {
  Dm: { pad: [57, 62, 65], arp: [62, 65, 69, 74], root: 38 },
  Bb: { pad: [58, 62, 65], arp: [62, 65, 70, 74], root: 34 },
  Gm: { pad: [58, 62, 67], arp: [62, 67, 70, 74], root: 43 },
  A: { pad: [57, 61, 64], arp: [61, 64, 69, 73], root: 45 }
}
const PROG = {
  intro: ['Dm', 'Bb'],
  A: ['Dm', 'Bb', 'Gm', 'A'],
  B: ['Dm', 'Bb', 'Gm', 'A'],
  brk: ['Gm', 'A'],
  C: ['Dm', 'Bb', 'Gm', 'A', 'Gm', 'A'],
  outro: ['Dm', 'Dm']
}
// Sections, as [first bar, bars]: an intro, the groove, a lift, a breakdown, the final, an outro.
const SECTIONS = [['Intro', 1, 4], ['Groove', 5, 8], ['Lift', 13, 8], ['Breakdown', 21, 4], ['Final', 25, 12], ['Outro', 37, 4]]

// The lead's eight bar theme over Dm Bb Gm A, as [start, length, pitch, velocity] in beats from its start.
const THEME = [
  [0, 1.5, 69, 92], [1.5, 0.5, 74, 84], [2, 1, 77, 96], [3, 1, 76, 86], [4, 2, 74, 92], [6, 1, 72, 82], [7, 1, 69, 80],
  [8, 1.5, 70, 92], [9.5, 0.5, 74, 84], [10, 1, 77, 96], [11, 1, 74, 86], [12, 2, 72, 92], [14, 1, 70, 82], [15, 1, 69, 80],
  [16, 1.5, 70, 94], [17.5, 0.5, 74, 86], [18, 1, 79, 98], [19, 1, 77, 88], [20, 2, 74, 92], [22, 1, 70, 82], [23, 1, 67, 80],
  [24, 1, 69, 92], [25, 1, 73, 88], [26, 1, 76, 94], [27, 1, 81, 100], [28, 1, 79, 94], [29, 1, 76, 86], [30, 1, 73, 84], [31, 1, 69, 90]
]

// ── the project ──────────────────────────────────────────────────────────────────────────────────────
const project = new Project()
const apply = (...changes) => project.apply(changes)

const TRACKS = [
  ['track-1', 'Drums', 'drumkit', 'node-1', { gain: 0.42, pan: 0 }, {
    kick_decay: 0.42, kick_drive: 0.35, snare_snap: 0.62, snare_level: 0.95, clap_level: 0.8, hh_closed_level: 0.6,
    hh_open_level: 0.5, crash_level: 0.7, tom1_level: 0.85, tom2_level: 0.85, master_reverb: 0.1, master_gain: 0.8
  }],
  ['track-2', 'Bass', 'pulse', 'node-2', { gain: 0.5, pan: 0 }, { waveform: 1, attack: 3, release: 150, cutoff: 700, gain: 0.5 }],
  ['track-3', 'Pad', 'canticle', 'node-3', { gain: 0.44, pan: 0 }, {
    model: 2, articulation: 3, tone: 0.45, movement: 0.35, attack: 0.45, release: 0.6, sustain: 0.85, width: 0.85, output: 0.5
  }],
  ['track-4', 'Pluck', 'canticle', 'node-4', { gain: 0.6, pan: -0.3 }, {
    model: 3, articulation: 1, tone: 0.62, decay: 0.3, sustain: 0.2, release: 0.25, width: 0.7, output: 0.6
  }],
  ['track-5', 'Bells and lead', 'moka', 'node-5', { gain: 0.5, pan: 0.25 }, {
    instrument: 1, decay: 0.62, mallet: 0.7, tone: 0.7, spread: 0.25, position: 0.4, voices: 6, level: 0.55, release: 0.45, width: 0.75
  }],
  ['track-6', 'Chip', '8b8', 'node-6', { gain: 2, pan: 0.45 }, {
    vib_enable: 1, vib_rate: 5.5, vib_depth: 7, vib_delay: 350, env_mode: 1, env_attack: 1, env_decay: 14,
    env_sustain: 20, env_release: 12, vel_sense: 0
  }],
  ['track-7', 'Reverb return', 'cascade', 'node-7', { gain: 1.5, pan: 0 }, { mode: 0, mix: 1, size: 30, damping: 6000 }]
]
for (const [track, label, name, node, channel, settings] of TRACKS) {
  apply({ op: 'addTrack', id: track, label, channel })
  apply({ op: 'addNode', id: node, track, pluginIri: plugin(name), label, settings })
}
// What plays into what: instruments take their track's MIDI clips, and the reverb return takes the sends.
for (const [track, , , node] of TRACKS.slice(0, 6)) apply({ op: 'setTrack', id: track, midiInput: node })
apply({ op: 'setTrack', id: 'track-7', audioInput: 'node-7' })
// The master's chain: one compressor and limiter, which the mix of every track arrives at.
apply({
  op: 'addNode', id: 'node-8', track: 'master', pluginIri: plugin('dynamix'), label: 'Glue',
  settings: {
    comp_enable: 1, threshold: -16, ratio: 2.5, attack: 25, release: 160, knee: 8, makeup: -1.5,
    limit_enable: 1, ceiling: -3, clip_enable: 0
  }
})
apply({ op: 'setMaster', audioInput: 'node-8' })
for (const [from, level] of [['track-4', 1.4], ['track-5', 1.6], ['track-6', 1.0], ['track-3', 0.9]]) {
  apply({ op: 'addSend', from, to: 'track-7', level, tap: 'post' })
}

// ── the clips ────────────────────────────────────────────────────────────────────────────────────────
const clip = (track, startBar, bars, notes) => apply({ op: 'addClip', track, kind: 'midi', startBeat: bar(startBar), lengthBeats: 4 * bars, notes })

// Drums: DrumKit answers kick 36, clap 39, snare 40, crash 41, closed hat 42, tom 45, open hat 46, tom 50, clave 53.
const K = 36; const CL = 39; const SN = 40; const CR = 41; const HH = 42; const T1 = 45; const OH = 46; const T2 = 50; const CLV = 53
const hats16 = (vels, skip = []) => Array.from({ length: 16 }, (_, i) => i * 0.25).filter(p => !skip.includes(p)).map((p, i) => note(p, 0.2, HH, vels[i % 4]))
const drumsA = () => [note(0, 0.3, K, 108), note(1, 0.3, K, 96), note(2, 0.3, K, 104), note(3, 0.3, K, 96),
  ...[0, 0.5, 1, 1.5, 2, 2.5, 3].map(p => note(p, 0.2, HH, p % 1 ? 92 : 70)), note(3.5, 0.4, OH, 68)]
const drumsB = () => [...[[0, 108], [2, 100], [2.75, 88]].map(([p, v]) => note(p, 0.3, K, v)),
  note(1, 0.3, SN, 100), note(3, 0.3, SN, 98), note(1, 0.3, CL, 66), note(3, 0.3, CL, 72), ...hats16([88, 48, 70, 48], [3.5]), note(3.5, 0.4, OH, 72)]
const drumsC = () => [...[[0, 110], [0.75, 84], [2, 104], [2.75, 90], [3.5, 86]].map(([p, v]) => note(p, 0.3, K, v)),
  note(1, 0.3, SN, 104), note(3, 0.3, SN, 102), note(1, 0.3, CL, 70), note(3, 0.3, CL, 78), note(3.75, 0.15, SN, 46),
  ...hats16([92, 52, 74, 52], [1.5, 3.5]), note(1.5, 0.4, OH, 76), note(3.5, 0.4, OH, 76)]
const fill = full => [...[0, 0.25, 0.5, 0.75].map((p, i) => note(2 + p, 0.2, SN, 52 + i * 14)),
  ...(full
    ? [[3, T2, 100], [3.25, T2, 104], [3.5, T1, 108], [3.75, T1, 112]].map(([p, t, v]) => note(p, 0.2, t, v))
    : [0, 0.25, 0.5, 0.75].map((p, i) => note(3 + p, 0.2, SN, 92 + i * 6)))]
const withFill = (barNotes, full) => [...barNotes.filter(x => x.startBeat < 2), ...fill(full)]
const repeat = (count, make, fills = {}, extra = {}) => Array.from({ length: count }, (_, b) => {
  let notes = make()
  if (fills[b] !== undefined) notes = withFill(notes, fills[b])
  if (extra[b]) notes = [...notes, ...extra[b]]
  return notes.map(x => ({ ...x, startBeat: x.startBeat + 4 * b }))
}).flat()
clip('track-1', 5, 8, repeat(8, drumsA, { 7: false }))
clip('track-1', 13, 8, repeat(8, drumsB, { 3: false, 7: true }))
clip('track-1', 21, 4, [...[0, 1, 2].flatMap(b => [0, 1, 2, 3].map(q => note(4 * b + q, 0.2, CLV, q % 2 ? 44 : 58))),
  ...withFill([], true).map(x => ({ ...x, startBeat: x.startBeat + 12 }))])
clip('track-1', 25, 12, repeat(12, drumsC, { 3: false, 7: true, 11: true }, { 0: [note(0, 2, CR, 96)], 8: [note(0, 2, CR, 92)] }))
clip('track-1', 37, 4, [note(0, 0.3, K, 100), note(2, 0.3, K, 90), ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((p, i) => note(p, 0.2, HH, 60 - i * 3)),
  note(4, 0.3, K, 84), ...[0, 1, 2, 3].map(q => note(4 + q, 0.2, HH, 38)), note(8, 2, CR, 72)])

// Bass: the chord's root, and a driving eighth note line in the final.
const bassBasic = r => [note(0, 0.75, r, 100), note(1.5, 0.5, r, 80), note(2, 0.75, r + 12, 96), note(3, 0.5, r + 7, 86), note(3.5, 0.5, r, 82)]
const bassDrive = r => [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((p, i) => note(p, 0.45, [0, 0, 12, 0, 0, 0, 12, 7][i] + r, i % 2 ? 82 : 104))
const bassBars = (section, make) => PROG[section].flatMap((c, i) => [0, 1].flatMap(b => make(CHORD[c].root).map(x => ({ ...x, startBeat: x.startBeat + 8 * i + 4 * b }))))
clip('track-2', 5, 8, bassBars('A', bassBasic))
clip('track-2', 13, 8, bassBars('B', bassBasic))
clip('track-2', 21, 4, PROG.brk.map((c, i) => note(8 * i, 7.8, CHORD[c].root, 92)))
clip('track-2', 25, 12, bassBars('C', bassDrive))
clip('track-2', 37, 2, [note(0, 7.5, 38, 88)])

// Pad: the chord held for two bars.
const padSection = (section, velocity, length = 7.8) => PROG[section].flatMap((c, i) => CHORD[c].pad.map(p => note(8 * i, length, p, velocity)))
clip('track-3', 1, 4, padSection('intro', 62))
clip('track-3', 5, 8, padSection('A', 66))
clip('track-3', 13, 8, padSection('B', 70))
clip('track-3', 21, 4, padSection('brk', 60))
clip('track-3', 25, 12, padSection('C', 76))
clip('track-3', 37, 4, padSection('outro', 58, 7.9))

// Pluck: an eighth note arpeggio of the chord, in a different order for the final.
const arpBar = (c, pattern, vels, scale) => pattern.map((idx, i) => note(i * 0.5, 0.45, CHORD[c].arp[idx], Math.round(vels[i] * scale)))
const arpSection = (section, pattern, vels, scale) => PROG[section].flatMap((c, i) => [0, 1].flatMap(b => arpBar(c, pattern, vels, scale).map(x => ({ ...x, startBeat: x.startBeat + 8 * i + 4 * b }))))
const P1 = [0, 1, 2, 3, 2, 1, 2, 3]; const P2 = [0, 2, 1, 3, 2, 3, 1, 2]; const V = [78, 62, 66, 70, 64, 60, 68, 72]
clip('track-4', 5, 8, arpSection('A', P1, V, 0.85))
clip('track-4', 13, 8, arpSection('B', P1, V, 1))
clip('track-4', 25, 12, arpSection('C', P2, V, 1.12))
clip('track-4', 37, 4, PROG.outro.flatMap((c, i) => [0, 1].flatMap(b => [0, 1, 2, 3].map(q => note(8 * i + 4 * b + q, 0.9, CHORD[c].arp[q], i ? 40 : 52)))).slice(0, 12))

// Bells and lead: bells in the intro, the theme in the lift, sparse in the breakdown, the theme again with the end of it repeated.
const theme = (octave = 0, velocity = 0) => THEME.map(([s, l, p, v]) => note(s, l, p + octave, Math.min(120, v + velocity)))
clip('track-5', 1, 4, [note(0, 3.5, 81, 66), note(4, 3.5, 77, 62), note(8, 3.5, 74, 64), note(12, 3.5, 77, 60), note(14, 1.5, 81, 52)])
clip('track-5', 13, 8, theme(0, -4))
clip('track-5', 21, 4, [note(0, 3.8, 74, 70), note(4, 3.8, 70, 66), note(8, 1.8, 73, 70), note(10, 1.8, 76, 74), note(12, 3.9, 81, 80)])
const tail = THEME.filter(([s]) => s >= 16).map(([s, l, p, v]) => note(s + 16, l, p, Math.min(120, v + 8)))
clip('track-5', 25, 12, [...theme(0, 6), ...tail])
clip('track-5', 37, 4, [note(0, 3.5, 81, 64), note(4, 3.5, 77, 58), note(8, 3.5, 74, 54), note(12, 3.9, 69, 44)])

// Chip: a rising run into the final, then the theme an octave up and short.
clip('track-6', 24, 1, Array.from({ length: 16 }, (_, i) => note(i * 0.25, 0.2, 62 + i, 46 + i * 3)))
const chipTheme = [...THEME, ...THEME.filter(([s]) => s >= 16).map(([s, l, p, v]) => [s + 16, l, p, v])]
clip('track-6', 25, 12, chipTheme.map(([s, l, p, v]) => note(s, Math.min(l * 0.5, 0.5), p + 12, Math.round(v * 0.75))))

// ── structure and movement ───────────────────────────────────────────────────────────────────────────
for (const [label, startBar, bars] of SECTIONS) {
  apply({ op: 'addMarker', atBeat: bar(startBar), label })
  apply({ op: 'addRegion', startBeat: bar(startBar), lengthBeats: 4 * bars, label })
}
const envelope = (node, symbol, points) => apply({ op: 'addEnvelope', target: { node, symbol }, points: points.map(([atBeat, value, curve = 'smooth']) => ({ atBeat, value, curve })) })
// The bass filter opens through the groove and the lift, closes in the breakdown and opens wide for the final.
envelope('node-2', 'cutoff', [[0, 500], [16, 500], [48, 1800], [80, 2600], [84, 420], [92, 420], [100, 4200], [144, 5200], [152, 1400], [160, 900]])
envelope('node-3', 'movement', [[0, 0.25], [64, 0.3], [84, 0.6], [96, 0.28], [160, 0.4]])
// The reverb gets darker and bigger in the breakdown, then clears.
envelope('node-7', 'damping', [[0, 7000], [76, 7000], [84, 2600], [94, 2600], [100, 7500], [160, 5000]])
envelope('node-7', 'size', [[0, 24], [76, 24], [84, 48], [94, 48], [100, 28], [160, 40]])
envelope('node-5', 'tone', [[0, 0.62], [92, 0.62], [100, 0.85], [148, 0.85], [160, 0.6]])
// Steady, then a ritardando through the last four bars; and the master fades over the last.
apply({ op: 'setTransport', beatsPerBar: 4, tempoPoints: [{ atBeat: 0, bpm: 104 }] })
apply({ op: 'addEnvelope', target: { kind: 'tempo' }, points: [{ atBeat: 0, value: 104, curve: 'step' }, { atBeat: 144, value: 104, curve: 'linear' }, { atBeat: 160, value: 84, curve: 'linear' }] })
apply({ op: 'addEnvelope', target: { kind: 'masterGain' }, points: [{ atBeat: 0, value: 1, curve: 'step' }, { atBeat: 152, value: 1, curve: 'smooth' }, { atBeat: 160, value: 0, curve: 'linear' }] })

const out = process.argv[2] ? resolve(process.argv[2]) : resolve(here, 'glass-hours.ttl')
// A preset is only written to the repository by default; when the session file is sent somewhere else (a test), the preset is
// written only if asked for.
const presetOut = process.argv[3] ? resolve(process.argv[3]) : process.argv[2] ? null : resolve(here, '../../web/presets/glass-hours.ttl')
// The writer states the structure and not a title, so the title is put on the project as a preset's is.
const text = writeProject(project, { iri: 'https://strandz.it/jigdaw/sessions/glass-hours/' })
  .replace('    a jig:Project ;\n', '    a jig:Project ;\n    rdfs:label "Glass Hours" ;\n')
writeFileSync(out, text)
if (presetOut) {
  const preset = `# web/presets/glass-hours.ttl
#
# GENERATED by examples/songs/glass-hours.js: the same piece as examples/songs/glass-hours.ttl, with the plugins named by their
# relative address, so they are the ones served beside the page, and no @base. Edit the script, not this file.
#
# Glass Hours: 40 bars in D minor for drums, bass, pad, pluck, bells and lead and a chip line, a reverb return that four of them send
# to, and a glue compressor on the master. It plays the clips it holds, and nothing else.

` + text.replace(/^@base <[^>]*> \.\n\n/, '').replaceAll(PLUGINS, '../plugins/')
  writeFileSync(presetOut, preset)
}
console.log(`wrote ${presetOut ? `${presetOut} and ` : ''}${out}: ${project.tracks.length} tracks, ${project.nodes.length} plugins, ${project.clips.length} clips, ${project.sends.length} sends, ${project.envelopes.length} envelopes`)
