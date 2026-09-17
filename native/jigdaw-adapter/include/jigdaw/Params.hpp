// native/jigdaw-adapter/include/jigdaw/Params.hpp
#pragma once

#include <cstdint>
#include <vector>

#include "jigdaw/Chain.hpp"

namespace jigdaw {

/// Give every parameter of a freshly built chain a value.
///
/// `values` holds the host's slot values, normalised to 0..1, and is updated in
/// place so that reading a slot back reports what is actually running. `touched`
/// says which slots the user has actually moved; those keep what they chose, so
/// reloading a project does not throw a mix away. The rest take the port's
/// declared default.
///
/// That last part is the whole reason this is a named function with a test. The
/// host's slots mean nothing until a chain is loaded, so they all read zero, and
/// zero normalised is the bottom of whatever range the port turns out to have.
/// Leaving it there brought Pulse up with its gain at minimum and its filter at
/// 100 Hz: notes arrived, voices ran, and nothing was audible. It lived in the
/// DPF wrapper where no test could reach it, and the chain tests missed it
/// because they drive Chain directly and a module keeps its own defaults until
/// something overwrites them.
void applyParameters(Chain& chain, std::vector<float>& values,
                     const std::vector<uint8_t>& touched);

/// A port's declared default, as a host's normalised slot value.
///
/// Shared because the plugin and the editor both need it and must agree. The
/// plugin uses it to decide what an untouched slot runs at; the editor uses it
/// to decide what an untouched slot displays. DPF cannot tell a VST3 host that a
/// parameter changed, so neither side can be informed of the other's answer, and
/// the only way they stay consistent is by computing the same one.
float normalisedDefault(const Port& port);

}  // namespace jigdaw
