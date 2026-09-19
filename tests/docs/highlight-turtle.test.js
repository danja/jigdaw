// tests/docs/highlight-turtle.test.js
//
// bin/highlight-turtle.js exists because highlight.js ships no RDF language
// of any kind, and most of this documentation's own code blocks are Turtle.
// These check the specific things a naive grammar gets wrong: the bare `a`
// keyword must not fire inside a prefixed name or a string, and a comment or
// a string must swallow whatever punctuation it contains rather than having
// the punctuation rule fire inside it.
import { describe, it, expect } from 'vitest'
import hljs from 'highlight.js'
import { turtle } from '../../bin/highlight-turtle.js'

hljs.registerLanguage('turtle', turtle)
const render = source => hljs.highlight(source, { language: 'turtle' }).value

describe('the Turtle grammar bin/build-docs-site.js highlights code blocks with', () => {
  it('marks a comment from # to the end of the line', () => {
    const html = render('# a comment about jig:module\njig:module <x> .')
    expect(html).toContain('<span class="hljs-comment"># a comment about jig:module</span>')
  })

  it('marks @prefix and @base as directives', () => {
    const html = render('@prefix jig: <http://x/> .\n@base <http://y/> .')
    expect(html).toContain('<span class="hljs-meta">@prefix</span>')
    expect(html).toContain('<span class="hljs-meta">@base</span>')
  })

  it('marks a prefixed name, not just the prefix', () => {
    const html = render('jig:audioInputs 1 .')
    expect(html).toContain('<span class="hljs-symbol">jig:audioInputs</span>')
  })

  it('marks an IRI in angle brackets', () => {
    const html = render('jig:module <cascade.wasm> .')
    expect(html).toContain('&lt;cascade.wasm&gt;')
    expect(html).toMatch(/<span class="hljs-link">&lt;cascade\.wasm&gt;<\/span>/)
  })

  it('marks the bare "a" keyword, standing for rdf:type', () => {
    const html = render('<> a jig:WebPlugin .')
    expect(html).toMatch(/<span class="hljs-keyword">\s*a<\/span>/)
  })

  it('does not mark "a" inside a prefixed name such as trn:AudioEffect', () => {
    const html = render('trn:role trn:AudioEffect .')
    expect(html).not.toContain('<span class="hljs-keyword">')
  })

  it('does not mark "a" inside a string, even one containing the word "a"', () => {
    const html = render('rdfs:comment "has a freeze" .')
    expect(html).not.toContain('<span class="hljs-keyword">')
    // The string as a whole is still marked, the punctuation inside it is not
    // separately tagged: the mode that consumed it was the string, not the
    // top-level rule list.
    expect(html).toMatch(/<span class="hljs-string">&quot;has a freeze&quot;<\/span>/)
  })

  it('marks a plain number', () => {
    const html = render('jig:audioInputs 1 ; jig:latencyFrames 0 .')
    expect(html).toContain('<span class="hljs-number">1</span>')
    expect(html).toContain('<span class="hljs-number">0</span>')
  })

  it('renders a whole real profile fragment without throwing', () => {
    // The point of the direct tests above is precision; this is the same
    // reasoning tests/dsp/jsfx-runtime.test.js applies to the bytecode VM:
    // run something real through it rather than only hand-picked fragments.
    const fragment = [
      '@base <https://example.org/plugins/cascade/> .',
      '@prefix jig: <http://purl.org/stuff/jigdaw/> .',
      '@prefix trn: <http://purl.org/stuff/transmissions/> .',
      '',
      '<>  a jig:WebPlugin , trn:PluginProfile ;',
      '    rdfs:label "Cascade" ;',
      '    trn:role trn:AudioEffect ;',
      '    jig:audioInputs 1 ; jig:inputChannels 2 .'
    ].join('\n')
    expect(() => render(fragment)).not.toThrow()
    const html = render(fragment)
    expect(html).toContain('hljs-meta')
    expect(html).toContain('hljs-symbol')
    expect(html).toContain('hljs-link')
    expect(html).toContain('hljs-string')
    expect(html).toContain('hljs-number')
  })
})
