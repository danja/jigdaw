# JigEQ ABC UI Test

Three versions of a top-quality equalizer plugin in the Jig format should be created each using the same Rust/WebAssembly DSP and a small test fixture which will measure the performance of the plugin. There should be existing tools to analyse the signal processing behaviour of the plugin, these will be extended as necessary, supporting general use with other plugins.

- JigEQa - using minimal UI
- JigEQb - using SVG UI
- JigEQc - using HTML UI

The purpose is to determine the trade-offs, discover which approach produces the most pleasing UI for a given specification, which is most efficient.

Notes should be added jigeq-abc-report.md first as a detailed implementation task list, keeping track of progress, then as a report of lessons learned.

## Requirements

- linear phase
- zero latency
- smooth dynamic and spectral EQ
- per-band mid/side processing
- solo feature
- optional auto gain
- built-in spectrum analyzer

Visually the plugins will have skewmorphic knob controls with a metal look & feel, with a light and dark theme. The graphic display will use color and visual components following conventional best practices. All features will have appropriate tools tips.

The aim is to create the best possible DSP backend, then match the UI to it.
