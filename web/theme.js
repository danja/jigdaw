// web/theme.js
//
// Which colour theme a page is drawn in: light, dark, or whichever the device asks for. A classic script loaded at the top of each
// page's head, like view.js, so the theme is on <html> before anything is drawn and a page is never shown in one and then the other.
//
// The choice is the person's and is kept in this browser (`jigdaw.theme`), shared by every page of the site. Until they choose,
// the theme is DEFAULT, which is light. The tokens each theme sets are in the pages' own style blocks, under `html[data-theme]`.
(function () {
  var KEY = 'jigdaw.theme'
  var DEFAULT = 'light'
  var CHOICES = ['light', 'dark', 'auto']
  // The colour a browser draws its own toolbar in, for an installed app and a phone, to agree with the page.
  var CHROME = { light: '#f4f6f9', dark: '#14171d' }

  function stored () {
    try {
      var value = window.localStorage.getItem(KEY)
      return CHOICES.indexOf(value) === -1 ? null : value
    } catch (error) { return null }
  }

  function resolve (choice) {
    if (choice !== 'auto') return choice
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function paintChrome (theme) {
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', CHROME[theme])
  }

  function apply (choice) {
    var theme = resolve(choice)
    document.documentElement.setAttribute('data-theme', theme)
    paintChrome(theme)
    // This script runs in the head, before the page's own <meta name="theme-color"> has been read, so it is told again once it has.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { paintChrome(theme) })
    return theme
  }

  /** The person chose: remember it and draw it. Storage that refuses is not an error, the choice lasts for this visit. */
  function choose (choice) {
    if (CHOICES.indexOf(choice) === -1) throw new Error('no such theme: ' + choice)
    try { window.localStorage.setItem(KEY, choice) } catch (error) { /* private window: kept for this visit only */ }
    return apply(choice)
  }

  window.__jigdawTheme = { choices: CHOICES, current: function () { return stored() || DEFAULT }, choose: choose }
  apply(stored() || DEFAULT)
})()
