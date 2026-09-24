# native/cmake/FindOrFetchWamr.cmake
#
# WAMR (WebAssembly Micro Runtime), a local checkout rather than fetched: it
# has no shallow-clone-friendly release tag the way wasm3 does (this project
# tracks the git repository directly), and a multi-hundred-MB tree is not
# something to re-clone on every clean build.
#
# Replaces wasm3 (see the removed FindOrFetchWasm3.cmake) for the one reason
# wasm3 could not stay: Ferrite and any future plugin declaring
# jig:wasmFeature jig:Simd128 needs WebAssembly SIMD, which wasm3's
# interpreter does not implement and wasm3 upstream has no plan to add.
#
# Built here as the fast interpreter with SIMD on and AOT/JIT off — pure
# bytecode interpretation, the same "no executable pages, nothing
# platform-specific to debug" property wasm3 was chosen for, just with SIMD.
# AOT would need wamrc (and therefore LLVM) as a build dependency for a
# modest throughput gain this project does not need; Module.cpp is the only
# file that knows which mode is in use, so that stays an option rather than
# a decision made here.
set(WAMR_ROOT "$ENV{HOME}/github/wasm-micro-runtime" CACHE PATH
    "Path to a WAMR (wasm-micro-runtime) checkout")

if(NOT EXISTS "${WAMR_ROOT}/build-scripts/runtime_lib.cmake")
  message(FATAL_ERROR
    "WAMR not found at ${WAMR_ROOT}. Clone "
    "https://github.com/wasm-micro-runtime/wasm-micro-runtime there, or pass "
    "-DWAMR_ROOT=<path>.")
endif()

set(WAMR_BUILD_PLATFORM "linux")
if(NOT DEFINED WAMR_BUILD_TARGET)
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64)")
    set(WAMR_BUILD_TARGET "AARCH64")
  elseif(CMAKE_SIZEOF_VOID_P EQUAL 8)
    set(WAMR_BUILD_TARGET "X86_64")
  else()
    set(WAMR_BUILD_TARGET "X86_32")
  endif()
endif()

set(WAMR_BUILD_INTERP 1)
set(WAMR_BUILD_FAST_INTERP 1)
set(WAMR_BUILD_SIMD 1)
set(WAMR_BUILD_AOT 0)
set(WAMR_BUILD_JIT 0)
set(WAMR_BUILD_FAST_JIT 0)
set(WAMR_BUILD_LIBC_BUILTIN 1)
set(WAMR_BUILD_LIBC_WASI 0)
# Rust's wasm32-unknown-unknown target emits a reference-types section by
# default (funcref/externref in the type/table encoding) even for a module
# that never uses one, as Ferrite's toolchain does. Without this WAMR refuses
# to parse the module at all, before SIMD or anything else about it matters.
set(WAMR_BUILD_REF_TYPES 1)
set(WAMR_BUILD_MULTI_MODULE 0)
set(WAMR_BUILD_LIB_PTHREAD 0)
set(WAMR_BUILD_SHARED_MEMORY 0)
# No native imports: every module here is jig:Abi1/Abi2, a closed set of
# exports and nothing more. Registering a "env" import module the way
# samples/basic does would be for a plugin that imports host functions, which
# the ABI this project speaks does not.

list(APPEND CMAKE_MODULE_PATH "${WAMR_ROOT}/build-scripts")
include("${WAMR_ROOT}/build-scripts/runtime_lib.cmake")

add_library(wamr_vmlib STATIC ${WAMR_RUNTIME_LIB_SOURCE})
target_include_directories(wamr_vmlib PUBLIC "${WAMR_ROOT}/core/iwasm/include")
set_target_properties(wamr_vmlib PROPERTIES POSITION_INDEPENDENT_CODE ON)
find_package(Threads REQUIRED)
target_link_libraries(wamr_vmlib PUBLIC Threads::Threads)
