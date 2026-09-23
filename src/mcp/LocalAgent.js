// src/mcp/LocalAgent.js
//
// A tool-calling loop against a local model's chat API, driving the dispatcher
// through the same jigdaw.mcp surface WebMCP or a person would use. Never a
// second implementation of an operation: every effect goes through
// surface.call, which is tools.js's own handlers.
//
// TODO.md, "Let a local agent drive the DAW": the page runs the loop itself
// rather than exposing an endpoint, so nothing outside the browser can reach
// the session and there is no new listener to secure. The network call is
// injected as `chat`, so the loop is tested against a fixed sequence of
// responses rather than a running model, the discipline OfflineHost.js
// applies to the audio path.
//
// Response shapes below are measured against a running Ollama 127.0.0.1:11434
// (qwen2.5:0.5b), not assumed from documentation: message.tool_calls[].
// function.arguments arrives as an object already, and a follow-up
// {role:'tool', content} with no id is enough for it to use the result.

/** A stop after this many turns, rather than trusting the model to stop on
 * its own. The same reasoning the JSFX runtime bounds a script's own loop by:
 * a runaway model must not leave the page waiting forever. */
export const MAX_TURNS = 8

/** jigdaw.mcp.tools, as the `tools` field ollamaChat's request wants. */
export function toolSchema (tools) {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }))
}

/** A tool call's arguments, whichever shape the model sent them in. Measured
 * as a plain object from Ollama; kept lenient for a model that stringifies
 * them, the way OpenAI's own API does. */
function argumentsOf (call) {
  const raw = call.function.arguments
  return typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
}

/**
 * Run one prompt to completion: repeated model turns, each tool call routed
 * through `surface.call`, until the model answers with no further tool call
 * or MAX_TURNS is reached. `onStep` is called for every user-visible event in
 * order, so a caller can render a transcript live rather than only at the end.
 */
export async function runAgentTurn ({ surface, chat, model, prompt, onStep = () => {} }) {
  const tools = toolSchema(surface.tools)
  const messages = [{ role: 'user', content: prompt }]
  onStep({ role: 'user', content: prompt })

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await chat({ model, messages, tools })
    const message = response.message
    messages.push(message)

    if (!message.tool_calls?.length) {
      onStep({ role: 'assistant', content: message.content ?? '' })
      return { messages, turns: turn + 1 }
    }

    if (message.content) onStep({ role: 'assistant', content: message.content })

    for (const call of message.tool_calls) {
      const args = argumentsOf(call)
      onStep({ role: 'tool_call', name: call.function.name, arguments: args })
      const result = await surface.call(call.function.name, args)
      onStep({ role: 'tool_result', name: call.function.name, result })
      messages.push({ role: 'tool', content: JSON.stringify(result) })
    }
  }

  onStep({ role: 'assistant', content: `stopped after ${MAX_TURNS} turns without a final answer` })
  return { messages, turns: MAX_TURNS }
}

/**
 * The network call against Ollama's native chat endpoint, kept apart from the
 * loop above so a test injects a fake instead of this.
 *
 * Loopback only, by construction: `endpoint` is typed by a person into the
 * page, so this reaches wherever they pointed it and nowhere it decides for
 * itself. A page served over `https:` (the strandz.it deployment) cannot
 * reach an `http:` endpoint at all, mixed content, measured rather than
 * assumed: this only works against a host the page itself was loaded from
 * insecurely, such as the local dev server `npm run serve` starts.
 */
export async function ollamaChat ({ endpoint, model, messages, tools }) {
  const response = await fetch(`${endpoint.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, stream: false })
  })
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}: ${await response.text()}`)
  }
  const data = await response.json()
  return { message: data.message }
}
