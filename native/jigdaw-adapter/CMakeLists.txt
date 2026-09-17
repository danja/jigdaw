# native/jigdaw-adapter/CMakeLists.txt
include(FindOrFetchWasm3)
find_package(OpenSSL REQUIRED)

# The portable core: everything except the plugin format wrapper. Testable on
# its own, and the only part that knows what a JigDAW plugin is.
add_library(jigdaw_core STATIC
  src/Turtle.cpp
  src/Profile.cpp
  src/Integrity.cpp
  src/Module.cpp
  src/Fetch.cpp
  src/Chain.cpp
)
# The core is linked into a shared module, so it must be position independent.
# Without this the VST3 fails to link with a relocation error naming a symbol
# from deep inside a dependency, which says nothing about the cause.
set_target_properties(jigdaw_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(jigdaw_core PUBLIC include)
target_include_directories(jigdaw_core PRIVATE ${JIGDAW_HTTPLIB_DIR})
target_compile_definitions(jigdaw_core PRIVATE CPPHTTPLIB_OPENSSL_SUPPORT)
target_link_libraries(jigdaw_core PUBLIC m3 PRIVATE OpenSSL::SSL OpenSSL::Crypto)

if(JIGDAW_BUILD_TESTS)
  # turtle and integrity need nothing. profile reads the worked plugins from the
  # repository. chain fetches over HTTP and skips when nothing is serving.
  foreach(name turtle integrity)
    add_executable(test_${name} tests/${name}_test.cpp)
    target_link_libraries(test_${name} PRIVATE jigdaw_core)
    add_test(NAME ${name} COMMAND test_${name})
  endforeach()

  get_filename_component(JIGDAW_REPO "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)

  add_executable(test_profile tests/profile_test.cpp)
  target_link_libraries(test_profile PRIVATE jigdaw_core)
  add_test(NAME profile COMMAND test_profile ${JIGDAW_REPO})

  set(JIGDAW_TEST_BASE "http://127.0.0.1:6026" CACHE STRING "Where the chain test fetches from")
  add_executable(test_chain tests/chain_test.cpp)
  target_link_libraries(test_chain PRIVATE jigdaw_core)
  add_test(NAME chain COMMAND test_chain ${JIGDAW_TEST_BASE})
  set_tests_properties(chain PROPERTIES SKIP_RETURN_CODE 77)
endif()

if(JIGDAW_BUILD_PLUGIN)
  if(NOT EXISTS "${JIGDAW_DPF_DIR}/CMakeLists.txt")
    message(WARNING "DPF not found at ${JIGDAW_DPF_DIR}; skipping the VST3. "
                    "Set -DJIGDAW_DPF_DIR=/path/to/DPF to build it.")
  else()
    add_subdirectory(${JIGDAW_DPF_DIR} ${CMAKE_BINARY_DIR}/dpf EXCLUDE_FROM_ALL)
    dpf_add_plugin(jigdaw-adapter
      TARGETS vst3 clap lv2
      FILES_DSP src/dpf/JigdawPlugin.cpp)
    target_include_directories(jigdaw-adapter PUBLIC include src/dpf)
    target_link_libraries(jigdaw-adapter PUBLIC jigdaw_core)
  endif()
endif()
