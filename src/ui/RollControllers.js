// src/ui/RollControllers.js
//
// The lane chooser under the note roll, and the lane of controller or pitch bend events it shows. Velocity is the first
// choice and is drawn by the roll itself; any other choice is a controller (modulation, volume, pan, expression, sustain, or
// any number from 0 to 127) or the pitch bend wheel, shown as a row of bars, one for each event of that controller in the clip.
// An event holds its value until the next, so the bars are a step curve. A press on empty lane adds an event at the nearest
// step; a bar is dragged or moved by the keys like any lane's; Delete removes the focused one.
import { createRollLane } from './RollLane.js'

const CHOICES = [
  ['velocity', 'Velocity'],
  ['pitchBend', 'Pitch bend'],
  ['1', 'Modulation (controller 1)'],
  ['7', 'Volume (controller 7)'],
  ['10', 'Pan (controller 10)'],
  ['11', 'Expression (controller 11)'],
  ['64', 'Sustain pedal (controller 64)'],
  ['other', 'Another controller']
]

const BEND = { min: -8192, max: 8191 }
const CC = { min: 0, max: 127 }

export function createRollControllers (document, { onEvents, place }) {
  const element = document.createElement('div')
  element.className = 'piano-roll-lanes'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'What is drawn under the notes')

  const label = document.createElement('label')
  label.append(document.createTextNode('Under the notes '))
  const select = document.createElement('select')
  select.id = 'roll-lane'
  CHOICES.forEach(([value, text], i) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    option.selected = i === 0
    select.append(option)
  })
  label.append(select)

  const numberLabel = document.createElement('label')
  numberLabel.append(document.createTextNode('Controller number '))
  const number = document.createElement('input')
  number.type = 'number'
  number.id = 'roll-lane-number'
  number.min = '0'
  number.max = '127'
  number.step = '1'
  number.value = '74'
  numberLabel.append(number)

  // Where the lane is drawn: inside the roll's scroller, so it scrolls sideways with the columns it is aligned to.
  const host = document.createElement('div')
  host.className = 'piano-roll-lane-host'

  let events = []
  let steps = 0
  let stepsPerBeat = 4
  let lane = null
  let laneKey = null

  /** What is chosen: null for velocity, otherwise `{ controller, name }`. */
  const chosen = () => {
    if (select.value === 'velocity') return null
    if (select.value === 'pitchBend') return { controller: 'pitchBend', name: 'Pitch bend', range: BEND, fine: 64, coarse: 1024 }
    const controller = select.value === 'other' ? Number(number.value) : Number(select.value)
    if (!(Number.isInteger(controller) && controller >= 0 && controller <= 127)) return undefined
    const name = select.value === 'other' ? `Controller ${controller}` : CHOICES.find(([v]) => v === select.value)[1].replace(/ \(.*\)/, '')
    return { controller, name, range: CC, fine: 1, coarse: 10 }
  }

  const bendWords = value => (value === 0 ? 'centre' : value > 0 ? 'bent up' : 'bent down')

  const send = list => onEvents(list)
  const same = (a, b) => a.controller === b.controller && a.atBeat === b.atBeat

  function build (choice) {
    const { controller, name, range, fine, coarse } = choice
    const key = `${controller}`
    lane = createRollLane(document, {
      id: 'roll-lane-controller',
      label: name,
      min: range.min,
      max: range.max,
      fine,
      coarse,
      onSet: (item, value) => send(events.map(e => (same(e, item.event) ? { ...e, value } : e))),
      onRemove: item => send(events.filter(e => !same(e, item.event))),
      onAdd: (fraction, value) => {
        const atBeat = Math.min(steps - 1, Math.floor(fraction * steps)) / stepsPerBeat
        send([...events.filter(e => !(e.controller === controller && e.atBeat === atBeat)), { atBeat, controller, value }])
      }
    })
    laneKey = key
    host.append(lane.element)
  }

  const rebuild = () => { lane?.element.remove(); lane = null; laneKey = null }
  select.addEventListener('change', () => { numberLabel.hidden = select.value !== 'other'; rebuild(); onChoice?.() })
  number.addEventListener('change', () => { rebuild(); onChoice?.() })
  let onChoice = null

  numberLabel.hidden = true
  element.append(label, numberLabel)

  return {
    element,
    host,
    /** Called when the choice of lane changes, so the roll can show or hide the velocity lane and draw again. */
    set onChoice (fn) { onChoice = fn },
    /** True while velocity is what is drawn under the notes. */
    get velocity () { return select.value === 'velocity' },
    /** The roll's size in columns, and its events, as it is now. */
    draw ({ list, columns, perBeat }) {
      events = list
      steps = columns
      stepsPerBeat = perBeat
      const choice = chosen()
      // A controller number that is not one says so on the field and draws no lane, rather than guessing.
      if (select.value === 'other') { if (choice === undefined) number.setAttribute('aria-invalid', 'true'); else number.removeAttribute('aria-invalid') }
      if (!choice) { lane?.element.remove(); lane = null; laneKey = null; return }
      if (!lane || laneKey !== `${choice.controller}`) { rebuild(); build(choice) }
      lane.element.style.setProperty('--steps', String(steps))
      lane.draw(events.filter(e => e.controller === choice.controller).map(e => {
        const where = place(e.atBeat)
        return {
          key: `${e.controller}@${e.atBeat}`,
          event: e,
          beat: e.atBeat,
          value: e.value,
          name: `${choice.name} at ${where}`,
          text: choice.controller === 'pitchBend' ? `${e.value}, ${bendWords(e.value)}, at ${where}` : `${e.value}, at ${where}`
        }
      }))
    }
  }
}
