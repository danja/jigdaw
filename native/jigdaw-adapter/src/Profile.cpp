// native/jigdaw-adapter/src/Profile.cpp
#include "jigdaw/Profile.hpp"

#include <algorithm>
#include <cmath>
#include <locale>
#include <map>
#include <sstream>
#include <stdexcept>

#include "jigdaw/Turtle.hpp"

namespace jigdaw {
namespace {

constexpr const char* JIG = "http://purl.org/stuff/jigdaw/";
constexpr const char* TRN = "http://purl.org/stuff/transmissions/";
constexpr const char* LV2 = "http://lv2plug.in/ns/lv2core#";
constexpr const char* UNITS = "http://lv2plug.in/ns/extensions/units#";
constexpr const char* RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
constexpr const char* RDFS = "http://www.w3.org/2000/01/rdf-schema#";
constexpr const char* RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

std::string jig(const char* term) { return std::string(JIG) + term; }
std::string trn(const char* term) { return std::string(TRN) + term; }
std::string lv2(const char* term) { return std::string(LV2) + term; }

bool containsMidi(const std::vector<std::string>& signals) {
    return std::any_of(signals.begin(), signals.end(), [](const std::string& s) {
        return s.rfind(TRN, 0) == 0 && s.find("Midi") != std::string::npos;
    });
}

/// Move a location under the canonical IRI onto where the profile was fetched.
///
/// Identity stays canonical, retrieval follows retrieval. Without this only the
/// origin named in a profile could ever serve the plugin, and a local checkout
/// or a mirror would fetch from production.
std::string rebase(const std::string& location, const std::string& canonical, const std::string& retrieval) {
    if (canonical.empty() || retrieval.empty() || canonical == retrieval) return location;
    if (location.rfind(canonical, 0) != 0) return location;   // another origin; its author meant it
    return retrieval + location.substr(canonical.size());
}

/// Parse a number the way Turtle writes one, whatever locale the host is in.
///
/// std::stof reads the *global C locale's* decimal separator, and a host that
/// has called setlocale(LC_ALL, "") — which every GTK application does, and
/// every DAW — is in the user's locale. Under a comma-decimal locale
/// std::stof("0.3") stops at the '.' and returns 0.
///
/// The damage is silent and total: every fractional lv2:default, lv2:minimum,
/// lv2:maximum and rdf:value in every profile becomes zero, so a plugin comes
/// up with its gain at the bottom of a range that is itself wrong. Whole
/// numbers are unaffected, which is why it survives a reading of the output.
/// A Turtle number is always '.'-decimal, so the classic locale is the only
/// correct one to read it with.
float toFloat(const std::string& text) {
    std::istringstream stream(text);
    stream.imbue(std::locale::classic());
    float value = 0.0f;
    stream >> value;
    if (stream.fail()) throw std::runtime_error("not a number: " + text);
    return value;
}

int toInt(const std::string& text) {
    try { return static_cast<int>(toFloat(text)); }
    catch (...) { throw std::runtime_error("not an integer: " + text); }
}

}  // namespace

std::string Port::labelFor(const float value) const {
    // Nearest, not equal: a value arrives as a float that has been round tripped
    // through a normalised host parameter, so it is rarely exactly the integer
    // the profile wrote.
    const ScalePoint* best = nullptr;
    float closest = 0.0f;
    for (const auto& point : scalePoints) {
        const float distance = std::fabs(point.value - value);
        if (best == nullptr || distance < closest) { best = &point; closest = distance; }
    }
    return best != nullptr ? best->label : std::string();
}

bool Profile::acceptsMidi() const { return containsMidi(accepts); }
bool Profile::producesMidi() const { return containsMidi(produces); }

bool Profile::requiresTransport() const {
    const std::string wanted = std::string(TRN) + "HostTransport";
    return std::find(requires_.begin(), requires_.end(), wanted) != requires_.end();
}

std::vector<Port> Profile::portsByIndex() const {
    std::vector<Port> sorted = ports;
    std::sort(sorted.begin(), sorted.end(), [](const Port& a, const Port& b) { return a.index < b.index; });
    return sorted;
}

ParseResult parseProfile(const std::string& turtleText, const std::string& retrievalBase) {
    ParseResult result;

    const auto doc = turtle::parse(turtleText, retrievalBase);
    if (!doc.ok) {
        result.error = "the profile is not parseable Turtle: " + doc.error;
        return result;
    }

    // Index the statements once: a profile is small, and a map keeps the rest
    // of this function about what a profile means rather than how to find it.
    std::map<std::string, std::map<std::string, std::vector<turtle::Triple>>> bySubject;
    for (const auto& t : doc.triples) bySubject[t.subject][t.predicate].push_back(t);

    auto objects = [&](const std::string& subject, const std::string& predicate) {
        std::vector<std::string> values;
        const auto s = bySubject.find(subject);
        if (s == bySubject.end()) return values;
        const auto p = s->second.find(predicate);
        if (p == s->second.end()) return values;
        for (const auto& t : p->second) values.push_back(t.object);
        return values;
    };

    auto first = [&](const std::string& subject, const std::string& predicate) -> std::string {
        const auto values = objects(subject, predicate);
        return values.empty() ? std::string{} : values.front();
    };

    // The subject is the one thing typed jig:WebPlugin. Several would be
    // ambiguous, and picking the first would make the answer depend on
    // serialisation order.
    std::vector<std::string> subjects;
    for (const auto& [subject, predicates] : bySubject) {
        const auto types = predicates.find(RDF_TYPE);
        if (types == predicates.end()) continue;
        for (const auto& t : types->second) {
            if (t.object == jig("WebPlugin")) { subjects.push_back(subject); break; }
        }
    }

    if (subjects.empty()) {
        result.error = "no jig:WebPlugin in this document. It may be a catalogue entry for a "
                       "plugin that does not run in a host like this one.";
        return result;
    }
    if (subjects.size() > 1) {
        result.error = "several jig:WebPlugin subjects in one document; expected one";
        return result;
    }

    Profile p;
    p.iri = subjects.front();

    try {
        p.label = first(p.iri, std::string(RDFS) + "label");
        p.comment = first(p.iri, std::string(RDFS) + "comment");
        p.vendor = first(p.iri, trn("vendor"));
        p.roles = objects(p.iri, trn("role"));
        p.accepts = objects(p.iri, trn("accepts"));
        p.produces = objects(p.iri, trn("produces"));
        p.requires_ = objects(p.iri, trn("requires"));

        auto intOr = [&](const char* term, int fallback) {
            const auto value = first(p.iri, jig(term));
            return value.empty() ? fallback : toInt(value);
        };
        p.audioInputs = intOr("audioInputs", 0);
        p.audioOutputs = intOr("audioOutputs", 0);
        p.inputChannels = intOr("inputChannels", 2);
        p.outputChannels = intOr("outputChannels", 2);
        p.latencyFrames = intOr("latencyFrames", 0);

        const auto moduleNode = first(p.iri, jig("module"));
        if (!moduleNode.empty()) {
            Resource resource;
            resource.location = rebase(first(moduleNode, jig("location")), p.iri, retrievalBase);
            resource.integrity = first(moduleNode, jig("integrity"));
            resource.mediaType = first(moduleNode, jig("mediaType"));
            p.module = resource;
            p.abi = first(moduleNode, jig("abi"));
        }

        for (const auto& portNode : objects(p.iri, lv2("port"))) {
            Port port;
            port.symbol = first(portNode, lv2("symbol"));
            port.name = first(portNode, lv2("name"));
            const auto minimum = first(portNode, lv2("minimum"));
            const auto maximum = first(portNode, lv2("maximum"));
            const auto value = first(portNode, lv2("default"));
            if (!minimum.empty()) port.minimum = toFloat(minimum);
            if (!maximum.empty()) port.maximum = toFloat(maximum);
            if (!value.empty()) port.defaultValue = toFloat(value);
            const auto index = first(portNode, jig("paramIndex"));
            if (!index.empty()) port.index = toInt(index);
            const auto unit = first(portNode, std::string(UNITS) + "unit");
            if (!unit.empty()) port.unit = unit.substr(unit.find_last_of("#/") + 1);

            for (const auto& property : objects(portNode, lv2("portProperty"))) {
                if (property == lv2("toggled")) port.toggled = true;
                if (property == lv2("enumeration")) port.enumeration = true;
            }

            // Scale points are the one place a profile's own blank nodes are
            // right: a named value is not addressable and nothing links to it.
            for (const auto& pointNode : objects(portNode, lv2("scalePoint"))) {
                ScalePoint point;
                point.label = first(pointNode, std::string(RDFS) + "label");
                const auto pointValue = first(pointNode, std::string(RDF) + "value");
                if (!pointValue.empty()) point.value = toFloat(pointValue);
                if (!point.label.empty()) port.scalePoints.push_back(std::move(point));
            }
            std::sort(port.scalePoints.begin(), port.scalePoints.end(),
                      [](const ScalePoint& a, const ScalePoint& b) { return a.value < b.value; });

            p.ports.push_back(std::move(port));
        }
    } catch (const std::exception& error) {
        result.error = std::string("the profile says something unusable: ") + error.what();
        return result;
    }

    result.ok = true;
    result.profile = std::move(p);
    return result;
}

}  // namespace jigdaw
