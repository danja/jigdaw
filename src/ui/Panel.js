// src/ui/Panel.js
//
// A control panel generated from a plugin's lv2:port declarations.
//
// Contract section 9.1: a plugin with no jig:skin gets this, whether or not it
// has a jig:ui, and that is the expected case rather than a degraded one. It is
// consistent with every other plugin, it is accessible, and it costs the author
// nothing. A jig:ui is an editor offered beside the panel, never instead of it.
//
// The widget is chosen by ProfileReader.widgetFor, from the shape of the
// declaration. Nothing here inspects lv2:toggled itself.
//
// This file carries the project's whole accessibility story. AGENTS.md requires
// WCAG 2.2 AA, and almost every control a person touches in Jiggy is generated
// here: a plugin that ships no jig:ui gets exactly this. So one accessible
// generator makes every such plugin accessible, and one careless generator
// makes every one of them unusable.
//
// A continuous control is drawn as a rotary knob by src/ui/Dial.js, which is
// where the pixels and the pointer live. The element underneath is still an
// `<input type="range">`, so nothing about the keyboard or the screen reader
// changed when the look did.
import { createDial } from './Dial.js'
import { createSkinPanel } from './SkinPanel.js'
import { splitPrimary } from './PrimaryControls.js'
import { createPad } from './Pad.js'
import { formatValue, spokenValue } from './PortText.js'

export { UNIT_LABELS, formatValue, SPOKEN_UNITS, spokenValue } from './PortText.js'

/**
 * Build a panel. `onChange(symbol, value)` is called on input; the panel does
 * not apply the value itself.
 *
 * That round trip is deliberate, per messaging.md section 2.3: a UI that
 * renders optimistically from its own input disagrees with the host the first
 * time a value is clamped, rejected, or overridden by automation.
 *
 * `onLoadAsset(key, file)` is called when a person picks a file for a
 * `jig:userReplaceable` asset (messaging.md section 1.2's `loadAsset`), one
 * per such asset the profile declares. Optional, and nothing is drawn for it
 * when a profile declares none: most plugins have nothing a person loads at
 * runtime, and this must cost them nothing, the same rule every other
 * generated control here already follows.
 *
 * An asset whose media type is `text/plain` is also drawn as a text area with an Apply button (contract section 5.5), so a
 * person can type into it rather than find a file. Apply calls `onLoadAsset(key, blob)` with the encoded text, the same path
 * a file takes. `onLoadAsset` may return `{ ok, message }`, and a refusal is said beside the text. The host puts the text
 * the plugin has loaded into the area with `setAssetText(key, text)`.
 *
 * `skinLayout` passes `measure` and `availableWidth` through to the skin, which a test supplies because a DOM has no layout.
 *
 * `skin`, from src/host/SkinLoader.js, is the plugin's own artwork already built
 * from the allowlist (docs/svg-skins.md). It is drawn first, and the generated
 * controls follow for every port it does not bind, so a skin can show a subset
 * of the ports and cannot make one unreachable (contract section 9.4).
 */
