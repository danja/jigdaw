// web/app/Click.js
//
// The sound of the metronome: a short sine blip, higher on the first beat of a bar. It goes straight to the context's
// destination and not through the engine, so it is not in a track, not on the meter, and not in a bounce: the click
// is for the person, and the mix must not have it in. Nodes are made at the moment a click is scheduled, which is
// on the message thread and not in process().
const ACCENT_HZ = 1568
const BEAT_HZ = 1046
const LENGTH_S = 0.06

export function createClickVoice (context) {
  return function click (when, accent) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.frequency.value = accent ? ACCENT_HZ : BEAT_HZ
    gain.gain.setValueAtTime(accent ? 0.5 : 0.3, when)
    gain.gain.exponentialRampToValueAtTime(0.001, when + LENGTH_S)
    osc.connect(gain).connect(context.destination)
    osc.start(when)
    osc.stop(when + LENGTH_S + 0.01)
  }
}
