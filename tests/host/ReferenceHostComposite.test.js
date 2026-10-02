// tests/host/ReferenceHostComposite.test.js
//
// A composite plugin through the reference host, which renders chains: a straight rack is flattened into the chain and
// heard, and one with a branch is refused by name. The silent variant matters most. A rack whose author sets Drive to 0
// must render silence, which can only happen if the signal really passes through the boost.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { renderChain } from '../../src/host/ReferenceHost.js'
import { chainOrder } from '../../src/host/CompositeChain.js'
import { readComposite } from '../../src/rdf/CompositeReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { pinnedRack, RACK_IRI, RACK_MEMBERS } from '../../src/testing/CompositeFixtures.js'

const root = resolve(import.meta.dirname, '../..')
const peakOf = channels => Math.max(...channels.map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
const memberRoots = () => Object.fromEntries(RACK_MEMBERS.map(name => [`https://strandz.it/jigdaw/plugins/${name}/`, resolve(root, 'plugins', name)]))

async function rackDirectory (text) {
  const dir = await mkdtemp(join(tmpdir(), 'jigdaw-ref-'))
  await writeFile(join(dir, 'profile.ttl'), text)
  return dir
}

describe('a composite plugin in the reference host', () => {
  let validator
  let pinned
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    pinned = await pinnedRack(root)
  })

  it('renders a straight rack as one stage, with the voicing its author set', async () => {
    const dir = await rackDirectory(pinned)
    const { channels, loaded } = await renderChain({ iris: [RACK_IRI], roots: { [RACK_IRI]: dir, ...memberRoots() }, seconds: 0.4, validator })
    expect(loaded).toHaveLength(1)
    expect(loaded[0].label).toBe('Stomp rack')
    expect(loaded[0].audioInputs).toBe(1)
    expect(channels.every(c => c.every(Number.isFinite))).toBe(true)
    expect(peakOf(channels)).toBeGreaterThan(1e-4)
  })

  it('is silent when its author sets Drive to zero, because the signal really passes through the boost', async () => {
    const quiet = pinned.replace('lv2:default 1 ; lv2:minimum 0 ; lv2:maximum 2', 'lv2:default 0 ; lv2:minimum 0 ; lv2:maximum 2')
    expect(quiet).not.toBe(pinned)
    const dir = await rackDirectory(quiet)
    const { channels } = await renderChain({ iris: [RACK_IRI], roots: { [RACK_IRI]: dir, ...memberRoots() }, seconds: 0.4, validator })
    expect(peakOf(channels)).toBe(0)
  })

  it('refuses a rack whose pin no longer matches, as any host does', async () => {
    const dir = await rackDirectory(await (await import('node:fs/promises')).readFile(resolve(root, 'examples/reference-composite.ttl'), 'utf8'))
    await expect(renderChain({ iris: [RACK_IRI], roots: { [RACK_IRI]: dir, ...memberRoots() }, seconds: 0.1, validator })).rejects.toThrow(/pins/)
  })

  it('runs through bin/check-plugin.js with --members, and says the rack produces audio', async () => {
    const dir = await rackDirectory(pinned)
    const out = execFileSync('node', [resolve(root, 'bin/check-plugin.js'), '--members', resolve(root, 'plugins'), '--root', `${RACK_IRI}=${dir}`, RACK_IRI], { encoding: 'utf8' })
    expect(out).toContain('Stomp rack')
    expect(out).toMatch(/produces audio:\s+ok/)
  })
})

describe('chainOrder', () => {
  const BASE = 'https://example.org/racks/shape/'
  const leaf = iri => ({ kind: 'plugin', iri, profile: {}, granted: [] })

  /** A composite tree from wires `[from, to, kind?, portSymbol?]` over members a, b, c, with `<>` the boundary. */
  async function tree (wires) {
    const names = ['a', 'b', 'c']
    const turtle = `@base <${BASE}> .
      @prefix jig: <http://purl.org/stuff/jigdaw/> . @prefix trn: <http://purl.org/stuff/transmissions/> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      <> a jig:CompositePlugin ; rdfs:label "Shape" ; jig:audioInputs 1 ; jig:audioOutputs 1 ;
         jig:member ${names.map(n => `<#${n}>`).join(' , ')} ; jig:connection ${wires.map((_, i) => `<#w${i}>`).join(' , ')} .
      ${names.map(n => `<#${n}> a jig:Member ; jig:plugin <https://p.example/${n}/> .`).join('\n')}
      ${wires.map(([f, t, kind = 'trn:Audio', symbol], i) => `<#w${i}> a jig:Connection ; jig:from <#w${i}f> ; jig:to <#w${i}t> ; jig:signalKind ${kind} .
        <#w${i}f> a jig:Endpoint ; jig:endpointNode ${f} ; jig:portIndex 0 .
        <#w${i}t> a jig:Endpoint ; jig:endpointNode ${t} ; ${symbol ? `jig:portSymbol "${symbol}"` : 'jig:portIndex 0'} .`).join('\n')}`
    const composite = readComposite(await parseText(turtle, BASE))
    return { kind: 'composite', iri: BASE, composite, granted: [], members: composite.members.map(m => ({ id: m.id, plugin: m.plugin, tree: leaf(m.plugin) })) }
  }

  it('orders a straight line first to last, wherever the members are listed', async () => {
    const order = chainOrder(await tree([['<>', '<#c>'], ['<#c>', '<#a>'], ['<#a>', '<#b>'], ['<#b>', '<>']]))
    expect(order.map(o => o.path[0].split('#')[1])).toEqual(['c', 'a', 'b'])
  })

  it('refuses a split, a join, a loop, a modulation edge and MIDI, each by name', async () => {
    const reasons = {
      'a signal splits or joins': [['<>', '<#a>'], ['<>', '<#b>'], ['<#a>', '<#c>'], ['<#b>', '<#c>'], ['<#c>', '<>']],
      'it loops': [['<#a>', '<#b>'], ['<#b>', '<#c>'], ['<#c>', '<#a>']],
      'some members are not on the one path': [['<>', '<#a>'], ['<#a>', '<>'], ['<#b>', '<#c>'], ['<#c>', '<#b>']],
      'it has a modulation connection': [['<>', '<#a>'], ['<#a>', '<#b>', 'trn:Audio', 'depth'], ['<#b>', '<#c>'], ['<#c>', '<>']],
      'it carries MIDI between its members': [['<>', '<#a>'], ['<#a>', '<#b>', 'trn:Midi'], ['<#b>', '<#c>'], ['<#c>', '<>']]
    }
    for (const [why, wires] of Object.entries(reasons)) {
      const built = await tree(wires)
      expect(() => chainOrder(built), why).toThrow(why)
    }
  })

  it('names the composite and says which host would run it', async () => {
    const built = await tree([['<>', '<#a>'], ['<>', '<#b>'], ['<#a>', '<>'], ['<#b>', '<#c>'], ['<#c>', '<>']])
    expect(() => chainOrder(built)).toThrow(/Shape is not a straight chain.*Jiggy/s)
  })
})
