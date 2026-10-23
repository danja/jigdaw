// src/ops/StepLabel.js
//
// A few words for an undo step, from the changes that made it: what a person would call it in a list of what they did. Pure,
// and made from the op names alone, so a new op has a label the day it exists (its name in words) before anyone gives it a
// better one here.

const WORDS = Object.freeze({
  addTrack: 'Add a track',
  setTrack: 'Change a track',
  removeTrack: 'Remove a track',
  moveNodeToTrack: 'Move a plugin to another track',
  setTrackChannel: 'Change level, pan, mute or solo',
  addNode: 'Add a plugin',
  setNode: 'Change a plugin',
  reorderNode: 'Reorder plugins',
  removeNode: 'Remove a plugin',
  setSetting: 'Change a setting',
  clearSetting: 'Reset a setting',
  setNodeState: 'Change a plugin\'s state',
  addConnection: 'Connect',
  setConnection: 'Change a connection',
  removeConnection: 'Disconnect',
  addClip: 'Add a clip',
  setClip: 'Change a clip',
  removeClip: 'Remove a clip',
  setClipNotes: 'Edit notes',
  setClipControllers: 'Edit controller events',
  addEnvelope: 'Add automation',
  setEnvelope: 'Change automation',
  removeEnvelope: 'Remove automation',
  addMarker: 'Add a marker',
  setMarker: 'Change a marker',
  removeMarker: 'Remove a marker',
  addRegion: 'Add a region',
  setRegion: 'Change a region',
  removeRegion: 'Remove a region',
  addSend: 'Add a send',
  setSend: 'Change a send',
  removeSend: 'Remove a send',
  setMaster: 'Change the master',
  setTransport: 'Change tempo, loop or time signature'
})

/** `setClipNotes` as "Set clip notes", for an op nothing above names. */
const spoken = op => {
  const words = String(op).replace(/([A-Z])/g, ' $1').trim().toLowerCase()
  return words === '' ? 'Edit' : words[0].toUpperCase() + words.slice(1)
}

/** One label for a whole changeset: its first op's, with a count of how many other kinds of change went with it. */
export function stepLabel (changes) {
  const labels = [...new Set((changes ?? []).map(c => WORDS[c.op] ?? spoken(c.op)))]
  if (labels.length === 0) return 'Edit'
  return labels.length === 1 ? labels[0] : `${labels[0]} and ${labels.length - 1} other change${labels.length === 2 ? '' : 's'}`
}
