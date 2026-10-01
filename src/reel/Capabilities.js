// src/reel/Capabilities.js
//
// What a Reel script can do, as a table from each statement to the agent tool whose Op it is
// (docs/livecoding.md: a script is a third adapter over the one dispatcher, with no capability the tools
// lack). tests/reel/Capabilities.test.js binds this to src/mcp/tools.js, so a tool added later is either
// given a statement or excluded here with a reason, and cannot be silently unreachable or silently
// reachable.

/** Statement to tool. */
export const SCRIPTABLE = Object.freeze({
  load: 'plugin_load',
  set: 'parameter_set',
  ramp: 'envelope_add',
  connect: 'connection_add'
})

// Every other tool, with why a script does not have it yet. Most are the arrangement and editing tools,
// which are not a performance gesture; some are queries, which a script has no use for because it cannot
// branch on what it reads. A reason that stops being true is the cue to give the tool a statement.
export const NOT_SCRIPTABLE = Object.freeze({
  status: 'a query; a script cannot branch on a result',
  project_get: 'a query; a script cannot branch on a result',
  plugins_search: 'a query, and a script names its plugins',
  plugin_describe: 'a query, answered by the planner for every plugin the script loads',
  plugin_validate_chain: 'a query; the planner validates what a script loads',
  collection_open: 'replaces the session, which is a person\'s decision and not a gesture in a set',
  graph_apply_changes: 'the general changeset; Reel has a statement for each change it permits',
  track_add: 'arrangement editing, not yet a statement',
  track_remove: 'arrangement editing, not yet a statement',
  track_layout: 'editor layout',
  track_set: 'arrangement editing, not yet a statement',
  track_set_channel: 'a mixer gesture; wanted, and not in version one',
  node_move_to_track: 'arrangement editing, not yet a statement',
  clip_add: 'arrangement editing, not yet a statement',
  clip_add_audio: 'arrangement editing, not yet a statement',
  clip_set_notes: 'arrangement editing, not yet a statement',
  clip_move: 'arrangement editing, not yet a statement',
  clip_set: 'arrangement editing, not yet a statement',
  clip_split: 'arrangement editing, not yet a statement',
  clip_duplicate: 'arrangement editing, not yet a statement',
  clip_remove: 'arrangement editing, not yet a statement',
  envelope_set: 'a ramp replaces an envelope through envelope_add; editing points is not a gesture',
  envelope_remove: 'not yet a statement',
  node_move_in_chain: 'chain editing, not yet a statement',
  node_bypass: 'wanted for performance, and not in version one',
  node_remove: 'destructive, and not a gesture in a set',
  connection_remove: 'not yet a statement',
  parameters_set_batch: 'a script sets parameters one statement at a time, each checked',
  parameter_reset: 'not yet a statement',
  history_undo: 'a script must not undo a person\'s edits',
  history_redo: 'a script must not redo a person\'s edits',
  transport_play: 'needs user activation, and the person starts the music',
  transport_stop: 'the person stops the music',
  transport_configure: 'tempo and loop changes are wanted for performance, and not in version one',
  diagnostics: 'a query; a script cannot branch on a result',
  script_run: 'a script cannot run a script, which would let one never end'
})
