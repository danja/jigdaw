// bin/is-main.js
//
// Is this module the script node was asked to run?
//
// Compared by real path. `process.argv[1]` is the path as it was typed, and `import.meta.url` is where node found the file, so
// the same script reached through a symlink or a second mount of the same directory differs between them. A script that
// guards its work with the raw comparison then does nothing and exits 0, which looks like success: found when
// bin/inline-ui.js wrote no file under /home/... for a checkout at /chalet/..., and the same line was in a dozen other scripts.
// tests/bin/is-main.test.js forbids the raw comparison anywhere in bin/.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** @param {string} moduleUrl the calling module's `import.meta.url` */
export function isMain (moduleUrl) {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    // argv[1] names no file (node -e, a REPL, a stdin script), so no module is the main one.
    return false
  }
}
