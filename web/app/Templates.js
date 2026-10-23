// web/app/Templates.js
//
// Templates: the open session kept in this browser under a name, and a new session started from one. The store
// is src/host/Templates.js; a template is a session as saved, so opening one is opening a file, through the same
// code (Sessions.openBytes), and starts a new history. Opening replaces the open session, as a preset does, so
// the button says so.
import { createTemplates } from '../../src/host/Templates.js'

export function createTemplatesPanel (ctx, { store = createTemplates() } = {}) {
  const { document, $, log } = ctx
  const status = document.createElement('p')
  status.className = 'note'
  status.setAttribute('role', 'status')

  const saveForm = document.createElement('form')
  saveForm.className = 'searchbar'
  const nameLabel = document.createElement('label')
  nameLabel.className = 'visually-hidden'
  nameLabel.htmlFor = 'template-name'
  nameLabel.textContent = 'Template name'
  const nameInput = document.createElement('input')
  nameInput.id = 'template-name'
  nameInput.type = 'text'
  nameInput.maxLength = 60
  nameInput.placeholder = 'Template name'
  const saveButton = document.createElement('button')
  saveButton.type = 'submit'
  saveButton.id = 'template-save'
  saveButton.textContent = 'Save as template'
  saveButton.title = 'Keep the open session in this browser, to start new ones from'
  saveForm.append(nameLabel, nameInput, saveButton)

  // Left out until there is a template to choose, since a choice with nothing in it does nothing.
  const openForm = document.createElement('form')
  openForm.className = 'searchbar'
  openForm.hidden = true
  const pickLabel = document.createElement('label')
  pickLabel.className = 'visually-hidden'
  pickLabel.htmlFor = 'template-pick'
  pickLabel.textContent = 'Template'
  const pick = document.createElement('select')
  pick.id = 'template-pick'
  const openButton = document.createElement('button')
  openButton.type = 'submit'
  openButton.id = 'template-open'
  openButton.textContent = 'New from template'
  openButton.title = 'Replaces the current session'
  const removeButton = document.createElement('button')
  removeButton.type = 'button'
  removeButton.id = 'template-remove'
  removeButton.textContent = 'Delete template'
  removeButton.title = 'Forget the chosen template; sessions already made from it are not touched'
  openForm.append(pickLabel, pick, openButton, removeButton)

  const element = document.createElement('div')
  element.id = 'templates'
  const heading = document.createElement('h2')
  heading.style.marginTop = '18px'
  heading.textContent = 'Templates'
  element.append(heading, saveForm, openForm, status)

  const say = (text, kind = 'ok') => { status.textContent = text; log(text, kind) }

  async function refresh (choose = null) {
    const names = (await store.list()).map(t => t.name)
    pick.replaceChildren(...names.map(name => {
      const option = document.createElement('option')
      option.value = name
      option.textContent = name
      return option
    }))
    for (const option of pick.options) option.selected = option.value === choose
    openForm.hidden = names.length === 0
    return names
  }

  async function save (name) {
    if (!ctx.dispatcher) throw new Error('there is nothing to keep yet')
    const packed = await ctx.sessions.pack()
    const kept = await store.save(name, { kind: packed.kind, bytes: packed.bytes })
    await refresh(kept)
    say(`kept as template ${kept}`)
    return kept
  }

  async function open (name) {
    const found = await store.get(name)
    if (!found) throw new Error(`no template called ${name}`)
    await ctx.sessions.openBytes(found.bytes)
    say(`started from template ${name}`)
  }

  async function remove (name) {
    await store.remove(name)
    await refresh()
    say(`deleted template ${name}`)
  }

  const chosen = () => [...pick.options].find(option => option.selected)?.value
  const guarded = work => event => { event?.preventDefault(); work().catch(error => say(error.message, 'error')) }
  saveForm.addEventListener('submit', guarded(async () => {
    // A blank name takes the project's title, which is what a person would call it.
    const typed = nameInput.value.trim()
    await save(typed !== '' ? typed : (ctx.dispatcher?.project.label ?? ''))
    nameInput.value = ''
  }))
  openForm.addEventListener('submit', guarded(() => open(chosen())))
  removeButton.addEventListener('click', guarded(() => remove(chosen())))

  return {
    element,
    save,
    open,
    remove,
    refresh,
    mount () {
      $('presets').after(element)
      return refresh().catch(error => log(`templates: ${error.message}`, 'error'))
    }
  }
}
