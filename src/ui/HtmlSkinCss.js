// src/ui/HtmlSkinCss.js
//
// The stylesheet half of an HTML skin (docs/html-skins.md, "Style"). The author's text is never handed to the browser:
// it is parsed here, every rule and declaration is checked against an allowlist, and a new sheet is written out from
// what was recognised. Anything not recognised is a problem, and a skin with a problem is refused whole.
//
// This is a parser and not CSSStyleSheet.replaceSync on purpose. It runs in Node and in a browser alike, so the same
// check holds in tests and in a native host, and it can refuse what a browser's parser would quietly accept (an
// escaped `url(`, a stray `!important`).
//
// Characters decide a lot. A value may hold letters, digits, spaces and a few symbols; a selector the same plus the
// combinators. That leaves no quote, no backslash and no `!`, so there is no string to hide `url(` in, no escape to spell
// it with, and no `!important` to put an author declaration above the host's own rules, which an important
// declaration in a lower cascade layer would otherwise do.

export const CSS_LIMITS = Object.freeze({ bytes: 64 * 1024, rules: 500 })

const PROPERTY = new RegExp('^(' + [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'inset(-.*)?', 'z-index',
  'flex(-.*)?', 'grid(-.*)?', '(row-|column-)?gap', 'align-.*', 'justify-.*', 'place-.*', 'order',
  'width', 'height', 'min-.*', 'max-.*', 'margin(-.*)?', 'padding(-.*)?', 'box-sizing', 'overflow(-.*)?',
  'color', 'background-color', 'border(-.*)?', 'outline(-.*)?', 'box-shadow', 'accent-color', 'color-scheme', 'container-type',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space'
].join('|') + ')$')

