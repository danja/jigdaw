// tests/mcp/LocalAgent.test.js
//
// The loop is tested against a fixed sequence of fake model responses, never
// a running Ollama: the network call is injected exactly so this suite does
// not depend on a model being installed. src/mcp/LocalAgent.js's own header
// records what was measured against a real one instead.
import { describe, it, expect, vi } from 'vitest'
import { runAgentTurn, toolSchema, ollamaChat, MAX_TURNS } from '../../src/mcp/LocalAgent.js'

const surfaceWith = handlers => ({
  tools: Object.entries(handlers).map(([name]) => ({
    name, description: `does ${name}`, inputSchema: { type: 'object', properties: {} }
  })),
  call: vi.fn(async (name, input) => handlers[name](input))
})

describe('toolSchema', () => {
  it('maps a jigdaw.mcp tool list to the function-calling shape', () => {
    const schema = toolSchema([
      { name: 'status', description: 'the state', inputSchema: { type: 'object', properties: {} } }
    ])
    expect(schema).toEqual([
      { type: 'function', function: { name: 'status', description: 'the state', parameters: { type: 'object', properties: {} } } }
    ])
  })
})

describe('runAgentTurn', () => {
  it('answers directly when the model calls no tool', async () => {
    const surface = surfaceWith({})
    const chat = vi.fn(async () => ({ message: { role: 'assistant', content: 'hello' } }))
    const steps = []
    const result = await runAgentTurn({ surface, chat, model: 'x', prompt: 'hi', onStep: s => steps.push(s) })

    expect(result.turns).toBe(1)
    expect(surface.call).not.toHaveBeenCalled()
    expect(steps).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ])
  })

  it('routes a tool call through surface.call and feeds the result back', async () => {
    const surface = surfaceWith({ status: async () => ({ ok: true, revision: 3 }) })
    // `messages` is one array, mutated in place across turns, so a mock that
    // only records the reference would see every call's argument as whatever
    // the array looks like once the whole loop finishes. Snapshotting with a
    // spread on the way in is what makes "what did turn N see" answerable.
    const seenMessages = []
    const chat = vi.fn(async ({ messages }) => {
      seenMessages.push([...messages])
      return seenMessages.length === 1
        ? { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'status', arguments: {} } }] } }
        : { message: { role: 'assistant', content: 'revision 3' } }
    })

    const steps = []
    const result = await runAgentTurn({ surface, chat, model: 'x', prompt: 'status?', onStep: s => steps.push(s) })

    expect(surface.call).toHaveBeenCalledWith('status', {})
    expect(result.turns).toBe(2)
    // The second call's messages include the tool result as a 'tool' message.
    expect(seenMessages[1].at(-1)).toEqual({ role: 'tool', content: JSON.stringify({ ok: true, revision: 3 }) })
    expect(steps.map(s => s.role)).toEqual(['user', 'tool_call', 'tool_result', 'assistant'])
  })

  it('parses stringified arguments the same as an object, for a model that stringifies them', async () => {
    const surface = surfaceWith({ parameter_set: async input => ({ ok: true, received: input }) })
    const chat = vi.fn()
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'parameter_set', arguments: '{"nodeId":"n1","value":0.5}' } }]
        }
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'done' } })

    await runAgentTurn({ surface, chat, model: 'x', prompt: 'turn it up', onStep: () => {} })
    expect(surface.call).toHaveBeenCalledWith('parameter_set', { nodeId: 'n1', value: 0.5 })
  })

  it('stops after MAX_TURNS rather than looping forever on a model that never stops calling tools', async () => {
    const surface = surfaceWith({ status: async () => ({ ok: true }) })
    const chat = vi.fn(async () => ({
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'status', arguments: {} } }] }
    }))
    const result = await runAgentTurn({ surface, chat, model: 'x', prompt: 'loop', onStep: () => {} })

    expect(result.turns).toBe(MAX_TURNS)
    expect(chat).toHaveBeenCalledTimes(MAX_TURNS)
  })
})

describe('ollamaChat', () => {
  it('posts messages and tools to <endpoint>/api/chat and returns the message', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ message: { role: 'assistant', content: 'hi' } })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await ollamaChat({
      endpoint: 'http://127.0.0.1:11434/',
      model: 'qwen2.5:0.5b',
      messages: [{ role: 'user', content: 'hi' }],
      tools: []
    })

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11434/api/chat', expect.objectContaining({
      method: 'POST'
    }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      model: 'qwen2.5:0.5b',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      stream: false
    })
    expect(result).toEqual({ message: { role: 'assistant', content: 'hi' } })
    vi.unstubAllGlobals()
  })

  it('throws with the status and body on a non-ok response, rather than returning a malformed message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 404, text: async () => 'model "ghost" not found'
    })))

    await expect(ollamaChat({ endpoint: 'http://127.0.0.1:11434', model: 'ghost', messages: [], tools: [] }))
      .rejects.toThrow('404')
    vi.unstubAllGlobals()
  })
})
