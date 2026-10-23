// web/app/ProjectInfo.js
//
// The Project section: title, author and notes. The form is the whole of the interface, and the same
// words are the `project_info` tool's, set on the project the way a track's layout is (not an undo step).
import { createProjectInfoForm } from '../../src/ui/ProjectInfoForm.js'

export function createProjectInfo (ctx) {
  const { document, $, log } = ctx
  const form = createProjectInfoForm(document, {
    // The runtime first, since the project lives in the dispatcher and that waits for the first thing needing sound.
    onChange: async patch => { (await ctx.runtime.ensureRunning()).project.setInfo(patch) },
    onError: error => log(error.message, 'error')
  })
  return {
    mount () { $('project-body').append(form.element) },
    /** Fill the form from the open project, after a session opens. */
    refresh () { form.show(ctx.dispatcher.project.info) }
  }
}
