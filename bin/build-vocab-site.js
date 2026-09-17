// bin/build-vocab-site.js
//
// Generate the human-readable view of the vocabulary from the vocabulary
// itself, so the page cannot drift from the terms it documents.
//
// docs/namespace.md: the namespace IRI serves Turtle to a machine and a page to
// a person. This builds the page, and copies the Turtle beside it so a single
// directory is the whole deployment.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { parseText } from '../src/rdf/parse.js'
import { JIG, vocabulary as v } from '../src/rdf/Vocabulary.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'deploy/vocab')

const OWL = 'http://www.w3.org/2002/07/owl#'
const source = join(root, 'vocabs/jigdaw.ttl')
const turtle = await readFile(source, 'utf8')
const dataset = await parseText(turtle, JIG)

const escape = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const objectsOf = (subject, predicate) =>
  [...dataset.match(subject, null, null)].filter(q => q.predicate.value === predicate).map(q => q.object.value)

const subjectsOfType = type =>
  [...dataset.match(null, null, null)]
    .filter(q => q.predicate.value === v.rdf.type && q.object.value === type)
    .map(q => q.subject)

function describe (term) {
  return {
    iri: term.value,
    name: term.value.slice(JIG.length),
    label: objectsOf(term, v.rdfs.label)[0] ?? term.value.slice(JIG.length),
    comment: objectsOf(term, v.rdfs.comment)[0] ?? '',
    domain: objectsOf(term, `${v.rdfs.label.replace('label', '')}domain`)[0] ?? ''
  }
}

const own = terms => terms.filter(t => t.value.startsWith(JIG)).map(describe)
  .sort((a, b) => a.name.localeCompare(b.name))

const classes = own(subjectsOfType(`${OWL}Class`))
const objectProperties = own(subjectsOfType(`${OWL}ObjectProperty`))
const dataProperties = own(subjectsOfType(`${OWL}DatatypeProperty`))
const individuals = own(subjectsOfType(`${OWL}NamedIndividual`))

const section = (heading, terms) => terms.length === 0 ? '' : `
<h2>${escape(heading)}</h2>
<dl>
${terms.map(t => `  <dt id="${escape(t.name)}"><code>jig:${escape(t.name)}</code>${t.label !== t.name ? ` <span class="label">${escape(t.label)}</span>` : ''}</dt>
  <dd>${t.comment ? escape(t.comment) : '<span class="undescribed">No description.</span>'}</dd>`).join('\n')}
</dl>`

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JigDAW vocabulary</title>
<link rel="alternate" type="text/turtle" href="jigdaw.ttl">
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 46rem; margin: 0 auto; padding: 2rem 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  .sub { color: #666; margin-top: 0; }
  h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #8884; padding-bottom: .25rem; }
  dt { margin-top: 1rem; font-weight: 600; }
  dt code { font-size: .95rem; }
  .label { font-weight: 400; color: #666; }
  dd { margin: .2rem 0 0 0; }
  .undescribed { color: #a00; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>JigDAW vocabulary</h1>
<p class="sub">
  Namespace <code>${JIG}</code>, prefix <code>jig:</code>.
  Also available as <a href="jigdaw.ttl">Turtle</a>, which is what you get if you ask for
  <code>text/turtle</code>.
</p>
<p>
  Terms describing how an audio plugin is fetched and run in a web browser. What a plugin
  <em>is</em> musically comes from the
  <a href="https://plugin-universe.com/ns">transmissions vocabulary</a>, which this one
  extends rather than replaces. Parameters are described with
  <a href="https://lv2plug.in/ns/lv2core">LV2</a>.
</p>
<p>
  This page is generated from the vocabulary, so it cannot drift from it.
  ${classes.length + objectProperties.length + dataProperties.length + individuals.length} terms.
</p>
${section('Classes', classes)}
${section('Object properties', objectProperties)}
${section('Data properties', dataProperties)}
${section('Individuals', individuals)}
</body>
</html>
`

await mkdir(out, { recursive: true })
await writeFile(join(out, 'index.html'), page)
await writeFile(join(out, 'jigdaw.ttl'), turtle)
console.log(`deploy/vocab: index.html (${classes.length} classes, ${objectProperties.length + dataProperties.length} properties, ${individuals.length} individuals) and jigdaw.ttl`)
