// web/app/Pwa.js
//
// The app side of docs/pwa.md: register the one service worker, say when a new
// version is ready and when the network is gone, and offer the browser's install.
//
// Nothing here reloads the page. A new version is used the next time the page
// is opened; a page never reloads under a piece that is playing.

export function createPwa (ctx) {
  const { window, document, $, log } = ctx
  let offered = null

  function showNetwork () {
    $('net-state').textContent = window.navigator.onLine
      ? ''
      : 'Offline. The page and the plugins you have opened still work.'
  }

  function watchForUpdates (registration) {
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      if (!worker) return
      worker.addEventListener('statechange', () => {
        // Installed while a worker already controls the page is an update; the
        // very first install is not news.
        if (worker.state === 'installed' && window.navigator.serviceWorker.controller) {
          $('update-notice').hidden = false
          $('update-notice').textContent = 'A new version of Jiggy is ready. It is used the next time the page is opened.'
        }
      })
    })
  }

  async function register () {
    if (!window.navigator.serviceWorker) return
    try {
      // Relative to the page, so a deployment under a path works as one at the root.
      const registration = await window.navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { type: 'classic' })
      watchForUpdates(registration)
    } catch (error) {
      log(`offline use is off: ${error.message}`, 'error')
    }
  }

  function mount () {
    window.addEventListener('online', showNetwork)
    window.addEventListener('offline', showNetwork)
    showNetwork()

    // Kept and shown as a button, not opened as a dialog, and only ever by the person.
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault()
      offered = event
      $('install').hidden = false
    })
    window.addEventListener('appinstalled', () => { offered = null; $('install').hidden = true })
    $('install').addEventListener('click', async () => {
      if (!offered) return
      const prompt = offered
      offered = null
      $('install').hidden = true
      await prompt.prompt()
    })

    // After the page has loaded, so registering never competes with starting it.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }

  return { mount }
}
