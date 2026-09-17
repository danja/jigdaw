// native/jigdaw-adapter/src/dpf/JigdawUI.cpp
//
// The editor.
//
// Without one a host shows its generic panel: a row of sliders named "Param 7"
// and no way at all to say which plugin to load, which makes the adapter
// unusable in a DAW however well the audio works.
//
// Two views. The list takes IRIs, asks the plugin to load them, and says what
// happened. Clicking a loaded plugin opens its panel, which is generated from
// the lv2:port statements in its profile: real names, real ranges, real units,
// and named values where the profile names them. That generation is the whole
// point. A JigDAW plugin declares no native user interface, and a jig:ui is a
// web page this host has no engine to run, so a panel built from what the
// profile says is the only one a native host can honestly draw. It is the same
// rule the browser panel follows, from the same statements.
//
// Controls write through the host, never straight into the chain, so automation
// and undo keep working and the host's own generic sliders stay in agreement.
#include "DistrhoUI.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "jigdaw/Chain.hpp"
#include "jigdaw/Params.hpp"
#include "jigdaw/Report.hpp"

START_NAMESPACE_DISTRHO

namespace {

constexpr float kPadding = 18.0f;
constexpr float kLineHeight = 19.0f;
constexpr float kRowHeight = 46.0f;      // a touch target, not a text line
constexpr int kListView = -1;

struct Colours {
    Color background{0.06f, 0.07f, 0.09f};
    Color panel{0.10f, 0.11f, 0.13f};
    Color field{0.04f, 0.05f, 0.06f};
    Color line{0.17f, 0.19f, 0.22f};
    Color text{0.91f, 0.92f, 0.93f};
    Color dim{0.55f, 0.58f, 0.63f};
    Color accent{0.19f, 0.51f, 0.81f};
    Color ok{0.49f, 0.86f, 0.56f};
    Color bad{1.0f, 0.54f, 0.54f};
};

/// A unit as a person writes it. The profile carries the units: term, which is
/// a name for a unit and not a symbol to print.
const char* unitSymbol(const std::string& unit) {
    if (unit == "hz") return " Hz";
    if (unit == "khz") return " kHz";
    if (unit == "ms") return " ms";
    if (unit == "s") return " s";
    if (unit == "db") return " dB";
    if (unit == "pc") return "%";
    if (unit == "semitone12TET") return " st";
    if (unit == "cent") return " ct";
    if (unit == "bpm") return " bpm";
    if (unit == "degree") return " deg";
    return "";
}

std::string formatValue(const jigdaw::Port& port, const float real) {
    // A named value prints its name. "Square" and "1" are different information,
    // and only one of them means anything to the person reading it.
    if (!port.scalePoints.empty()) {
        const auto label = port.labelFor(real);
        if (!label.empty()) return label;
    }
    if (port.toggled) return real >= 0.5f ? "on" : "off";

    char buffer[48];
    const float span = port.maximum - port.minimum;
    // Enough digits to distinguish neighbouring values, no more. A cutoff in Hz
    // does not want three decimal places and a mix from 0 to 1 does.
    const int digits = span >= 100.0f ? 0 : (span >= 10.0f ? 1 : 2);
    std::snprintf(buffer, sizeof(buffer), "%.*f%s", digits, real, unitSymbol(port.unit));
    return buffer;
}

}  // namespace

class JigdawUI : public UI {
public:
    JigdawUI() : UI(DISTRHO_UI_DEFAULT_WIDTH, DISTRHO_UI_DEFAULT_HEIGHT) {
        loadSharedResources();
        values_.resize(JIGDAW_PARAMETER_COUNT, 0.0f);
        touched_.resize(JIGDAW_PARAMETER_COUNT, 0);
    }

