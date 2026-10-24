// src/mcp/tools/arrangementTools.js
//
// The arrangement's own parts: the master, sends, markers and regions, written from a table because each is the same call with different fields.
// One group of the agent tools (docs/webmcp.md); src/mcp/tools.js assembles them in order and is the front door.
import { ok, failed } from './Result.js'

export function arrangementTools ({ dispatcher }) {
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
