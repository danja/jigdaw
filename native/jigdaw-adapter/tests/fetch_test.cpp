// native/jigdaw-adapter/tests/fetch_test.cpp
//
// File URLs. plugin-profiles.md tells an author to set an explicit @base so a
// profile "means the same thing wherever it is read from, including from a file
// on disk during development", and until fetchUrl understood file:// there was
// no host that could do that. It is also what lets a host test against a real
// plugin without anything serving.

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

#include "jigdaw/Fetch.hpp"

namespace {

int failures = 0;

void check(bool condition, const std::string& what) {
    std::cout << (condition ? "  ok   " : "  FAIL ") << what << "\n";
    if (!condition) ++failures;
}

std::string urlFor(const std::filesystem::path& path) {
    return "file://" + path.string();
}

} // namespace

int main() {
    namespace fs = std::filesystem;
    const auto root = fs::temp_directory_path() / "jigdaw-fetch-test";
    fs::remove_all(root);
    fs::create_directories(root / "a plugin");

    {
        std::ofstream file(root / "a plugin" / "profile.ttl");
        file << "# profile\n";
    }
    {
        std::ofstream file(root / "loose.ttl");
        file << "# loose\n";
    }

    std::cout << "file URLs\n";

    const auto loose = jigdaw::fetchUrl(urlFor(root / "loose.ttl"));
    check(loose.ok, "reads a file named directly");
    check(loose.body == "# loose\n", "with its bytes intact");
    check(loose.status == 200, "and a status a caller can treat like any other");

    // A plugin IRI over http ends in a slash and serves its profile by content
    // negotiation. A filesystem has no such thing, so a directory means the
    // profile inside it and the same IRI shape works either way.
    const auto directory = jigdaw::fetchUrl(urlFor(root / "a plugin") + "/");
    check(directory.ok, "a directory reads profile.ttl inside it");
    check(directory.body == "# profile\n", "and it is the right file");

    const auto unslashed = jigdaw::fetchUrl(urlFor(root / "a plugin"));
    check(unslashed.ok, "with or without the trailing slash");

    // A checkout under a path with a space in it is otherwise unreachable, and
    // the failure reads as a missing file rather than as an unparsed URL.
    std::string encoded = urlFor(root / "a plugin") + "/";
    const auto space = encoded.find("a plugin");
    encoded.replace(space, 8, "a%20plugin");
    const auto percent = jigdaw::fetchUrl(encoded);
    check(percent.ok, "percent-encoded path: " + encoded);

    const auto missing = jigdaw::fetchUrl(urlFor(root / "nosuch.ttl"));
    check(!missing.ok, "a file that is not there is refused");
    check(missing.error.find("nosuch.ttl") != std::string::npos,
          "and the message names it: " + missing.error);

    const auto remote = jigdaw::fetchUrl("file://elsewhere.example/plugin/");
    check(!remote.ok, "a file URL naming another host is refused rather than guessed at");

    const auto scheme = jigdaw::fetchUrl("ftp://example.org/plugin/");
    check(!scheme.ok, "and an unsupported scheme still is");

    fs::remove_all(root);
    std::cout << (failures == 0 ? "\nall passed\n"
                                : "\n" + std::to_string(failures) + " failed\n");
    return failures == 0 ? 0 : 1;
}
