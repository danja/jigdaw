// src/ui/ClipHold.js
//
// Whether the output has clipped since it was last cleared. A meter shows the level now and a clip lasts a
// few samples, so the moment it happened is gone by the time anyone looks; this holds it until a person
// says they have seen it. Pure: it is handed the peak of each frame and says nothing about how it is shown.

/** A sample at or above this is at the top of the range, which is where Web Audio's output stops. */
export const CLIP_LEVEL = 0.999

export function createClipHold ({ level = CLIP_LEVEL } = {}) {
  if (!(level > 0 && level <= 1)) throw new Error(`a clip level is above 0 and at most 1: ${level}`)
  let clipped = false
  return {
    /** Feed the largest absolute sample of a frame. Returns whether the output has clipped since it was cleared. */
    update (peak) {
      if (peak >= level) clipped = true
      return clipped
    },
    clear () { clipped = false },
    get clipped () { return clipped }
  }
}
