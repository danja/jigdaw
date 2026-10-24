// src/mcp/tools/sessionTools.js
//
// Session and catalogue: status the session, search and describe plugins, load one, open a collection.
// One group of the agent tools (docs/webmcp.md); src/mcp/tools.js assembles them in order and is the front door.
import { FACET_NAMES, expandTerm as expand, compactTerm as compact } from '../../catalogue/facets.js'
import { ok, failed } from './Result.js'

export function sessionTools ({ dispatcher, catalogue, loadPlugin, openCollection }) {
  const requireCatalogue = () =>
    catalogue ? null : failed('this host has no catalogue configured, so it cannot search')

  return [
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
    }
  ]
}