    // The worker touches members, so it has to be finished before they are.
    // Closing the editor mid-load is an ordinary thing for a person to do.
    ~JigdawUI() override {
        if (worker_.joinable()) worker_.join();
    }

protected:
    void stateChanged(const char* key, const char* value) override {
        if (std::strcmp(key, "iris") == 0) {
            text_ = value != nullptr ? value : "";
            // Resolve whatever the host restored, so that reopening an editor on
            // a saved project shows the panels rather than an empty list. The
            // plugin is already playing this chain; this is the editor catching
            // up with it.
            if (!text_.empty() && loaded_.empty()) startResolve();
        }
        // The `report` state is written by the plugin and readable by the host.
        // The editor does not read it: it has the full description from its own
        // resolve, and text parsed back out of a state would be the poorer half.
        repaint();
    }

    /// The host's value for a slot, including automation.
    ///
    /// Only a value that differs is an edit, by the same rule the plugin uses.
    /// A host pushes zero for every slot when the editor opens, because nothing
    /// ever told it what the loaded plugin's defaults were, and treating that as
    /// a choice would make this panel report silence while the plugin is playing.
    void parameterChanged(uint32_t index, float value) override {
        if (index >= values_.size()) return;
        if (value != values_[index]) touched_[index] = 1;
        values_[index] = value;
        repaint();
    }

    /// Collect what the worker found, on the thread allowed to draw.
    void uiIdle() override {
        if (!ready_.exchange(false)) return;
        std::vector<jigdaw::LoadedPlugin> found;
        {
            std::lock_guard<std::mutex> guard(resultLock_);
            found = std::move(result_);
        }
        if (worker_.joinable()) worker_.join();
        loaded_ = std::move(found);
        loading_ = false;

        // Show what the plugin is actually running. It gives an untouched slot
        // the port's declared default, and cannot tell the host it did, so an
        // editor that believed the host would display zeros over a plugin at
        // full voice. Same jigdaw::normalisedDefault, so the two agree.
        for (const auto& entry : loaded_) {
            if (!entry.ok) continue;
            for (size_t i = 0; i < entry.ports.size(); ++i) {
                const int slot = entry.firstSlot - 1 + static_cast<int>(i);
                if (slot < 0 || slot >= static_cast<int>(values_.size())) continue;
                if (!touched_[slot]) values_[slot] = jigdaw::normalisedDefault(entry.ports[i]);
            }
        }
        // A panel open on a plugin that is no longer there would draw controls
        // for parameters nothing owns.
        if (view_ >= static_cast<int>(loaded_.size())) view_ = kListView;
        repaint();
    }

    void onNanoDisplay() override {
        const Colours c;
        beginPath(); rect(0, 0, getWidth(), getHeight()); fillColor(c.background); fill();
        if (view_ == kListView) drawList(c); else drawPanel(c, loaded_[view_]);
    }

    bool onMouse(const MouseEvent& event) override {
        if (!event.press) {
            dragging_ = -1;
            return false;
        }
        const Point<double> p = event.pos;
        return view_ == kListView ? pressList(p) : pressPanel(p);
    }

    bool onMotion(const MotionEvent& event) override {
        if (dragging_ < 0 || view_ == kListView) return false;
        setFromX(loaded_[view_], dragging_, event.pos.getX());
        return true;
    }

    bool onCharacterInput(const CharacterInputEvent& event) override {
        if (!focused_ || view_ != kListView) return false;
        if (event.character < 32 || event.character == 127) return false;
        text_ += static_cast<char>(event.character);
        repaint();
        return true;
    }

    bool onKeyboard(const KeyboardEvent& event) override {
        if (!event.press) return false;

        // Escape leaves a panel. Anywhere a pointer can go, a key can go too.
        if (view_ != kListView) return panelKey(event);
        if (!focused_) return false;

        switch (event.key) {
            case kKeyBackspace:
                if (!text_.empty()) { text_.pop_back(); repaint(); }
                return true;
            case kKeyEnter:
                // Ctrl+Enter loads, because a list of IRIs needs newlines and
                // making Enter load would stop anyone typing a second one.
                if (event.mod & kModifierControl) load();
                else { text_ += '\n'; repaint(); }
                return true;
            case kKeyEscape:
                focused_ = false;
                repaint();
                return true;
            default:
                return false;
        }
    }

private:
    // ---------------------------------------------------------------- the list

