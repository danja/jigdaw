// bin/wam-fixtures.js
//
// Build what web/foreign/probe.html needs to run.
//
// The probe checks the one part of contract section 12 that no test in this
// repository can reach: a container served from a service worker, and a real
// Web Audio Module imported out of it. That needs a real WAM, and the ones in
// webaudiomodules/wam-examples are somebody else's MIT code. They are built
// here on demand rather than committed, because a vendored build artefact goes
// stale silently and because they are not ours to ship.
//
// So the probe is live and its inputs are not, which is a page that 404s unless
// somebody runs this. The probe says so when they are missing rather than
// failing at the first fetch, and this is the command it names.
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { deflateRawSync, crc32 } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'web/foreign')
const examples = process.env.WAM_EXAMPLES ?? join(homedir(), 'wam-examples/packages')
const PLUGIN = 'pingpongdelay'

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

/** The same deterministic writer bin/bundle.js uses, fixed date and all. */
function zip (entries) {
  const locals = []; const central = []; let offset = 0
  for (const { name, bytes } of entries) {
    const deflated = deflateRawSync(bytes, { level: 9 })
    const stored = deflated.length >= bytes.length
    const body = stored ? bytes : deflated
    const method = stored ? 0 : 8
    const nameBytes = Buffer.from(name, 'utf8')
    const sum = crc32(bytes)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0x21),
      u32(sum), u32(body.length), u32(bytes.length),
      u16(nameBytes.length), u16(0), nameBytes, body
    ])
    locals.push(local)
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0x21),
      u32(sum), u32(body.length), u32(bytes.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
    ]))
    offset += local.length
  }
  const directory = Buffer.concat(central)
  return Buffer.concat([...locals, directory, Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.length), u32(offset), u16(0)
  ])])
}

if (!existsSync(examples)) {
  console.error(`no WAM examples at ${examples}`)
  console.error('  git clone --recurse-submodules https://github.com/webaudiomodules/wam-examples ~/wam-examples')
  console.error('  or set WAM_EXAMPLES to a checkout of its packages/ directory')
  process.exit(1)
}

const { build } = await import('esbuild')
const alias = name => join(examples, name, 'src/index.js')

await mkdir(out, { recursive: true })
const staging = join(out, '.staging')
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })

// The plugin, bundled the way a real one is distributed: one ES module that
// still locates itself with import.meta.url and still fetches its own
// descriptor, which is what makes it a fair test of the virtual origin.
await build({
  entryPoints: [join(examples, PLUGIN, 'src/index.js')],
  outfile: join(staging, 'index.js'),
  bundle: true, format: 'esm', logLevel: 'warning',
  alias: {
    '@webaudiomodules/sdk': alias('sdk'),
    '@webaudiomodules/sdk-parammgr': alias('sdk-parammgr'),
    '@webaudiomodules/api': alias('api')
  },
  loader: { '.html': 'text', '.css': 'text', '.png': 'dataurl' }
})

for (const asset of ['descriptor.json', 'screenshot.png']) {
  const from = join(examples, PLUGIN, 'src', asset)
  if (existsSync(from)) await writeFile(join(staging, asset), await readFile(from))
}

const names = (await readdir(staging)).sort()
const container = zip(await Promise.all(
  names.map(async name => ({ name, bytes: await readFile(join(staging, name)) }))))
await writeFile(join(out, `${PLUGIN}.wam`), container)
await rm(staging, { recursive: true, force: true })

// The WAM runtime the HOST installs in its own worklet. Contract section 12.3a:
// it is shared by every WAM in the context, it is in no container, and it is
// the host's code rather than a plugin's.
await build({
  entryPoints: [join(examples, 'sdk/src/initializeWamHost.js')],
  outfile: join(out, 'wam-host.js'),
  bundle: true, format: 'esm', logLevel: 'warning'
})

const digest = await crypto.subtle.digest('SHA-384', container)
const sri = 'sha384-' + Buffer.from(digest).toString('base64')

console.log(`web/foreign/${PLUGIN}.wam   ${container.length} bytes, ${names.length} files`)
console.log(`  ${names.join(', ')}`)
console.log(`  ${sri}`)
console.log('web/foreign/wam-host.js  the WAM runtime the host installs, per contract 12.3a')
console.log('')
console.log('Both are built from webaudiomodules/wam-examples, which is MIT and not ours to')
console.log('commit, so they are gitignored. Open /foreign/probe.html to run the check.')
