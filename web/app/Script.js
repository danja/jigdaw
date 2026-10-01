// web/app/Script.js
//
// The Script tab: Reel in the page. It builds the panel (src/ui/ScriptPanel.js), the clock that fires a
// script's timed statements, and the reel that checks and runs a script, and joins them to what the page
// already has: the dispatcher, the agent tools, the plugin loader and the transport.
//
// Nothing here holds a dispatcher or an engine at construction, because neither exists until the first
// thing that needs sound (web/app/Runtime.js). Runtime calls `attach` once they do.
import { ReelClock } from '../../src/reel/Clock.js'
import { createReel } from '../../src/reel/Reel.js'
import { createPluginValidator } from '../../src/reel/Host.js'
import { createScriptPanel } from '../../src/ui/ScriptPanel.js'

export function createScript (ctx) {
  const { window, $, log } = ctx

  let reel = null
  let clock = null
  let startedAt = null

  // A draft is a convenience, so storage that is absent or blocked is no reason for the tab not to work.
  const storage = (() => { try { return window.localStorage } catch { return null } })()

  const panel = createScriptPanel(ctx.document, {
    mount: $('script-mount'),
    storage,
    onRun: (source, options) => run(source, options),
    onCheck: source => check(source),
    onStop: () => stop()
  })

  const need = () => {
    if (!reel) throw new Error('the script runner is not ready: audio has not started')
    return reel
  }

  /** What the agent tool `script_run` calls, before the reel exists. It is built after the tools it runs through. */
  function agentReel () {
    return {
      check: source => need().check(source),
      run: (source, options) => need().run(source, options),
      describe: plan => need().describe(plan)
    }
  }

  /** Called by Runtime once the dispatcher, the agent tools and the loader exist. */
  function attach ({ dispatcher, tools, loader }) {
    clock = new ReelClock({ now: () => ctx.engine.context.currentTime, transport: () => dispatcher.transport() })
    reel = createReel({
      dispatcher,
      tools: Object.fromEntries(tools.map(t => [t.name, t.handler])),
      clock,
      resolvePlugin: createPluginValidator(loader),
      beatsPerBar: () => dispatcher.transport().beatsPerBar,
      currentBeat: () => (startedAt === null ? 0 : dispatcher.transport().beatAtSeconds(ctx.engine.context.currentTime - startedAt)),
      onError: e => {
        panel.log(`line ${e.line}: ${e.message}`, 'error')
        panel.status(`A statement failed on line ${e.line}, and the rest carries on. See the log.`)
      },
      onPhase: phase => {
        if (phase === 'checking') panel.status('Checking the script and loading its plugins…')
        if (phase === 'waiting') panel.status('Checked. It takes over at the next bar line.')
      }
    })
    return reel
  }

  /** The transport started: beat zero is heard at `at`, on the audio clock. */
  function clockStart (at) { startedAt = at; clock?.start(at) }
  function clockTick () { clock?.tick() }
  function clockStop () { startedAt = null; clock?.stop() }

  const problemsSentence = n => `The script has ${n} problem${n === 1 ? '' : 's'}, so nothing was changed.`

  async function check (source) {
    panel.problems(null)
    panel.plan(null)
    try {
      await ctx.runtime.ensureRunning()
      panel.status('Checking the script and loading its plugins…')
      const result = await need().check(source)
      if (!result.ok) {
        panel.problems(result.errors)
        panel.status(problemsSentence(result.errors.length))
        return
      }
      panel.plan(need().describe(result.plan))
      panel.status('Checked: no problems. Nothing has been run.')
    } catch (error) {
      panel.status(`Could not check the script: ${error.message}`)
      panel.log(error.message, 'error')
    }
  }

  async function run (source, { now = false } = {}) {
    panel.problems(null)
    panel.plan(null)
    try {
      // Pressing Run is the click the page needs to start audio, and the validator needs the loader it builds.
      await ctx.runtime.ensureRunning()
      const result = await need().run(source, { now })
      if (result.stage) {
        panel.problems(result.errors)
        panel.status(problemsSentence(result.errors.length))
        panel.log(`not run: ${result.errors.length} problem${result.errors.length === 1 ? '' : 's'}`, 'error')
        return
      }
      if (result.swapped === 'superseded') {
        panel.log('replaced by a newer run before it took over')
        return
      }
      panel.running(need().running)
      const when = result.swapped === 'at-bar' ? 'at the bar line' : 'now'
      if (!result.ok) {
        panel.problems(result.errors)
        panel.status(`Took over ${when}, with ${result.errors.length} statement${result.errors.length === 1 ? '' : 's'} failing. See the problems.`)
        panel.log(`took over ${when} with errors`, 'error')
        return
      }
      panel.status(`Running. It took over ${when}.`)
      panel.log(`took over ${when}`)
    } catch (error) {
      panel.status(`Could not run the script: ${error.message}`)
      panel.log(error.message, 'error')
      log(`script: ${error.message}`, 'error')
    }
  }

  function stop () {
    reel?.stop()
    panel.running(false)
    panel.status('Stopped.')
    panel.log('stopped')
  }

  return { panel, attach, agentReel, clockStart, clockTick, clockStop, stop }
}
