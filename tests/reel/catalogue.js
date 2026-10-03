// tests/reel/catalogue.js
//
// Not a test: the real bundled pieces and the real plugin profiles on disk, shaped the way Reel's planner sees
// them, so a test can plan a script against a piece without an engine. A plugin address maps to
// plugins/<name>/profile.json by its last path segment, which is how the catalogue is laid out.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseText } from '../../src/rdf/parse.js'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { existingPlugins } from '../../src/reel/Host.js'

export const root = resolve(import.meta.dirname, '../..')
const SITE = 'https://strandz.it/jigdaw/'

/** The planner's view of one plugin: what createPluginValidator returns for it. */
export function portsOfPlugin (name) {
  const profile = JSON.parse(readFileSync(resolve(root, 'plugins', name, 'profile.json'), 'utf8'))
  return profile.ports.map(p => ({
    symbol: p.symbol, name: p.name, unit: p.unit ?? null, minimum: p.minimum, maximum: p.maximum, defaultValue: p.default,
    ...(p.scalePoints ? { scalePoints: p.scalePoints } : {})
  }))
}

export const pluginNames = () => readdirSync(resolve(root, 'plugins'), { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('_'))
  .map(e => e.name)
  .filter(name => { try { readFileSync(resolve(root, 'plugins', name, 'profile.json')); return true } catch { return false } })

const nameOf = iri => iri.replace(/\/+$/, '').split('/').pop()

/** What `load` resolves to in a test: the profile on disk for an address under the site's plugins. */
export async function resolvePlugin (iri) {
  if (!iri.startsWith(`${SITE}plugins/`)) return { ok: false, message: `${iri} is not a bundled plugin` }
  try { return { ok: true, ports: portsOfPlugin(nameOf(iri)) } } catch (error) { return { ok: false, message: error.message } }
}

/** A bundled piece read from disk: the names a script can use in it, by Reel's own naming rules. */
export async function pieceNames (file) {
  const text = readFileSync(resolve(root, 'web/presets', file), 'utf8')
  const read = readProject(await parseText(text, `${SITE}presets/${file}`))
  const nodes = read.changes.filter(c => c.op === 'addNode')
  const profiles = new Map(nodes.map(n => [n.id, { ports: portsOfPlugin(nameOf(n.pluginIri)), label: n.label }]))
  const dispatcher = {
    project: { nodes },
    engineNode: id => ({ profile: { ports: profiles.get(id).ports, label: profiles.get(id).label } })
  }
  return existingPlugins(dispatcher, { names: new Map() })
}
