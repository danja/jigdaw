// native/jigdaw-adapter/include/jigdaw/Fetch.hpp
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace jigdaw {

struct Response {
    bool ok = false;
    int status = 0;
    std::string contentType;
    std::string body;
    std::vector<uint8_t> bytes;
    std::string error;
};

/// GET a URL. Never called from the audio thread.
///
/// `accept` is sent as the Accept header, which is how a plugin IRI is asked
/// for Turtle rather than the page a person would get.
///
/// http, https and file are understood. A file URL naming a directory reads
/// profile.ttl inside it, so a plugin IRI keeps the trailing-slash shape it has
/// over http, where the profile arrives by content negotiation.
Response fetchUrl(const std::string& url, const std::string& accept = {});

}  // namespace jigdaw