export function createPanel (document, profile, onChange, onLoadAsset, { scope = profile.iri, skin = null, skinLayout = {} } = {}) {
  // What the control ids are made from. The plugin IRI by default, and a host
  // showing two instances of one plugin passes something per instance: two
  // panels built from one IRI gave every control an id the other also had, so
  // a label pointed at the first instance's knob and focus came back to the
  // wrong one after a redraw.
  const root = document.createElement('section')
  root.className = 'panel'

  const heading = document.createElement('h3')
  heading.textContent = profile.label ?? profile.iri
  const headingId = `${scope}-heading`.replace(/[^\w-]/g, '_')
  heading.id = headingId
  // A group per plugin, named by its own heading, so a panel is one landmark a
  // reader can skip rather than a flat run of controls from several plugins.
  root.setAttribute('role', 'group')
  root.setAttribute('aria-labelledby', headingId)
  root.append(heading)

  // Contract section 12.5. A foreign plugin runs in this document with this
  // document's privileges, and a person who consented once and came back a
  // week later has no other way to tell. The mark is text inside the heading
  // rather than a class on the panel, because section 12.5 requires it to
  // reach assistive technology and forbids carrying it by colour alone: a
  // border a stylesheet draws is invisible to a screen reader and to anyone
  // who cannot see the border.
  if (profile.kind === 'foreign') {
    const mark = document.createElement('span')
    mark.className = 'foreign'
    mark.textContent = 'foreign'
    mark.title = 'Runs in this page with this page\'s privileges. It is not sandboxed.'
    heading.append(' ', mark)
    root.classList.add('is-foreign')
  }

  // Help for a control, from the port's own rdfs:comment: one line under the heading showing what the hovered or focused control does,
  // and the same words as the control's description, which is what a screen reader reads on focus. The line is drawn only for a plugin
  // that has any help, and reserves its height, so a panel that says nothing gets nothing and a panel that does not jump when it shows.
  // It never takes the focus and never covers a control, and Escape puts it away (WCAG 1.4.13: dismissible, hoverable, persistent).
  let helpLine = null
  let focusedPort = null
  if (profile.ports.some(p => p.comment)) {
    helpLine = document.createElement('p')
    helpLine.className = 'control-help'
    // Hidden from assistive technology because the control already carries these words as its description, and saying them twice is noise.
    helpLine.setAttribute('aria-hidden', 'true')
    root.append(helpLine)
  }
  const showHelp = port => {
    // The control's name in bold, then the sentence: a colon between them doubled up with any colon the author's sentence had.
    const name = document.createElement('b')
    name.textContent = port.name ?? port.symbol
    helpLine.replaceChildren(name, document.createTextNode(` ${port.comment}`))
  }
  const clearHelp = () => { helpLine.replaceChildren() }
  // When the pointer leaves, what has the focus is the next thing to explain, if it has anything to say.
  const settleHelp = () => { if (focusedPort) showHelp(focusedPort); else clearHelp() }

  // Pads: squares that set two of the plugin's ports at once (src/ui/Pad.js). Drawn above the controls, which stay where they are: the pad
  // is a pointer shortcut and the two ports it sets are still the controls a keyboard and a screen reader use. A profile with no pads
  // draws none, which is every profile there was before pads.
  const padHandles = []
  const pads = Array.isArray(profile.pads) ? profile.pads : []
  // The row is made here so it sits above whatever is drawn after it, and filled below, once the controls can be made. A selector a pad
  // names as its choice is moved beside the pad and not drawn twice, except under a skin, which draws its own controls and is left alone.
  const padsRow = pads.length > 0 ? document.createElement('div') : null
  if (padsRow) { padsRow.className = 'pads'; root.append(padsRow) }
  const moved = skin ? new Set() : new Set(pads.map(p => p.choice).filter(Boolean))
  const listed = profile.ports.filter(p => !moved.has(p.symbol))

  // No description. rdfs:comment is three lines of prose above the controls,
  // it is the same three lines every time the plugin is loaded, and the
  // browser and the catalogue both already show it where someone is choosing
  // a plugin rather than playing one. Screen area is the scarce thing in a
  // rack.

  // symbol -> the functions that draw that port's value: the generated control, and a second one when the panel has two
  // (a skin that is too cramped to use at this width is replaced by generated controls for every port).
  const setters = new Map()
  const onValue = (symbol, fn) => { if (!setters.has(symbol)) setters.set(symbol, []); setters.get(symbol).push(fn) }

  const skinPanel = skin ? createSkinPanel(document, { ...skin, ports: profile.ports }, onChange, { scope, ...skinLayout }) : null
  if (skinPanel) {
    root.append(skinPanel.element)
    root.classList.add('has-skin')
    for (const port of profile.ports) skinPanel.update(port.symbol, port.defaultValue)
    // The hit areas are placed from measurements, which exist only once the element is in a page
    // and change with its width, so the observer does both.
    const Observer = document.defaultView?.ResizeObserver
    // The panel, not the skin: the skin is put away when it is cramped and then has no size to observe.
    if (Observer) new Observer(() => skinPanel.fit()).observe(root)
  }
  const unskinned = skinPanel ? profile.ports.filter(p => !skinPanel.bound.has(p.symbol)) : listed

  // The pads, now that the controls can be made. A pad with a choice is a pad and that one selector side by side.
  pads.forEach((pad, index) => {
    const handle = createPad(document, {
      pad,
      ports: profile.ports,
      id: `${scope}-pad-${index}`.replace(/[^\w-]/g, '_'),
      // Through the same path a knob takes: the two controls draw the new value and the host is told, exactly as for a drag of either.
      onSet: (symbol, value) => { for (const fn of setters.get(symbol) ?? []) fn(value); onChange(symbol, value) }
    })
    const choice = moved.has(pad.choice) ? profile.ports.find(p => p.symbol === pad.choice) : null
    if (choice) {
      const holder = document.createElement('div')
      holder.className = 'pad-with-choice'
      const box = document.createElement('div')
      box.className = 'pad-choice'
      addControl(box, choice, 'pad-')
      holder.append(handle.element, box)
      padsRow.append(holder)
    } else {
      padsRow.append(handle.element)
    }
    padHandles.push({ pad, handle })
  })

  function addControl (grid, port, tag) {
    const row = document.createElement('div')
    row.className = `control control-${port.widget}`

    const label = document.createElement('label')
    const id = `${scope}#${tag}${port.symbol}`.replace(/[^\w-]/g, '_')
    // setAttribute rather than the htmlFor property: the property is an alias
    // that not every DOM implementation provides, and the association is the
    // whole point of the label.
    label.setAttribute('for', id)
    // A bound controller is part of the control's name, so a person matching
    // a hardware knob to the panel finds it by reading: the declaration is
    // per port, and the accessible name is the label.
    label.textContent = port.controller == null
      ? (port.name ?? port.symbol)
      : `${port.name ?? port.symbol} (CC ${port.controller})`
    row.append(label)

    const readout = document.createElement('span')
    readout.className = 'value'

    let input
    // What goes in the row: the input itself for a switch or a selector, and
    // the knob that wraps the input for a dial.
    let knob = null
    if (port.widget === 'switch') {
      input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = port.defaultValue >= 0.5
      input.addEventListener('change', () => onChange(port.symbol, input.checked ? port.maximum : port.minimum))
      onValue(port.symbol, v => {
        const on = v >= 0.5
        input.checked = on
        // WCAG 1.4.1: the readout is the non-colour signal for the state. A
        // two-point enumeration is drawn as a switch too, and its points have
        // names: "off" for Quefrency's "Cepstral" estimator said nothing true.
        const named = port.scalePoints?.find(p => p.value === (on ? port.maximum : port.minimum))?.label
        readout.textContent = named ?? (on ? 'on' : 'off')
      })
    } else if (port.widget === 'selector') {
      input = document.createElement('select')
      for (const point of port.scalePoints) {
        const option = document.createElement('option')
        option.value = String(point.value)
        option.textContent = point.label ?? String(point.value)
        input.append(option)
      }
      // Selecting by marking the option rather than assigning select.value,
      // which is a setter some DOM implementations do not provide.
      const select = value => {
        for (const option of input.options ?? input.children) {
          option.selected = Number(option.value) === Number(value)
        }
      }
      select(port.defaultValue)
      input.addEventListener('change', () => onChange(port.symbol, Number(input.value)))
      onValue(port.symbol, v => {
        select(v)
        readout.textContent = port.scalePoints.find(p => p.value === v)?.label ?? String(v)
      })
    } else {
      const dial = createDial(document, port, id)
      input = dial.input
      // One listener for both, because a drag dispatches the same event an
      // arrow key does. Nothing here knows which happened.
      input.addEventListener('input', () => onChange(port.symbol, Number(input.value)))
      onValue(port.symbol, v => {
        input.value = String(v)
        readout.textContent = formatValue(port, v)
        // aria-valuetext, because a range otherwise announces the raw number
        // and loses the unit entirely.
        input.setAttribute('aria-valuetext', spokenValue(port, v))
        dial.render(v)
      })
      knob = dial.element
    }

    input.id = id
    // The readout is the accessible description rather than a separate node a
    // reader has to go and find.
    const readoutId = `${id}-value`
    readout.id = readoutId
    input.setAttribute('aria-describedby', readoutId)
    // The full name, because a knob's caption is narrow and a long one wraps
    // or is read in pieces. The accessible name is the label and is never
    // shortened; this is for a pointer. A control with help of its own has it
    // in the help line instead, which a keyboard and a touch reach as well.
    if (!port.comment && port.name) input.title = port.name
    row.append(knob ?? input, readout)
    if (port.comment) {
      const helpId = `${id}-help`
      const words = document.createElement('span')
      words.className = 'visually-hidden'
      words.id = helpId
      words.textContent = port.comment
      row.append(words)
      input.setAttribute('aria-describedby', `${readoutId} ${helpId}`)
      row.addEventListener('pointerenter', () => showHelp(port))
      row.addEventListener('pointerleave', settleHelp)
      row.addEventListener('focusin', () => { focusedPort = port; showHelp(port) })
      row.addEventListener('focusout', event => {
        if (row.contains(event.relatedTarget)) return
        focusedPort = null
        clearHelp()
      })
      row.addEventListener('keydown', event => { if (event.key === 'Escape') clearHelp() })
    }
    grid.append(row)

    // Render the declared default through the same path a host update takes.
    setters.get(port.symbol).at(-1)(port.defaultValue)
  }

  // The controls share one grid per section, so knobs pack across the width
  // they are given instead of taking a row each. A panel of 42 controls was
  // 2000 pixels tall as sliders and is one screen as knobs.
  function addGrid (parent, ports, tag) {
    const controls = document.createElement('div')
    controls.className = 'controls'
    parent.append(controls)
    for (const port of ports) addControl(controls, port, tag)
  }

  // Ports render in sections: ungrouped ports first, exactly as a plugin with
  // no groups renders today, then one named section per group in order of
  // first appearance. A fieldset names its controls to assistive technology;
  // a visible heading alone would name them only to sight. `tag` keeps the ids
  // apart when the same port is drawn twice.
  function addSections (parent, ports, tag, ungroupedLegend) {
    const ungrouped = ports.filter(p => p.group == null)
    const groups = []
    for (const port of ports) {
      if (port.group == null) continue
      const group = groups.find(g => g.label === port.group)
      if (group) group.ports.push(port)
      else groups.push({ label: port.group, ports: [port] })
    }
    const fieldset = label => {
      const field = document.createElement('fieldset')
      field.className = 'control-group'
      const legend = document.createElement('legend')
      legend.textContent = label
      field.append(legend)
      parent.append(field)
      return field
    }
    if (ungrouped.length > 0) addGrid(ungroupedLegend ? fieldset(ungroupedLegend) : parent, ungrouped, tag)
    for (const group of groups) addGrid(fieldset(group.label), group.ports, tag)
  }

  // The ports the author said matter most come first, highest first; the others wait under a disclosure, which a keyboard opens like
  // any other and which stays as the person left it for as long as the panel does. A profile that says nothing, or that ranks every
  // port, is drawn whole, as it always was (src/ui/PrimaryControls.js).
  function addWithMore (parent, ports, tag, ungroupedLegend) {
    const { primary, rest } = splitPrimary(ports)
    // The first view is one flat grid in priority order. A group's heading over a single knob is no help, and a plugin that groups by
    // voice would otherwise open as a column of boxes with one control in each. The groups are kept inside the disclosure.
    addSections(parent, rest.length === 0 ? primary : primary.map(p => ({ ...p, group: null })), tag, ungroupedLegend)
    if (rest.length === 0) return
    const more = document.createElement('details')
    more.className = 'more-controls'
    const summary = document.createElement('summary')
    summary.textContent = `More controls (${rest.length})`
    more.append(summary)
    addSections(more, rest, tag, null)
    parent.append(more)
  }

  if (!skinPanel) addWithMore(root, listed, '', null)
  else {
    // Under a drawing, controls the drawing does not have need saying so.
    const others = document.createElement('div')
    others.className = 'skin-others'
    addWithMore(others, unskinned, '', 'Other controls')
    // The skin's controls are padded to 44px, and at a narrow width a dense drawing cannot give each one that
    // without them overlapping. Then the drawing is put away and every port is drawn as a generated control, which
    // a person can use at any width. Both exist, and one is hidden, so a resize either way needs no rebuild.
    const everything = document.createElement('div')
    everything.className = 'skin-fallback'
    everything.hidden = true
    addWithMore(everything, profile.ports, 'all-', null)
    root.append(others, everything)
    skinPanel.onCramped(cramped => {
      skinPanel.element.hidden = cramped
      others.hidden = cramped
      everything.hidden = !cramped
      root.classList.toggle('skin-cramped', cramped)
    })
  }

  // Each pad follows its two ports, whatever moves them, and starts where the profile's defaults put them.
  for (const { pad, handle } of padHandles) {
    for (const symbol of [pad.x, pad.y]) {
      onValue(symbol, v => handle.update(symbol, v))
      handle.update(symbol, profile.ports.find(p => p.symbol === symbol).defaultValue)
    }
  }

  // One file picker per jig:userReplaceable asset, after the parameters:
  // loading a different model or impulse response is a rarer action than
  // turning a knob, and the panel reads top to bottom in the order a person
  // is most likely to want it.
  let assetGrid = null
  const textAreas = new Map()
  for (const asset of profile.assets ?? []) {
    if (!asset.userReplaceable) continue
    // Its own grid, trailing the sections: the per-section grids above are
    // owned by their ports, and an asset picker belongs to neither.
    if (!assetGrid) {
      assetGrid = document.createElement('div')
      assetGrid.className = 'controls'
      root.append(assetGrid)
    }
    const key = asset.iri.split('#').pop()

    if (asset.mediaType === 'text/plain') assetGrid.append(textControl(document, key, asset, `${scope}#${key}-text`.replace(/[^\w-]/g, '_'), onLoadAsset, textAreas))

    const row = document.createElement('div')
    row.className = 'control control-asset'

    const label = document.createElement('label')
    const id = `${scope}#${key}-asset`.replace(/[^\w-]/g, '_')
    label.setAttribute('for', id)
    label.textContent = key
    row.append(label)

    const input = document.createElement('input')
    input.type = 'file'
    input.id = id
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file) onLoadAsset?.(key, file)
    })
    row.append(input)
    assetGrid.append(row)
  }

  return {
    element: root,
    /** Called by the host when a value actually changed. */
    update (symbol, value) {
      for (const fn of setters.get(symbol) ?? []) fn(value)
      skinPanel?.update(symbol, value)
    },
    /**
     * Show the text a plugin has loaded in its text asset's area. Edits the person has not applied are kept, and the
     * status says the plugin's text changed underneath them, so typing is never thrown away.
     */
    setAssetText (key, text) { textAreas.get(key)?.show(text) },
    /** Whether a skin is drawn, so a caller can tell a panel built before its skin arrived. */
    skinned: skinPanel !== null,
    /** The skin's own view, for a caller that places it itself: a test with its own measurements. */
    skinView: skinPanel
  }
}

