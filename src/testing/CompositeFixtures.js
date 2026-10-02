// src/testing/CompositeFixtures.js
//
// The reference rack with its placeholder pins replaced by the digests of the member plugins as
// they are on disk, so a test can load it and the pins mean something. A fixed pin in the example
// would go stale the day a plugin is rebuilt; computing them keeps the rack honest.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseText } from '../rdf/parse.js'
import { pluginForm } from '../rdf/Canonical.js'
import { digestOf } from '../host/Integrity.js'

export const RACK_IRI = 'https://example.org/racks/stomp/'
export const RACK_MEMBERS = ['boost', 'tremolo', 'cascade']
const PLACEHOLDER = `sha384-${'A'.repeat(64)}`

/** `examples/reference-composite.ttl`, pinned against `<root>/plugins/<member>/profile.ttl`. */
export async function pinnedRack (root) {
  let text = await readFile(join(root, 'examples/reference-composite.ttl'), 'utf8')
  for (const name of RACK_MEMBERS) {
    const iri = `https://strandz.it/jigdaw/plugins/${name}/`
    const dataset = await parseText(await readFile(join(root, 'plugins', name, 'profile.ttl'), 'utf8'), 'urn:jigdaw:bundle')
    const digest = await digestOf(new TextEncoder().encode(pluginForm(dataset, iri)), 'sha384')
    text = text.replace(new RegExp(`(plugins/${name}/>\\s*;\\s*jig:pinnedDigest) "${PLACEHOLDER}"`), `$1 "${digest}"`)
  }
  return text
}

/** A fetch that serves `text` at `iri` and defers to `otherwise` for everything else. */
export const servingAt = (iri, text, otherwise) => async (url, ...rest) => {
  if (url !== iri) return otherwise(url, ...rest)
  return { ok: true, status: 200, text: async () => text }
}
