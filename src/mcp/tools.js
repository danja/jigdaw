// src/mcp/tools.js
//
// The agent surface, as specified in docs/webmcp.md.
//
// These are the dispatcher's operations, not a second implementation of them.
// architecture.md: the editor and the agent surface are thin adapters over one
// dispatcher, because two implementations of "add a connection" diverge and the
// first sign is usually an undo that half works.
//
// Nothing here knows how a tool is registered with a user agent. That binding
// is not settled and lives in adapter.js, so when the API moves one file
// changes and this one does not.
import { splitClip, duplicateClip, trimClip, copyClips, pasteClips } from '../model/ClipEdit.js'
import { describeBus } from '../model/TrackBus.js'
import { describeNoteTransform, NOTE_TRANSFORMS } from '../model/NoteTransform.js'
import { SCALE_NAMES } from '../model/Scale.js'
import { duplicateTrack } from '../ops/DuplicateTrack.js'
import { chainSwapChanges } from '../ops/ChainReorder.js'
import { FACET_NAMES, expandTerm as expand, compactTerm as compact } from '../catalogue/facets.js'

/** A tool result, in the shape every handler returns. */
const POINT_SCHEMA = { type: 'object', properties: { atBeat: { type: 'number', minimum: 0 }, value: { type: 'number' }, curve: { type: 'string', enum: ['step', 'linear', 'smooth'] } }, required: ['atBeat', 'value'] }

const ok = data => ({ ok: true, ...data })
const failed = (message, extra = {}) => ({ ok: false, error: message, ...extra })

/**
 * Build the tool list.
 *
 * `catalogue` may be null, in which case the discovery tools report that
 * searching is unavailable rather than being silently absent. A tool that
 * vanishes is harder for an agent to reason about than one that explains
 * itself.
 */
/** One note of a MIDI clip, as the clip tools take it. project-format.md "Clips". */
const CONTROLLER_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    atBeat: { type: 'number' },
    controller: { description: 'a MIDI controller number 0 to 127, or the string "pitchBend"', oneOf: [{ type: 'integer' }, { type: 'string', enum: ['pitchBend'] }] },
    value: { type: 'integer', description: '0 to 127 for a controller, -8192 to 8191 for pitchBend (0 is the wheel at rest)' }
  },
  required: ['atBeat', 'controller', 'value']
})

const NOTE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    startBeat: { type: 'number' }, lengthBeats: { type: 'number' },
    pitch: { type: 'integer' }, velocity: { type: 'integer' }
  },
  required: ['startBeat', 'lengthBeats', 'pitch', 'velocity']
})

