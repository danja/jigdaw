// bin/jig.js
//
// A minimal Jig plugin host, roughly equivalent to jalv for LV2.
//
// jalv lists installed plugins, shows their ports, and runs one with a UI.
// A Jig is a URL rather than something installed, so "installed" here means
// the plugins this repository holds under plugins/, read through
// plugins/index.json the same way bin/serve.js reads them. Anything else is
// fetched by IRI, through the same contract steps bin/host.js uses.
//
// Usage:
//   node bin/jig.js list [--json]
//   node bin/jig.js info <name-or-IRI> [--root PREFIX=DIR]... [--json]
//   node bin/jig.js panel <name-or-IRI> --out panel.html [--root PREFIX=DIR]...
//   node bin/jig.js render IRI... [--root PREFIX=DIR]... [--seconds N]
//                                 [--note NOTE@TIME[:OFFTIME]]... [--out FILE.wav]
//                                 [--sample-rate N] [--no-validate]
//   node bin/jig.js shot <name-or-IRI> --out shot.png [--width N] [--height N]
//                                       [--root PREFIX=DIR]...
//
// A bare directory name (e.g. "pulse") means the plugin under plugins/ of
// that name. Anything else is an IRI, fetched from the network unless a
// --root prefix maps it onto a local directory, exactly like bin/host.js.
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseHTML } from 'linkedom'
import { parseText } from '../src/rdf/parse.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import { pluginDirs } from '../src/catalogue/PluginDirectories.js'
import { createPanel } from '../src/ui/Panel.js'
import { renderChain } from '../src/host/ReferenceHost.js'
import { encodeWav } from '../src/host/Wav.js'
import { shapeValidatorFromFile } from '../src/validate/files.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'plugins')
const indexPath = join(pluginsDir, 'index.json')

const PROFILE_ACCEPT = 'text/turtle, application/ld+json;q=0.9'

