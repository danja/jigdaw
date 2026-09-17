#!/usr/bin/env bash
# install.sh
#
# Build the JigDAW Adapter and install it where a DAW will find it.
#
# At the repository root rather than in native/, because it is the thing a
# person arriving here runs, and the native adapter is only one of the things
# this repository holds.
#
# Follows downspout's installer in shape, including its hard-won note about
# plugin caches at the end. One difference worth knowing: this installs from
# the bundles DPF produced rather than staging them, so the execute bit
# survives and a host does not report the plugin as missing when it is merely
# unreadable.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
native_dir="$repo_root/native"

build_dir="${JIGDAW_BUILD_DIR:-$native_dir/build}"
build_type="${CMAKE_BUILD_TYPE:-Release}"
vst3_dir="${JIGDAW_VST3_DIR:-$HOME/.vst3}"
clap_dir="${JIGDAW_CLAP_DIR:-$HOME/.clap}"
lv2_dir="${JIGDAW_LV2_DIR:-$HOME/.lv2}"
run_tests="${JIGDAW_RUN_TESTS:-1}"
install_clap="${JIGDAW_INSTALL_CLAP:-0}"
install_lv2="${JIGDAW_INSTALL_LV2:-0}"

usage() {
  cat <<'EOF'
Usage: ./install.sh [--clap] [--lv2] [--no-tests] [--debug]

Builds the JigDAW Adapter and installs the VST3 into ~/.vst3.

  --clap        also install the CLAP into ~/.clap
  --lv2         also install the LV2 into ~/.lv2
  --all         install all three
  --no-tests    skip the test run
  --debug       build with CMAKE_BUILD_TYPE=Debug

Environment:
  JIGDAW_VST3_DIR   where the VST3 goes        (default ~/.vst3)
  JIGDAW_BUILD_DIR  where the build happens    (default native/build)
  JIGDAW_DPF_DIR    a DPF checkout             (default downspout's)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clap) install_clap=1 ;;
    --lv2) install_lv2=1 ;;
    --all) install_clap=1; install_lv2=1 ;;
    --no-tests) run_tests=0 ;;
    --debug) build_type=Debug ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# DPF is not vendored here. Say where to find it rather than failing deep in a
# CMake trace, which is where this otherwise goes wrong for a first-time build.
dpf_dir="${JIGDAW_DPF_DIR:-$HOME/github/downspout/third_party/DPF}"
if [[ ! -f "$dpf_dir/CMakeLists.txt" ]]; then
  cat >&2 <<EOF
DPF is not at $dpf_dir

The adapter is built against the same DPF the downspout plugins use, rather
than vendoring a second copy. Either check downspout out beside this
repository, or point at a DPF you already have:

  JIGDAW_DPF_DIR=/path/to/DPF ./install.sh
EOF
  exit 1
fi

echo "Building the JigDAW Adapter ($build_type)"
cmake -S "$native_dir" -B "$build_dir" \
  -DCMAKE_BUILD_TYPE="$build_type" \
  -DJIGDAW_DPF_DIR="$dpf_dir" >/dev/null

cmake --build "$build_dir" -j "$(nproc 2>/dev/null || echo 4)"

if [[ "$run_tests" == "1" ]]; then
  echo
  echo "Running the tests"
  # A failure is reported and does not stop the install: the tests that need a
  # server skip without one, and a developer installing a known-broken build is
  # allowed to, as long as nobody can pretend it passed.
  test_exit=0
  ctest --test-dir "$build_dir" --output-on-failure || test_exit=$?
  if [[ "$test_exit" != "0" ]]; then
    echo "WARNING: tests failed. Installing anyway."
    echo "Run 'ctest --test-dir $build_dir --output-on-failure' for detail."
  fi
fi

bundle="$build_dir/bin/jigdaw-adapter.vst3"
if [[ ! -d "$bundle" ]]; then
  echo "No VST3 bundle was produced at $bundle" >&2
  echo "The core may have built while the plugin did not; check the output above." >&2
  exit 1
fi

install_bundle() {
  local source="$1" target_dir="$2" what="$3"
  if [[ ! -e "$source" ]]; then
    echo "  no $what bundle was built, skipping"
    return
  fi
  mkdir -p "$target_dir"
  # -a rather than cmake --install: it preserves the execute bit by design,
  # which is the thing that silently breaks otherwise.
  rm -rf "$target_dir/$(basename "$source")"
  cp -a "$source" "$target_dir/"
  echo "  $what  ->  $target_dir/$(basename "$source")"
}

echo
echo "Installing"
install_bundle "$bundle" "$vst3_dir" "VST3"
[[ "$install_clap" == "1" ]] && install_bundle "$build_dir/bin/jigdaw-adapter.clap" "$clap_dir" "CLAP"
[[ "$install_lv2" == "1" ]] && install_bundle "$build_dir/bin/jigdaw-adapter.lv2" "$lv2_dir" "LV2"

# Ask a question of the consumer, not of the artefact: a copy that succeeded
# says nothing about whether the result can actually be loaded.
installed="$vst3_dir/jigdaw-adapter.vst3"
so="$(find "$installed" -name '*.so' | head -1)"
if [[ -z "$so" ]]; then
  echo >&2
  echo "The bundle was copied but contains no shared object. Something is wrong." >&2
  exit 1
fi
if [[ ! -x "$so" ]]; then
  echo "  fixing the execute bit on $so"
  chmod +x "$so"
fi
if command -v ldd >/dev/null && ldd "$so" 2>&1 | grep -q "not found"; then
  echo >&2
  echo "WARNING: the installed plugin has unresolved libraries:" >&2
  ldd "$so" | grep "not found" >&2
fi

cat <<EOF

Installed. $(du -sh "$installed" | cut -f1) at $installed

To use it, add a JigDAW plugin IRI to the plugin's "iris" state, one per line:

  https://strandz.it/jigdaw/plugins/pulse/
  https://strandz.it/jigdaw/plugins/cascade/

That chain is a synthesiser into a reverb. MIDI reaches every plugin that takes
it, and each plugin's audio feeds the next. See native/jigdaw-adapter/README.md.

If a DAW does not show it, or shows an old version, force a plugin rescan or
clear that DAW's VST3 cache. This installs the bundle; it does not edit caches
such as REAPER's reaper-vstplugins64.ini or Ardour's ~/.cache/ardour*/vst.
EOF
