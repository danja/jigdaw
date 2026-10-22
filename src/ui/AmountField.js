// src/ui/AmountField.js
//
// A number to type and a button to apply it, for the panels that move several tracks by an amount (a decibel step on level,
// a shift on pan). The steps beside it are for a nudge; this is for an exact figure. Nothing is sent until Apply or Enter, an
// empty or non-numeric entry is refused where the person is looking (aria-invalid and a spoken message), and the field is
// left holding what was typed so the same amount can be applied again.
export function createAmountField (document, { id, label, unit, min, max, step, onApply }) {
  const element = document.createElement('div')
  element.className = 'track-field amount-field'
  const field = document.createElement('label')
  field.append(document.createTextNode(`${label} `))
  const input = document.createElement('input')
  input.type = 'number'
  input.id = id
  input.inputMode = 'decimal'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.setAttribute('aria-describedby', `${id}-unit`)
  field.append(input)
  const unitText = document.createElement('span')
  unitText.id = `${id}-unit`
  unitText.textContent = unit
  const apply = document.createElement('button')
  apply.type = 'button'
  apply.id = `${id}-apply`
  apply.textContent = 'Apply'
  const said = document.createElement('span')
  said.className = 'visually-hidden'
  said.setAttribute('role', 'status')

  const run = () => {
    const text = input.value.trim()
    const amount = Number(text)
    if (text === '' || !Number.isFinite(amount) || amount < min || amount > max) {
      input.setAttribute('aria-invalid', 'true')
      said.textContent = `${label} needs a number from ${min} to ${max}`
      return
    }
    input.removeAttribute('aria-invalid')
    said.textContent = ''
    onApply(amount)
  }
  apply.addEventListener('click', run)
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); run() } })
  element.append(field, unitText, apply, said)
  return { element, input }
}
