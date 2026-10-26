// web/app/Theme.js
//
// The Theme control in Settings. The choosing and remembering is web/theme.js, which every page loads at the top of its head so a theme
// is on the page before it is drawn; this only shows what it holds and tells it when the person changes their mind.
export function createTheme (ctx) {
  const { window, $, log } = ctx

  function mount () {
    const select = $('theme-choice')
    const theme = window.__jigdawTheme
    if (!theme) throw new Error('theme.js did not run: the page is missing its script tag')
    select.value = theme.current()
    select.addEventListener('change', () => {
      try { log(`theme: ${theme.choose(select.value)}`) } catch (error) { log(error.message, 'error') }
    })
  }

  return { mount }
}
