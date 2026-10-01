// src/ui/ScriptPanel.js
//
// The Script tab's contents: a text area for a Reel script, the buttons that run it, and what comes back.
// It builds elements and calls what it is handed, and knows nothing of Reel, the engine or the page
// (web/app/Script.js is that glue), the same split as Tabs.js and Dial.js.
//
// Built to the interface rules in CLAUDE.md, which here mean:
//  - Every control has a name. The text area has a visible label, and its help and its status are
//    described to it, so a screen reader hears what the box is and how the last run went.
//  - Keyboard before pointer: Control+Enter runs and Control+Shift+Enter runs now, the buttons are real
//    buttons in Tab order, and each problem has a button that puts the caret on its line.
//  - No state by colour alone: an error is the word "Error" or "Line N", never a red line by itself.
//  - A control nobody can use is left out, not shown disabled: Stop is not there until something is running,
//    and Problems and the plan are not there until there is one.
//  - Phone: one column, 16px text in the text area (iOS zooms the page in on anything smaller), and buttons
//    of 44px, set in web/index.html.
//
// The draft is kept in storage only as a convenience: a script typed live is not lost to a reload. Storage
// may be absent or throw, and the panel works the same without it.

const EXAMPLE = `# Reel. One statement per line; the first thing on a line is what it does.
# Load a plugin by its address, then set its parameters, in their units:
#   load verb = https://example.org/plugins/cascade/
#   verb.mix = 35%
#   at 3:1 verb.size = 40
#   every 1 bar: verb.mix = pick(20%, 35%, 50%)
#   ramp verb.size 10 -> 60 over 4 bars
# Edit and run again while the music plays: the new script takes over at the next bar line.
`

const SYNTAX = [
  ['load NAME = ADDRESS', 'Fetch, validate and load a plugin. The address is written out in full.'],
  ['NAME.parameter = VALUE', 'Set a parameter now. A value can carry a unit: 8kHz, 250ms, -6dB, 7st, 35%.'],
  ['at BAR:BEAT NAME.parameter = VALUE', 'Set it when the transport reaches bar 3 beat 1, as 3:1. Beats count from 1.'],
  ['every N bars: NAME.parameter = VALUE', 'Set it again at every bar line, or every N beats. Use pick(a, b, c) or rand(low, high).'],
  ['ramp NAME.parameter FROM -> TO over N bars', 'Move a parameter smoothly. It starts on the next bar line.'],
  ['connect A -> B', 'Connect one plugin to another.'],
  ['let NAME = VALUE', 'Name a value to use below. seed N makes the random choices repeat.']
]

const LOG_LIMIT = 50

