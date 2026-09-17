// vitest.config.js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Every test directory must appear here. A suite that is written and never
    // run is the same as a suite that does not exist, and nothing reports it.
    include: [
      'tests/validate/**/*.test.js',
      'tests/rdf/**/*.test.js',
      'tests/docs/**/*.test.js',
      'tests/host/**/*.test.js',
      'tests/dsp/**/*.test.js',
      'tests/ui/**/*.test.js',
      'tests/model/**/*.test.js',
      'tests/compiler/**/*.test.js',
      'tests/ops/**/*.test.js',
      'tests/engine/**/*.test.js',
      'tests/catalogue/**/*.test.js',
      'tests/mcp/**/*.test.js',
      'tests/native/**/*.test.js',
      'tests/server/**/*.test.js'
    ]
  }
})
