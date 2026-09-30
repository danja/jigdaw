// bin/build-icons.js
//
// The app icons, drawn here and written as PNG: three bars of a sequence and a
// playhead across them, on the page's own dark background. No image tool and no
// dependency: a PNG is a few chunks and node has zlib. Deterministic, so the same
// run writes the same bytes and a diff shows a change of design and nothing else.
//
// Committed on purpose, like the bundle: the server has no build step.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { crc32 } from '../src/host/Zip.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKGROUND = [0x13, 0x16, 0x1b]
const BAR = [0x3e, 0x8e, 0xf7]
const HEAD = [0xff, 0xd1, 0x66]

/** Rounded rectangle test, in unit coordinates. */
const inRounded = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/**
 * The colour at a point of the unit square. `inset` shrinks the drawing towards
 * the middle: a maskable icon may be cropped to a circle, so its picture stays
 * inside the central 80%.
 */
function colourAt (u, v, inset) {
  const x = (u - 0.5) / (1 - inset) + 0.5
  const y = (v - 0.5) / (1 - inset) + 0.5
  // The playhead, over the bars.
  if (inRounded(x, y, 0.55, 0.16, 0.6, 0.84, 0.025)) return HEAD
  const bars = [[0.16, 0.5, 0.26], [0.26, 0.82, 0.44], [0.16, 0.66, 0.62]]
  for (const [a, b, top] of bars) if (inRounded(x, y, a, top, b, top + 0.12, 0.05)) return BAR
  return BACKGROUND
}

function png (size, { inset = 0 } = {}) {
  const samples = 3
  const rows = []
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const c = colourAt((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size, inset)
          for (let k = 0; k < 3; k++) sum[k] += c[k]
        }
      }
      for (let k = 0; k < 3; k++) row[1 + px * 4 + k] = Math.round(sum[k] / (samples * samples))
      row[1 + px * 4 + 3] = 255
    }
    rows.push(row)
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(8 + data.length + 4)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export const ICONS = Object.freeze([
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.2 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0 }
])

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = resolve(root, 'web/icons')
  mkdirSync(dir, { recursive: true })
  for (const { file, size, inset } of ICONS) {
    writeFileSync(resolve(dir, file), png(size, { inset }))
    console.log(`web/icons/${file}: ${size}x${size}`)
  }
}
