// src/engine/Chance.js
//
// A note's chance of playing (jig:chance). The draw is a number from 0 up to but not including 1, made from a key the caller builds out of what
// identifies the moment: the node it plays into, the pitch, and the time it falls at. Never from a clock or a random generator, so the same piece
// rendered twice, offline or live from the same start, makes the same choices; and because a loop pass falls at a different time, each pass
// draws again. FNV-1a over the key's characters, finished with a mix so near keys do not give near draws.

/** The draw for a key, in [0, 1). */
export function drawFor (key) {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Whether a note with `chance` (absent is 1) sounds at this moment. */
export function sounds (chance, key) {
  if (chance === undefined || chance >= 1) return true
  return drawFor(key) < chance
}
