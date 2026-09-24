// native/jigdaw-adapter/include/jigdaw/Profile.hpp
#pragma once

#include <optional>
#include <string>
#include <vector>

namespace jigdaw {

/// One named value a port can take, as lv2:scalePoint.
struct ScalePoint {
    std::string label;
    float value = 0.0f;
};

/// One declared parameter, as lv2:port plus the index jig:Abi1 needs.
struct Port {
    std::string symbol;
    std::string name;
    float minimum = 0.0f;
    float maximum = 1.0f;
    float defaultValue = 0.0f;
    int index = -1;          ///< jig:paramIndex
    std::string unit;        ///< units:unit, empty when unitless

    /// lv2:portProperty. The same rule the browser panel follows: toggled is a
    /// switch, an enumeration is a selector, anything else is a dial. A panel
    /// reads these rather than guessing from the range, because a 0 to 2 range
    /// says nothing about whether 1 means anything on its own.
    bool toggled = false;
    bool enumeration = false;
    std::vector<ScalePoint> scalePoints;   ///< sorted by value

    /// The label for a value, when the port names its values. Empty otherwise.
    std::string labelFor(float value) const;
};

/// A fetchable file named by the profile.
struct Resource {
    std::string location;    ///< absolute, already rebased onto the retrieval URL
    std::string integrity;    ///< sha384-...
    std::string mediaType;
};

/// A `jig:asset` — a file the module loads at start-up and, when
/// `jig:userReplaceable`, a person may load a different one into while the
/// plugin runs (docs/plugin-profiles.md, docs/messaging.md section 1.2).
/// Ferrite's neural amp model and cabinet impulse response are one of these
/// each. `key` is the asset node's IRI fragment (`<#nam>` -> "nam"), which is
/// also the ABI convention: a module wanting this loadable exports
/// `jig_<key>_ptr`, `jig_<key>_max_len` and `jig_load_<key>`.
struct Asset {
    std::string key;
    Resource resource;
    bool userReplaceable = false;
};

/// What a native host needs from a plugin profile.
///
/// Deliberately not everything a profile can say. This is the subset jig:Abi1
/// makes usable without a JavaScript engine; the rest is read and discarded so
/// that an unknown statement never stops a plugin loading.
struct Profile {
    std::string iri;
    std::string label;
    std::string comment;
    std::string vendor;

    std::vector<std::string> roles;
    std::vector<std::string> accepts;
    std::vector<std::string> produces;
    std::vector<std::string> requires_;

    int audioInputs = 0;
    int audioOutputs = 0;
    int inputChannels = 2;
    int outputChannels = 2;
    int latencyFrames = 0;

    std::optional<Resource> module;
    std::string abi;          ///< jig:abi, empty when the module is processor-private
    std::vector<Port> ports;
    std::vector<Asset> assets;   ///< jig:asset, in declaration order

    bool acceptsMidi() const;
    bool producesMidi() const;

    /// trn:requires trn:HostTransport. A plugin in time with the session says so.
    bool requiresTransport() const;

    /// Sorted by jig:paramIndex, which is the order jig_set_param uses.
    std::vector<Port> portsByIndex() const;
};

/// Why a profile could not be used, in the words a person needs.
struct ParseResult {
    bool ok = false;
    Profile profile;
    std::string error;
};

/// Parse a profile from Turtle.
///
/// `retrievalBase` is where the document was actually fetched from. Resource
/// locations under the profile's own IRI are rebased onto it, so a plugin
/// mirrored anywhere keeps its canonical identity and is fetched from where it
/// was found. Contract section 1.1 and plugin-profiles.md.
ParseResult parseProfile(const std::string& turtle, const std::string& retrievalBase);

}  // namespace jigdaw
