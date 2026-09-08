cmake_minimum_required(VERSION 3.22)

project(iinatan_mp_native VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(MSVC)
  # Keep the native helpers self-contained on Windows. CMake's default is the
  # dynamically linked CRT, which would add a separate runtime prerequisite to
  # the packaged helper.
  set(
    CMAKE_MSVC_RUNTIME_LIBRARY
    "MultiThreaded$<$<CONFIG:Debug>:Debug>"
    CACHE STRING "MSVC runtime library for bundled native helpers"
  )
endif()

if(APPLE)
  set(IINATAN_BUILD_PORTABLE_HOSHI_DEFAULT OFF)
else()
  set(IINATAN_BUILD_PORTABLE_HOSHI_DEFAULT ON)
endif()
option(
  IINATAN_BUILD_PORTABLE_HOSHI
  "Build the portable dictionary-only HoshiDicts worker"
  ${IINATAN_BUILD_PORTABLE_HOSHI_DEFAULT}
)

set(IINATAN_WINDOW_PROBE_SOURCES native/window_probe_main.cpp)
if(APPLE)
  enable_language(OBJCXX)
  list(APPEND IINATAN_WINDOW_PROBE_SOURCES native/window_probe_macos.mm)
elseif(WIN32)
  enable_language(RC)
  list(APPEND IINATAN_WINDOW_PROBE_SOURCES
    native/window_probe_windows.cpp
    native/window_probe_windows.rc
  )
else()
  list(APPEND IINATAN_WINDOW_PROBE_SOURCES native/window_probe_linux.cpp)
endif()

add_executable(iinatan-window-probe ${IINATAN_WINDOW_PROBE_SOURCES})
target_include_directories(iinatan-window-probe PRIVATE native)
set_target_properties(iinatan-window-probe PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
)

if(APPLE)
  find_library(APPKIT_FRAMEWORK AppKit REQUIRED)
  find_library(COREGRAPHICS_FRAMEWORK CoreGraphics REQUIRED)
  find_library(COREFOUNDATION_FRAMEWORK CoreFoundation REQUIRED)
  target_link_libraries(iinatan-window-probe PRIVATE ${APPKIT_FRAMEWORK} ${COREGRAPHICS_FRAMEWORK} ${COREFOUNDATION_FRAMEWORK})
elseif(WIN32)
  target_link_libraries(iinatan-window-probe PRIVATE user32)
else()
  find_package(X11 QUIET)
  if(X11_FOUND)
    target_compile_definitions(iinatan-window-probe PRIVATE IINATAN_HAS_X11=1)
    target_include_directories(iinatan-window-probe PRIVATE ${X11_INCLUDE_DIR})
    target_link_libraries(iinatan-window-probe PRIVATE ${X11_LIBRARIES})
  endif()
endif()

install(TARGETS iinatan-window-probe RUNTIME DESTINATION bin)

if(APPLE)
  add_executable(
    iinatan-desktop-test
    native/desktop_test_main.cpp
    native/desktop_test_macos.mm
  )
  target_include_directories(iinatan-desktop-test PRIVATE native)
  find_library(APPLICATIONSERVICES_FRAMEWORK ApplicationServices REQUIRED)
  find_library(CORESERVICES_FRAMEWORK CoreServices REQUIRED)
  find_library(IMAGEIO_FRAMEWORK ImageIO REQUIRED)
  target_link_libraries(
    iinatan-desktop-test
    PRIVATE
      ${APPLICATIONSERVICES_FRAMEWORK}
      ${APPKIT_FRAMEWORK}
      ${COREGRAPHICS_FRAMEWORK}
      ${CORESERVICES_FRAMEWORK}
      ${IMAGEIO_FRAMEWORK}
  )
  set_target_properties(iinatan-desktop-test PROPERTIES
    MACOSX_BUNDLE TRUE
    MACOSX_BUNDLE_BUNDLE_NAME "iinatan-desktop-test"
    MACOSX_BUNDLE_GUI_IDENTIFIER "com.iinatan.desktop-test"
    MACOSX_BUNDLE_SHORT_VERSION_STRING "0.1.0"
    MACOSX_BUNDLE_BUNDLE_VERSION "0.1.0"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
  )

  add_library(iinatan-mpv-window-shim MODULE native/mpv_window_shim_macos.mm)
  target_include_directories(iinatan-mpv-window-shim PRIVATE native)
  target_link_libraries(
    iinatan-mpv-window-shim
    PRIVATE
      ${APPKIT_FRAMEWORK}
      ${COREGRAPHICS_FRAMEWORK}
  )
  target_link_options(iinatan-mpv-window-shim PRIVATE "-undefined" "dynamic_lookup")
  set_target_properties(iinatan-mpv-window-shim PROPERTIES
    PREFIX ""
    # mpv's documented C-plugin loader recognizes .so/.dll script extensions;
    # the Mach-O module remains a native macOS dynamic library.
    SUFFIX ".so"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
  )

elseif(WIN32)
  add_executable(
    iinatan-desktop-test
    native/desktop_test_main.cpp
    native/desktop_test_windows.cpp
    native/png_writer.cpp
    native/window_probe_windows.rc
  )
  target_include_directories(iinatan-desktop-test PRIVATE native)
  target_link_libraries(iinatan-desktop-test PRIVATE user32 gdi32)
  set_target_properties(iinatan-desktop-test PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
  )

else()
  find_package(X11 REQUIRED)
  find_library(IINATAN_XTST_LIBRARY Xtst REQUIRED)
  add_executable(
    iinatan-desktop-test
    native/desktop_test_main.cpp
    native/desktop_test_x11.cpp
    native/png_writer.cpp
  )
  target_include_directories(iinatan-desktop-test PRIVATE native ${X11_INCLUDE_DIR})
  target_link_libraries(
    iinatan-desktop-test
    PRIVATE
      ${X11_LIBRARIES}
      ${IINATAN_XTST_LIBRARY}
  )
  set_target_properties(iinatan-desktop-test PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
  )
endif()

if(IINATAN_BUILD_PORTABLE_HOSHI)
  set(IINATAN_HOSHI_ARCHIVE
      "${CMAKE_SOURCE_DIR}/vendor/iina-hoshi-dicts-native-source.tar.gz")
  if(NOT EXISTS "${IINATAN_HOSHI_ARCHIVE}")
    message(FATAL_ERROR "portable HoshiDicts build requires ${IINATAN_HOSHI_ARCHIVE}")
  endif()
  file(SHA256 "${IINATAN_HOSHI_ARCHIVE}" IINATAN_HOSHI_ARCHIVE_SHA256)
  if(NOT IINATAN_HOSHI_ARCHIVE_SHA256 STREQUAL
    "77292ffd1aa3e2ecc0f99f7c1973040a8261ecf4111bda76a5f8238c139d7326")
    message(FATAL_ERROR "portable HoshiDicts source archive checksum is not the reviewed value")
  endif()

  set(IINATAN_HOSHI_STAGE "${CMAKE_BINARY_DIR}/portable-hoshi-source")
  set(IINATAN_HOSHI_ROOT "${IINATAN_HOSHI_STAGE}/iinatan-native-source")
  if(NOT EXISTS "${IINATAN_HOSHI_ROOT}/vendor/hoshidicts/CMakeLists.txt")
    file(MAKE_DIRECTORY "${IINATAN_HOSHI_STAGE}")
    execute_process(
      COMMAND "${CMAKE_COMMAND}" -E tar xzf "${IINATAN_HOSHI_ARCHIVE}"
      WORKING_DIRECTORY "${IINATAN_HOSHI_STAGE}"
      RESULT_VARIABLE IINATAN_HOSHI_EXTRACT_RESULT
    )
    if(NOT IINATAN_HOSHI_EXTRACT_RESULT EQUAL 0)
      message(FATAL_ERROR "could not extract the portable HoshiDicts source archive")
    endif()
  endif()

  # macOS archives can carry AppleDouble resource-fork entries.  Some Linux
  # libarchive builds materialize those entries as `._*` files, and zstd's
  # source glob then attempts to compile them as C.  They are metadata only.
  file(GLOB_RECURSE IINATAN_HOSHI_METADATA_FILES CONFIGURE_DEPENDS
    "${IINATAN_HOSHI_ROOT}/._*"
    "${IINATAN_HOSHI_ROOT}/.DS_Store"
  )
  if(IINATAN_HOSHI_METADATA_FILES)
    file(REMOVE ${IINATAN_HOSHI_METADATA_FILES})
  endif()

  add_subdirectory(
    "${IINATAN_HOSHI_ROOT}/vendor/hoshidicts"
    "${CMAKE_BINARY_DIR}/portable-hoshidicts"
  )
  add_executable(
    iina-hoshi-dicts
    native/portable_hoshi_main.cpp
    "${IINATAN_HOSHI_ROOT}/src/native/worker_protocol.cpp"
  )
  target_include_directories(
    iina-hoshi-dicts
    PRIVATE
      "${IINATAN_HOSHI_ROOT}/vendor/hoshidicts/include"
      "${IINATAN_HOSHI_ROOT}/vendor/hoshidicts/external/utfcpp/source"
      "${IINATAN_HOSHI_ROOT}/vendor/hoshidicts/external/xxHash"
      "${IINATAN_HOSHI_ROOT}/src/native"
      native
  )
  target_link_libraries(iina-hoshi-dicts PRIVATE hoshidicts)
  set_target_properties(
    iina-hoshi-dicts
    PROPERTIES
      RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
      RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}"
      RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}"
      RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}"
      RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}"
  )
  if(MSVC)
    target_compile_options(iina-hoshi-dicts PRIVATE /utf-8)
  endif()
endif()
