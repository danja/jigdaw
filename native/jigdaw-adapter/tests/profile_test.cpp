// native/jigdaw-adapter/tests/profile_test.cpp
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "jigdaw/Profile.hpp"

namespace {
int failures = 0;
void check(bool ok, const std::string& what) {
    std::cout << (ok ? "  ok   " : "  FAIL ") << what << "\n";
    if (!ok) ++failures;
}
std::string readText(const std::string& path) {
    std::ifstream in(path);
    std::stringstream ss; ss << in.rdbuf(); return ss.str();
}
}  // namespace

int main(int argc, char** argv) {
    const std::string root = argc > 1 ? argv[1] : ".";

    std::cout << "a real profile\n";
    const auto canonical = "https://strandz.it/jigdaw/plugins/pulse/";
    auto parsed = jigdaw::parseProfile(readText(root + "/plugins/pulse/profile.ttl"), canonical);
    check(parsed.ok, parsed.ok ? "Pulse parses" : "failed: " + parsed.error);
    if (!parsed.ok) return 1;

    const auto& p = parsed.profile;
    check(p.label == "Pulse", "reads the label");
    check(p.iri == canonical, "the subject is the canonical IRI");
    check(p.abi == "http://purl.org/stuff/jigdaw/Abi1", "reads the declared ABI");
    check(p.acceptsMidi(), "knows it takes MIDI");
    check(!p.producesMidi(), "knows it emits none");
    check(p.audioInputs == 0 && p.audioOutputs == 1, "reads the audio shape");
    check(p.ports.size() == 5, "reads five ports");

    const auto ordered = p.portsByIndex();
    bool indicesAscend = true;
    for (size_t i = 1; i < ordered.size(); ++i) if (ordered[i].index <= ordered[i - 1].index) indicesAscend = false;
    check(indicesAscend, "ports sort by jig:paramIndex, which is what jig_set_param uses");
    check(ordered.front().symbol == "waveform", "index 0 is waveform");

    std::cout << "identity and retrieval are different questions\n";
    // Fetched from a mirror: the canonical IRI is unchanged and the module
    // follows the retrieval host, or only one origin could ever serve a plugin.
    auto mirrored = jigdaw::parseProfile(readText(root + "/plugins/pulse/profile.ttl"),
                                         "http://localhost:6026/plugins/pulse/");
    check(mirrored.ok, "parses when fetched elsewhere");
    check(mirrored.profile.iri == canonical, "identity stays canonical");
    check(mirrored.profile.module->location == "http://localhost:6026/plugins/pulse/pulse.wasm",
          "retrieval follows the mirror: " + mirrored.profile.module->location);

    std::cout << "refusals\n";
    auto notAProfile = jigdaw::parseProfile("@prefix x: <http://x/> .\n<a> x:b \"c\" .", "https://x/");
    check(!notAProfile.ok && notAProfile.error.find("jig:WebPlugin") != std::string::npos,
          "a document with no plugin in it is refused, saying so");

    auto broken = jigdaw::parseProfile("this is not turtle <<<", "https://x/");
    check(!broken.ok, "unparseable Turtle is refused");

    std::cout << (failures == 0 ? "\nall passed\n" : "\n" + std::to_string(failures) + " failed\n");
    return failures == 0 ? 0 : 1;
}