    void drawList(const Colours& c) {
        const float w = getWidth();
        const float h = getHeight();

        fontSize(19.0f); fillColor(c.text); textAlign(ALIGN_LEFT | ALIGN_TOP);
        text(kPadding, kPadding, "JigDAW Adapter", nullptr);
        fontSize(12.0f); fillColor(c.dim);
        text(kPadding, kPadding + 24.0f,
             "A plugin is a URL. One IRI per line; they load in order and the audio passes through each.",
             nullptr);

        const float fieldTop = kPadding + 52.0f;
        fieldRect_ = Rectangle<float>(kPadding, fieldTop, w - kPadding * 2.0f, 118.0f);
        beginPath();
        roundedRect(fieldRect_.getX(), fieldRect_.getY(), fieldRect_.getWidth(), fieldRect_.getHeight(), 5.0f);
        fillColor(c.field); fill();
        strokeColor(focused_ ? c.accent : c.line); strokeWidth(focused_ ? 2.0f : 1.0f); stroke();

        fontSize(13.0f);
        if (text_.empty() && !focused_) {
            fillColor(c.dim);
            text(fieldRect_.getX() + 10.0f, fieldRect_.getY() + 9.0f,
                 "https://strandz.it/jigdaw/plugins/pulse/", nullptr);
        } else {
            fillColor(c.text);
            float y = fieldRect_.getY() + 9.0f;
            std::istringstream lines(text_);
            std::string line;
            while (std::getline(lines, line) && y < fieldRect_.getY() + fieldRect_.getHeight() - 14.0f) {
                text(fieldRect_.getX() + 10.0f, y, line.c_str(), nullptr);
                y += kLineHeight;
            }
            if (focused_) {
                beginPath();
                rect(fieldRect_.getX() + 10.0f + measureLine(lastLine()), y - kLineHeight, 1.5f, 14.0f);
                fillColor(c.accent); fill();
            }
        }

        const float buttonTop = fieldRect_.getY() + fieldRect_.getHeight() + 12.0f;
        loadRect_ = Rectangle<float>(kPadding, buttonTop, 104.0f, 34.0f);
        drawButton(loadRect_, loading_ ? "Loading" : "Load", c.accent, c);
        clearRect_ = Rectangle<float>(kPadding + 114.0f, buttonTop, 84.0f, 34.0f);
        drawButton(clearRect_, "Clear", c.panel, c);
        exampleRect_ = Rectangle<float>(kPadding + 208.0f, buttonTop, 150.0f, 34.0f);
        drawButton(exampleRect_, "Example chain", c.panel, c);

        fontSize(11.0f); fillColor(c.dim); textAlign(ALIGN_RIGHT | ALIGN_MIDDLE);
        text(w - kPadding, buttonTop + 17.0f, "Enter adds a line \xc2\xb7 Ctrl+Enter loads", nullptr);
        textAlign(ALIGN_LEFT | ALIGN_TOP);

        const float listTop = buttonTop + 50.0f;
        beginPath();
        roundedRect(kPadding, listTop, w - kPadding * 2.0f, h - listTop - kPadding, 5.0f);
        fillColor(c.panel); fill();
        strokeColor(c.line); strokeWidth(1.0f); stroke();

        rowRects_.clear();
        if (loaded_.empty()) {
            fillColor(c.dim); fontSize(12.5f);
            text(kPadding + 12.0f, listTop + 12.0f,
                 loading_ ? "Loading. Fetching each profile, verifying its digest, instantiating."
                          : "Nothing loaded yet. Paste a plugin IRI above and press Load.", nullptr);
            if (!loading_) {
                fontSize(11.5f);
                text(kPadding + 12.0f, listTop + 38.0f,
                     "A plugin must declare jig:abi to run here: without it its module is private", nullptr);
                text(kPadding + 12.0f, listTop + 54.0f,
                     "to its JavaScript processor, and this host has no JavaScript engine.", nullptr);
            }
            return;
        }

        float y = listTop + 8.0f;
        for (size_t i = 0; i < loaded_.size(); ++i) {
            const auto& entry = loaded_[i];
            if (y + kRowHeight > h - kPadding) break;
            const Rectangle<float> row(kPadding + 4.0f, y, w - kPadding * 2.0f - 8.0f, kRowHeight - 4.0f);
            rowRects_.push_back(row);

            if (entry.ok) {
                beginPath();
                roundedRect(row.getX(), row.getY(), row.getWidth(), row.getHeight(), 4.0f);
                fillColor(Color(1.0f, 1.0f, 1.0f, i == hover_ ? 0.07f : 0.03f)); fill();
            }

            fontSize(12.5f);
            fillColor(entry.ok ? c.ok : c.bad);
            text(row.getX() + 10.0f, row.getY() + 8.0f, entry.ok ? "loaded" : "refused", nullptr);
            fillColor(c.text);
            text(row.getX() + 66.0f, row.getY() + 8.0f,
                 entry.ok ? entry.label.c_str() : entry.iri.c_str(), nullptr);

            fillColor(c.dim); fontSize(11.5f);
            if (entry.ok) {
                char detail[96];
                std::snprintf(detail, sizeof(detail), "params %d-%d", entry.firstSlot, entry.lastSlot);
                text(row.getX() + 212.0f, row.getY() + 8.0f, detail, nullptr);
                textAlign(ALIGN_RIGHT | ALIGN_TOP);
                fillColor(c.accent);
                text(row.getX() + row.getWidth() - 10.0f, row.getY() + 8.0f, "open panel", nullptr);
                textAlign(ALIGN_LEFT | ALIGN_TOP);
                fillColor(c.dim);
                std::string symbols;
                for (const auto& port : entry.ports) symbols += port.symbol + " ";
                text(row.getX() + 66.0f, row.getY() + 25.0f, symbols.c_str(), nullptr);
            } else {
                text(row.getX() + 66.0f, row.getY() + 25.0f, entry.error.c_str(), nullptr);
            }
            y += kRowHeight;
        }
    }

