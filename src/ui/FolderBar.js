// src/ui/FolderBar.js
//
// The bar above a run of tracks that share a folder name: the name, how many tracks, and a button that hides or shows
// them. Whether it is collapsed is the view's, held by the caller and not saved; the folder itself is editor metadata
// (jig:folder) and changes nothing that is heard.
export function createFolderBar (document, { onToggle }) {
  const element = document.createElement('div')
  element.className = 'timeline-folder'
  element.setAttribute('role', 'group')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'folder-toggle'
  let name = ''
  button.addEventListener('click', () => onToggle(name))
  element.append(button)
  return {
    element,
    update ({ name: folder, count, collapsed }) {
      name = folder
      const tracks = count === 1 ? '1 track' : `${count} tracks`
      // The state is in the words and in aria-expanded, never in the arrow alone.
      button.textContent = `${collapsed ? '▸' : '▾'} ${folder}, ${tracks}${collapsed ? ', hidden' : ''}`
      button.setAttribute('aria-expanded', String(!collapsed))
      button.setAttribute('aria-label', `${collapsed ? 'Show' : 'Hide'} the ${tracks} in folder ${folder}`)
      element.setAttribute('aria-label', `Folder ${folder}`)
    }
  }
}
