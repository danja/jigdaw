// tests/ui/appSource.js
//
// The page's own source, for the checks that have to read it because the page
// runs only in a browser: web/app.js and every module under web/app/.
//
// Walked, not listed. A check that named the files it read would go blind to
// the next module split out of the page, which is how a guard comes to be
// narrower than the thing it guards (CLAUDE.md, "a guard is only as wide as
// the list it walks").
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

/** Every file of the page, repository-relative, the entry first. */
export function appFiles () {
  const modules = readdirSync(join(root, 'web/app'))
    .filter(name => name.endsWith('.js'))
    .sort()
    .map(name => `web/app/${name}`)
  return ['web/app.js', ...modules]
}

/** One file of the page. */
export function appFile (path) {
  return readFileSync(join(root, path), 'utf8')
}

/** All of the page's source, one file after another. */
export function appSource () {
  return appFiles().map(appFile).join('\n')
}
