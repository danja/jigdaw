# native/CMakeLists.txt
#
# The native side: a VST3 that loads JigDAW plugins by IRI.
#
# Built apart from the web side on purpose. Nothing here is needed to run the
# browser host, and a checkout that only wants the DAW should not have to
# build a WebAssembly interpreter to get it.
cmake_minimum_required(VERSION 3.20)
project(jigdaw-native LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/cmake")

option(JIGDAW_BUILD_TESTS "Build the native tests" ON)
option(JIGDAW_BUILD_PLUGIN "Build the VST3, which needs DPF" ON)

# DPF, as downspout vendors it. A path rather than a fetch, because this is the
# same DPF those plugins are built against and two copies would be two answers.
set(JIGDAW_DPF_DIR "$ENV{HOME}/github/downspout/third_party/DPF"
    CACHE PATH "DPF checkout to build the VST3 against")
set(JIGDAW_HTTPLIB_DIR "$ENV{HOME}/github/downspout/third_party/cpp-httplib"
    CACHE PATH "cpp-httplib checkout")

# At the top level, or ctest finds nothing from the build root.
if(JIGDAW_BUILD_TESTS)
  enable_testing()
endif()

add_subdirectory(jigdaw-adapter)