    bool pressList(const Point<double>& p) {
        if (contains(loadRect_, p)) { load(); return true; }
        if (contains(clearRect_, p)) { text_.clear(); repaint(); return true; }
        if (contains(exampleRect_, p)) {
            text_ = "https://strandz.it/jigdaw/plugins/pulse/\n"
                    "https://strandz.it/jigdaw/plugins/cascade/";
            repaint();
            return true;
        }
        for (size_t i = 0; i < rowRects_.size() && i < loaded_.size(); ++i) {
            if (contains(rowRects_[i], p) && loaded_[i].ok) {
                view_ = static_cast<int>(i);
                selected_ = 0;
                focused_ = false;
                repaint();
                return true;
            }
        }
        focused_ = contains(fieldRect_, p);
        repaint();
        return focused_;
    }

    // --------------------------------------------------------------- the panel

    void drawPanel(const Colours& c, const jigdaw::LoadedPlugin& entry) {
        const float w = getWidth();
        const float h = getHeight();

        fontSize(19.0f); fillColor(c.text); textAlign(ALIGN_LEFT | ALIGN_TOP);
        text(kPadding, kPadding, entry.label.c_str(), nullptr);
        fontSize(11.5f); fillColor(c.dim);
        text(kPadding, kPadding + 25.0f, entry.iri.c_str(), nullptr);

        backRect_ = Rectangle<float>(w - kPadding - 92.0f, kPadding - 2.0f, 92.0f, 32.0f);
        drawButton(backRect_, "Back", c.panel, c);

        const float top = kPadding + 54.0f;
        beginPath();
        roundedRect(kPadding, top, w - kPadding * 2.0f, h - top - kPadding, 5.0f);
        fillColor(c.panel); fill();
        strokeColor(c.line); strokeWidth(1.0f); stroke();

        if (entry.ports.empty()) {
            fillColor(c.dim); fontSize(12.5f);
            text(kPadding + 14.0f, top + 14.0f, "This plugin declares no parameters.", nullptr);
            barRects_.clear();
            return;
        }

        // The label column is sized to the longest name, so a plugin with one
        // long parameter name does not push every bar off the panel.
        fontSize(12.5f);
        float labelWidth = 90.0f;
        for (const auto& port : entry.ports) {
            labelWidth = std::max(labelWidth, measureLine(port.name.empty() ? port.symbol : port.name));
        }
        labelWidth = std::min(labelWidth, w * 0.32f);

        const float barLeft = kPadding + 16.0f + labelWidth + 16.0f;
        const float valueWidth = 96.0f;
        const float barWidth = std::max(60.0f, w - kPadding - 16.0f - valueWidth - barLeft);

        barRects_.clear();
        float y = top + 14.0f;
        for (size_t i = 0; i < entry.ports.size(); ++i) {
            const auto& port = entry.ports[i];
            const int slot = entry.firstSlot - 1 + static_cast<int>(i);
            const float span = port.maximum - port.minimum;
            const float normalised = slotValue(slot);
            const float real = port.minimum + normalised * span;

            const Rectangle<float> bar(barLeft, y + 12.0f, barWidth, 16.0f);
            barRects_.push_back(bar);

            const bool isSelected = static_cast<int>(i) == selected_;
            if (isSelected) {
                beginPath();
                roundedRect(kPadding + 6.0f, y, w - kPadding * 2.0f - 12.0f, kRowHeight - 6.0f, 4.0f);
                fillColor(Color(c.accent.red, c.accent.green, c.accent.blue, 0.14f)); fill();
            }

            fontSize(12.5f); fillColor(c.text); textAlign(ALIGN_LEFT | ALIGN_MIDDLE);
            text(kPadding + 16.0f, bar.getY() + 8.0f,
                 (port.name.empty() ? port.symbol : port.name).c_str(), nullptr);

            beginPath();
            roundedRect(bar.getX(), bar.getY(), bar.getWidth(), bar.getHeight(), 3.0f);
            fillColor(c.field); fill();
            strokeColor(isSelected ? c.accent : c.line); strokeWidth(1.0f); stroke();

            // Named values get ticks, because a selector is not a continuum and
            // drawing it as one invites dragging to a value that does not exist.
            if (!port.scalePoints.empty() && span > 0.0f) {
                for (const auto& point : port.scalePoints) {
                    const float at = bar.getX() + (point.value - port.minimum) / span * bar.getWidth();
                    beginPath(); rect(at - 0.5f, bar.getY(), 1.0f, bar.getHeight());
                    fillColor(c.line); fill();
                }
            }

            beginPath();
            roundedRect(bar.getX(), bar.getY(), std::max(3.0f, bar.getWidth() * normalised), bar.getHeight(), 3.0f);
            fillColor(c.accent); fill();

            fontSize(12.0f); fillColor(c.text); textAlign(ALIGN_RIGHT | ALIGN_MIDDLE);
            text(w - kPadding - 16.0f, bar.getY() + 8.0f, formatValue(port, real).c_str(), nullptr);

            // The slot number, so the host's "Param 7" can be found from here.
            fontSize(10.5f); fillColor(c.dim); textAlign(ALIGN_LEFT | ALIGN_MIDDLE);
            char slotText[24];
            std::snprintf(slotText, sizeof(slotText), "%d", slot + 1);
            text(bar.getX() - 14.0f, bar.getY() + 8.0f, slotText, nullptr);

            textAlign(ALIGN_LEFT | ALIGN_TOP);
            y += kRowHeight;
            if (y + kRowHeight > h - kPadding) break;
        }
    }

