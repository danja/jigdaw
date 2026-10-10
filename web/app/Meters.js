// web/app/Meters.js
//
// Feeds the level meters on the Mixer tab: one per track, from an analyser on what the track sounds like
// after its fader and pan (Engine.trackMeter), and the master's, from the analyser the whole mix goes
// through. One animation frame loop for all of them, drawing only the meters that are on the screen, so a
// hidden tab costs nothing and a track with no meter showing never gets an analyser at all.
//
// The meters themselves are src/ui/Meter.js, and what they show is src/ui/MeterModel.js; this is only the
// part that reads the audio, which needs a browser.

/** The largest absolute sample in an analyser's latest window. */
function peakOf (analyser, data) {
  analyser.getFloatTimeDomainData(data)
  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  return peak
}

export function createMeters (ctx) {
  // A track's analyser and the buffer it is read into, kept so a frame allocates nothing.
  const taps = new Map()
  let masterData = null

  const onScreen = meter => meter.element.isConnected && meter.element.getClientRects().length > 0

  function frame (now) {
    const { engine } = ctx
    // Before the first load there is no engine and nothing to measure; the loop simply waits for one.
    if (engine) {
      const meters = ctx.rack.meters()
      for (const id of [...taps.keys()]) if (!meters.has(id)) taps.delete(id)
      for (const [id, meter] of meters) {
        if (!onScreen(meter)) continue
        let tap = taps.get(id)
        if (!tap) {
          const analyser = engine.trackMeter(id)
          tap = { analyser, data: new Float32Array(analyser.fftSize) }
          taps.set(id, tap)
        }
        meter.set(peakOf(tap.analyser, tap.data), now)
      }
      const master = ctx.master.meter
      if (ctx.analyser && onScreen(master)) {
        masterData ??= new Float32Array(ctx.analyser.fftSize)
        master.set(peakOf(ctx.analyser, masterData), now)
      }
    }
    requestAnimationFrame(frame)
  }

  return { start () { requestAnimationFrame(frame) } }
}
