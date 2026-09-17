// native/jigdaw-adapter/src/Profile.cpp
#include "jigdaw/Profile.hpp"

#include <algorithm>
#include <map>
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

float toFloat(const std::string& text) {
    try { return std::stof(text); } catch (...) { throw std::runtime_error("not a number: " + text); }
}

int toInt(const std::string& text) {
    try { return static_cast<int>(std::stof(text)); } catch (...) { throw std::runtime_error("not an integer: " + text); }
}

}  // namespace

bool Profile::acceptsMidi() const { return containsMidi(accepts); }
bool Profile::producesMidi() const { return containsMidi(produces); }

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
