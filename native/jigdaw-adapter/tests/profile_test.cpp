// native/jigdaw-adapter/tests/profile_test.cpp
#include <clocale>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include <algorithm>
#include <cmath>

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

    // Parse everything below under the user's locale, the way a host does.
    //
    // A library does not choose the locale; the application does, and every GTK
    // application and every DAW calls setlocale(LC_ALL, ""). A test that runs in
    // the default "C" locale is testing the one case that was never in doubt,
    // which is why this bug reached a running host: the parser was right in
    // every test and wrong in every DAW on a machine outside the anglosphere.
    if (std::setlocale(LC_ALL, "it_IT.UTF-8") == nullptr &&
        std::setlocale(LC_ALL, "de_DE.UTF-8") == nullptr &&
        std::setlocale(LC_ALL, "fr_FR.UTF-8") == nullptr) {
        std::cout << "  note  no comma-decimal locale installed; "
                     "the locale-independence checks below prove nothing here\n";
    }
    else {
        std::cout << "parsing under " << std::setlocale(LC_ALL, nullptr) << "\n";
    }

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

    // A fractional number survives the locale. Whole numbers do not exercise
    // this: "5" parses the same everywhere, and that is exactly what made the
    // failure invisible.
    const auto gain = std::find_if(p.ports.begin(), p.ports.end(),
                                   [](const auto& port) { return port.symbol == "gain"; });
    check(gain != p.ports.end(), "finds the gain port");
    if (gain != p.ports.end()) {
        check(std::fabs(gain->defaultValue - 0.3f) < 1e-6f,
              "gain's declared default 0.3 survives, got " + std::to_string(gain->defaultValue));
    }
    const auto attack = std::find_if(p.ports.begin(), p.ports.end(),
                                     [](const auto& port) { return port.symbol == "attack"; });
    check(attack != p.ports.end(), "finds the attack port");
    if (attack != p.ports.end()) {
        check(std::fabs(attack->minimum - 0.5f) < 1e-6f,
              "attack's minimum 0.5 survives, got " + std::to_string(attack->minimum));
    }

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
