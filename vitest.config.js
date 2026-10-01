// vitest.config.js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Tests that run real plugins and worklets take a second alone and several when the whole suite
    // shares the machine; the default 5 s failed them at random under load and they passed alone.
    testTimeout: 30000,
    // A beforeAll that loads and validates every plugin profile outgrew the default 10 s as the plugin count grew,
    // and timed out under a full parallel run while passing alone.
    hookTimeout: 60000,
    // Every test directory must appear here. A suite that is written and never
    // run is the same as a suite that does not exist, and nothing reports it.
    include: [
      'tests/bin/**/*.test.js',
      'tests/validate/**/*.test.js',
      'tests/wam/**/*.test.js',
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
      'tests/server/**/*.test.js',
      'tests/jsfx/**/*.test.js',
      'tests/web/**/*.test.js',
      'tests/reel/**/*.test.js'
    ]
  }
})