export function createTools ({ dispatcher, catalogue = null, loadPlugin = null, openCollection = null, onPlay = null, onStop = null, onPanic = null, reel = null }) {
  if (!dispatcher) throw new Error('the tool surface needs a dispatcher')

  const requireCatalogue = () =>
    catalogue ? null : failed('this host has no catalogue configured, so it cannot search')

  const tools = [
    {
      name: 'status',
      description:
        'The state of the session: revision, how many tracks and nodes, the transport, and whether anything is failing. ' +
        'Deliberately small and cheap. Call it before making changes.',
      inputSchema: { type: 'object', properties: {} },
      async handler () {
        const compiled = dispatcher.compile()
        const project = dispatcher.project
        return ok({
          revision: dispatcher.revision,
          tracks: project.tracks.length,
          clips: project.clips.length,
          nodes: project.nodes.length,
          connections: project.connections.length,
          totalLatencyFrames: compiled.totalLatency,
          compiles: compiled.ok,
          problems: compiled.errors.map(e => e.message),
          transport: {
            tempo: project.transport.tempoPoints[0]?.bpm ?? null,
            beatsPerBar: project.transport.beatsPerBar,
            loopEnabled: project.transport.loopEnabled
          }
        })
      }
    },

    {
      name: 'project_get',
      description: 'The whole project as data: tracks, nodes, connections, parameter settings and transport.',
      inputSchema: { type: 'object', properties: {} },
      async handler () {
        return ok({ project: dispatcher.project.snapshot() })
      }
    },

    {
      name: 'project_info',
      description:
        'The title, author and notes kept with the session, saved in the file and shown in the Project section. Pass any of ' +
        'title, author, notes to change them (text, or null for none; title and author up to 120 characters, notes up to 4000). ' +
        'Like a track layout this is not an edit to the audio, so it changes no revision and has no undo.',
      inputSchema: {
        type: 'object',
        properties: { title: { type: ['string', 'null'] }, author: { type: ['string', 'null'] }, notes: { type: ['string', 'null'] } }
      },
      async handler (patch = {}) {
        try {
          if (Object.keys(patch).length > 0) dispatcher.project.setInfo(patch)
          return ok({ info: dispatcher.project.info })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
      }
    },

    {
      name: 'plugins_search',
      description:
        'Find candidate plugins by text and by what they do. Returns enough to choose between them; ' +
        'call plugin_describe for the few that matter. Results marked web:true can run in this host; ' +
        'the rest are native plugins the catalogue knows about but this host cannot load.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Text matched against name, description and vendor' },
          role: { type: 'string', description: 'A role such as Instrument or AudioEffect' },
          accepts: { type: 'string', description: 'A signal type the plugin takes, such as Audio or Midi' },
          produces: { type: 'string', description: 'A signal type the plugin emits' },
          limit: { type: 'integer', description: 'At most 200, default 25' }
        }
      },
      async handler ({ q = '', limit = 25, ...facets } = {}) {
        const unavailable = requireCatalogue()
        if (unavailable) return unavailable
        const unknown = Object.keys(facets).filter(k => !FACET_NAMES.includes(k))
        if (unknown.length > 0) {
          // Named, never ignored: a silently dropped facet returns a full
          // result set that looks like an answer.
          return failed(`unknown facet: ${unknown.join(', ')}`, { known: FACET_NAMES })
        }
        try {
          return ok({ results: await catalogue.search({ text: q, limit, ...facets }) })
        } catch (error) {
          return failed(`catalogue: ${error.message}`)
        }
      }
    },

    {
      name: 'plugin_describe',
      description: 'Everything the catalogue holds about one plugin, by its IRI.',
      inputSchema: {
        type: 'object',
        properties: { iri: { type: 'string' } },
        required: ['iri']
      },
      async handler ({ iri } = {}) {
        const unavailable = requireCatalogue()
        if (unavailable) return unavailable
        if (!iri) return failed('plugin_describe needs an iri')
        try {
          return ok(await catalogue.describe(iri))
        } catch (error) {
          return failed(`catalogue: ${error.message}`)
        }
      }
    },

    {
      name: 'plugin_validate_chain',
      description:
        'Given plugins in order, check that each one produces something the next one accepts. ' +
        'Reports the mismatches and any cautions. Does not change anything.',
      inputSchema: {
        type: 'object',
        properties: { iris: { type: 'array', items: { type: 'string' } } },
        required: ['iris']
      },
      async handler ({ iris = [] } = {}) {
        const unavailable = requireCatalogue()
        if (unavailable) return unavailable
        if (iris.length < 2) return failed('a chain needs at least two plugins')

        const described = []
        for (const iri of iris) {
          try {
            described.push(await catalogue.describe(iri))
          } catch (error) {
            return failed(`could not describe ${iri}: ${error.message}`)
          }
        }

        const problems = []
        const cautions = []
        for (let i = 0; i < described.length - 1; i++) {
          const from = described[i]
          const to = described[i + 1]
          const produces = from.properties.produces ?? []
          const accepts = to.properties.accepts ?? []
          for (const caution of from.properties.caution ?? []) {
            cautions.push({ plugin: from.iri, caution })
          }
          // Only checked when both sides say something. A plugin that declares
          // nothing is not evidence of a mismatch, and reporting one would
          // train an agent to ignore this tool.
          if (produces.length === 0 || accepts.length === 0) continue
          if (!produces.some(signal => accepts.includes(signal))) {
            problems.push({
              from: from.iri, to: to.iri,
              message: `${from.iri} produces ${produces.join(', ')} and ${to.iri} accepts ${accepts.join(', ')}`
            })
          }
        }
        return ok({ valid: problems.length === 0, problems, cautions })
      }
    },

    {
      name: 'collection_open',
      description:
        'Open a plugin collection by IRI (docs/plugin-collections.md): fetch the document and ' +
        'check every listed plugin\'s profile and capabilities. A catalogue read, not an Op: it ' +
        'reaches the network but changes nothing, and fetches no module, processor or asset. ' +
        'Load a member afterwards with plugin_load, by the iri this tool reports for it.',
      inputSchema: {
        type: 'object',
        properties: { iri: { type: 'string' } },
        required: ['iri']
      },
      async handler ({ iri } = {}) {
        if (!iri) return failed('collection_open needs an iri')
        if (!openCollection) return failed('this host cannot open collections')
        try {
          const { collection, warnings, members } = await openCollection(iri)
          return ok({
            label: collection.label,
            comment: collection.comment ?? null,
            warnings: warnings.map(w => w.message),
            members: members.map(m => m.ok
              ? { iri: m.iri, label: m.profile.label, ok: true, notes: m.notes }
              : { iri: m.iri, label: m.listedLabel, ok: false, step: m.step, message: m.message })
          })
        } catch (error) {
          return failed(error.message, { step: error.step ?? null })
        }
      }
    },

    {
      name: 'plugin_load',
      description:
        'Fetch, validate and instantiate a plugin by IRI, adding it to the session. ' +
        'Without a track it gets a new track of its own, named after it; the track "master" puts it on the master bus. ' +
        'This is the only tool that reaches the network. Reports which step failed if it does.',
      inputSchema: {
        type: 'object',
        properties: {
          iri: { type: 'string' },
          track: { type: 'string', description: 'The id of an existing track to add it to, or "master" for the master bus' }
        },
        required: ['iri']
      },
      async handler ({ iri, track } = {}) {
        if (!iri) return failed('plugin_load needs an iri')
        if (!loadPlugin) return failed('this host cannot load plugins')
        const result = await loadPlugin(iri, track ? { track } : {})
        if (!result.ok) return failed(result.message, { step: result.step ?? null })
        return ok({
          nodeId: result.nodeId,
          trackId: result.trackId,
          label: result.entry.profile.label,
          parameters: result.entry.profile.ports.map(p => ({
            symbol: p.symbol, name: p.name, min: p.minimum, max: p.maximum, default: p.defaultValue
          })),
          latencyFrames: result.entry.ready.latencyFrames,
          revision: result.revision
        })
      }
    },

    {
      name: 'graph_apply_changes',
      description:
        'Apply a changeset atomically: all of it applies or none does. Pass expectedRevision to be ' +
        'rejected if the project has moved on, and dryRun to see what would happen without committing.',
      inputSchema: {
        type: 'object',
        properties: {
          changes: { type: 'array', items: { type: 'object' } },
          expectedRevision: { type: 'integer' },
          dryRun: { type: 'boolean' }
        },
        required: ['changes']
      },
      async handler ({ changes = [], expectedRevision, dryRun = false } = {}) {
        const result = dispatcher.apply(changes, { expectedRevision, dryRun })
        if (!result.ok) {
          return failed(result.message, {
            kind: result.kind,
            revision: result.revision,
            ...(result.expected !== undefined ? { expected: result.expected } : {}),
            ...(result.index !== undefined ? { index: result.index } : {})
          })
        }
        return ok({
          revision: result.revision,
          applied: result.applied,
          totalLatencyFrames: result.compiled.totalLatency
        })
      }
    },

    {
      name: 'track_add',
      description: 'Add an empty track: a mixer strip and a line of the arrangement.',
      inputSchema: {
        type: 'object',
        properties: { label: { type: 'string' }, expectedRevision: { type: 'integer' } }
      },
      async handler ({ label, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'addTrack', label: label ?? null }], { expectedRevision })
        return result.ok
          ? ok({ revision: result.revision, trackId: result.results[0] })
          : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'track_remove',
      description:
        'Remove a track. Refused while plugins are on it, unless moveNodesTo names the track ' +
        'they go to instead.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          moveNodesTo: { type: 'string' },
          expectedRevision: { type: 'integer' }
        },
        required: ['trackId']
      },
      async handler ({ trackId, moveNodesTo, expectedRevision } = {}) {
        const change = { op: 'removeTrack', id: trackId, ...(moveNodesTo ? { moveNodesTo } : {}) }
        const result = dispatcher.apply([change], { expectedRevision })
        return result.ok
          ? ok({ revision: result.revision, removed: trackId })
          : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'track_duplicate',
      description:
        'Copy a track with its plugins as one edit: each plugin is loaded again onto a new track with the same settings, ' +
        'saved state and bypass, and the wiring between them, the track inputs, automation, clips, channel strip and sends ' +
        'from the track are copied. A connection to another track is not. Undone as one step. If any plugin fails to load ' +
        'nothing is kept. Returns the new track id, a map from each original node id to its copy, and what was left out.',
      inputSchema: {
        type: 'object',
        properties: { trackId: { type: 'string' } },
        required: ['trackId']
      },
      async handler ({ trackId } = {}) {
        const result = await duplicateTrack(dispatcher, trackId)
        return result.ok
          ? ok({ revision: dispatcher.project.revision, trackId: result.trackId, nodeIds: result.nodeIds, skipped: result.skipped })
          : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'track_bus',
      description:
        'Make a bus from two or more tracks: one new track, and each chosen track\'s output set to it instead of the master. ' +
        'One edit, undone as one step. A track already sent to another bus is moved. Returns the bus track id.',
      inputSchema: {
        type: 'object',
        properties: { trackIds: { type: 'array', items: { type: 'string' }, minItems: 2 }, label: { type: 'string' } },
        required: ['trackIds']
      },
      async handler ({ trackIds, label } = {}) {
        let changes
        try {
          changes = describeBus(dispatcher.project, trackIds ?? [], label === undefined ? {} : { label })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
        const result = dispatcher.apply(changes)
        return result.ok ? ok({ revision: result.revision, trackId: changes[0].id }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'track_layout',
      description:
        'How the page draws a track: its place in the arrangement, colour, lane size and folder. Editor ' +
        'metadata, so it changes no revision and has no undo. "move" is places up (negative) or ' +
        'down (positive). Colour is lower case #rrggbb, or null for none. laneSize is collapsed (a thin bar), small, medium or large. folder is a name of 1 to 60 characters that tracks share, or null for none.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          move: { type: 'integer' },
          color: { type: ['string', 'null'] },
          laneSize: { type: 'string', enum: ['collapsed', 'small', 'medium', 'large'] },
          folder: { type: ['string', 'null'] }
        },
        required: ['trackId']
      },
      async handler ({ trackId, move, color, laneSize, folder } = {}) {
        try {
          const { project } = dispatcher
          if (move !== undefined) project.moveTrack(trackId, move)
          if (color !== undefined || laneSize !== undefined || folder !== undefined) {
            project.setTrackLayout(trackId, {
              ...(color !== undefined ? { color } : {}), ...(laneSize !== undefined ? { laneSize } : {}), ...(folder !== undefined ? { folder } : {})
            })
          }
          const order = project.orderedTracks.map(t => t.id)
          return ok({ trackId, layout: project.trackLayout(trackId), position: order.indexOf(trackId) + 1, of: order.length })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
      }
    },

    {
      name: 'track_set',
      description:
        'Rename a track, name the plugins on it that its MIDI clips and audio clips play into, or send its ' +
        'output to another track instead of the master (a bus). The audio input is also where audio from ' +
        'another track arrives, a bus output or a send, so a plugin on a bus is in the path; it must take an ' +
        'audio input. Pass null to clear an input or an output.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          label: { type: ['string', 'null'] },
          midiInput: { type: ['string', 'null'], description: 'A node on this track' },
          audioInput: { type: ['string', 'null'], description: 'A node on this track, with an audio input. Its audio clips and anything sent or bused to the track arrive at it; without one they go to the fader' },
          output: { type: ['string', 'null'], description: 'The track this one feeds instead of the master, which makes it a bus. null for the master. A cycle is refused.' },
          expectedRevision: { type: 'integer' }
        },
        required: ['trackId']
      },
      async handler ({ trackId, expectedRevision, ...fields } = {}) {
        const change = { op: 'setTrack', id: trackId }
        for (const key of ['label', 'midiInput', 'audioInput', 'output']) {
          if (fields[key] !== undefined) change[key] = fields[key]
        }
        const result = dispatcher.apply([change], { expectedRevision })
        return result.ok ? ok({ revision: result.revision }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'track_set_channel',
      description:
        'Set any of a track\'s fader (linear gain, 1 is unity), pan (-1 to 1), mute and solo. ' +
        'If any track is soloed, every track that is not is silent.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          gain: { type: 'number' }, pan: { type: 'number' },
          muted: { type: 'boolean' }, soloed: { type: 'boolean' },
          expectedRevision: { type: 'integer' }
        },
        required: ['trackId']
      },
      async handler ({ trackId, expectedRevision, ...change } = {}) {
        const result = dispatcher.setTrackChannel(trackId, change, { expectedRevision })
        return result.ok
          ? ok({ revision: result.revision, channel: dispatcher.project.track(trackId).channel })
          : failed(result.message, { kind: result.kind })
      }
    },

    ...arrangementTools(),

    {
      name: 'node_move_to_track',
      description: 'Move a plugin to another track, or to the master bus with the track "master". It stops being the old track\'s clip input, if it was one.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' }, trackId: { type: 'string' }, expectedRevision: { type: 'integer' }
        },
        required: ['nodeId', 'trackId']
      },
      async handler ({ nodeId, trackId, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'moveNodeToTrack', id: nodeId, track: trackId }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'clip_add',
      description:
        'Add a MIDI clip to a track, at a beat and for a number of beats, optionally with its notes. ' +
        'It plays into the track\'s MIDI input; track_set names that. Notes start relative to the clip.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          startBeat: { type: 'number' },
          lengthBeats: { type: 'number' },
          notes: { type: 'array', items: NOTE_SCHEMA },
          controllers: { type: 'array', items: CONTROLLER_SCHEMA },
          loopBeats: { type: 'number', exclusiveMinimum: 0, description: 'Repeat the first this many beats of notes and events to fill the clip' },
          expectedRevision: { type: 'integer' }
        },
        required: ['trackId', 'startBeat', 'lengthBeats']
      },
      async handler ({ trackId, startBeat, lengthBeats, notes = [], controllers = [], loopBeats, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'addClip', track: trackId, kind: 'midi', startBeat, lengthBeats, notes, controllers, ...(loopBeats !== undefined ? { loopBeats } : {}) }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision, clipId: result.results[0] }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'clip_add_audio',
      description:
        'Add an audio clip to a track, playing a file by its absolute IRI. The file is referred to, never ' +
        'copied into the session. offsetSeconds is where in the file the clip begins.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          source: { type: 'string', description: 'The absolute IRI of the audio file' },
          startBeat: { type: 'number' },
          lengthBeats: { type: 'number' },
          offsetSeconds: { type: 'number' },
          expectedRevision: { type: 'integer' }
        },
        required: ['trackId', 'source', 'startBeat', 'lengthBeats']
      },
      async handler ({ trackId, source, startBeat, lengthBeats, offsetSeconds = 0, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'addClip', track: trackId, kind: 'audio', source, startBeat, lengthBeats, offsetSeconds }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision, clipId: result.results[0] }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'clip_set_notes',
      description:
        'Replace every note of a MIDI clip, as one edit. Each note has startBeat (from the clip start), ' +
        'lengthBeats, pitch (0 to 127, 60 is middle C) and velocity (1 to 127).',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          notes: { type: 'array', items: NOTE_SCHEMA },
          expectedRevision: { type: 'integer' }
        },
        required: ['clipId', 'notes']
      },
      async handler ({ clipId, notes, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'setClipNotes', id: clipId, notes }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'clip_set_controllers',
      description:
        'Replace every controller and pitch bend event of a MIDI clip, as one edit. Each event has atBeat (from the clip start), ' +
        'controller (a MIDI controller number 0 to 127, such as 1 modulation, 7 volume, 10 pan, 64 sustain; or "pitchBend") and ' +
        'value (0 to 127 for a controller; -8192 to 8191 for pitchBend, where 0 is the wheel at rest). An event holds its value until ' +
        'the next one for the same controller. One controller has at most one event at a beat.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          controllers: { type: 'array', items: CONTROLLER_SCHEMA },
          expectedRevision: { type: 'integer' }
        },
        required: ['clipId', 'controllers']
      },
      async handler ({ clipId, controllers, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'setClipControllers', id: clipId, controllers }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'clip_transform_notes',
      description:
        'Edit the notes of a MIDI clip in one step, all of them or only those at `indices` (positions in the clip\'s note order). ' +
        '`transform` is quantize (`grid` in beats, `strength` 0 to 1, `ends` true to move note ends too), transpose (`semitones`, whole), ' +
        'scaleVelocity (`factor` above zero), reverse (mirrors the notes inside the clip), invert (mirrors pitches about `axis`, default the first note) or ' +
        'humanize (random nudges of start by up to `timing` beats and velocity by up to `velocity`, from a whole `seed` so the same seed gives the same result) or ' +
        'fitScale (moves each note to the nearest pitch of `scale` in `root`, 0 for C to 11 for B), legato (each note held until the next start) or ' +
        'strum (each chord rolled: `spread` beats between its notes, `direction` up from the lowest or down from the highest). Refused as a whole if any note would leave its range.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          transform: { type: 'string', enum: NOTE_TRANSFORMS },
          grid: { type: 'number' }, strength: { type: 'number' }, ends: { type: 'boolean' },
          semitones: { type: 'integer' }, factor: { type: 'number' },
          axis: { type: 'integer' }, timing: { type: 'number' }, velocity: { type: 'number' }, seed: { type: 'integer' },
          spread: { type: 'number' }, direction: { type: 'string', enum: ['up', 'down'] },
          root: { type: 'integer' }, scale: { type: 'string', enum: SCALE_NAMES },
          indices: { type: 'array', items: { type: 'integer' } },
          expectedRevision: { type: 'integer' }
        },
        required: ['clipId', 'transform']
      },
      async handler ({ clipId, transform, indices, expectedRevision, ...options } = {}) {
        let changes
        try { changes = describeNoteTransform(dispatcher.project, clipId, transform, options, { indices: indices ?? null }) } catch (error) { return failed(error.message) }
        const result = dispatcher.apply(changes, { expectedRevision })
        return result.ok ? ok({ revision: result.revision }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'clip_move',
      description: 'Move a clip to another beat or another track, or change its length in beats.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          startBeat: { type: 'number' },
          lengthBeats: { type: 'number' },
          trackId: { type: 'string' },
          expectedRevision: { type: 'integer' }
        },
        required: ['clipId']
      },
      async handler ({ clipId, startBeat, lengthBeats, trackId, expectedRevision } = {}) {
        const change = { op: 'setClip', id: clipId }
        if (startBeat !== undefined) change.startBeat = startBeat
        if (lengthBeats !== undefined) change.lengthBeats = lengthBeats
        if (trackId !== undefined) change.track = trackId
        const result = dispatcher.apply([change], { expectedRevision })
        return result.ok ? ok({ revision: result.revision }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'clip_set',
      description:
        'Change how a clip behaves, in one edit. muted keeps it on the lane and does not play it; locked ' +
        'refuses later moves, edits and removal until it is unlocked (muting and unlocking still work); ' +
        'fadeInBeats and fadeOutBeats are straight-line fades on an audio clip. loopBeats makes a MIDI clip repeat its first ' +
        'that many beats of notes and events to fill its length (null clears it; notes after the loop end are kept but not played). color is a lower case ' +
        '#rrggbb or null, editor metadata that changes no revision and has no undo.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          muted: { type: 'boolean' },
          locked: { type: 'boolean' },
          fadeInBeats: { type: 'number', minimum: 0 },
          fadeOutBeats: { type: 'number', minimum: 0 },
          loopBeats: { type: ['number', 'null'], exclusiveMinimum: 0 },
          color: { type: ['string', 'null'] },
          expectedRevision: { type: 'integer' }
        },
        required: ['clipId']
      },
      async handler ({ clipId, muted, locked, fadeInBeats, fadeOutBeats, loopBeats, color, expectedRevision } = {}) {
        const change = { op: 'setClip', id: clipId }
        for (const [key, value] of Object.entries({ muted, locked, fadeInBeats, fadeOutBeats, loopBeats })) {
          if (value !== undefined) change[key] = value
        }
        const edited = Object.keys(change).length > 2
        if (!edited && color === undefined) return failed('nothing to change: give muted, locked, a fade, loopBeats or a color', { kind: 'change' })
        try {
          let revision = dispatcher.project.revision
          if (edited) {
            const result = dispatcher.apply([change], { expectedRevision })
            if (!result.ok) return failed(result.message, { kind: result.kind })
            revision = result.revision
          }
          if (color !== undefined) dispatcher.project.setClipColor(clipId, color)
          return ok({ revision, clip: { ...dispatcher.project.clip(clipId), color: dispatcher.project.clipColor(clipId) } })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
      }
    },

    {
      name: 'clip_split',
      description:
        'Cut a clip in two at a beat inside it. The first half keeps the clip id; the second is new and its id ' +
        'is returned. A note across the cut becomes two notes, an audio half starts further into the same file, ' +
        'and a fade in stays with the first half and a fade out goes with the second. One edit, one undo.',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string' }, atBeat: { type: 'number' }, expectedRevision: { type: 'integer' } },
        required: ['clipId', 'atBeat']
      },
      async handler ({ clipId, atBeat, expectedRevision } = {}) {
        try {
          const changes = splitClip(dispatcher.project, clipId, atBeat, { transport: dispatcher.transport() })
          const result = dispatcher.apply(changes, { expectedRevision })
          if (!result.ok) return failed(result.message, { kind: result.kind })
          const created = changes.find(c => c.op === 'addClip').id
          return ok({ revision: result.revision, firstClipId: clipId, secondClipId: created })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
      }
    },

    {
      name: 'clip_trim',
      description:
        'Shorten a clip from the front and/or the back, to absolute beats inside it, without moving what is left: notes keep the time ' +
        'they sounded, an audio clip begins further into its file, and a fade belongs to the edge it was made for. Give `from`, `to` or ' +
        'both; an edge left out stays. One edit, one undo. A trim must leave some of the clip.',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' }, expectedRevision: { type: 'integer' } },
        required: ['clipId']
      },
      async handler ({ clipId, from, to, expectedRevision } = {}) {
        if (from === undefined && to === undefined) return failed('clip_trim needs from, to or both', { kind: 'change' })
        try {
          const changes = trimClip(dispatcher.project, clipId, { from, to }, { transport: dispatcher.transport() })
          const result = dispatcher.apply(changes, { expectedRevision })
          return result.ok ? ok({ revision: result.revision, clipId }) : failed(result.message, { kind: result.kind })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
      }
    },
    {
      name: 'clip_copy_to',
      description:
        'Copy several clips and put the group down with its earliest clip at `startBeat`, as one edit: the way a person copies a ' +
        'selection and pastes. Each copy goes back to the track it came from, or all onto `trackId` when given. With `cut` true the ' +
        'originals are removed in the same edit, so it is a move that keeps nothing behind. Copies are not locked. Returns the new ' +
        'clip ids in the order of `clipIds`.',
      inputSchema: {
        type: 'object',
        properties: {
          clipIds: { type: 'array', items: { type: 'string' } }, startBeat: { type: 'number' }, trackId: { type: 'string' },
          cut: { type: 'boolean' }, expectedRevision: { type: 'integer' }
        },
        required: ['clipIds', 'startBeat']
      },
      async handler ({ clipIds, startBeat, trackId, cut = false, expectedRevision } = {}) {
        if (!Array.isArray(clipIds)) return failed('clip_copy_to needs clipIds', { kind: 'change' })
        if (!Number.isFinite(startBeat) || startBeat < 0) return failed('startBeat must be a beat from zero up', { kind: 'change' })
        try {
          const copied = copyClips(dispatcher.project, clipIds)
          const additions = pasteClips(dispatcher.project, copied, { startBeat, track: trackId ?? null })
          const removals = cut ? clipIds.map(id => ({ op: 'removeClip', id })) : []
          const result = dispatcher.apply([...additions, ...removals], { expectedRevision })
          return result.ok ? ok({ revision: result.revision, clipIds: result.results.slice(0, additions.length) }) : failed(result.message, { kind: result.kind })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
      }
    },
    {
      name: 'clip_duplicate',
      description:
        'Copy a clip, by default straight after it on the same track, or at startBeat and/or on trackId. The copy ' +
        'is not locked. Returns the new clip id.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' }, startBeat: { type: 'number' }, trackId: { type: 'string' }, expectedRevision: { type: 'integer' }
        },
        required: ['clipId']
      },
      async handler ({ clipId, startBeat, trackId, expectedRevision } = {}) {
        try {
          const changes = duplicateClip(dispatcher.project, clipId, { startBeat, track: trackId })
          const result = dispatcher.apply(changes, { expectedRevision })
          return result.ok ? ok({ revision: result.revision, clipId: result.results[0] }) : failed(result.message, { kind: result.kind })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
      }
    },

    {
      name: 'clip_remove',
      description: 'Remove a clip and its notes. The plugins on its track are untouched.',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string' }, expectedRevision: { type: 'integer' } },
        required: ['clipId']
      },
      async handler ({ clipId, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'removeClip', id: clipId }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision, removed: clipId }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'connection_add',
      description: 'Connect one node to another. signalKind is Audio or Midi, or a full IRI. A MIDI connection may carry lowNote and highNote, and then lets only the notes from one to the other through.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' },
          fromPort: { type: 'integer' }, toPort: { type: 'integer' },
          toParameter: { type: 'string', description: 'Target a parameter by symbol instead of a port' },
          signalKind: { type: 'string' },
          lowNote: { type: 'integer', description: 'MIDI only: the lowest note let through, 0 to 127' },
          highNote: { type: 'integer', description: 'MIDI only: the highest note let through, 0 to 127' }
        },
        required: ['from', 'to']
      },
      async handler ({ from, to, fromPort = 0, toPort = 0, toParameter, signalKind = 'Audio', lowNote, highNote } = {}) {
        const change = {
          op: 'addConnection',
          from: { node: from, portIndex: fromPort },
          to: toParameter ? { node: to, portSymbol: toParameter } : { node: to, portIndex: toPort },
          signalKind: expand(signalKind),
          ...(lowNote === undefined ? {} : { lowNote }),
          ...(highNote === undefined ? {} : { highNote })
        }
        const result = dispatcher.apply([change])
        return result.ok
          ? ok({ revision: result.revision, connection: result.results[0] })
          : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'envelope_add',
      description:
        'Automate one parameter of a plugin: an envelope of points over the beats. Each point has atBeat, value (in ' +
        'the parameter\'s own units) and curve, which is how the value leaves it towards the next point (step holds, ' +
        'linear is a straight line, smooth is smoothstep). Before the first point the value holds the first value, ' +
        'after the last it holds the last. A parameter has one envelope. Returns its id.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' }, symbol: { type: 'string', description: 'The parameter\'s lv2:symbol' },
          points: { type: 'array', items: POINT_SCHEMA }, expectedRevision: { type: 'integer' }
        },
        required: ['nodeId', 'symbol', 'points']
      },
      async handler ({ nodeId, symbol, points, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'addEnvelope', target: { node: nodeId, symbol }, points }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision, envelopeId: result.results[0] }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'envelope_set',
      description: 'Replace every point of an envelope at once, as one edit and one undo. Same point shape as envelope_add.',
      inputSchema: {
        type: 'object',
        properties: { envelopeId: { type: 'string' }, points: { type: 'array', items: POINT_SCHEMA }, expectedRevision: { type: 'integer' } },
        required: ['envelopeId', 'points']
      },
      async handler ({ envelopeId, points, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'setEnvelope', id: envelopeId, points }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'envelope_remove',
      description: 'Remove an envelope. The parameter keeps the value set by hand.',
      inputSchema: {
        type: 'object',
        properties: { envelopeId: { type: 'string' }, expectedRevision: { type: 'integer' } },
        required: ['envelopeId']
      },
      async handler ({ envelopeId, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'removeEnvelope', id: envelopeId }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision, removed: envelopeId }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'node_move_in_chain',
      description:
        'Move an effect one place earlier (delta -1) or later (1) in its track\'s audio chain, swapping it with its ' +
        'neighbour and rewiring the joins, as one edit. Only a plain chain is moved: both plugins must take and give ' +
        'audio, and each join must be the only one, so nothing is guessed. The reason is returned when it is refused.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string' }, delta: { type: 'integer', enum: [-1, 1] }, expectedRevision: { type: 'integer' } },
        required: ['nodeId', 'delta']
      },
      async handler ({ nodeId, delta, expectedRevision } = {}) {
        try {
          const passesAudio = id => {
            const profile = dispatcher.engineNode(id)?.profile
            return (profile?.audioInputs ?? 0) > 0 && (profile?.audioOutputs ?? 0) > 0
          }
          const changes = chainSwapChanges(dispatcher.project, nodeId, delta, { passesAudio })
          const result = dispatcher.apply(changes, { expectedRevision })
          return result.ok ? ok({ revision: result.revision, nodeId, delta }) : failed(result.message, { kind: result.kind })
        } catch (error) {
          return failed(error.message, { kind: 'change' })
        }
      }
    },

    {
      name: 'node_unpack',
      description:
        'Turn a composite plugin (a plugin made of other plugins, such as an effects rack) back into its members: ordinary nodes on ' +
        'the same track, joined to what the composite was joined to, each with the value it had inside so it sounds the same. One ' +
        'edit, one undo. Refused for a node that is not a composite, for one with automation on it, and when a member will not ' +
        'load, in which case the composite is left exactly as it was.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string' } },
        required: ['nodeId']
      },
      async handler ({ nodeId } = {}) {
        if (typeof nodeId !== 'string' || nodeId === '') return failed('node_unpack needs a nodeId')
        const result = await dispatcher.unpackComposite(nodeId)
        return result.ok
          ? ok({ revision: result.revision, unpacked: nodeId, nodeIds: result.nodeIds })
          : failed(result.message, { kind: result.kind })
      }
    },
    {
      name: 'node_swap',
      description:
        'Replace a plugin with another, in the same place: on its track, joined to what it was joined to wherever the new one has a ' +
        'port for the join, with the settings the new one has parameters for, its label if you gave it one, and its bypass. One ' +
        'edit, one undo. The result lists in `dropped` what could not be carried over, in words. Refused for a composite (use ' +
        'node_unpack), for a plugin with automation on it, and when the new one will not load, in which case nothing changes.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string' }, iri: { type: 'string', description: 'The IRI of the plugin to put in its place.' } },
        required: ['nodeId', 'iri']
      },
      async handler ({ nodeId, iri } = {}) {
        if (typeof nodeId !== 'string' || nodeId === '') return failed('node_swap needs a nodeId')
        if (typeof iri !== 'string' || iri === '') return failed('node_swap needs the iri of the replacement')
        const result = await dispatcher.swapPlugin(nodeId, iri)
        return result.ok
          ? ok({ revision: result.revision, replaced: nodeId, nodeId: result.nodeId, dropped: result.dropped })
          : failed(result.message, { kind: result.kind })
      }
    },
    {
      name: 'composite_pack',
      description:
        'Describe a selection of loaded plugins as a composite plugin: the Turtle profile of one plugin made of them, wired as they ' +
        'are wired, with a control for every parameter you have moved and each member pinned to its profile as fetched now. It ' +
        'changes nothing in the project. A composite is a plugin at an IRI, so the profile is a document to publish at the iri you ' +
        'give. The warnings say what it cannot carry: bypass, saved state, automation, a connection into a member\'s own parameter.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeIds: { type: 'array', items: { type: 'string' }, description: 'The plugins to pack, all on one track.' },
          iri: { type: 'string', description: 'Where it will be published: https, or http on loopback.' },
          label: { type: 'string', description: 'Its name.' },
          comment: { type: 'string', description: 'What it is for.' },
          expose: { type: 'string', enum: ['set', 'none'], description: 'set (default) makes a control of each parameter moved by hand; none fixes them.' }
        },
        required: ['nodeIds', 'iri', 'label']
      },
      async handler ({ nodeIds, iri, label, comment, expose } = {}) {
        const result = await dispatcher.packSelection({ nodeIds, iri, label, comment, expose })
        return result.ok
          ? ok({ turtle: result.turtle, summary: result.summary, warnings: result.warnings })
          : failed(result.message, { kind: result.kind })
      }
    },
    {
      name: 'node_bypass',
      description:
        'Take a plugin out of the signal, or put it back, keeping its state. A bypassed effect passes what ' +
        'arrives at its input straight on, a bypassed MIDI processor passes its MIDI through, and a bypassed ' +
        'instrument or generator makes nothing. One edit, one undo.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string' }, bypassed: { type: 'boolean' }, expectedRevision: { type: 'integer' } },
        required: ['nodeId', 'bypassed']
      },
      async handler ({ nodeId, bypassed, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'setNode', id: nodeId, bypassed }], { expectedRevision })
        return result.ok ? ok({ revision: result.revision, nodeId, bypassed }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'node_remove',
      description:
        'Remove a node and everything connected to it. With heal, a node taken out of the ' +
        'middle of a path has its neighbours rejoined, which is what a person means by ' +
        'removing one plugin from a chain.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          heal: { type: 'boolean', description: 'Rejoin what it stood between. Default false.' },
          expectedRevision: { type: 'integer' }
        },
        required: ['nodeId']
      },
      async handler ({ nodeId, heal = false, expectedRevision } = {}) {
        const before = dispatcher.project.connections.length
        const result = dispatcher.apply([{ op: 'removeNode', id: nodeId, heal }], { expectedRevision })
        return result.ok
          ? ok({
            revision: result.revision,
            removed: nodeId,
            // How much of the graph went with it, which is the part an agent
            // cannot see from the changeset it sent.
            connectionsRemoved: before - dispatcher.project.connections.length
          })
          : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'connection_set',
      description:
        'Change the notes a MIDI connection lets through: only those from lowNote to highNote, 0 to 127. An end you ' +
        'leave out stays as it was, and null takes it away, so a connection with neither passes everything. Two ' +
        'connections from one source with ranges that meet split a keyboard between two instruments.',
      inputSchema: {
        type: 'object',
        properties: {
          connectionId: { type: 'string' },
          lowNote: { type: ['integer', 'null'] }, highNote: { type: ['integer', 'null'] },
          expectedRevision: { type: 'integer' }
        },
        required: ['connectionId']
      },
      async handler ({ connectionId, lowNote, highNote, expectedRevision } = {}) {
        const change = { op: 'setConnection', id: connectionId, ...(lowNote === undefined ? {} : { lowNote }), ...(highNote === undefined ? {} : { highNote }) }
        const result = dispatcher.apply([change], { expectedRevision })
        return result.ok ? ok({ revision: result.revision }) : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'connection_remove',
      description: 'Remove one connection by its id. project_get lists them.',
      inputSchema: {
        type: 'object',
        properties: { connectionId: { type: 'string' }, expectedRevision: { type: 'integer' } },
        required: ['connectionId']
      },
      async handler ({ connectionId, expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'removeConnection', id: connectionId }], { expectedRevision })
        return result.ok
          ? ok({ revision: result.revision, removed: connectionId })
          : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'parameters_set_batch',
      description:
        'Set several parameters at once. Atomic: all of them apply or none does, so a ' +
        'preset arrives as one edit rather than as a visible sweep through intermediate states.',
      inputSchema: {
        type: 'object',
        properties: {
          settings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nodeId: { type: 'string' }, symbol: { type: 'string' }, value: { type: 'number' }
              },
              required: ['nodeId', 'symbol', 'value']
            }
          },
          expectedRevision: { type: 'integer' }
        },
        required: ['settings']
      },
      async handler ({ settings, expectedRevision } = {}) {
        const result = dispatcher.setParameters(settings, { expectedRevision })
        return result.ok
          ? ok({ revision: result.revision, applied: result.applied })
          : failed(result.message, { kind: result.kind })
      }
    },

    {
      name: 'parameter_set',
      description:
        'Set a parameter by its symbol. Returns the value actually applied, which may be clamped ' +
        'to the range the plugin declares.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The node, as every other tool names it' },
          node: { type: 'string', description: 'The same, under the name this tool used before the others agreed on nodeId' },
          symbol: { type: 'string' }, value: { type: 'number' }
        },
        required: ['symbol', 'value']
      },
      async handler ({ nodeId, node = nodeId, symbol, value } = {}) {
        if (!node) return failed('parameter_set needs nodeId, the node whose parameter it sets')
        const result = dispatcher.setParameter(node, symbol, value)
        return result.ok
          ? ok({ value: result.value, revision: result.revision })
          : failed(result.message)
      }
    },

    {
      name: 'parameter_reset',
      description:
        'Put a parameter back to its plugin default and forget its setting, so the project says what ' +
        'a node that was never touched says. Returns the default the plugin now holds.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string' }, node: { type: 'string', description: 'The older name for nodeId' }, symbol: { type: 'string' } },
        required: ['symbol']
      },
      async handler ({ nodeId, node = nodeId, symbol } = {}) {
        if (!node) return failed('parameter_reset needs nodeId, the node whose parameter it resets')
        const result = dispatcher.resetParameter(node, symbol)
        return result.ok
          ? ok({ value: result.value, revision: result.revision })
          : failed(result.message)
      }
    },

    {
      name: 'history_undo',
      description:
        'Step the project back over the last edit, whoever made it, a person or an agent. Undoing a ' +
        'removed plugin reloads it, so this can take a moment. Fails, changing nothing, when there is ' +
        'nothing to undo. Returns the history in words: `done`, oldest first, and `undone`, next redo first.',
      inputSchema: { type: 'object', properties: {} },
      async handler () {
        const result = await dispatcher.undo()
        return result.ok ? ok({ revision: result.revision, canUndo: dispatcher.canUndo(), canRedo: dispatcher.canRedo(), history: dispatcher.history() }) : failed(result.message)
      }
    },

    {
      name: 'history_redo',
      description:
        'Step forward again over whatever history_undo last stepped back from. Fails, changing ' +
        'nothing, when there is nothing to redo, which includes after any new edit.',
      inputSchema: { type: 'object', properties: {} },
      async handler () {
        const result = await dispatcher.redo()
        return result.ok ? ok({ revision: result.revision, canUndo: dispatcher.canUndo(), canRedo: dispatcher.canRedo(), history: dispatcher.history() }) : failed(result.message)
      }
    },

    {
      name: 'script_run',
      description:
        'Run a Reel script, the livecoding language of docs/livecoding.md, or with dryRun check it and ' +
        'return what it would do without doing it. A script that does not parse or plan changes nothing, ' +
        'and errors come back with their line numbers. During playback a new script takes over at the next ' +
        'bar line, atomically, unless now is true. One run is one undo step. Every plugin the script loads ' +
        'is fetched and validated before anything it says is carried out.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'The script, one statement per line' },
          dryRun: { type: 'boolean', description: 'Check and describe only. Default false.' },
          now: { type: 'boolean', description: 'Take over at once and not at the next bar line. Default false.' }
        },
        required: ['source']
      },
      async handler ({ source, dryRun = false, now = false } = {}) {
        if (!reel) return failed('this host has no scripting')
        if (typeof source !== 'string') return failed('script_run needs the script as source')
        if (dryRun) {
          const checked = await reel.check(source)
          return checked.ok ? ok({ plan: reel.describe(checked.plan) }) : failed('the script has errors', { stage: checked.stage, errors: checked.errors })
        }
        const result = await reel.run(source, { now })
        if (result.stage) return failed('the script has errors, so nothing was changed', { stage: result.stage, errors: result.errors })
        return result.ok ? ok({ swapped: result.swapped }) : failed('the script ran with errors', { swapped: result.swapped, errors: result.errors })
      }
    },

    {
      name: 'transport_play',
      description:
        'Start the transport, so clips play and plugins receive transport position. It starts at fromBeat when given, ' +
        'and otherwise at the start of the loop when a loop is on, and at the beginning when not: so a section is ' +
        'heard by looping it, and a piece can be joined part way. ' +
        'Needs audio already started by a person: a browser starts no AudioContext without a click.',
      inputSchema: { type: 'object', properties: { fromBeat: { type: 'number', description: 'The beat to start at, zero or more' } } },
      async handler ({ fromBeat } = {}) {
        if (!onPlay) return failed('this host cannot play: no transport is connected')
        if (fromBeat !== undefined && !(Number.isFinite(fromBeat) && fromBeat >= 0)) return failed(`fromBeat is a beat at or after zero: ${fromBeat}`)
        try {
          await onPlay(fromBeat === undefined ? {} : { fromBeat })
          return ok({})
        } catch (error) {
          return failed(`play failed: ${error?.message ?? error}`)
        }
      }
    },

    {
      name: 'transport_stop',
      description:
        'Stop the transport. Notes sounding are given their ends, the same as the page Stop button.',
      inputSchema: { type: 'object', properties: {} },
      async handler () {
        if (!onStop) return failed('this host cannot stop: no transport is connected')
        try {
          await onStop()
          return ok({})
        } catch (error) {
          return failed(`stop failed: ${error?.message ?? error}`)
        }
      }
    },

    {
      name: 'transport_panic',
      description:
        'Silence every note that is stuck: all notes off and all sound off go to every plugin, and the transport keeps ' +
        'running. Use it instead of transport_stop when a note hangs and the loop being worked on should go on.',
      inputSchema: { type: 'object', properties: {} },
      async handler () {
        if (!onPanic) return failed('this host cannot panic: no transport is connected')
        try {
          await onPanic()
          return ok({})
        } catch (error) {
          return failed(`panic failed: ${error?.message ?? error}`)
        }
      }
    },

    {
      name: 'transport_configure',
      description: 'Set the tempo, time signature or loop.',
      inputSchema: {
        type: 'object',
        properties: {
          tempo: { type: 'number' }, beatsPerBar: { type: 'integer' },
          loopStart: { type: 'number' }, loopEnd: { type: 'number' }, loopEnabled: { type: 'boolean' }
        }
      },
      async handler ({ tempo, ...rest } = {}) {
        const change = { op: 'setTransport', ...rest }
        if (tempo !== undefined) change.tempoPoints = [{ atBeat: 0, bpm: tempo }]
        const result = dispatcher.apply([change])
        return result.ok ? ok({ revision: result.revision }) : failed(result.message)
      }
    },

    {
      name: 'diagnostics',
      description: 'Engine detail, including the compiled graph, any cycles, and per-node load state.',
      inputSchema: { type: 'object', properties: {} },
      async handler () {
        const compiled = dispatcher.compile()
        return ok({
          order: compiled.order,
          cycles: compiled.cycles,
          errors: compiled.errors,
          compensation: compiled.compensation,
          totalLatencyFrames: compiled.totalLatency,
          nodes: dispatcher.project.nodes.map(n => {
            const entry = dispatcher.engineNode(n.id)
            return {
              id: n.id,
              plugin: n.pluginIri,
              loaded: Boolean(entry),
              failed: entry?.failed ?? null,
              latencyFrames: entry?.ready?.latencyFrames ?? null
            }
          })
        })
      }
    }
  ]

  /**
   * The arrangement's own parts, each one Op through apply: the master, sends, markers and regions. They are
   * written from a table because each is the same call with different fields.
   */
  function arrangementTools () {
    const num = description => ({ type: 'number', description })
    const one = ({ name, description, properties = {}, required = [], op, id, pick = args => args, returns = 'id' }) => ({
      name,
      description,
      inputSchema: { type: 'object', properties: { ...properties, expectedRevision: { type: 'integer' } }, required },
      async handler ({ expectedRevision, ...args } = {}) {
        const fields = pick(args)
        const result = dispatcher.apply([{ op, ...fields }], { expectedRevision })
        if (!result.ok) return failed(result.message, { kind: result.kind })
        return ok({ revision: result.revision, ...(returns === 'id' ? { [id]: result.results[0] } : {}) })
      }
    })
    const keep = names => args => Object.fromEntries(Object.entries(args).filter(([k]) => names.includes(k)))
    const withId = (key, names) => args => ({ id: args[key], ...keep(names)(args) })
    return [
      one({
        name: 'master_set',
        description: 'Set the master bus: linear gain (1 is unity), pan (-1 to 1), mute, and the plugin on the master ' +
          'that the mix of every track arrives at (audioInput, null for the fader). Any of them; the rest stay. ' +
          'Plugins go on the master with plugin_load or node_move_to_track and the track "master".',
        properties: {
          gain: num('Linear, zero or more'), pan: num('-1 to 1'), muted: { type: 'boolean' },
          audioInput: { type: ['string', 'null'], description: 'A node on the master, with an audio input' }
        },
        op: 'setMaster', returns: 'none', pick: keep(['gain', 'pan', 'muted', 'audioInput'])
      }),
      one({
        name: 'send_add',
        description: 'Send one track to another. Audio (the default) is a copy of the signal as an effect send: level is linear (default 1) and tap is pre or post fader (default post); it arrives at the target\'s audioInput, or its fader. With kind midi it routes the MIDI the source track makes to the plugin the target\'s MIDI clips play into (its midiInput), and takes no level or tap. A cycle, or a second send of one kind between the same two tracks, is refused.',
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string', enum: ['audio', 'midi'] },
          level: num('Linear, zero or more; audio only'), tap: { type: 'string', enum: ['pre', 'post'], description: 'Audio only' },
          lowNote: { type: 'integer', description: 'MIDI only: the lowest note let through, 0 to 127' },
          highNote: { type: 'integer', description: 'MIDI only: the highest note let through, 0 to 127' }
        },
        required: ['from', 'to'], op: 'addSend', id: 'sendId', pick: keep(['from', 'to', 'kind', 'level', 'tap', 'lowNote', 'highNote'])
      }),
      one({
        name: 'send_set',
        description: 'Change an audio send\'s level or whether it takes the signal before or after the fader. A MIDI send has neither, and takes a note range instead: lowNote and highNote, an end left out staying as it was and null taking it away.',
        properties: {
          sendId: { type: 'string' }, level: num('Linear, zero or more'), tap: { type: 'string', enum: ['pre', 'post'] },
          lowNote: { type: ['integer', 'null'] }, highNote: { type: ['integer', 'null'] }
        },
        required: ['sendId'], op: 'setSend', returns: 'none', pick: withId('sendId', ['level', 'tap', 'lowNote', 'highNote'])
      }),
      one({
        name: 'send_remove',
        description: 'Remove a send, by the id send_add returned or project_get lists.',
        properties: { sendId: { type: 'string' } }, required: ['sendId'], op: 'removeSend', returns: 'none', pick: withId('sendId', [])
      }),
      one({
        name: 'marker_add',
        description: 'Name a position in the arrangement, in beats from the start.',
        properties: { atBeat: num('Zero or more'), label: { type: ['string', 'null'] } },
        required: ['atBeat'], op: 'addMarker', id: 'markerId', pick: keep(['atBeat', 'label'])
      }),
      one({
        name: 'marker_set',
        description: 'Move a marker to another beat, or rename it. Either, or both.',
        properties: { markerId: { type: 'string' }, atBeat: num('Zero or more'), label: { type: ['string', 'null'] } },
        required: ['markerId'], op: 'setMarker', returns: 'none', pick: withId('markerId', ['atBeat', 'label'])
      }),
      one({
        name: 'marker_remove',
        description: 'Remove a marker, by the id marker_add returned or project_get lists.',
        properties: { markerId: { type: 'string' } }, required: ['markerId'], op: 'removeMarker', returns: 'none', pick: withId('markerId', [])
      }),
      one({
        name: 'region_add',
        description: 'Name a range of the arrangement: where it starts and how long it lasts, both in beats.',
        properties: { startBeat: num('Zero or more'), lengthBeats: num('Above zero'), label: { type: ['string', 'null'] } },
        required: ['startBeat', 'lengthBeats'], op: 'addRegion', id: 'regionId', pick: keep(['startBeat', 'lengthBeats', 'label'])
      }),
      one({
        name: 'region_set',
        description: 'Move a region, change how long it lasts, or rename it. Any of them.',
        properties: { regionId: { type: 'string' }, startBeat: num('Zero or more'), lengthBeats: num('Above zero'), label: { type: ['string', 'null'] } },
        required: ['regionId'], op: 'setRegion', returns: 'none', pick: withId('regionId', ['startBeat', 'lengthBeats', 'label'])
      }),
      one({
        name: 'region_remove',
        description: 'Remove a region, by the id region_add returned or project_get lists.',
        properties: { regionId: { type: 'string' } }, required: ['regionId'], op: 'removeRegion', returns: 'none', pick: withId('regionId', [])
      })
    ]
  }

  return tools
}

export { compact, expand }
