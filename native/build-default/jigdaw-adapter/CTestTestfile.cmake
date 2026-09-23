# CMake generated Testfile for 
# Source directory: /home/danny/github/jigdaw/native/jigdaw-adapter
# Build directory: /home/danny/github/jigdaw/native/build-default/jigdaw-adapter
# 
# This file includes the relevant testing commands required for 
# testing this directory and lists subdirectories to be tested as well.
add_test([=[turtle]=] "/home/danny/github/jigdaw/native/build-default/jigdaw-adapter/test_turtle")
set_tests_properties([=[turtle]=] PROPERTIES  _BACKTRACE_TRIPLES "/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;38;add_test;/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;0;")
add_test([=[integrity]=] "/home/danny/github/jigdaw/native/build-default/jigdaw-adapter/test_integrity")
set_tests_properties([=[integrity]=] PROPERTIES  _BACKTRACE_TRIPLES "/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;38;add_test;/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;0;")
add_test([=[fetch]=] "/home/danny/github/jigdaw/native/build-default/jigdaw-adapter/test_fetch")
set_tests_properties([=[fetch]=] PROPERTIES  _BACKTRACE_TRIPLES "/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;38;add_test;/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;0;")
add_test([=[profile]=] "/home/danny/github/jigdaw/native/build-default/jigdaw-adapter/test_profile" "/home/danny/github/jigdaw")
set_tests_properties([=[profile]=] PROPERTIES  _BACKTRACE_TRIPLES "/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;45;add_test;/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;0;")
add_test([=[chain]=] "/home/danny/github/jigdaw/native/build-default/jigdaw-adapter/test_chain" "http://127.0.0.1:6026")
set_tests_properties([=[chain]=] PROPERTIES  SKIP_RETURN_CODE "77" _BACKTRACE_TRIPLES "/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;50;add_test;/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;0;")
add_test([=[chain_file]=] "/home/danny/github/jigdaw/native/build-default/jigdaw-adapter/test_chain" "file:///home/danny/github/jigdaw")
set_tests_properties([=[chain_file]=] PROPERTIES  SKIP_RETURN_CODE "77" _BACKTRACE_TRIPLES "/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;53;add_test;/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;0;")
add_test([=[parameter_count]=] "/home/danny/github/jigdaw/native/build-default/jigdaw-adapter/test_parameter_count" "file:///home/danny/github/jigdaw")
set_tests_properties([=[parameter_count]=] PROPERTIES  SKIP_RETURN_CODE "77" _BACKTRACE_TRIPLES "/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;61;add_test;/home/danny/github/jigdaw/native/jigdaw-adapter/CMakeLists.txt;0;")
