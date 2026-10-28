// src/ui/HtmlSkin.js
//
// Turns an HTML skin (docs/html-skins.md) into nodes a host may put in its own document, by copying what an allowlist
// recognises and nothing else. As for an SVG skin (src/ui/SkinArtwork.js) the file is never inserted: it is parsed
// inertly, read once, and what reaches the page is what this module built. Nothing is serialised and parsed again, so a
// string that parses differently the second time has nothing to work on.
//
// A skin with anything outside the lists is refused whole, with the element and its position named. The one exception is
// a binding the profile cannot honour, a port it does not declare or a control of the wrong kind for its port, which is
// left out and reported: a control nobody can use is not shown (docs/html-skins.md, "Ports the skin does not bind").
import { checkCss, ELEMENTS } from './HtmlSkinCss.js'

export const HTML_SKIN_LIMITS = Object.freeze({ bytes: 256 * 1024, elements: 2000 })

/** A skin the host refuses. `problems` is every reason found, each naming where. */
export class HtmlSkinError extends Error {
  constructor (problems) {
    super(problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`)
    this.name = 'HtmlSkinError'
    this.problems = problems
  }
}

/** Browser only. Parses as text/html, which builds an inert document: no script in it runs. */
export function parseHtml (text, DOMParserClass = globalThis.DOMParser) {
  return new DOMParserClass().parseFromString(text, 'text/html')
}

const ATTRIBUTES = new Set(['class', 'id', 'lang', 'title', 'aria-hidden', 'data-param', 'data-param-name', 'data-param-text', 'data-param-help'])
const PER_ELEMENT = { input: ['type'], label: ['for'] }
const BOUND = ['data-param', 'data-param-name', 'data-param-text']

// Where a port's shape says it belongs. The control follows the port (contract section 5.3), never the other way round.
const KIND = { range: 'dial', checkbox: 'switch', select: 'selector' }

/** `div[2] > section[1] > input[1]`: the element and where it is, as SkinArtwork's errors name theirs. */
function where (el) {
  const path = []
  for (let node = el; node && node.tagName && node.tagName !== 'BODY' && node.tagName !== 'HTML'; node = node.parentElement) {
    const same = [...(node.parentElement?.children ?? [])].filter(s => s.tagName === node.tagName)
    path.unshift(`${node.tagName.toLowerCase()}[${same.indexOf(node) + 1}]`)
  }
  return path.join(' > ') || 'body'
}

function kindOf (el) {
  const tag = el.tagName.toLowerCase()
  if (tag === 'select') return 'select'
  if (tag === 'input') return el.getAttribute('type')
  return null
}

/**
 * @param {Document} doc a parsed skin
 * @param {{ symbol: string, widget: string }[]} ports the profile's ports
 * @returns {{ problems: string[], omitted: { element: string, reason: string }[], css: string }}
 *   problems refuse the whole skin; omitted are single bindings left out
 */
export function checkHtmlSkin (doc, ports, { prefix = '' } = {}) {
  const problems = []
  const omitted = []
  const bySymbol = new Map(ports.map(p => [p.symbol, p]))
  const head = [...(doc.head?.children ?? [])]
  const body = doc.body
  if (!body) return { problems: ['the skin has no body'], omitted, css: '' }

  for (const el of head) {
    const tag = el.tagName.toLowerCase()
    if (tag !== 'style' && tag !== 'title') problems.push(`head > ${tag} is not allowed`)
  }
  const elements = [...body.querySelectorAll('*')]
  if (elements.length + head.length > HTML_SKIN_LIMITS.elements) problems.push(`${elements.length} elements, over the ${HTML_SKIN_LIMITS.elements} limit`)

  const styles = [...head.filter(e => e.tagName === 'STYLE'), ...elements.filter(e => e.tagName === 'STYLE')]
  if (styles.length > 1) problems.push(`${styles.length} style elements, at most one is allowed`)

  const ids = new Set(elements.map(e => e.getAttribute('id')).filter(Boolean))
  for (const el of elements) {
    const tag = el.tagName.toLowerCase()
    const at = where(el)
    if (tag === 'style') continue
    if (!ELEMENTS.has(tag)) { problems.push(`${at}: <${tag}> is not an allowed element`); continue }
    for (const attribute of el.getAttributeNames()) {
      if (!ATTRIBUTES.has(attribute) && !(PER_ELEMENT[tag] ?? []).includes(attribute)) problems.push(`${at}: ${attribute} is not an allowed attribute on <${tag}>`)
    }
    if (tag === 'label' && el.hasAttribute('for') && !ids.has(el.getAttribute('for'))) problems.push(`${at}: for="${el.getAttribute('for')}" names no element of this file`)
    if (tag === 'input') {
      const type = el.getAttribute('type')
      if (type !== 'range' && type !== 'checkbox') problems.push(`${at}: <input type=${type}> is not allowed`)
    }
    if ((tag === 'input' || tag === 'select') && !el.hasAttribute('data-param')) problems.push(`${at}: <${tag}> without data-param is not allowed`)
    if (tag === 'select' && el.querySelector('option')) problems.push(`${at}: <select> has option children, which the host makes`)
    for (const attribute of BOUND) {
      const symbol = el.getAttribute(attribute)
      if (symbol === null) continue
      const port = bySymbol.get(symbol)
      if (!port) { omitted.push({ element: at, reason: `${attribute}="${symbol}" names no port of this plugin` }); continue }
      if (attribute === 'data-param') {
        const kind = kindOf(el)
        if (KIND[kind] && KIND[kind] !== port.widget) omitted.push({ element: at, reason: `a ${kind} cannot set ${symbol}, which is a ${port.widget}` })
      }
    }
  }

  let css = ''
  if (styles.length === 1) {
    const checked = checkCss(styles[0].textContent, prefix)
    css = checked.css
    for (const p of checked.problems) problems.push(`style: ${p}`)
  }
  return { problems, omitted, css }
}

const copyAttributes = (from, to, prefix) => {
  for (const name of from.getAttributeNames()) {
    if (name === 'id' || name === 'for') to.setAttribute(name, `${prefix}${from.getAttribute(name)}`)
    else to.setAttribute(name, from.getAttribute(name))
  }
}

/**
 * Builds the skin's nodes. Throws HtmlSkinError, naming every reason, when the skin breaks a rule.
 *
 * @param {Document} doc from parseHtml
 * @param {{ ports: object[] }} profile
 * @param {{ document: Document, prefix: string, size?: number }} context prefix makes this panel's ids its own
 * @returns {{ root: Element, css: string, controls: { element: Element, port: object, kind: string }[], texts: { element: Element, symbol: string }[],
 *   names: { element: Element, symbol: string }[], help: Element[], omitted: object[] }}
 */
export function buildHtmlSkin (doc, profile, { document, prefix, size = 0 }) {
  if (size > HTML_SKIN_LIMITS.bytes) throw new HtmlSkinError([`the skin is ${size} bytes, over the ${HTML_SKIN_LIMITS.bytes} limit`])
  const { problems, omitted, css } = checkHtmlSkin(doc, profile.ports, { prefix })
  if (problems.length) throw new HtmlSkinError(problems)
  const bySymbol = new Map(profile.ports.map(p => [p.symbol, p]))
  const dropped = new Set(omitted.map(o => o.element))

  const controls = []
  const texts = []
  const names = []
  const help = []
  const root = document.createElement('div')
  root.className = 'html-skin'

  const copy = (from, into) => {
    for (const child of from.childNodes) {
      if (child.nodeType === 3) { into.append(document.createTextNode(child.textContent)); continue }
      if (child.nodeType !== 1 || child.tagName === 'STYLE') continue
      const tag = child.tagName.toLowerCase()
      const at = where(child)
      // A binding the profile cannot honour: the control is left out. Its label stays, which is text.
      if (dropped.has(at) && child.hasAttribute('data-param')) continue
      const made = document.createElement(tag)
      copyAttributes(child, made, prefix)
      if (dropped.has(at)) for (const a of BOUND) made.removeAttribute(a)
      into.append(made)
      const symbol = child.getAttribute('data-param')
      if (symbol !== null && bySymbol.has(symbol)) controls.push({ element: made, port: bySymbol.get(symbol), kind: kindOf(child) })
      if (child.hasAttribute('data-param-text') && !dropped.has(at)) texts.push({ element: made, symbol: child.getAttribute('data-param-text') })
      if (child.hasAttribute('data-param-name') && !dropped.has(at)) names.push({ element: made, symbol: child.getAttribute('data-param-name') })
      if (child.hasAttribute('data-param-help')) help.push(made)
      if (tag !== 'select' && tag !== 'input') copy(child, made)
    }
  }
  copy(doc.body, root)
  return { root, css, controls, texts, names, help, omitted }
}
