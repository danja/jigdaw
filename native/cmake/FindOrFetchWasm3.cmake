# native/cmake/FindOrFetchWasm3.cmake
#
# wasm3, a small interpreter, fetched if it is not already present.
#
# An interpreter rather than a JIT on purpose. The adapter's job is to prove
# that jig:Abi1 is loadable outside a browser, and an interpreter builds
# everywhere, needs no executable pages and has no platform-specific backend to
# debug. If throughput ever matters more than that, the runtime is one file to
# swap: Module.cpp is the only thing that knows which one is in use.
include(FetchContent)

set(WASM3_VERSION "v0.5.0" CACHE STRING "wasm3 release to build against")

FetchContent_Declare(
  wasm3
  GIT_REPOSITORY https://github.com/wasm3/wasm3.git
  GIT_TAG ${WASM3_VERSION}
  GIT_SHALLOW TRUE
)

# wasm3's own CMakeLists pulls extra dependencies for its command line tool,
# which fail to configure and are not wanted here. Only the interpreter core is
# needed, so the sources are compiled directly: seventeen C files, no options.
FetchContent_GetProperties(wasm3)
if(NOT wasm3_POPULATED)
  FetchContent_Populate(wasm3)
endif()

file(GLOB WASM3_SOURCES ${wasm3_SOURCE_DIR}/source/*.c)
add_library(m3 STATIC ${WASM3_SOURCES})
target_include_directories(m3 PUBLIC ${wasm3_SOURCE_DIR}/source)
set_target_properties(m3 PROPERTIES C_STANDARD 11 POSITION_INDEPENDENT_CODE ON)
