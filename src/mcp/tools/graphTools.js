// src/mcp/tools/graphTools.js
//
// Connections, envelopes, nodes and parameters: wiring, automation, plugin edits and parameter changes.
// One group of the agent tools (docs/webmcp.md); src/mcp/tools.js assembles them in order and is the front door.
import { chainSwapChanges } from '../../ops/ChainReorder.js'
import { expandTerm as expand } from '../../catalogue/facets.js'
import { ok, failed } from './Result.js'
import { POINT_SCHEMA } from './Schemas.js'

export function graphTools ({ dispatcher }) {
  return [
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
    }
  ]
}