// The elements a skin may contain, which a selector may therefore name. HtmlSkin.js takes its list from here, so the
// markup and the stylesheet cannot disagree about what exists.
export const ELEMENTS = new Set(['section', 'div', 'span', 'header', 'footer', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'fieldset', 'legend', 'label', 'output', 'input', 'select'])
const DISPLAY = new Set(['block', 'inline', 'inline-block', 'flex', 'grid', 'contents'])
const POSITION = new Set(['static', 'relative', 'absolute'])
const FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-monospace', 'ui-sans-serif', 'ui-serif'])
const FUNCTION_REFUSED = /\b(url|image-set|attr|env|var|expression)\s*\(/i
const VALUE_CHARS = /^[A-Za-z0-9\s.,%#()+\-*/_]*$/
const SELECTOR_CHARS = /^[A-Za-z0-9\s.#>:\-_[\]]+$/
const MEDIA = /^\(\s*(min|max)-(width|height)\s*:\s*[^()]+\)(\s+and\s+\(\s*(min|max)-(width|height)\s*:\s*[^()]+\))*$/
// One compound selector: an optional element, then classes, ids, the bound-attribute family and the few pseudo-classes.
const COMPOUND = /^(?:[a-z][a-z0-9]*)?(?:\.[A-Za-z_-][\w-]*|#[A-Za-z_-][\w-]*|\[data-param(?:-name|-text|-help)?\]|:(?:hover|focus-visible|checked|first-child))*$/

/** Top-level `{ prelude, body }` blocks of `text`, matching braces. A statement with no block has `body: null`. */
function blocks (text) {
  const out = []
  let depth = 0
  let start = 0
  let open = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{') { if (depth === 0) open = i; depth++ } else if (c === '}') {
      depth--
      if (depth < 0) return { error: 'an unmatched closing brace' }
      if (depth === 0) { out.push({ prelude: text.slice(start, open).trim(), body: text.slice(open + 1, i) }); start = i + 1 }
    } else if (c === ';' && depth === 0) { out.push({ prelude: text.slice(start, i).trim(), body: null }); start = i + 1 }
  }
  if (depth !== 0) return { error: 'an unclosed brace' }
  if (text.slice(start).trim()) out.push({ prelude: text.slice(start).trim(), body: null })
  return out
}

function declarations (selector, body, problems) {
  const kept = []
  for (const raw of body.split(';')) {
    if (!raw.trim()) continue
    const at = raw.indexOf(':')
    if (at < 0) { problems.push(`${selector}: a declaration with no colon`); continue }
    const property = raw.slice(0, at).trim().toLowerCase()
    const value = raw.slice(at + 1).trim()
    if (property.startsWith('--')) { problems.push(`${selector}: custom property ${property} is refused`); continue }
    if (!PROPERTY.test(property) || property.startsWith('border-image')) { problems.push(`${selector}: property ${property} is not allowed`); continue }
    if (!VALUE_CHARS.test(value)) { problems.push(`${selector}: ${property} has a character a value may not hold (a quote, a backslash or !important, for one)`); continue }
    if (FUNCTION_REFUSED.test(value)) { problems.push(`${selector}: ${property} uses a refused function`); continue }
    if (property === 'display' && !DISPLAY.has(value)) { problems.push(`${selector}: display ${value} is not allowed`); continue }
    if (property === 'position' && !POSITION.has(value)) { problems.push(`${selector}: position ${value} is not allowed`); continue }
    if (property === 'z-index' && !(/^\d+$/.test(value) && Number(value) <= 10)) { problems.push(`${selector}: z-index ${value} is not a whole number from 0 to 10`); continue }
    if (property === 'container-type' && value !== 'inline-size') { problems.push(`${selector}: container-type ${value} is not allowed`); continue }
    if (property === 'font-family') {
      const bad = value.split(',').map(f => f.trim().toLowerCase()).filter(f => !FAMILIES.has(f))
      if (bad.length) { problems.push(`${selector}: font-family ${bad[0]} is not a generic family`); continue }
    }
    if (property === 'box-shadow') {
      const blur = Number(value.match(/-?\d+(\.\d+)?px\s+-?\d+(\.\d+)?px\s+(\d+(\.\d+)?)px/)?.[3] ?? 0)
      if (blur > 16) { problems.push(`${selector}: box-shadow blur ${blur}px is over 16px`); continue }
    }
    kept.push(`${property}:${value}`)
  }
  return kept
}

/** The selector, checked and with its ids rewritten to `prefix`, or null with the problem recorded. */
function selectorOf (selector, prefix, problems) {
  // The pseudo-class is named first, so a refusal says which one and not only that a bracket was found.
  const refusedPseudo = selector.match(/(?<!:):([a-z-]+)/g)?.map(p => p.slice(1)).find(name => !/^(hover|focus-visible|checked|first-child)$/.test(name))
  if (refusedPseudo) { problems.push(`${selector}: :${refusedPseudo} is not allowed`); return null }
  if (!SELECTOR_CHARS.test(selector)) { problems.push(`${selector}: a character a selector may not hold`); return null }
  if (/::/.test(selector)) { problems.push(`${selector}: a pseudo-element is refused`); return null }
  const parts = selector.trim().split(/\s*>\s*|\s+/).filter(Boolean)
  if (parts.length > 4) { problems.push(`${selector}: more than four compound parts`); return null }
  for (const part of parts) {
    const type = part.match(/^[a-z][a-z0-9]*/)?.[0]
    if (COMPOUND.test(part) && (!type || ELEMENTS.has(type))) continue
    problems.push(`${selector}: ${part} is not an allowed selector`)
    return null
  }
  return selector.trim().replace(/#([A-Za-z_-][\w-]*)/g, (_, id) => `#${prefix}${id}`)
}

function rules (text, prefix, problems, insideLayer, counter) {
  const parsed = blocks(text)
  if (parsed.error) { problems.push(parsed.error); return '' }
  let out = ''
  for (const { prelude, body } of parsed) {
    if (prelude.startsWith('@')) {
      const [name, ...rest] = prelude.slice(1).split(/\s+/)
      const argument = rest.join(' ')
      if (body === null) { problems.push(`@${name} is refused`); continue }
      if (name === 'layer') {
        if (insideLayer || argument !== 'skin') { problems.push(`@layer ${argument} is not the one skin layer`); continue }
        out += rules(body, prefix, problems, true, counter)
      } else if (name === 'media' || name === 'container') {
        if (!insideLayer) { problems.push(`@${name} sits outside @layer skin`); continue }
        if (!MEDIA.test(argument)) { problems.push(`@${name} ${argument}: only width and height conditions are allowed`); continue }
        out += `@${name} ${argument}{${rules(body, prefix, problems, true, counter)}}`
      } else problems.push(`@${name} is refused`)
      continue
    }
    counter.rules++
    if (!insideLayer) { problems.push(`${prelude}: a rule outside @layer skin`); continue }
    const selectors = prelude.split(',').map(s => selectorOf(s.trim(), prefix, problems))
    const kept = declarations(prelude, body ?? '', problems)
    if (selectors.every(Boolean) && kept.length) out += `${selectors.join(',')}{${kept.join(';')}}`
  }
  return out
}

/**
 * @param {string} text the skin's stylesheet
 * @param {string} prefix put in front of every id, as the markup's ids are
 * @returns {{ css: string, problems: string[] }} css is the author's rules rewritten inside one cascade layer, empty
 *   when there are problems, since a skin with any is refused whole
 */
export function checkCss (text, prefix) {
  const problems = []
  if (text.length > CSS_LIMITS.bytes) return { css: '', problems: [`the stylesheet is ${text.length} bytes, over the ${CSS_LIMITS.bytes} limit`] }
  const counter = { rules: 0 }
  const inner = rules(text.replace(/\/\*[\s\S]*?\*\//g, ''), prefix, problems, false, counter)
  if (counter.rules > CSS_LIMITS.rules) problems.push(`${counter.rules} rules, over the ${CSS_LIMITS.rules} limit`)
  return { css: problems.length || !inner ? '' : `@layer skin{${inner}}`, problems }
}
