// native/jigdaw-adapter/src/Report.cpp
#include "jigdaw/Report.hpp"

#include <sstream>

namespace jigdaw {

std::vector<LoadedPlugin> buildChain(Chain& chain, const std::string& iris,
                                     const double sampleRate) {
    std::vector<LoadedPlugin> loaded;
    std::istringstream lines(iris);
    std::string iri;

    while (std::getline(lines, iri)) {
        while (!iri.empty() && (iri.back() == '\r' || iri.back() == ' ')) iri.pop_back();
        if (iri.empty() || iri[0] == '#') continue;

        LoadedPlugin entry;
        entry.iri = iri;

        const size_t before = chain.parameters().size();
        entry.error = chain.add(iri, sampleRate);
        entry.ok = entry.error.empty();

        if (entry.ok) {
            const auto& slot = chain.at(chain.size() - 1);
            entry.label = slot.profile.label;
            entry.ports = slot.ports;
            // The parameter mapping, because a host shows "Param 3" and nothing
            // else can say what that is.
            entry.firstSlot = static_cast<int>(before) + 1;
            entry.lastSlot = static_cast<int>(chain.parameters().size());
        }
        // A failure is named and survived: one bad IRI must not stop the rest.
        loaded.push_back(std::move(entry));
    }

    return loaded;
}

std::string describe(const std::vector<LoadedPlugin>& loaded) {
    std::ostringstream report;
    bool any = false;

    for (const auto& entry : loaded) {
        if (entry.ok) {
            any = true;
            report << "ok\t" << entry.label << "\tparams " << entry.firstSlot << "-"
                   << entry.lastSlot << "\t";
            for (const auto& port : entry.ports) report << port.symbol << " ";
            report << "\n";
        } else {
            report << "no\t" << entry.iri << "\t" << entry.error << "\n";
        }
    }

    if (!any && !loaded.empty()) report << "no\t\tnothing loaded\n";
    return report.str();
}

}  // namespace jigdaw
