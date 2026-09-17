// native/jigdaw-adapter/include/jigdaw/Report.hpp
#pragma once

#include <string>
#include <vector>

#include "jigdaw/Chain.hpp"
#include "jigdaw/Profile.hpp"

namespace jigdaw {

/// What became of one IRI, and what a panel needs to draw it.
struct LoadedPlugin {
    bool ok = false;
    std::string iri;
    std::string label;
    std::string error;       ///< set when ok is false
    int firstSlot = 0;       ///< 1 based, as a host numbers its parameters
    int lastSlot = 0;
    std::vector<Port> ports; ///< in jig:paramIndex order, so ports[n] is slot firstSlot + n
};

/// Build `chain` from newline separated IRIs and say what happened.
///
/// One implementation because there are two callers. The plugin builds a chain
/// it keeps and plays; the editor builds one it throws away, keeping only this
/// description so it can draw a panel. DPF only delivers a plugin to editor
/// state push under CLAP, so the editor cannot be told the answer and has to
/// work it out. Two loops would be two answers to the same question, and the
/// one the user reads would be the one nothing plays.
///
/// Blank lines and lines starting with `#` are skipped. One IRI failing is
/// reported and survived, never fatal to the rest.
std::vector<LoadedPlugin> buildChain(Chain& chain, const std::string& iris, double sampleRate);

/// The same thing as text, for the host readable `report` state.
///
/// Tab separated, one line per IRI:
///   ok<TAB><label><TAB>params <first>-<last><TAB><symbols separated by spaces>
///   no<TAB><iri><TAB><what went wrong>
std::string describe(const std::vector<LoadedPlugin>& loaded);

}  // namespace jigdaw
