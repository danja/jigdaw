// bin/highlight-turtle.js
//
// A Turtle grammar for highlight.js, used only by bin/build-docs-site.js.
// highlight.js ships no RDF language of any kind, and Turtle is the language
// most of this documentation's own code blocks are written in, so the
// specification's own examples rendered as plain monochrome text until this
// existed. Small and specific to what actually appears in docs/*.md rather
// than a complete grammar: prefixes, IRIs, prefixed names, `a`, strings,
// numbers and comments, which covers every example in this repository.
export function turtle (hljs) {
  return {
    name: 'Turtle',
    case_insensitive: false,
    contains: [
      hljs.COMMENT('#', '$'),
      {
        className: 'meta',
        begin: /@(prefix|base)\b/
      },
      {
        // A prefixed name: jig:audioInputs, trn:Audio, rdf:type. Matched
        // before the bare "a" keyword rule so "trn:a" is not mistaken for it.
        className: 'symbol',
        begin: /(?:[A-Za-z][\w-]*)?:[A-Za-z_][\w-]*/
      },
      {
        className: 'link',
        begin: /<[^\s>]*>/
      },
      {
        className: 'string',
        begin: '"""', end: '"""'
      },
      {
        className: 'string',
        begin: "'''", end: "'''"
      },
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        className: 'number',
        begin: /\b\d+(\.\d+)?\b/
      },
      {
        className: 'keyword',
        begin: /(?<=^|\s)a(?=\s)/
      },
      {
        className: 'literal',
        begin: /\btrue\b|\bfalse\b/
      },
      {
        className: 'punctuation',
        begin: /[;,.]/
      }
    ]
  }
}
