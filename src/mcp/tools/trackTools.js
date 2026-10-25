// src/mcp/tools/trackTools.js
//
// Tracks and the general changeset: graph_apply_changes and the tools that edit a track.
// One group of the agent tools (docs/webmcp.md); src/mcp/tools.js assembles them in order and is the front door.
import { describeBus, placeBus } from '../../model/TrackBus.js'
import { duplicateTrack } from '../../ops/DuplicateTrack.js'
import { ok, failed } from './Result.js'

export function trackTools ({ dispatcher }) {
  return [
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
        if (result.ok) placeBus(dispatcher.project, changes[0].id, trackIds)
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
    }
  ]
}