    bool pressPanel(const Point<double>& p) {
        if (contains(backRect_, p)) { view_ = kListView; repaint(); return true; }
        const auto& entry = loaded_[view_];
        for (size_t i = 0; i < barRects_.size() && i < entry.ports.size(); ++i) {
            // A generous band, so a control is grabbable without hitting a
            // 16 pixel bar exactly.
            Rectangle<float> band = barRects_[i];
            band.setY(band.getY() - 14.0f);
            band.setHeight(band.getHeight() + 28.0f);
            if (contains(band, p)) {
                selected_ = static_cast<int>(i);
                dragging_ = static_cast<int>(i);
                setFromX(entry, static_cast<int>(i), p.getX());
                return true;
            }
        }
        return false;
    }

    bool panelKey(const KeyboardEvent& event) {
        const auto& entry = loaded_[view_];
        const int count = static_cast<int>(entry.ports.size());

        if (event.key == kKeyEscape) { view_ = kListView; repaint(); return true; }
        if (count == 0) return false;

        switch (event.key) {
            case kKeyUp:    selected_ = (selected_ + count - 1) % count; repaint(); return true;
            case kKeyDown:  selected_ = (selected_ + 1) % count; repaint(); return true;
            case kKeyLeft:  nudge(entry, selected_, -1, event.mod & kModifierShift); return true;
            case kKeyRight: nudge(entry, selected_, +1, event.mod & kModifierShift); return true;
            default: return false;
        }
    }

