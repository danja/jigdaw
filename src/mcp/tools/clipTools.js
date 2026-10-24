// src/mcp/tools/clipTools.js
//
// Clips: moving a plugin to a track, and every MIDI and audio clip tool.
// One group of the agent tools (docs/webmcp.md); src/mcp/tools.js assembles them in order and is the front door.
import { splitClip, duplicateClip, trimClip, copyClips, pasteClips } from '../../model/ClipEdit.js'
import { describeNoteTransform, NOTE_TRANSFORMS } from '../../model/NoteTransform.js'
import { describeEuclidean } from '../../model/Euclidean.js'
import { SCALE_NAMES } from '../../model/Scale.js'
import { ok, failed } from './Result.js'
import { CONTROLLER_SCHEMA, NOTE_SCHEMA } from './Schemas.js'

export function clipTools ({ dispatcher }) {
  return [
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
        'It plays into the track\'s MIDI input; track_set names that. Notes start relative to the clip. With `scene` (a whole number from 0) ' +
        'the clip goes in the clip launcher instead of on the timeline: it has no start beat, and a track has one clip in each scene.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          startBeat: { type: 'number' },
          lengthBeats: { type: 'number' },
          notes: { type: 'array', items: NOTE_SCHEMA },
          controllers: { type: 'array', items: CONTROLLER_SCHEMA },
          loopBeats: { type: 'number', exclusiveMinimum: 0, description: 'Repeat the first this many beats of notes and events to fill the clip' },
          scene: { type: 'integer', minimum: 0, description: 'A clip launcher row. The clip then has no start beat.' },
          expectedRevision: { type: 'integer' }
        },
        required: ['trackId', 'lengthBeats']
      },
      async handler ({ trackId, startBeat, lengthBeats, notes = [], controllers = [], loopBeats, scene, expectedRevision } = {}) {
        // A launcher clip has no place on the timeline, so its start is 0 whether or not the caller said so.
        const at = scene === undefined ? startBeat : (startBeat ?? 0)
        const result = dispatcher.apply([{ op: 'addClip', track: trackId, kind: 'midi', startBeat: at, lengthBeats, notes, controllers, ...(loopBeats !== undefined ? { loopBeats } : {}), ...(scene !== undefined ? { scene } : {}) }], { expectedRevision })
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
        'strum (each chord rolled: `spread` beats between its notes, `direction` up from the lowest or down from the highest) or setChance (`chance` above 0 and at most 1: how likely each note is to sound each time it comes round; 1 takes the chance away). Refused as a whole if any note would leave its range.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          transform: { type: 'string', enum: NOTE_TRANSFORMS },
          grid: { type: 'number' }, strength: { type: 'number' }, ends: { type: 'boolean' },
          semitones: { type: 'integer' }, factor: { type: 'number' },
          axis: { type: 'integer' }, timing: { type: 'number' }, velocity: { type: 'number' }, seed: { type: 'integer' },
          chance: { type: 'number' }, spread: { type: 'number' }, direction: { type: 'string', enum: ['up', 'down'] },
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
      name: 'clip_euclidean',
      description:
        'Lay a Euclidean rhythm into a MIDI clip: `pulses` notes of `pitch` spread as evenly as they can be over `steps` steps of `stepBeats` beats ' +
        '(default a sixteenth), repeated to fill the clip, and moved later by `rotation` steps. Notes already at that pitch are replaced and every ' +
        'other note is kept, so a drum clip is built one pitch at a time. One edit, one undo step.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' }, pitch: { type: 'integer', minimum: 0, maximum: 127 },
          pulses: { type: 'integer', minimum: 0 }, steps: { type: 'integer', minimum: 1, maximum: 64 }, rotation: { type: 'integer' },
          stepBeats: { type: 'number' }, velocity: { type: 'integer', minimum: 1, maximum: 127 }, lengthBeats: { type: 'number', description: 'How long each note is; default one step' },
          expectedRevision: { type: 'integer' }
        },
        required: ['clipId', 'pitch', 'pulses', 'steps']
      },
      async handler ({ clipId, expectedRevision, ...options } = {}) {
        let changes
        try { changes = describeEuclidean(dispatcher.project, clipId, options) } catch (error) { return failed(error.message) }
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
        'that many beats of notes and events to fill its length (null clears it; notes after the loop end are kept but not played). scene moves a MIDI clip ' +
        'into a clip launcher row (it then has no start) or, as null, back onto the timeline at startBeat 0 unless startBeat is also given. color is a lower case ' +
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
          scene: { type: ['integer', 'null'], minimum: 0 },
          startBeat: { type: 'number', minimum: 0, description: 'With scene null: where the clip lands on the timeline.' },
          color: { type: ['string', 'null'] },
          expectedRevision: { type: 'integer' }
        },
        required: ['clipId']
      },
      async handler ({ clipId, muted, locked, fadeInBeats, fadeOutBeats, loopBeats, scene, startBeat, color, expectedRevision } = {}) {
        const change = { op: 'setClip', id: clipId }
        for (const [key, value] of Object.entries({ muted, locked, fadeInBeats, fadeOutBeats, loopBeats, scene, startBeat })) {
          if (value !== undefined) change[key] = value
        }
        const edited = Object.keys(change).length > 2
        if (!edited && color === undefined) return failed('nothing to change: give muted, locked, a fade, loopBeats, scene or a color', { kind: 'change' })
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
    }
  ]
}
