// native/jigdaw-adapter/include/jigdaw/Integrity.hpp
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace jigdaw {

/// The Subresource Integrity digest of some bytes, as sha384-<base64>.
std::string digestOf(const std::vector<uint8_t>& bytes, const std::string& algorithm = "sha384");

/// Empty on success, or why the bytes do not match.
///
/// Contract section 3.2: a host verifies every fetched resource before running
/// it and offers no way to skip. The profile and the code it names need not
/// share an origin, so an unverified profile is an instruction to execute
/// whatever currently sits at a URL.
std::string verifyIntegrity(const std::vector<uint8_t>& bytes, const std::string& declared);

}  // namespace jigdaw
