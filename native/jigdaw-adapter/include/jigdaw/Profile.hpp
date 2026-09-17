// native/jigdaw-adapter/include/jigdaw/Profile.hpp
#pragma once

#include <optional>
#include <string>
#include <vector>

namespace jigdaw {

/// One declared parameter, as lv2:port plus the index jig:Abi1 needs.
struct Port {
    std::string symbol;
    std::string name;
    float minimum = 0.0f;
    float maximum = 1.0f;
    float defaultValue = 0.0f;
    int index = -1;          ///< jig:paramIndex
    std::string unit;        ///< units:unit, empty when unitless
};

/// A fetchable file named by the profile.
struct Resource {
    std::string location;    ///< absolute, already rebased onto the retrieval URL
    std::string integrity;    ///< sha384-...
    std::string mediaType;
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

    bool acceptsMidi() const;
    bool producesMidi() const;

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
