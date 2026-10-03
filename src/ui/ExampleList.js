// src/ui/ExampleList.js
//
// The example scripts as a list of cards, each with two buttons: one puts the script in the editor, the other
// also starts the piece it was written for and runs it. It builds elements and calls what it is handed, like
// TunePicker.js; the page owns what opening a piece or running a script means.
//
// Choosing an example replaces the text in the editor, which would lose a person's own script, so the page
// is told which one it is and decides; nothing here opens anything on its own (WCAG 3.2.2).
export function createExampleList (document, { examples, pieceLabel, onEdit, onPlay }) {
  for (const [name, fn] of Object.entries({ pieceLabel, onEdit, onPlay })) {
    if (typeof fn !== 'function') throw new Error(`createExampleList needs ${name}`)
  }
  const list = document.createElement('ul')
  list.className = 'examples'

  for (const example of examples) {
    const item = document.createElement('li')
    item.className = 'example'
    item.id = `example-${example.id}`

    const title = document.createElement('h3')
    title.textContent = example.title
    const about = document.createElement('p')
    about.className = 'about'
    about.textContent = example.about
    const piece = document.createElement('p')
    piece.className = 'note'
    piece.textContent = `Written for the piece "${pieceLabel(example.piece)}".`

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'example-edit'
    edit.textContent = 'Edit this'
    edit.setAttribute('aria-label', `Edit ${example.title}`)
    edit.addEventListener('click', () => onEdit(example))

    const play = document.createElement('button')
    play.type = 'button'
    play.className = 'example-play'
    play.textContent = 'Play it'
    play.setAttribute('aria-label', `Play ${example.title}`)
    play.addEventListener('click', () => onPlay(example))

    const actions = document.createElement('div')
    actions.className = 'example-actions'
    actions.append(edit, play)
    item.append(title, about, piece, actions)
    list.append(item)
  }
  return { element: list }
}
