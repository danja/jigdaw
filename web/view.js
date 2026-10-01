// web/view.js
//
// Which page a person starts on. A phone gets the simple one: the studio's arrangement is built for a wide
// screen, and the simple page is for playing with a piece. A person who asks for the studio (the "Full studio"
// links carry ?studio) is remembered, in this browser, until they go back to the simple page. A classic script,
// loaded at the top of the studio's head, so the redirect happens before anything else is fetched or drawn.
(function () {
  var store
  try { store = window.localStorage } catch (error) { store = null }
  var KEY = 'jigdaw.view'
  var onSimple = /(^|\/)simple\.html$/.test(window.location.pathname)
  if (onSimple) {
    if (store) { try { store.removeItem(KEY) } catch (error) { /* storage refused */ } }
    return
  }
  if (/[?&]studio(&|=|$)/.test(window.location.search)) {
    if (store) { try { store.setItem(KEY, 'studio') } catch (error) { /* storage refused */ } }
    return
  }
  var chosen = null
  if (store) { try { chosen = store.getItem(KEY) } catch (error) { chosen = null } }
  if (chosen === 'studio') return
  // 720px is where the interface rules put one column (CLAUDE.md).
  if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) window.location.replace('simple.html')
})()
