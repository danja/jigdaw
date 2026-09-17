// native/jigdaw-adapter/src/Params.cpp
#include "jigdaw/Params.hpp"

#include <cstddef>

namespace jigdaw {

float normalisedDefault(const Port& port) {
    const float span = port.maximum - port.minimum;
    // A zero span is a port with one legal value. Normalising against it would
    // divide by zero, and there is nothing to choose anyway.
    return span > 0.0f ? (port.defaultValue - port.minimum) / span : 0.0f;
}

void applyParameters(Chain& chain, std::vector<float>& values,
                     const std::vector<uint8_t>& touched) {
    const auto& ports = chain.parameters();
    for (std::size_t i = 0; i < ports.size() && i < values.size(); ++i) {
        const Port& port = ports[i];
        const float span = port.maximum - port.minimum;

        const bool moved = i < touched.size() && touched[i] != 0;
        if (!moved) values[i] = normalisedDefault(port);
        chain.setParameter(i, port.minimum + values[i] * span);
    }
}

}  // namespace jigdaw
