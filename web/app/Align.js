// web/app/Align.js
//
// Whether tracks are lined up with one another for latency (docs/latency.md,
// "Between tracks"): a checkbox on the Mixer tab, since it is a mixing matter.
// The starting value is web/host.json's `alignTracks`. A person's own choice is
// remembered in this browser and wins over the file, so changing it once is
// enough; a storage that is blocked only means the file's value applies again.
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

  /** Show what the dispatcher is doing. Left alone while the box has the focus. */
  function sync () {
    const on = ctx.dispatcher?.alignTracks
    if (on === undefined) return
    $('align-tracks').checked = on
    $('align-status').textContent = on
      ? 'Tracks with less latency are delayed to line up with the slowest.'
      : 'Tracks are not lined up: a track with latency sounds later than one without.'
  }

  function mount () {
    $('align-tracks').addEventListener('change', async () => {
      const on = $('align-tracks').checked
      try { window.localStorage.setItem(KEY, on ? '1' : '0') } catch { /* storage unavailable */ }
      const d = await ctx.runtime.ensureRunning().catch(error => { log(error.message, 'error'); return null })
      d?.setAlignTracks(on)
      sync()
      ctx.rack.draw()
    })
  }

  return { preferred, sync, mount }
}
