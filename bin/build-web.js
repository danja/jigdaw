// bin/build-web.js
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const result = await build({
  entryPoints: [resolve(root, 'web/app.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: resolve(root, 'web/app.bundle.js'),
  sourcemap: true,
  // See web/shims/stream.js: unreachable code paths in two RDF dependencies.
  alias: {
    stream: resolve(root, 'web/shims/stream.js'),
    util: resolve(root, 'web/shims/util.js')
  },
  logLevel: 'warning',
  metafile: true
})

const bytes = Object.values(result.metafile.outputs)[0].bytes
console.log(`web/app.bundle.js: ${(bytes / 1024).toFixed(0)} KB`)