/** Every string from a profile is data, never markup (contract section 11). */
export function escapeHtml (value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

/** The local catalogue, as bin/serve.js reads it. */
export async function listLocalPlugins () {
  const body = JSON.parse(await readFile(indexPath, 'utf8'))
  if (!Array.isArray(body.plugins)) throw new Error('plugins/index.json holds no plugins array')
  return body.plugins
}

export function dirNameOf (iri) {
  return basename(new URL(iri).pathname.replace(/\/$/, ''))
}

function usage () {
  console.error(
    'usage:\n' +
    '  node bin/jig.js list [--json]\n' +
    '  node bin/jig.js info <name-or-IRI> [--root PREFIX=DIR]... [--json]\n' +
    '  node bin/jig.js panel <name-or-IRI> --out panel.html [--root PREFIX=DIR]...\n' +
    '  node bin/jig.js render IRI... [options, see bin/host.js]\n' +
    '  node bin/jig.js shot <name-or-IRI> --out shot.png [--width N] [--height N] [--root PREFIX=DIR]...'
  )
}

/** Read a profile.ttl file and return the host's profile object. */
async function profileFromFile (file) {
  const text = await readFile(file, 'utf8')
  return readProfile(await parseText(text, pathToFileURL(file).href))
}

/** Fetch an IRI's profile text, honouring --root mappings onto local dirs. */
async function fetchProfileText (iri, roots) {
  for (const [prefix, dir] of Object.entries(roots)) {
    if (!iri.startsWith(prefix)) continue
    const rest = iri.slice(prefix.length) || 'profile.ttl'
    return readFile(resolve(dir, rest), 'utf8')
  }
  const response = await globalThis.fetch(iri, { headers: { accept: PROFILE_ACCEPT } })
  if (!response.ok) throw new Error(`${iri} returned ${response.status}`)
  return response.text()
}

/**
 * Resolve a CLI target to a profile: a bare plugin directory name, a local
 * path, or an IRI (mapped through --root where it matches).
 */
export async function resolveProfile (target, roots = {}) {
  if (/^[A-Za-z0-9_-]+$/.test(target)) {
    const file = join(pluginsDir, target, 'profile.ttl')
    if (existsSync(file)) return { profile: await profileFromFile(file), name: target }
  }
  const asPath = resolve(target)
  if (existsSync(asPath)) {
    const { stat } = await import('node:fs/promises')
    const info = await stat(asPath)
    const file = info.isDirectory() ? join(asPath, 'profile.ttl') : asPath
    const name = basename(info.isDirectory() ? asPath : dirname(asPath))
    return { profile: await profileFromFile(file), name }
  }
  const text = await fetchProfileText(target, roots)
  const profile = readProfile(await parseText(text, target), { baseIRI: target })
  return { profile, name: dirNameOf(profile.iri) }
}

let cachedStyle = null
/** The page stylesheet, so a standalone panel looks like the one in Jiggy. */
export async function panelStyle () {
  if (cachedStyle) return cachedStyle
  const page = await readFile(join(root, 'web/index.html'), 'utf8')
  const match = /<style>([\s\S]*)<\/style>/.exec(page)
  if (!match) throw new Error('web/index.html holds no <style> block to reuse')
  cachedStyle = match[1]
  return cachedStyle
}

/**
 * A standalone page holding one plugin's generated panel. Rendered with the
 * same createPanel Jiggy uses, so a screenshot of this page is a screenshot
 * of the real control surface.
 */
export async function renderPanelHTML (profile) {
  const { document } = parseHTML('<!doctype html><html><body></body></html>')
  const { element } = createPanel(document, profile, () => {})
  const style = await panelStyle()
  const ports = profile.ports.length
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(profile.label ?? profile.iri)} panel</title>
<style>${style}</style>
<style>body{max-width:900px;margin:24px auto;padding:0 16px}</style>
</head>
<body>
<p><a href="/">Jiggy</a> / <a href="/gallery.html">plugin gallery</a></p>
<h1>${escapeHtml(profile.label ?? profile.iri)}</h1>
<p>${escapeHtml(profile.comment ?? '')}</p>
<p>${escapeHtml(profile.iri)} . ${ports} control${ports === 1 ? '' : 's'}.</p>
${element.outerHTML}
</body>
</html>
`
}

function formatInfo (profile) {
  const lines = [
    `${profile.label} <${profile.iri}>`,
    `roles:    ${profile.roles.join(', ') || '(none)'}`,
    `accepts:  ${profile.accepts.join(', ') || '(none)'} -> produces: ${profile.produces.join(', ') || '(none)'}`,
    `requires: ${profile.requires.join(', ') || '(none)'}`,
    `audio:    ${profile.audioInputs} in, ${profile.audioOutputs} out (${profile.outputChannels}ch)`,
    `latency:  ${profile.latencyFrames} frames, tail: ${profile.tailFrames ?? '(none)'}`,
    `module:   ${profile.module?.location ?? '(none)'} [${profile.module?.integrity?.slice(0, 19) ?? '?'}...]`,
    `processor:${profile.processor?.location ?? '(none)'} [${profile.processor?.integrity?.slice(0, 19) ?? '?'}...]`,
    '',
    'ports:'
  ]
  for (const port of profile.ports) {
    const range = `${port.minimum}..${port.maximum} (default ${port.defaultValue})`
    const extra = [
      port.widget,
      port.unit ? port.unit.split('#').pop() : null,
      port.controller != null ? `CC ${port.controller}` : null,
      port.group ? `group ${port.group}` : null
    ].filter(Boolean).join(', ')
    lines.push(`  ${port.symbol} "${port.name}" ${range} [${extra}]`)
  }
  if (profile.cautions?.length > 0) {
    lines.push('', 'cautions:')
    for (const caution of profile.cautions) lines.push(`  - ${caution}`)
  }
  return lines.join('\n')
}

function parseCommon (argv) {
  const roots = {}
  const rest = []
  let json = false
  let out = null
  let width = 900
  let height = 700
  let seconds = 2
  let sampleRate = 48000
  let validate = true
  const notes = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') {
      const value = argv[++i]
      const eq = value?.indexOf('=') ?? -1
      if (!value || eq < 1) throw new Error('--root needs PREFIX=DIR')
      roots[value.slice(0, eq)] = resolve(value.slice(eq + 1))
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--out') {
      out = argv[++i]
      if (!out) throw new Error('--out needs a file path')
    } else if (arg === '--width') {
      width = Number(argv[++i])
    } else if (arg === '--height') {
      height = Number(argv[++i])
    } else if (arg === '--seconds') {
      seconds = Number(argv[++i])
    } else if (arg === '--sample-rate') {
      sampleRate = Number(argv[++i])
    } else if (arg === '--no-validate') {
      validate = false
    } else if (arg === '--note') {
      const value = argv[++i]
      const match = /^(\d+)@([\d.]+)(?::([\d.]+))?$/.exec(value ?? '')
      if (!match) throw new Error('--note needs NOTE@ONTIME[:OFFTIME]')
      const note = Number(match[1]); const on = Number(match[2]); const off = match[3] ? Number(match[3]) : null
      notes.push({ frame: Math.round(on * sampleRate), note })
      if (off !== null) notes.push({ frame: Math.round(off * sampleRate), note, off: true })
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`)
    } else {
      rest.push(arg)
    }
  }
  return { roots, rest, json, out, width, height, seconds, sampleRate, validate, notes }
}

