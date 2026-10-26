// src/ui/KeyTable.js
//
// Every keyboard shortcut the studio has that is listed for a person, as data. The overlay (KeysOverlay.js) draws it.
// tests/ui/KeyTable.test.js fires each row's `press` events at the real control and asserts that the control reacts, so
// a row that names a key nothing handles, or a handler whose key was changed, fails there.
//
// `press` is what the test dispatches. `keys` is what a person reads. They are written apart on purpose: the first is
// an event, the second is words.

export const KEY_SCOPES = Object.freeze({
  everywhere: 'Anywhere on the page',
  clip: 'With a clip focused',
  track: 'With a track name focused',
  chain: 'With a plugin focused in the chain strip',
  point: 'With an envelope point focused',
  script: 'In the script box',
  text: 'In a plugin\'s text box',
  browser: 'In the Browser',
  menu: 'In a context menu',
  grid: 'With a clip launcher cell focused'
})

const plain = key => ({ key })

export const KEY_ROWS = Object.freeze([
  { scope: 'everywhere', keys: 'Ctrl or Cmd + Z', does: 'Undo, except while typing in a field', press: [{ key: 'z', ctrlKey: true }] },
  { scope: 'everywhere', keys: 'Ctrl or Cmd + Shift + Z, or Ctrl or Cmd + Y', does: 'Redo, except while typing in a field', press: [{ key: 'z', ctrlKey: true, shiftKey: true }, { key: 'y', ctrlKey: true }] },
  { scope: 'everywhere', keys: 'Ctrl or Cmd + full stop', does: 'Panic: silence every stuck note', press: [{ key: '.', ctrlKey: true }] },
  { scope: 'everywhere', keys: 'F1', does: 'Show or hide this list', press: [plain('F1')] },

  { scope: 'clip', keys: 'Left or Right', does: 'Move the clip one grid step', press: [plain('ArrowLeft'), plain('ArrowRight')] },
  { scope: 'clip', keys: 'Shift + Left or Right', does: 'Make the clip one grid step shorter or longer', press: [{ key: 'ArrowLeft', shiftKey: true }, { key: 'ArrowRight', shiftKey: true }] },
  { scope: 'clip', keys: 'Space', does: 'Add the clip to the selection, or take it out; Enter opens it', press: [plain(' ')] },
  { scope: 'clip', keys: 'S', does: 'Split at the playhead', press: [plain('s')] },
  { scope: 'clip', keys: 'D', does: 'Duplicate', press: [plain('d')] },
  { scope: 'clip', keys: 'R', does: 'Repeat a MIDI clip once more: it gets one pattern longer, the notes coming round again', press: [plain('r')] },
  { scope: 'clip', keys: 'M', does: 'Mute or unmute', press: [plain('m')] },
  { scope: 'clip', keys: 'L', does: 'Lock or unlock', press: [plain('l')] },
  { scope: 'clip', keys: '[ and ]', does: 'Trim the start or the end to the playhead', press: [plain('['), plain(']')] },
  { scope: 'clip', keys: 'Ctrl or Cmd + C, X, V', does: 'Copy, cut, paste', press: [{ key: 'c', ctrlKey: true }, { key: 'x', ctrlKey: true }, { key: 'v', ctrlKey: true }] },
  { scope: 'clip', keys: 'Delete or Backspace', does: 'Delete', press: [plain('Delete'), plain('Backspace')] },

  { scope: 'track', keys: 'Alt + Up or Down', does: 'Move the track earlier or later in the order', press: [{ key: 'ArrowUp', altKey: true }, { key: 'ArrowDown', altKey: true }] },
  { scope: 'track', keys: '+ and -', does: 'Make the lane one size taller or shorter', press: [plain('+'), plain('-')] },
  { scope: 'track', keys: 'Shift + Up or Down', does: 'Extend the selection to the track above or below', press: [{ key: 'ArrowUp', shiftKey: true }, { key: 'ArrowDown', shiftKey: true }] },
  { scope: 'track', keys: 'D', does: 'Duplicate the track', press: [plain('d')] },

  { scope: 'chain', keys: 'Alt + Left or Right', does: 'Move the plugin earlier or later in the chain, where it can', press: [{ key: 'ArrowLeft', altKey: true }, { key: 'ArrowRight', altKey: true }] },

  { scope: 'point', keys: 'Left or Right', does: 'Move the point in time by one grid step', press: [plain('ArrowLeft'), plain('ArrowRight')] },
  { scope: 'point', keys: 'Up or Down, with Shift for a finer step', does: 'Change the point\'s value', press: [plain('ArrowUp'), plain('ArrowDown'), { key: 'ArrowUp', shiftKey: true }] },
  { scope: 'point', keys: 'C', does: 'Change the curve after the point', press: [plain('c')] },
  { scope: 'point', keys: 'Delete or Backspace', does: 'Delete the point', press: [plain('Delete'), plain('Backspace')] },

  { scope: 'script', keys: 'Ctrl or Cmd + Enter', does: 'Run the script at the next bar; add Shift to run it now', press: [{ key: 'Enter', ctrlKey: true }, { key: 'Enter', ctrlKey: true, shiftKey: true }] },

  { scope: 'text', keys: 'Ctrl or Cmd + Enter', does: 'Apply the text to the plugin', press: [{ key: 'Enter', ctrlKey: true }] },

  { scope: 'browser', keys: 'Escape', does: 'Close the Browser and return to its button', press: [plain('Escape')] },

  { scope: 'menu', keys: 'Down or Up', does: 'Move to the next or previous action', press: [plain('ArrowDown'), plain('ArrowUp')] },
  { scope: 'menu', keys: 'Home or End', does: 'Move to the first or last action', press: [plain('Home'), plain('End')] },
  { scope: 'grid', keys: 'Arrow keys', does: 'Move to the cell above, below, left or right', press: [plain('ArrowUp'), plain('ArrowDown'), plain('ArrowLeft'), plain('ArrowRight')] },

  { scope: 'menu', keys: 'Escape', does: 'Close the menu and return to the item it came from', press: [plain('Escape')] }
])

// Files that handle keydown and whose keys are not in the table above. Each is a reason or a promise, so a new file
// with a keydown handler cannot appear without a decision (tests/ui/KeyTable.test.js walks src/ and web/).
export const UNLISTED_KEY_FILES = Object.freeze({
  'src/ui/Tabs.js': 'the tabs pattern: arrows, Home and End, as in the WAI-ARIA authoring practices',
  'src/ui/RoutingMatrix.js': 'the grid pattern: arrows, Home and End',
  'src/ui/Dock.js': 'the splitter pattern: arrows, Home and End',
  'src/ui/Keyboard.js': 'the on-screen piano plays notes; its keys are its own help text',
  'src/ui/LoopRow.js': 'arrows on a loop edge, said by its label',
  'src/ui/AmountField.js': 'Enter commits a field',
  'src/ui/TrackPanel.js': 'Enter commits a field',
  'src/ui/AudioClipPanel.js': 'Enter commits a field',
  'src/ui/BulkTrackPanel.js': 'Enter commits a field',
  'src/ui/PianoRoll.js': 'not listed yet: the roll has many keys and wants its own section',
  'src/ui/RollLane.js': 'not listed yet: goes with the piano roll section',
  'src/ui/Timeline.js': 'not listed yet: plus and minus zoom the timeline when it has focus',
  'src/ui/TimelineReorder.js': 'Escape drops a track or a folder being dragged where it started, said in docs/jiggy-features.md; the grip is a second way to what Alt with Up or Down, listed above, already does'
})
