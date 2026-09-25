// web/app/Agent.js
//
// TODO.md, "Let a local agent drive the DAW". The page runs the loop itself,
// against a model server the person names, rather than exposing an endpoint
// of its own: nothing outside this tab can reach the session, and the surface
// it drives is the same jigdaw.mcp surface the console and WebMCP already use,
// never a second implementation of an operation.
import { runAgentTurn, ollamaChat } from '../../src/mcp/LocalAgent.js'

export function createAgent (ctx) {
  const { document, $, log } = ctx

  /** One transcript entry. Colour is never the only signal WCAG-wise, so the
   * role is also written as text, uppercase, first. */
  function renderAgentStep (step) {
    const line = document.createElement('div')
    line.className = `agent-step ${step.role}`
    const text = step.role === 'tool_call'
      ? `${step.name}(${JSON.stringify(step.arguments)})`
      : step.role === 'tool_result'
        ? `${step.name} -> ${JSON.stringify(step.result)}`
        : step.content
    const role = document.createElement('span')
    role.className = 'role'
    role.textContent = step.role
    line.append(role, document.createTextNode(text))
    $('agent-log').append(line)
    $('agent-log').scrollTop = $('agent-log').scrollHeight
  }

  async function askAgent () {
    const prompt = $('agent-prompt').value.trim()
    if (!prompt) return
    const endpoint = $('agent-endpoint').value.trim()
    const model = $('agent-model').value.trim()
    const button = $('agentbar').querySelector('button')

    await ctx.runtime.ensureRunning()
    button.disabled = true
    try {
      await runAgentTurn({
        surface: ctx.mcpSurface,
        chat: args => ollamaChat({ endpoint, ...args }),
        model,
        prompt,
        onStep: renderAgentStep
      })
      $('agent-prompt').value = ''
    } catch (error) {
      log(`local agent failed: ${error.message}`, 'error')
    } finally {
      button.disabled = false
    }
  }

  return { askAgent }
}