    // --------------------------------------------------------- values and wiring

    float slotValue(int slot) const {
        return slot >= 0 && slot < static_cast<int>(values_.size()) ? values_[slot] : 0.0f;
    }

    /// Write a slot through the host, never straight into the chain.
    ///
    /// The host owns automation and undo. Setting the chain directly would work
    /// until the first automation pass overwrote it, and the host's own generic
    /// slider would disagree with this panel for as long as the editor was open.
    void setSlot(int slot, float normalised) {
        normalised = std::min(1.0f, std::max(0.0f, normalised));
        if (slot < 0 || slot >= static_cast<int>(values_.size())) return;
        values_[slot] = normalised;
        touched_[slot] = 1;
        setParameterValue(static_cast<uint32_t>(slot), normalised);
        repaint();
    }

    /// Quantise to a named value when the port names its values.
    float quantise(const jigdaw::Port& port, float normalised) const {
        const float span = port.maximum - port.minimum;
        if (span <= 0.0f) return 0.0f;
        if (port.toggled) return normalised >= 0.5f ? 1.0f : 0.0f;
        if (port.scalePoints.empty()) return normalised;

        const float real = port.minimum + normalised * span;
        float best = port.scalePoints.front().value;
        for (const auto& point : port.scalePoints) {
            if (std::fabs(point.value - real) < std::fabs(best - real)) best = point.value;
        }
        return (best - port.minimum) / span;
    }

    void setFromX(const jigdaw::LoadedPlugin& entry, int which, double x) {
        if (which < 0 || which >= static_cast<int>(barRects_.size())) return;
        const auto& bar = barRects_[which];
        const auto& port = entry.ports[which];
        const float fraction = bar.getWidth() > 0.0f
            ? static_cast<float>((x - bar.getX()) / bar.getWidth()) : 0.0f;
        setSlot(entry.firstSlot - 1 + which, quantise(port, fraction));
    }

    void nudge(const jigdaw::LoadedPlugin& entry, int which, int direction, bool fine) {
        if (which < 0 || which >= static_cast<int>(entry.ports.size())) return;
        const auto& port = entry.ports[which];
        const int slot = entry.firstSlot - 1 + which;
        const float current = slotValue(slot);

        if (port.toggled) { setSlot(slot, current >= 0.5f ? 0.0f : 1.0f); return; }

        if (!port.scalePoints.empty()) {
            // Step to the next named value, not by a fraction that would land
            // between two of them.
            const float span = port.maximum - port.minimum;
            const float real = port.minimum + current * span;
            int at = 0;
            for (size_t i = 0; i < port.scalePoints.size(); ++i) {
                if (std::fabs(port.scalePoints[i].value - real) <
                    std::fabs(port.scalePoints[at].value - real)) at = static_cast<int>(i);
            }
            at = std::min(static_cast<int>(port.scalePoints.size()) - 1, std::max(0, at + direction));
            setSlot(slot, span > 0.0f ? (port.scalePoints[at].value - port.minimum) / span : 0.0f);
            return;
        }

        setSlot(slot, current + direction * (fine ? 0.002f : 0.02f));
    }

