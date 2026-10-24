// src/mcp/tools/performanceTools.js
//
// History, script and performance: undo and redo, the script tool, the transport and the clip launcher, and diagnostics.
// One group of the agent tools (docs/webmcp.md); src/mcp/tools.js assembles them in order and is the front door.
import { ok, failed } from './Result.js'

export function performanceTools ({ dispatcher, onPlay, onStop, onPanic, launcher, reel }) {
  return [
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
      name: 'launcher_launch',
      description:
        'Launch clip launcher slots, a performance gesture that changes no revision and is not undone. Give `clipId` for one slot (a MIDI clip ' +
        'with a scene), `scene` for every slot in that row, or `nodeId` with `scene` for the slot in that row on the track the plugin sits on. A slot starts at the next launch boundary (see launcher_quantise), and what else ' +
        'plays on its track stops there; the arrangement on that track is silent while a slot plays. If the transport is stopped it is started. ' +
        'Returns the beat each slot starts at.',
      inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, scene: { type: 'integer', minimum: 0 }, nodeId: { type: 'string', description: 'With scene: the plugin whose track holds the slot' } } },
      async handler ({ clipId, scene, nodeId } = {}) {
        if (!launcher) return failed('this host has no clip launcher')
        if (nodeId !== undefined && (clipId !== undefined || scene === undefined)) return failed('give nodeId with scene, and no clipId')
        if (nodeId === undefined && (clipId === undefined) === (scene === undefined)) return failed('give either clipId or scene')
        try {
          if (nodeId !== undefined) {
            const node = dispatcher.project.node(nodeId)
            if (!node) return failed(`no node ${nodeId}`)
            return ok({ launched: await launcher.launchSlot(node.track, scene) })
          }
          return ok({ launched: await (clipId !== undefined ? launcher.launch(clipId) : launcher.launchScene(scene)) })
        } catch (error) {
          return failed(`launch failed: ${error?.message ?? error}`)
        }
      }
    },

    {
      name: 'launcher_stop',
      description:
        'Stop clip launcher slots at the next launch boundary: the slot playing on `trackId`, or every slot when no track is given. A slot still ' +
        'waiting for its start is called off. Changes no revision. Returns the beat the stop happens at, or null where nothing was playing.',
      inputSchema: { type: 'object', properties: { trackId: { type: 'string' }, nodeId: { type: 'string', description: 'Instead of trackId: the plugin whose track to stop' } } },
      async handler ({ trackId, nodeId } = {}) {
        if (!launcher) return failed('this host has no clip launcher')
        if (nodeId !== undefined && trackId !== undefined) return failed('give trackId or nodeId, not both')
        try {
          if (nodeId !== undefined) {
            const node = dispatcher.project.node(nodeId)
            if (!node) return failed(`no node ${nodeId}`)
            trackId = node.track
          }
          return ok({ at: await launcher.stop(trackId ?? null) })
        } catch (error) {
          return failed(`stop failed: ${error?.message ?? error}`)
        }
      }
    },

    {
      name: 'launcher_quantise',
      description:
        'Read or set how long a launch or stop waits: none (at once), beat, bar, 2bars or 4bars, counted from the start of the transport. ' +
        'Given nothing it only reads. The setting is saved with the session (on the transport) and is one undo step; the launches themselves are not.',
      inputSchema: { type: 'object', properties: { quantise: { type: 'string', enum: ['none', 'beat', 'bar', '2bars', '4bars'] } } },
      async handler ({ quantise } = {}) {
        if (!launcher) return failed('this host has no clip launcher')
        try {
          if (quantise !== undefined) launcher.setQuantise(quantise)
          return ok({ quantise: launcher.quantise() })
        } catch (error) {
          return failed(error?.message ?? String(error))
        }
      }
    },

    {
      name: 'launcher_state',
      description: 'What each clip launcher slot is doing now: stopped, queued, playing or stopping, with the scene and track it sits in.',
      inputSchema: { type: 'object', properties: {} },
      async handler () {
        if (!launcher) return failed('this host has no clip launcher')
        return ok({ quantise: launcher.quantise(), slots: launcher.slots() })
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
}
