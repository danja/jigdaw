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

/** `text` with each placeholder pin for a member of `<root>/plugins/<member>/` replaced by that plugin's real digest. */
async function pin (root, text, members) {
  for (const name of members) {
    const iri = `https://strandz.it/jigdaw/plugins/${name}/`
    const dataset = await parseText(await readFile(join(root, 'plugins', name, 'profile.ttl'), 'utf8'), 'urn:jigdaw:bundle')
    const digest = await digestOf(new TextEncoder().encode(pluginForm(dataset, iri)), 'sha384')
    text = text.replace(new RegExp(`(plugins/${name}/>\\s*;\\s*jig:pinnedDigest) "${PLACEHOLDER}"`), `$1 "${digest}"`)
  }
  return text
}

/** `examples/reference-composite.ttl`, pinned against `<root>/plugins/<member>/profile.ttl`. */
export async function pinnedRack (root) {
  return pin(root, await readFile(join(root, 'examples/reference-composite.ttl'), 'utf8'), RACK_MEMBERS)
}

export const MIDI_RACK_IRI = 'https://example.org/racks/midi-chain/'
export const MIDI_RACK_MEMBERS = ['dice', 'midifilter']

/**
 * A composite that is all MIDI: a chance gate into a MIDI filter, with a MIDI input at the gate and a MIDI
 * output at the filter. There is no audio and nothing is exposed, since what is under test is where MIDI
 * crosses the boundary.
 */
export async function pinnedMidiRack (root) {
  const member = (id, name) => `<#${id}> a jig:Member ;
    jig:plugin <https://strandz.it/jigdaw/plugins/${name}/> ;
    jig:pinnedDigest "${PLACEHOLDER}" .`
  const edge = (id, from, to) => `<#${id}> a jig:Connection ; jig:from <#${id}-from> ; jig:to <#${id}-to> ; jig:signalKind trn:Midi .
<#${id}-from> a jig:Endpoint ; jig:endpointNode ${from} ; jig:portIndex 0 .
<#${id}-to> a jig:Endpoint ; jig:endpointNode ${to} ; jig:portIndex 0 .`
  const text = `@base <${MIDI_RACK_IRI}> .
@prefix jig:  <http://purl.org/stuff/jigdaw/> .
@prefix trn:  <http://purl.org/stuff/transmissions/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<>
    a jig:CompositePlugin , trn:PluginProfile ;
    rdfs:label "MIDI chain" ;
    rdfs:comment "A chance gate into a MIDI filter." ;
    foaf:homepage <> ;
    trn:role trn:MidiProcessor ;
    trn:accepts trn:Midi ;
    trn:produces trn:Midi ;
    trn:format trn:Jig ;
    trn:requires jig:MidiEvents , jig:MidiOut ;
    jig:audioInputs 0 ;
    jig:audioOutputs 0 ;
    jig:member <#gate> , <#filter> ;
    jig:connection <#c-in> , <#c-mid> , <#c-out> .

${member('gate', 'dice')}
${member('filter', 'midifilter')}
${edge('c-in', '<>', '<#gate>')}
${edge('c-mid', '<#gate>', '<#filter>')}
${edge('c-out', '<#filter>', '<>')}
`
  return pin(root, text, MIDI_RACK_MEMBERS)
}

/** A fetch that serves `text` at `iri` and defers to `otherwise` for everything else. */
export const servingAt = (iri, text, otherwise) => async (url, ...rest) => {
  if (url !== iri) return otherwise(url, ...rest)
  return { ok: true, status: 200, text: async () => text }
}
