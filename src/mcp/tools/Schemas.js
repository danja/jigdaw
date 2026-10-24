// src/mcp/tools/Schemas.js
//
// JSON Schema fragments that more than one tool takes: an envelope point, a controller event and a note of a MIDI clip
// (project-format.md, "Clips").
export const POINT_SCHEMA = { type: 'object', properties: { atBeat: { type: 'number', minimum: 0 }, value: { type: 'number' }, curve: { type: 'string', enum: ['step', 'linear', 'smooth'] } }, required: ['atBeat', 'value'] }

export const CONTROLLER_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    atBeat: { type: 'number' },
    controller: { description: 'a MIDI controller number 0 to 127, or the string "pitchBend"', oneOf: [{ type: 'integer' }, { type: 'string', enum: ['pitchBend'] }] },
    value: { type: 'integer', description: '0 to 127 for a controller, -8192 to 8191 for pitchBend (0 is the wheel at rest)' }
  },
  required: ['atBeat', 'controller', 'value']
})

export const NOTE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    startBeat: { type: 'number' }, lengthBeats: { type: 'number' },
    pitch: { type: 'integer' }, velocity: { type: 'integer' },
    chance: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: 'The chance the note sounds each time it comes round, above 0 and at most 1; leave it out for a note that always sounds' }
  },
  required: ['startBeat', 'lengthBeats', 'pitch', 'velocity']
})
