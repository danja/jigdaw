# JigEQ ABC implementation report

## Task list

The plan in `docs/jigeq-abc-plan.md` is a good benchmark goal, but the practical requirement is a reusable measurement harness that can judge any equalizer without depending on one UI. The repo already had the surrounding checks for plugin validity and render budget; the missing piece was a direct, repeatable response check for tone gain and frequency sweeps.

### Completed

- Added `src/host/PluginAnalysis.js` with:
  - `measureToneGain()`, which renders a single sine through a plugin and reports input RMS, output RMS and gain in dB.
  - `measureFrequencyResponse()`, which sweeps a list of frequencies and returns a response curve.
  - shared helpers for `rms()` and `gainDb()` so the same logic can be reused by a UI benchmark later.
- Wired the CLI in `bin/check-plugin.js` to accept `--frequency` and `--sweep` so an equalizer can be checked from the command line without writing a bespoke harness.
- Added `tests/host/PluginAnalysis.test.js` to prove the measurement matches a pass-through EQ in its default state.

### Completed

- Build the three interface variants from the same DSP backend: A = minimal UI, B = SVG skin, C = HTML UI.

### Remaining for the full ABC set

- Add a fixture that logs all three response curves into one table so the UI trade-offs are visible in the same way as the engine trade-offs.
- Measure startup time, CPU budget and visible latency for each implementation.
- Capture the lessons learned into a final comparison report, keyed to the exact DSP and UI decisions that shaped the result.

### Visual harness

`npm run jigeq:harness` starts the local server on port 8750 and opens
`/jigeq-abc.html`. The page uses the normal profile validator, verified plugin
loader, generated panel, SVG skin renderer and sandboxed HTML editor. Its
stereo white-noise source feeds the selected plugin and reaches the browser's
default audio output after the output-level control. Press **Start white noise**
in the page to grant audio playback; only the selected EQ is routed at a time.

The harness compares the three interfaces visually and audibly. It does not
measure plugin CPU use or render latency.

## Practical conclusion

The main work needed in practice was not a second equalizer engine but a reliable way to measure the one engine in many UI shells. The response helpers now give the project that measurement path, which is the part a real UI benchmark must share across A, B and C.
