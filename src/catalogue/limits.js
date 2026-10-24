// src/catalogue/limits.js
//
// The most results one search returns, however many are asked for. Shared so that the page that
// means "everything this host holds" asks for exactly this, rather than a number that was once
// larger than the catalogue and then was not (25 hid 8 of 33 plugins, found 2026-10-24).
export const MAX_RESULTS = 200
