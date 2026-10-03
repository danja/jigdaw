// bin/build-web.js
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const result = await build({
  // The studio page, the simple page and the Reel page: three front ends over the same modules.
  entryPoints: {
    'app.bundle': resolve(root, 'web/app.js'),
    'simple.bundle': resolve(root, 'web/simple.js'),
    'reel.bundle': resolve(root, 'web/reel.js')
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outdir: resolve(root, 'web'),
  sourcemap: true,
  // See web/shims/stream.js: unreachable code paths in two RDF dependencies.
  alias: {
    stream: resolve(root, 'web/shims/stream.js'),
    util: resolve(root, 'web/shims/util.js')
  },
  logLevel: 'warning',
  metafile: true
})

for (const [file, { bytes }] of Object.entries(result.metafile.outputs)) {
  if (file.endsWith('.js')) console.log(`${file}: ${(bytes / 1024).toFixed(0)} KB`)
}
