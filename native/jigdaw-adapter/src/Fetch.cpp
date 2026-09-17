// native/jigdaw-adapter/src/Fetch.cpp
#include "jigdaw/Fetch.hpp"

// TLS support comes from the build, which knows whether OpenSSL is there.
#include <httplib.h>

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

}  // namespace

Response fetchUrl(const std::string& url, const std::string& accept) {
    Response response;
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
