// vitest.config.js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Every test directory must appear here. A suite that is written and never
    // run is the same as a suite that does not exist, and nothing reports it.
    include: ['tests/validate/**/*.test.js', 'tests/rdf/**/*.test.js']
  }
})
