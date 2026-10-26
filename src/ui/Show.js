// src/ui/Show.js
//
// What the studio page draws at each step: Simple, Standard and Advanced (docs/learning-curve.md).
//
// One list says, for each control, the first step at which it is drawn. The page applies it by putting that step on the element
// as `data-from`, and a rule in web/index.html leaves out what the current step does not reach. A control that is not drawn is
// not disabled: it is out of the layout, the tab order and the accessibility tree, which is the project's rule for a control
// nobody can use. Nothing here is a lock, since the step is a view and the person can change it at any time.
//
// Keys are CSS selectors, so a control and the wrapper that would otherwise be left behind empty are both nameable. A child
// may be drawn later than its parent and never earlier, because a drawn child inside an undrawn parent is still not on the
// screen; tests/web/Show.test.js walks the page and binds this list to it in both directions.

export const STEPS = Object.freeze(['simple', 'standard', 'advanced'])

export const STEP_LABELS = Object.freeze({ simple: 'Simple', standard: 'Standard', advanced: 'Advanced' })

/** The width at which the page is one column, as web/index.html draws it. A phone starts on Simple. */
export const NARROW_QUERY = '(max-width: 760px)'

export const FROM = Object.freeze({
  // The transport bar is in groups, each named for a screen reader. A group is drawn from the first step of its first control, and
  // never earlier than any control in it, since a drawn control inside an undrawn group is not on the screen.
  '#group-view': 'simple',
  '#group-play': 'simple',
  '#group-time': 'simple',
  '#group-input': 'standard',
  '#group-edit': 'simple',
  '#group-file': 'simple',
  '#transport-more': 'advanced',
  // Play, stop and the things a person needs the first minute.
  '#toggle-browser': 'simple',
  '#toggle-keys': 'simple',
  '#play': 'simple',
  '#stop': 'simple',
  '#loop': 'simple',
  '#metronome': 'simple',
  '#count-in-group': 'simple',
  '#tempo-group': 'simple',
  '#show-group': 'simple',
  '#undo': 'simple',
  '#redo': 'simple',
  '#save': 'simple',
  '#open': 'simple',
  '#clip': 'simple',
  // Making a piece: recording, playing in, tapping a tempo, moving notes and sound in and out.
  '#record': 'standard',
  '#record-midi': 'standard',
  '#tap-tempo': 'standard',
  '#signature-group': 'standard',
  '#midi-in': 'standard',
  '#mic-in': 'standard',
  '#export': 'standard',
  '#export-midi': 'standard',
  '#import-midi': 'standard',
  // Building: the controls whose job is to put right something that went wrong, or to publish.
  '#panic': 'advanced',
  '#export-stems': 'advanced',
  '#install': 'advanced',
  // The tabs, which web/app.js builds. Simple has none: the arrangement is the whole stage.
  '#tab-arrangement': 'simple',
  '#tab-mixer': 'standard',
  '#tab-launcher': 'standard',
  '#tab-settings': 'standard',
  '#tab-tracks': 'advanced',
  '#tab-routing': 'advanced',
  '#tab-script': 'advanced',
  // Below the stage.
  '#history': 'standard',
  '#log-details': 'advanced',
  // In the Settings tab.
  '#local-agent': 'advanced',
  '#bridge': 'advanced'
})

/** Whether a thing whose first step is `from` is drawn at `step`. */
export function drawnAt (step, from) {
  const at = STEPS.indexOf(step)
  const first = STEPS.indexOf(from)
  if (at === -1) throw new Error(`no such step: ${step}`)
  if (first === -1) throw new Error(`no such step: ${from}`)
  return at >= first
}

/** `value` if it names a step, else null. For what storage or a select hands back, which may be anything. */
export function asStep (value) {
  return STEPS.includes(value) ? value : null
}

/** Where a visit starts when the person has not chosen: Simple on a phone, Standard on a desktop. Advanced is never a default. */
export function defaultStep ({ narrow }) {
  return narrow ? 'simple' : 'standard'
}

/** The tab ids drawn at `step`, in the order given, from a list of `{ id }`. */
export function tabsDrawnAt (step, tabs) {
  return tabs.filter(tab => drawnAt(step, FROM[`#tab-${tab.id}`])).map(tab => tab.id)
}
