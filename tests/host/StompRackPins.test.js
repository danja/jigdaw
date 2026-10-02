// tests/host/StompRackPins.test.js
//
// plugins/stomp-rack is a composite pinned to the profiles of three other plugins. A pin is the author saying "these bytes",
// so a member that is rebuilt must not leave it quietly wrong: this fails, and says which command renews it. Also checked here:
// the profile is valid, sound, and loadable through the real loader, so the one worked composite is known to work.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { pinsFor } from '../../bin/pin.js'
import { memberDirectoryUnder } from '../../bin/bundle-composite.js'
import { readComposite, checkComposite } from '../../src/rdf/CompositeReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { resolveComposite } from '../../src/host/CompositeResolver.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const IRI = 'https://strandz.it/jigdaw/plugins/stomp-rack/'
const directory = resolve(root, 'plugins/stomp-rack')

describe('plugins/stomp-rack', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('is pinned to every member as it is now', async () => {
    const rows = await pinsFor(directory, memberDirectoryUnder(resolve(root, 'plugins')))
    expect(rows.length).toBe(3)
    const stale = rows.filter(r => r.state !== 'current')
    expect(stale.map(r => `${r.plugin} is ${r.state}: write jig:pinnedDigest "${r.digest}"`),
      'a member was rebuilt. Renew the pins with: node bin/pin.js plugins/stomp-rack --members plugins').toEqual([])
  })

  it('validates against the shapes and is sound inside its own document', async () => {
    const dataset = await parseText(await readFile(resolve(directory, 'profile.ttl'), 'utf8'), IRI)
    const report = await validator.validate(dataset)
    expect(report.violations.map(v => `${v.focusNode} ${v.path ?? ''}: ${v.message}`)).toEqual([])
    const composite = readComposite(dataset)
    expect(composite.iri).toBe(IRI)
    expect(checkComposite(composite)).toEqual([])
  })

  it('loads through the real loader: every member found, pinned and drivable', async () => {
    const site = sitePlugins('https://strandz.it/jigdaw/', resolve(root, 'plugins'))
    const loader = new PluginLoader({ fetch: site.fetch, parse: parseText, validator, capabilities: new Set(), processorUrl: site.processorUrl })
    const tree = await resolveComposite(IRI, { loader })
    expect(tree.members.map(m => m.tree.profile.label).sort()).toEqual(['Boost', 'Cascade', 'Tremolo'])
    expect(tree.composite.ports.map(p => p.symbol).sort()).toEqual(['depth', 'drive', 'room'])
  })
})
