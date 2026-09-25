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
import { FACET_NAMES, expandTerm as expand, compactTerm as compact } from '../catalogue/facets.js'

/** A tool result, in the shape every handler returns. */
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
const NOTE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    startBeat: { type: 'number' }, lengthBeats: { type: 'number' },
    pitch: { type: 'integer' }, velocity: { type: 'integer' }
  },
  required: ['startBeat', 'lengthBeats', 'pitch', 'velocity']
})

export function createTools ({ dispatcher, catalogue = null, loadPlugin = null, openCollection = null }) {
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
        'Without a track it gets a new track of its own, named after it. ' +
        'This is the only tool that reaches the network. Reports which step failed if it does.',
      inputSchema: {
        type: 'object',
        properties: {
          iri: { type: 'string' },
          track: { type: 'string', description: 'The id of an existing track to add it to' }
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
      name: 'track_set',
      description:
        'Rename a track, or name the plugins on it that its MIDI clips and audio clips play into. ' +
        'Pass null to clear an input.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          label: { type: ['string', 'null'] },
          midiInput: { type: ['string', 'null'], description: 'A node on this track' },
          audioInput: { type: ['string', 'null'], description: 'A node on this track' },
          expectedRevision: { type: 'integer' }
        },
        required: ['trackId']
      },
      async handler ({ trackId, expectedRevision, ...fields } = {}) {
        const change = { op: 'setTrack', id: trackId }
        for (const key of ['label', 'midiInput', 'audioInput']) {
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

    {
      name: 'node_move_to_track',
      description: 'Move a plugin to another track. It stops being the old track\'s clip input, if it was one.',
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
          expectedRevision: { type: 'integer' }
        },
        required: ['trackId', 'startBeat', 'lengthBeats']
      },
      async handler ({ trackId, startBeat, lengthBeats, notes = [], expectedRevision } = {}) {
        const result = dispatcher.apply([{ op: 'addClip', track: trackId, kind: 'midi', startBeat, lengthBeats, notes }], { expectedRevision })
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
      description: 'Connect one node to another. signalKind is Audio or Midi, or a full IRI.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' },
          fromPort: { type: 'integer' }, toPort: { type: 'integer' },
          toParameter: { type: 'string', description: 'Target a parameter by symbol instead of a port' },
          signalKind: { type: 'string' }
        },
        required: ['from', 'to']
      },
      async handler ({ from, to, fromPort = 0, toPort = 0, toParameter, signalKind = 'Audio' } = {}) {
        const change = {
          op: 'addConnection',
          from: { node: from, portIndex: fromPort },
          to: toParameter ? { node: to, portSymbol: toParameter } : { node: to, portIndex: toPort },
          signalKind: expand(signalKind)
        }
        const result = dispatcher.apply([change])
        return result.ok
          ? ok({ revision: result.revision, connection: result.results[0] })
          : failed(result.message, { kind: result.kind })
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
          node: { type: 'string' }, symbol: { type: 'string' }, value: { type: 'number' }
        },
        required: ['node', 'symbol', 'value']
      },
      async handler ({ node, symbol, value } = {}) {
        const result = dispatcher.setParameter(node, symbol, value)
        return result.ok
          ? ok({ value: result.value, revision: result.revision })
          : failed(result.message)
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

  return tools
}

export { compact, expand }