async function cmdList ({ json }) {
  const plugins = await listLocalPlugins()
  if (json) {
    console.log(JSON.stringify(plugins, null, 2))
    return
  }
  for (const plugin of plugins) {
    console.log(`${dirNameOf(plugin.iri).padEnd(22)} ${plugin.label} [${plugin.roles.join(', ')}]`)
  }
  console.log(`\n${plugins.length} plugin(s)`)
}

async function cmdInfo (target, { roots, json }) {
  if (!target) throw new Error('info needs a plugin name or IRI')
  const { profile } = await resolveProfile(target, roots)
  if (json) console.log(JSON.stringify(profile, null, 2))
  else console.log(formatInfo(profile))
}

async function cmdPanel (target, { roots, out }) {
  if (!target) throw new Error('panel needs a plugin name or IRI')
  if (!out) throw new Error('panel needs --out panel.html')
  const { profile } = await resolveProfile(target, roots)
  await writeFile(out, await renderPanelHTML(profile))
  console.log(`${out}: ${profile.label}, ${profile.ports.length} control(s)`)
}

async function cmdRender (iris, { roots, seconds, sampleRate, validate, notes, out }) {
  if (iris.length === 0) throw new Error('render needs at least one plugin IRI')
  const output = out ?? 'out.wav'
  const validator = validate
    ? await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    : null
  const started = Date.now()
  const { channels, loaded } = await renderChain({ iris, roots, seconds, sampleRate, notes, validator })
  await writeFile(output, encodeWav(channels, sampleRate))
  const peak = Math.max(...channels.map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
  console.log(
    `${output}: ${loaded.map(l => l.label).join(' -> ')}, ` +
    `${seconds}s at ${sampleRate}Hz, peak ${peak.toFixed(3)}, ${Date.now() - started}ms`
  )
}

/**
 * Screenshot one plugin's panel with headless Chrome. The panel page is
 * static (no script runs), so the shot is deterministic: the same profile
 * always draws the same controls.
 */
export async function shotPanel (target, { roots = {}, out, width = 900, height = 700 }) {
  if (!target) throw new Error('shot needs a plugin name or IRI')
  if (!out) throw new Error('shot needs --out shot.png')
  const chrome = process.env.CHROME_BIN ?? '/usr/bin/google-chrome'
  if (!existsSync(chrome)) throw new Error(`no Chrome at ${chrome}; set CHROME_BIN`)
  const { profile } = await resolveProfile(target, roots)
  const dir = await mkdtemp(join(tmpdir(), 'jig-shot-'))
  const page = join(dir, 'panel.html')
  await writeFile(page, await renderPanelHTML(profile))
  const result = spawnSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${width},${height}`,
    `--screenshot=${resolve(out)}`,
    `file://${page}`
  ], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`Chrome failed: ${(result.stderr || result.stdout || '').slice(0, 500)}`)
  }
  return { profile, out }
}

async function main () {
  const [command, ...argv] = process.argv.slice(2)
  const options = parseCommon(argv)
  try {
    if (command === 'list') await cmdList(options)
    else if (command === 'info') await cmdInfo(options.rest[0], options)
    else if (command === 'panel') await cmdPanel(options.rest[0], options)
    else if (command === 'render') await cmdRender(options.rest, options)
    else if (command === 'shot') {
      const { profile } = await shotPanel(options.rest[0], options)
      console.log(`${options.out}: ${profile.label}`)
    } else {
      usage()
      process.exit(2)
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

// The plugin directory list bin/build-gallery.js walks, so the gallery and
// this host's list subcommand cannot drift apart (AGENTS.md: a change in one
// file usually needs a second file to change with it).
export { pluginDirs }

const invoked = process.argv[1] === fileURLToPath(import.meta.url)
if (invoked) await main()
