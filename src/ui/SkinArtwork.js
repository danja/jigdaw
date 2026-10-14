// src/ui/SkinArtwork.js
//
// Turns a skin's SVG into nodes a host may put in its own document, by copying
// what an allowlist recognises and nothing else. docs/svg-skins.md, contract
// section 9.4. The file is never inserted: a plugin's artwork is read, and what
// reaches the page is what this module built.
//
// parseSvg is the one browser-only function. buildArtwork takes a parsed
// Document, so it is tested with trees whose elements carry their real
// namespaces; linkedom's own DOMParser gives every element the XHTML namespace
// and no parser error, which is more permissive than a browser and so cannot
// be the test's parser.

export const SVG_NS = 'http://www.w3.org/2000/svg'

// Limits a host may raise (docs/svg-skins.md).
export const SKIN_LIMITS = Object.freeze({ bytes: 512 * 1024, elements: 5000 })

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'use'
])

const ATTRIBUTES = new Set([
  'id', 'viewBox', 'width', 'height', 'preserveAspectRatio',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'dx', 'dy',
  'd', 'points', 'transform', 'offset',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'clipPathUnits',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'clip-path',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset',
  'stop-color', 'stop-opacity', 'opacity', 'display', 'visibility', 'paint-order',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'style', 'href'
])

// Properties kept from a style attribute. Others are dropped, not refused: an
// editor writes a good many, and an unknown property can do nothing here.
const STYLE_PROPERTIES = new Set([...ATTRIBUTES].filter(a => a.includes('-') || ['fill', 'stroke', 'opacity', 'display', 'visibility'].includes(a)))

/** A skin the host refuses. `element` is a path such as "svg > g[2] > script[1]". */
export class SkinError extends Error {
  constructor (message, element = null) {
    super(element === null ? message : `${message} (at ${element})`)
    this.name = 'SkinError'
    this.element = element
  }
}

/** Browser only. Parses as image/svg+xml, which a browser does with namespaces and a parser error. */
export function parseSvg (text, DOMParserClass = globalThis.DOMParser) {
  const doc = new DOMParserClass().parseFromString(text, 'image/svg+xml')
  const failure = doc.getElementsByTagName('parsererror')[0]
  if (failure) throw new SkinError(`the artwork is not well formed XML: ${failure.textContent.trim().split('\n')[0]}`)
  return doc
}

const FRAGMENT = /^#([^\s()'"]+)$/
const URL_REFERENCE = /url\(\s*([^)]*?)\s*\)/gi

// A value may name something only by a fragment of this file.
function checkValue (value, where) {
  if (/javascript:|@import|expression\(/i.test(value)) throw new SkinError(`an attribute value runs or imports code: ${value.slice(0, 40)}`, where)
  for (const m of value.matchAll(URL_REFERENCE)) {
    if (!FRAGMENT.test(m[1].replace(/^['"]|['"]$/g, ''))) {
      throw new SkinError(`a url() leaves the file: ${m[0]}`, where)
    }
  }
}

function pathOf (stack) { return stack.join(' > ') }

/**
 * @param {Document} doc a parsed image/svg+xml document
 * @param {{ document: Document, prefix: string, limits?: object, size?: number }} context
 *   `document` makes the nodes, `prefix` is put in front of every id, `size` is the file's byte length
 * @returns {{ svg: Element, ids: Map<string, number>, elements: Map<string, Element> }}
 *   ids: each author id, mapped to the number of child elements the copy has, which is what
 *   a Toggle and a Selector are checked against
 *   elements: each author id, mapped to the copied element, so nothing has to select by id
 * @throws {SkinError}
 */
export function buildArtwork (doc, { document, prefix, limits = SKIN_LIMITS, size = 0 }) {
  if (typeof prefix !== 'string' || prefix === '') throw new TypeError('buildArtwork needs an id prefix, or two skins on one page can collide')
  if (size > limits.bytes) throw new SkinError(`the artwork is ${size} bytes; the limit is ${limits.bytes}`)
  const root = doc.documentElement
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg') {
    throw new SkinError('the artwork root is not an svg element in the SVG namespace', root ? root.nodeName : 'the document')
  }

  const ids = new Map()
  const elements = new Map()
  let count = 0

  const rename = value => value
    .replace(URL_REFERENCE, (all, ref) => {
      const m = FRAGMENT.exec(ref.replace(/^['"]|['"]$/g, ''))
      return m ? `url(#${prefix}${m[1]})` : all
    })

  function copy (source, stack) {
    const name = source.localName
    // Foreign namespaces are how an editor stores its own data. They can do nothing here and are dropped with their subtree.
    if (source.namespaceURI !== SVG_NS) return null
    if (!ELEMENTS.has(name)) throw new SkinError(`<${name}> is not an allowed element`, pathOf(stack))
    if (++count > limits.elements) throw new SkinError(`the artwork has more than ${limits.elements} elements`, pathOf(stack))

    const target = document.createElementNS(SVG_NS, name)
    for (const attr of [...source.attributes]) {
      const attrName = attr.localName ?? attr.name
      // An attribute in a namespace (xmlns declarations, inkscape:, xlink:) is dropped; xlink:href is not a way round the href rule.
      if (attr.namespaceURI && attr.namespaceURI !== SVG_NS) continue
      if (/^on/i.test(attrName)) throw new SkinError(`event attribute ${attrName} is not allowed`, pathOf(stack))
      if (!ATTRIBUTES.has(attrName)) continue
      let value = attr.value
      if (attrName === 'href') {
        const m = FRAGMENT.exec(value)
        if (!m) throw new SkinError(`href "${value.slice(0, 40)}" leaves the file`, pathOf(stack))
        target.setAttribute('href', `#${prefix}${m[1]}`)
        continue
      }
      if (attrName === 'style') {
        if (value.includes('\\')) throw new SkinError('a style attribute uses a CSS escape', pathOf(stack))
        checkValue(value, pathOf(stack))
        const kept = value.split(';').map(s => s.trim()).filter(Boolean).flatMap(decl => {
          const at = decl.indexOf(':')
          const property = decl.slice(0, at).trim().toLowerCase()
          return at > 0 && STYLE_PROPERTIES.has(property) ? [`${property}:${rename(decl.slice(at + 1).trim())}`] : []
        })
        if (kept.length) target.setAttribute('style', kept.join(';'))
        continue
      }
      checkValue(value, pathOf(stack))
      if (attrName === 'id') {
        if (ids.has(value)) throw new SkinError(`the id "${value}" is used twice`, pathOf(stack))
        ids.set(value, 0)
        elements.set(value, target)
        value = prefix + value
      } else value = rename(value)
      target.setAttribute(attrName, value)
    }

    const counts = new Map()
    for (const child of source.childNodes) {
      if (child.nodeType === 1) {
        const n = (counts.get(child.localName) ?? 0) + 1
        counts.set(child.localName, n)
        const made = copy(child, [...stack, `${child.localName}[${n}]`])
        if (made) target.append(made)
      } else if (child.nodeType === 3 && (name === 'text' || name === 'tspan' || name === 'title' || name === 'desc')) {
        target.append(document.createTextNode(child.nodeValue))
      }
    }
    const authorId = source.getAttribute('id')
    if (authorId !== null && ids.has(authorId)) ids.set(authorId, target.children.length)
    return target
  }

  const svg = copy(root, ['svg'])
  return { svg, ids, elements }
}