    // ------------------------------------------------------------------ shared

    void drawButton(const Rectangle<float>& r, const char* label, const Color& fillColour, const Colours& c) {
        beginPath();
        roundedRect(r.getX(), r.getY(), r.getWidth(), r.getHeight(), 4.0f);
        fillColor(fillColour); fill();
        strokeColor(c.line); strokeWidth(1.0f); stroke();
        fontSize(13.0f); fillColor(c.text);
        textAlign(ALIGN_CENTER | ALIGN_MIDDLE);
        text(r.getX() + r.getWidth() / 2.0f, r.getY() + r.getHeight() / 2.0f, label, nullptr);
        textAlign(ALIGN_LEFT | ALIGN_TOP);
    }

    static bool contains(const Rectangle<float>& r, const Point<double>& p) {
        return p.getX() >= r.getX() && p.getX() <= r.getX() + r.getWidth() &&
               p.getY() >= r.getY() && p.getY() <= r.getY() + r.getHeight();
    }

    std::string lastLine() const {
        const auto at = text_.find_last_of('\n');
        return at == std::string::npos ? text_ : text_.substr(at + 1);
    }

    float measureLine(const std::string& line) {
        if (line.empty()) return 0.0f;
        Rectangle<float> bounds;
        textBounds(0, 0, line.c_str(), nullptr, bounds);
        return bounds.getWidth();
    }

    void load() {
        if (loading_) return;
        // The plugin does the real load. It owns the chain that plays, and it
        // has to be able to do this with no editor open at all, which is why the
        // work lives there and not here.
        setState("iris", text_.c_str());
        startResolve();
    }

    /// Work out what the IRIs describe, for the list and the panels.
    ///
    /// DPF wires the plugin to editor state push under CLAP only, and it is a
    /// null pointer in the VST3, VST2 and JACK wrappers, so waiting to be told
    /// would mean waiting for ever in the format this is mostly used in. Same
    /// IRIs, same jigdaw::buildChain, so the two cannot disagree about what
    /// happened.
    ///
    /// On a worker, because it fetches over the network and an editor that stops
    /// repainting looks like a hung DAW.
    void startResolve() {
        if (worker_.joinable()) worker_.join();
        loading_ = true;
        loaded_.clear();
        view_ = kListView;
        repaint();

        const std::string iris = text_;
        const double rate = getSampleRate();
        ready_.store(false);
        worker_ = std::thread([this, iris, rate] {
            jigdaw::Chain scratch;
            auto found = jigdaw::buildChain(scratch, iris, rate);
            {
                std::lock_guard<std::mutex> guard(resultLock_);
                result_ = std::move(found);
            }
            ready_.store(true);
        });
    }

    std::string text_;
    bool focused_ = false;
    bool loading_ = false;
    int view_ = kListView;       ///< kListView, or an index into loaded_
    int selected_ = 0;           ///< which control the keyboard is on
    int dragging_ = -1;
    size_t hover_ = static_cast<size_t>(-1);

    std::vector<jigdaw::LoadedPlugin> loaded_;
    std::vector<float> values_;     ///< the host's normalised slot values
    std::vector<uint8_t> touched_;  ///< slots someone has actually chosen

    Rectangle<float> fieldRect_, loadRect_, clearRect_, exampleRect_, backRect_;
    std::vector<Rectangle<float>> rowRects_, barRects_;

    std::thread worker_;
    std::mutex resultLock_;
    std::vector<jigdaw::LoadedPlugin> result_;
    std::atomic<bool> ready_{false};

    DISTRHO_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(JigdawUI)
};

UI* createUI() { return new JigdawUI(); }

END_NAMESPACE_DISTRHO
