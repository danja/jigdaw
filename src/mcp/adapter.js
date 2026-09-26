// src/mcp/adapter.js
//
// Binding the tool surface to whatever the browser offers.
//
// docs/webmcp.md: the tool surface is a decision this project makes and is
// specified; the binding is not settled, because WebMCP is still moving. So the
// shape of a tool lives in tools.js and every assumption about how a user agent
// learns of it lives here. When the API settles, this file changes and nothing
// else does.
//
// Treat any code that reaches past this module to a browser API as a defect.
import { createTools } from './tools.js'

/**
 * Register the tools with whatever is available, in order of preference.
 *
 * Returns what it bound to, so a caller can say so rather than guess. Binding
 * to nothing is a normal outcome in a browser without the API, not an error:
 * the tools still work, they are simply only reachable from the page.
 */
export function registerTools ({ dispatcher, catalogue, loadPlugin, openCollection, onPlay, onStop, target = globalThis } = {}) {
  const tools = createTools({ dispatcher, catalogue, loadPlugin, openCollection, onPlay, onStop })

  // Always available, whatever else happens. This is what the page's own
  // console can drive, and what a test can call.
  const surface = {
    tools,
    names: tools.map(t => t.name),
    async call (name, input = {}) {
      const tool = tools.find(t => t.name === name)
      if (!tool) {
        return { ok: false, error: `no such tool: ${name}`, known: tools.map(t => t.name) }
      }
      try {
        return await tool.handler(input)
      } catch (error) {
        // A throwing tool would otherwise reach an agent as a rejected promise
        // with no shape. Every failure looks the same as every other failure.
        return { ok: false, error: `${name} threw: ${error?.message ?? error}` }
      }
    }
  }

  target.jigdaw = { ...(target.jigdaw ?? {}), mcp: surface }

  // The proposed shape at the time of writing: navigator.modelContext with a
  // provideContext call. Feature detected rather than assumed, and wrapped,
  // because a failure to register must not stop the page working.
  const navigatorContext = target.navigator?.modelContext
  if (navigatorContext && typeof navigatorContext.provideContext === 'function') {
    try {
      navigatorContext.provideContext({
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          async execute (input) {
            const result = await surface.call(tool.name, input ?? {})
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }
        }))
      })
      return { bound: 'navigator.modelContext', count: tools.length, surface }
    } catch (error) {
      return { bound: 'page', count: tools.length, surface, warning: `modelContext refused: ${error.message}` }
    }
  }

  return { bound: 'page', count: tools.length, surface }
}
