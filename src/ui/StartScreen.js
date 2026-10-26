// src/ui/StartScreen.js
//
// What an empty session offers, as groups of actions: play a tune, start a new piece, open something already made
// (docs/learning-curve.md, "A first hour").
//
// The groups are data and the Timeline draws them, so the order and the words are decided here and nothing about a button is
// decided in the drawing. A group with nothing in it is left out: a person with no saved templates is not shown an empty
// "From a template", and a page whose tunes have not arrived yet shows the others.
//
// Tunes are the bundled presets, the same list the simple page offers (web/presets/index.json), so a person who has seen one page
// finds the same names on the other.

/**
 * `tunes` and `templates` are lists of names. `run` has one function per thing the screen can do; each is called with no
 * arguments except `tune(name)` and `template(name)`, which are given the name that was pressed.
 */
export function describeStart ({ tunes, templates, run }) {
  for (const key of ['tune', 'template', 'emptyTrack', 'sound', 'browse', 'open']) {
    if (typeof run[key] !== 'function') throw new Error(`the start screen needs run.${key}`)
  }
  const groups = [
    { heading: 'Play a tune', actions: tunes.map(name => ({ label: name, run: () => run.tune(name) })) },
    {
      heading: 'Start a new piece',
      actions: [
        { label: 'A track with a sound', run: () => run.sound() },
        { label: 'An empty track', run: () => run.emptyTrack() },
        { label: 'Find a plugin', run: () => run.browse() }
      ]
    },
    { heading: 'From a template', actions: templates.map(name => ({ label: name, run: () => run.template(name) })) },
    { heading: 'Open a saved piece', actions: [{ label: 'Choose a file', run: () => run.open() }] }
  ]
  return groups.filter(group => group.actions.length > 0)
}
