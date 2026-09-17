// native/jigdaw-adapter/src/Fetch.cpp
#include "jigdaw/Fetch.hpp"

// TLS support comes from the build, which knows whether OpenSSL is there.
#include <httplib.h>

#include <cctype>
#include <filesystem>
#include <fstream>

namespace jigdaw {
namespace {

struct Split { std::string origin; std::string path; bool https = false; bool ok = false; };

Split splitUrl(const std::string& url) {
    Split out;
    const auto schemeEnd = url.find("://");
    if (schemeEnd == std::string::npos) return out;
    const std::string scheme = url.substr(0, schemeEnd);
    if (scheme != "http" && scheme != "https") return out;
    out.https = scheme == "https";
    const auto pathStart = url.find('/', schemeEnd + 3);
    out.origin = pathStart == std::string::npos ? url : url.substr(0, pathStart);
    out.path = pathStart == std::string::npos ? "/" : url.substr(pathStart);
    out.ok = true;
    return out;
}

/// Percent-decode a file URL's path. A checkout under a directory with a space
/// in it is otherwise unreachable, and the failure reads as a missing file.
std::string percentDecode(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '%' && i + 2 < text.size() &&
            std::isxdigit(static_cast<unsigned char>(text[i + 1])) &&
            std::isxdigit(static_cast<unsigned char>(text[i + 2]))) {
            out.push_back(static_cast<char>(std::stoi(text.substr(i + 1, 2), nullptr, 16)));
            i += 2;
            continue;
        }
        out.push_back(text[i]);
    }
    return out;
}

/// Read a file URL.
///
/// plugin-profiles.md asks an author to set an explicit @base so that a profile
/// "means the same thing wherever it is read from, including from a file on
/// disk during development". Without this there was no way to read one from
/// disk, so that sentence described something no host could do. It is also what
/// lets a host test against a plugin offline, which a network fetch cannot be.
///
/// A directory resolves to profile.ttl inside it, because an http plugin IRI
/// ends in a slash and serves the profile by content negotiation, and a
/// filesystem has no such thing. The same IRI shape then works either way.
Response fetchFile(const std::string& url) {
    Response response;
    std::string path = url.substr(std::string("file://").size());
    // file://host/path is only addressable when the host is this one.
    if (!path.empty() && path[0] != '/') {
        const auto slash = path.find('/');
        const std::string host = slash == std::string::npos ? path : path.substr(0, slash);
        if (host != "localhost") {
            response.error = "not a local file URL: " + url;
            return response;
        }
        path = slash == std::string::npos ? "/" : path.substr(slash);
    }
    path = percentDecode(path);

    std::error_code code;
    if (std::filesystem::is_directory(path, code)) {
        path = (std::filesystem::path(path) / "profile.ttl").string();
    }

    std::ifstream file(path, std::ios::binary);
    if (!file) {
        response.error = "could not read " + path;
        return response;
    }
    std::string body((std::istreambuf_iterator<char>(file)),
                     std::istreambuf_iterator<char>());
    if (!file.eof() && file.fail()) {
        response.error = "could not read " + path;
        return response;
    }

    response.ok = true;
    response.status = 200;
    response.body = std::move(body);
    response.bytes.assign(response.body.begin(), response.body.end());
    return response;
}

}  // namespace

Response fetchUrl(const std::string& url, const std::string& accept) {
    Response response;
    if (url.rfind("file://", 0) == 0) return fetchFile(url);
    const auto split = splitUrl(url);
    if (!split.ok) {
        response.error = "not a fetchable URL: " + url;
        return response;
    }

    httplib::Client client(split.origin);
    client.set_follow_location(true);
    client.set_connection_timeout(10);
    client.set_read_timeout(30);
    // Identify honestly, with somewhere to complain to.
    client.set_default_headers({{"User-Agent", "jigdaw-adapter/0.1 (+https://github.com/danja/jigdaw)"}});

    httplib::Headers headers;
    if (!accept.empty()) headers.emplace("Accept", accept);

    const auto result = client.Get(split.path, headers);
    if (!result) {
        response.error = "could not reach " + url + ": " + httplib::to_string(result.error());
        return response;
    }

    response.status = result->status;
    if (result->status < 200 || result->status >= 300) {
        response.error = url + " returned " + std::to_string(result->status);
        return response;
    }

    response.ok = true;
    response.contentType = result->get_header_value("Content-Type");
    response.body = result->body;
    response.bytes.assign(result->body.begin(), result->body.end());
    return response;
}

}  // namespace jigdaw