const encoder = new TextEncoder()

/**
 * The text area for a plain text asset: a label, the area, how much of the limit it uses, an Apply button and a status line.
 * Its size is counted in bytes, which is what the plugin's buffer holds, and Apply refuses what will not fit rather than
 * letting the plugin clip it without saying.
 */
function textControl (document, key, asset, id, onLoadAsset, registry) {
  const row = document.createElement('div')
  row.className = 'control control-text'

  const label = document.createElement('label')
  label.setAttribute('for', id)
  label.textContent = key
  const area = document.createElement('textarea')
  area.id = id
  area.rows = 6
  area.spellcheck = false
  area.style.cssText = 'width:100%;box-sizing:border-box;font:inherit;font-size:16px'
  const hint = document.createElement('div')
  hint.id = `${id}-hint`
  hint.className = 'control-hint'
  area.setAttribute('aria-describedby', hint.id)
  const apply = document.createElement('button')
  apply.type = 'button'
  apply.textContent = 'Apply'
  apply.style.cssText = 'min-height:44px;min-width:44px'
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  status.className = 'control-status'

  let loaded = ''
  const bytes = () => encoder.encode(area.value).length
  const limit = asset.maxBytes ?? null
  const count = () => {
    hint.textContent = limit === null ? `${bytes()} bytes` : `${bytes()} of ${limit} bytes`
    hint.classList.toggle('over', limit !== null && bytes() > limit)
  }
  area.addEventListener('input', count)

  const send = async () => {
    if (limit !== null && bytes() > limit) {
      status.textContent = `Not applied: ${bytes()} bytes is over the limit of ${limit}.`
      return
    }
    const text = area.value
    const result = await onLoadAsset?.(key, new Blob([encoder.encode(text)], { type: 'text/plain' }))
    if (result && result.ok === false) { status.textContent = `Not applied: ${result.message}`; return }
    loaded = text
    status.textContent = 'Applied.'
  }
  apply.addEventListener('click', () => { send() })
  area.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send() }
  })

  registry.set(key, {
    show (text) {
      // Unsent typing wins over what arrives: the person is partway through writing it.
      if (area.value !== loaded && area.value !== text) {
        status.textContent = 'The plugin\'s text changed. Your edits are kept; Apply replaces it.'
        return
      }
      loaded = text
      area.value = text
      count()
    }
  })
  count()
  row.append(label, area, hint, apply, status)
  return row
}
