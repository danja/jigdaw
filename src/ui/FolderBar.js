// src/ui/FolderBar.js
//
// The bar above a run of tracks that share a folder name: the name, how many tracks, and a button that hides or shows
// them. Whether it is collapsed is the view's, held by the caller and not saved; the folder itself is editor metadata
// (jig:folder) and changes nothing that is heard.
//
// Move up and Move down shift the whole run past its neighbour. One that goes nowhere (the first run has no Move up)
// is left out, not disabled.
export function createFolderBar (document, { onToggle, onMove = null }) {
  const element = document.createElement('div')
  element.className = 'timeline-folder'
  element.setAttribute('role', 'group')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'folder-toggle'
  let name = ''
  button.addEventListener('click', () => onToggle(name))
  element.append(button)
  const move = (delta, text) => {
    const step = document.createElement('button')
    step.type = 'button'
    step.className = `folder-move folder-move-${delta < 0 ? 'up' : 'down'}`
    step.textContent = text
    step.addEventListener('click', () => onMove(delta))
    return step
  }
  const up = move(-1, 'Move up')
  const down = move(1, 'Move down')
  if (onMove) element.append(up, down)
  return {
    element,
    update ({ name: folder, count, collapsed, canUp = false, canDown = false }) {
      name = folder
      up.hidden = !canUp
      down.hidden = !canDown
      up.setAttribute('aria-label', `Move folder ${folder} up`)
      down.setAttribute('aria-label', `Move folder ${folder} down`)
      const tracks = count === 1 ? '1 track' : `${count} tracks`
      // The state is in the words and in aria-expanded, never in the arrow alone.
      button.textContent = `${collapsed ? '▸' : '▾'} ${folder}, ${tracks}${collapsed ? ', hidden' : ''}`
      button.setAttribute('aria-expanded', String(!collapsed))
      button.setAttribute('aria-label', `${collapsed ? 'Show' : 'Hide'} the ${tracks} in folder ${folder}`)
      element.setAttribute('aria-label', `Folder ${folder}`)
    }
  }
}