export function createScriptPanel (document, { mount, onRun, onCheck, onStop, storage = null, draftKey = 'jigdaw.reel.draft' }) {
  for (const [name, fn] of Object.entries({ onRun, onCheck, onStop })) {
    if (typeof fn !== 'function') throw new Error(`the script panel needs ${name}`)
  }

  const el = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attributes)) {
      if (value === false || value === null || value === undefined) continue
      node.setAttribute(key, value === true ? '' : String(value))
    }
    node.append(...children)
    return node
  }

  const button = (id, text, extra = {}) => el('button', { type: 'button', id, class: 'script-button', ...extra }, text)

  const help = el('p', { id: 'script-help', class: 'note' },
    'Reel drives the plugins from text. Run it to take over at the next bar line, or run it now. ' +
    'Nothing runs until the script has been checked in full, and a script with a problem changes nothing.')

  const source = el('textarea', {
    id: 'script-source', class: 'script-source', rows: 14, spellcheck: 'false', autocapitalize: 'off',
    autocomplete: 'off', autocorrect: 'off', 'aria-describedby': 'script-help script-status'
  })
  const label = el('label', { for: 'script-source', class: 'script-label' }, 'Reel script')

  const run = button('script-run', 'Run at the next bar', { 'aria-keyshortcuts': 'Control+Enter' })
  const runNow = button('script-run-now', 'Run now', { 'aria-keyshortcuts': 'Control+Shift+Enter' })
  const check = button('script-check', 'Check only')
  const stop = button('script-stop', 'Stop script', { hidden: true })
  const actions = el('div', { class: 'script-actions', role: 'group', 'aria-label': 'Script actions' }, run, runNow, check, stop)

  const status = el('p', { id: 'script-status', class: 'script-status', role: 'status' })

  const problemsHeading = el('h3', { id: 'script-problems-heading' }, 'Problems')
  const problemsList = el('ol', { class: 'script-problems-list' })
  const problems = el('section', { class: 'script-problems', 'aria-labelledby': 'script-problems-heading', hidden: true }, problemsHeading, problemsList)

  const planHeading = el('h3', { id: 'script-plan-heading' }, 'What this script would do')
  const planList = el('ul', { class: 'script-plan-list' })
  const plan = el('section', { class: 'script-plan', 'aria-labelledby': 'script-plan-heading', hidden: true }, planHeading, planList)

  const syntax = el('details', { class: 'script-syntax' },
    el('summary', {}, 'Syntax'),
    el('dl', {}, ...SYNTAX.flatMap(([form, what]) => [el('dt', {}, el('code', {}, form)), el('dd', {}, what)])))

  const logHeading = el('h3', { id: 'script-log-heading' }, 'Log')
  const logList = el('ol', { class: 'script-log-list', 'aria-live': 'polite' })
  const logSection = el('section', { class: 'script-log', 'aria-labelledby': 'script-log-heading' }, logHeading, logList)

  mount.append(help, label, source, actions, status, problems, plan, syntax, logSection)

  // The draft, restored if there is one. Storage may throw, in a private window or with site data blocked.
  const read = () => { try { return storage?.getItem(draftKey) ?? null } catch { return null } }
  const write = text => { try { storage?.setItem(draftKey, text) } catch { /* a draft is a convenience */ } }
  source.value = read() ?? EXAMPLE
  source.addEventListener('input', () => write(source.value))

  const text = () => source.value

  run.addEventListener('click', () => onRun(text(), { now: false }))
  runNow.addEventListener('click', () => onRun(text(), { now: true }))
  check.addEventListener('click', () => onCheck(text()))
  stop.addEventListener('click', () => onStop())

  // Control+Enter, and Meta+Enter on a Mac, run the script from inside the box: the way a live coder
  // expects, and without a trip to the buttons.
  source.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    onRun(text(), { now: event.shiftKey === true })
  })

  /** Put the caret on a line, selecting it, and move the focus there. */
  function goToLine (line) {
    const lines = source.value.split('\n')
    const index = Math.min(Math.max(line, 1), lines.length) - 1
    const start = lines.slice(0, index).reduce((n, l) => n + l.length + 1, 0)
    source.focus()
    if (typeof source.setSelectionRange === 'function') source.setSelectionRange(start, start + lines[index].length)
  }

  const clear = node => { while (node.firstChild) node.removeChild(node.firstChild) }

  return {
    /** The script as typed. */
    source: text,
    setSource (value) { source.value = value; write(value) },

    /** A line of text for the status region, which a screen reader announces. Empty clears it. */
    status (message) { status.textContent = message ?? '' },

    /** Show whether a script is running. Stop is there only while one is. */
    running (isRunning) { if (isRunning) stop.removeAttribute('hidden'); else stop.setAttribute('hidden', '') },

    /** Problems with their lines, or nothing to take the section away. */
    problems (list) {
      clear(problemsList)
      if (!list?.length) { problems.setAttribute('hidden', ''); return }
      problemsHeading.textContent = `Problems (${list.length})`
      for (const p of list) {
        const where = p.line ? `Line ${p.line}${p.column ? `, column ${p.column}` : ''}: ` : ''
        const item = el('li', {}, el('span', { class: 'script-error-word' }, 'Error'), ` ${where}${p.message} `)
        if (p.line) {
          const go = button(`script-go-${p.line}`, 'Go to line', { 'aria-label': `Go to line ${p.line}` })
          go.addEventListener('click', () => goToLine(p.line))
          item.append(go)
        }
        problemsList.append(item)
      }
      problems.removeAttribute('hidden')
    },

    /** What a checked script would do, as the plan's own description, or nothing to take it away. */
    plan (described) {
      clear(planList)
      if (!described) { plan.setAttribute('hidden', ''); return }
      for (const l of described.loads) planList.append(el('li', {}, `Line ${l.line}: load ${l.name} from ${l.iri}`))
      for (const s of described.steps) planList.append(el('li', {}, `Line ${s.line}, ${s.when}: ${s.do}`))
      if (!planList.firstChild) planList.append(el('li', {}, 'Nothing: the script has no statements.'))
      plan.removeAttribute('hidden')
    },

    /** One line in the log, newest first. An error says so in words. */
    log (message, kind = 'info') {
      const item = el('li', { class: `script-log-${kind}` }, kind === 'error' ? `Error: ${message}` : message)
      logList.prepend(item)
      while (logList.children.length > LOG_LIMIT) logList.removeChild(logList.lastChild)
    },

    goToLine,
    focus () { source.focus() },
    elements: { source, run, runNow, check, stop, status, problems, plan, logList }
  }
}

export const REEL_EXAMPLE = EXAMPLE
