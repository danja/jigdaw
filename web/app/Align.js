// web/app/Align.js
//
// Whether tracks are lined up with one another for latency (docs/latency.md,
// "Between tracks"): a checkbox on the Mixer tab, since it is a mixing matter.
// The starting value is web/host.json's `alignTracks`. A person's own choice is
// remembered in this browser and wins over the file, so changing it once is
// enough; a storage that is blocked only means the file's value applies again.
// A session can say too (`jig:alignTracks`, docs/project-format.md): once a person
// changes the box the session carries that, and a session that says wins over the
// person's own preference when it is opened, so two people hear it the same way.
// A session that does not say leaves the person's preference to decide.
const KEY = 'jigdaw.alignTracks'

export function createAlign (ctx) {
  const { window, $, log } = ctx

  /** The person's choice if they have made one, else `fallback` (the config's value). */
  function preferred (fallback) {
    try {
      const stored = window.localStorage.getItem(KEY)
      if (stored === '1') return true
      if (stored === '0') return false
    } catch { /* storage unavailable */ }
    return fallback
  }

  /** Show what the dispatcher is doing, and whether the session is what says so. */
  function sync () {
    const on = ctx.dispatcher?.alignTracks
    if (on === undefined) return
    $('align-tracks').checked = on
    const said = ctx.dispatcher.project.settings.alignTracks !== null
    $('align-status').textContent = (on
      ? 'Tracks with less latency are delayed to line up with the slowest.'
      : 'Tracks are not lined up: a track with latency sounds later than one without.') +
      (said ? ' This session says so.' : '')
  }

  /**
   * A session was opened or started: what it says is used, and one that says nothing gets the person's own preference,
   * so the last session's setting does not carry over to a session that never stated one.
   */
  function fromSession () {
    const d = ctx.dispatcher
    const said = d.project.settings.alignTracks
    d.setAlignTracks(said ?? preferred(ctx.hostConfig.alignTracks))
    sync()
    ctx.rack?.draw()
  }

  function mount () {
    $('align-tracks').addEventListener('change', async () => {
      const on = $('align-tracks').checked
      try { window.localStorage.setItem(KEY, on ? '1' : '0') } catch { /* storage unavailable */ }
      const d = await ctx.runtime.ensureRunning().catch(error => { log(error.message, 'error'); return null })
      d?.setAlignTracks(on)
      // The session now says, and carries it when saved.
      d?.project.setSettings({ alignTracks: on })
      sync()
      ctx.rack.draw()
    })
  }

  return { preferred, sync, fromSession, mount }
}
