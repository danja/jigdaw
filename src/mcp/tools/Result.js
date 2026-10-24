// src/mcp/tools/Result.js
//
// The two shapes every tool handler returns: `{ ok: true, ...data }`, or `{ ok: false, error, ...extra }`.
export const ok = data => ({ ok: true, ...data })
export const failed = (message, extra = {}) => ({ ok: false, error: message, ...extra })
