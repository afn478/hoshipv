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

set(
  IINATAN_NATIVE_GEOMETRY_STAGE
  "${CMAKE_BINARY_DIR}/native-geometry-deps/stage"
  CACHE PATH "Prefix containing the pinned private libass geometry dependencies"
)
if(APPLE)
  set(IINATAN_BUILD_PORTABLE_HOSHI_DEFAULT OFF)
  set(IINATAN_BUILD_PORTABLE_GEOMETRY_DEFAULT OFF)
elseif(EXISTS "${IINATAN_NATIVE_GEOMETRY_STAGE}/include/ass/ass.h")
  # A prepared dependency stage opts the non-Apple build into the helper by
  # default.  Ordinary window-probe builds remain useful before that stage
  # exists; packaging must pass the option explicitly and validate the result.
  set(IINATAN_BUILD_PORTABLE_HOSHI_DEFAULT ON)
  set(IINATAN_BUILD_PORTABLE_GEOMETRY_DEFAULT ON)
else()
  set(IINATAN_BUILD_PORTABLE_HOSHI_DEFAULT ON)
  set(IINATAN_BUILD_PORTABLE_GEOMETRY_DEFAULT OFF)
endif()
option(
  IINATAN_BUILD_PORTABLE_HOSHI
  "Build the portable dictionary-only HoshiDicts worker"
  ${IINATAN_BUILD_PORTABLE_HOSHI_DEFAULT}
)
option(
  IINATAN_BUILD_PORTABLE_GEOMETRY
  "Build the private instrumented libass geometry helper"
  ${IINATAN_BUILD_PORTABLE_GEOMETRY_DEFAULT}
)
set(
  IINATAN_ASS_GEOMETRY_PATCH
  "libass-0.17.5-iinatan-unit-ids-v2"
  CACHE STRING "Patch identity reported by the private geometry helper"
)
option(
  IINATAN_BUILD_DESKTOP_TEST
  "Build the native desktop interaction test executable"
  ON
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
if(WIN32 AND MSVC)
  # The Windows resource file embeds the reviewed DPI-awareness manifest.
  # Disable CMake/MSVC's second auto-generated manifest to avoid duplicate
  # RT_MANIFEST resources at link time.
  target_link_options(iinatan-window-probe PRIVATE "/MANIFEST:NO")
elseif(WIN32 AND MINGW)
  # The probe is launched on a user's machine without the builder's MinGW
  # runtime on PATH, so keep it self-contained like the geometry helper.
  target_link_options(iinatan-window-probe PRIVATE
    -static -static-libgcc -static-libstdc++)
endif()
set_target_properties(iinatan-window-probe PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
)

if(APPLE)
  find_library(APPKIT_FRAMEWORK AppKit REQUIRED)
  find_library(COREGRAPHICS_FRAMEWORK CoreGraphics REQUIRED)
  find_library(COREFOUNDATION_FRAMEWORK CoreFoundation REQUIRED)
  target_link_libraries(iinatan-window-probe PRIVATE ${APPKIT_FRAMEWORK} ${COREGRAPHICS_FRAMEWORK} ${COREFOUNDATION_FRAMEWORK})
elseif(WIN32)
  target_link_libraries(iinatan-window-probe PRIVATE user32 dwmapi)
else()
  find_package(X11 QUIET)
  if(X11_FOUND)
    target_compile_definitions(iinatan-window-probe PRIVATE IINATAN_HAS_X11=1)
    target_include_directories(iinatan-window-probe PRIVATE ${X11_INCLUDE_DIR})
    target_link_libraries(iinatan-window-probe PRIVATE ${X11_LIBRARIES})
  endif()
endif()

install(TARGETS iinatan-window-probe RUNTIME DESTINATION bin)

if(IINATAN_BUILD_DESKTOP_TEST AND APPLE)
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

elseif(IINATAN_BUILD_DESKTOP_TEST AND WIN32)
  add_executable(
    iinatan-desktop-test
    native/desktop_test_main.cpp
    native/desktop_test_windows.cpp
    native/png_writer.cpp
    native/window_probe_windows.rc
  )
  target_include_directories(iinatan-desktop-test PRIVATE native)
  target_link_libraries(iinatan-desktop-test PRIVATE user32 gdi32)
  if(MSVC)
    target_link_options(iinatan-desktop-test PRIVATE "/MANIFEST:NO")
  elseif(MINGW)
    target_link_options(iinatan-desktop-test PRIVATE
      -static -static-libgcc -static-libstdc++)
  endif()
  set_target_properties(iinatan-desktop-test PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
  )

elseif(IINATAN_BUILD_DESKTOP_TEST)
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

if(IINATAN_BUILD_PORTABLE_HOSHI OR IINATAN_BUILD_PORTABLE_GEOMETRY)
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
  file(GLOB_RECURSE IINATAN_HOSHI_METADATA_FILES
    "${IINATAN_HOSHI_ROOT}/._*"
    "${IINATAN_HOSHI_ROOT}/.DS_Store"
  )
  if(IINATAN_HOSHI_METADATA_FILES)
    file(REMOVE ${IINATAN_HOSHI_METADATA_FILES})
  endif()

  if(IINATAN_BUILD_PORTABLE_HOSHI)
    add_subdirectory(
      "${IINATAN_HOSHI_ROOT}/vendor/hoshidicts"
      "${CMAKE_BINARY_DIR}/portable-hoshidicts"
    )
  endif()
endif()

if(IINATAN_BUILD_PORTABLE_HOSHI)
  add_executable(
    iina-hoshi-dicts
    native/portable_hoshi_main.cpp
    "${IINATAN_HOSHI_ROOT}/src/native/worker_protocol.cpp"
  )
  if(WIN32)
    target_sources(iina-hoshi-dicts PRIVATE native/windows_controller.cpp)
  endif()
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
  if(WIN32)
    target_link_libraries(iina-hoshi-dicts PRIVATE winmm)
  endif()
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
    # MSVC keeps __cplusplus at its legacy value unless this switch is
    # enabled.  utf8cpp selects its C++17/20 string overloads from that
    # macro, so without it the portable worker builds on Clang but fails on
    # Windows with missing utf8to32/utf32to8 overloads.
    target_compile_options(hoshidicts PRIVATE /Zc:__cplusplus)
    target_compile_options(iina-hoshi-dicts PRIVATE /utf-8 /Zc:__cplusplus)
  endif()
endif()

if(IINATAN_BUILD_PORTABLE_GEOMETRY)
  foreach(required_file
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/include/ass/ass.h"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/include/libavformat/avformat.h"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libass.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libavformat.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libavcodec.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libavutil.a")
    if(NOT EXISTS "${required_file}")
      message(FATAL_ERROR
        "private geometry dependency is missing: ${required_file}; "
        "run scripts/build-native-geometry.sh first")
    endif()
  endforeach()

  add_executable(
    iinatan-native-geometry
    native/portable_geometry_main.cpp
    native/portable_geometry_media_demux.cpp
    "${IINATAN_HOSHI_ROOT}/src/native/worker_protocol.cpp"
    "${IINATAN_HOSHI_ROOT}/src/native/ass_geometry.cpp"
  )
  target_compile_definitions(
    iinatan-native-geometry
    PRIVATE
      IINATAN_ASS_GEOMETRY=1
      IINATAN_ASS_GEOMETRY_PATCH=\"${IINATAN_ASS_GEOMETRY_PATCH}\"
  )
  target_include_directories(
    iinatan-native-geometry
    PRIVATE
      "${IINATAN_HOSHI_ROOT}/src/native"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/include"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/include/freetype2"
  )
  target_link_libraries(
    iinatan-native-geometry
    PRIVATE
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libavformat.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libavcodec.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libavutil.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libass.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libharfbuzz.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libfribidi.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libunibreak.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libfreetype.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libz.a"
  )
  if(WIN32)
    target_link_libraries(iinatan-native-geometry PRIVATE
      dwrite uuid ole32 user32 gdi32 ws2_32 bcrypt secur32 advapi32)
  else()
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(IINATAN_FONTCONFIG REQUIRED IMPORTED_TARGET fontconfig)
    find_package(Threads REQUIRED)
    target_link_libraries(iinatan-native-geometry PRIVATE
      PkgConfig::IINATAN_FONTCONFIG
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libfontconfig.a"
      "${IINATAN_NATIVE_GEOMETRY_STAGE}/lib/libexpat.a"
      Threads::Threads
      ${CMAKE_DL_LIBS}
      m
    )
  endif()
  if(MSVC)
    target_compile_options(iinatan-native-geometry PRIVATE /utf-8)
    target_link_options(iinatan-native-geometry PRIVATE "/MANIFEST:NO")
  elseif(MINGW)
    # The helper is shipped as one executable.  Do not make the packaged
    # runtime depend on the MinGW GCC, C++ or pthread DLLs used by the builder.
    target_link_options(iinatan-native-geometry PRIVATE
      -static -static-libgcc -static-libstdc++)
  endif()
  set_target_properties(
    iinatan-native-geometry
    PROPERTIES
      RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
      RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Debug"
      RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
      RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}/RelWithDebInfo"
      RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}/MinSizeRel"
  )
  install(TARGETS iinatan-native-geometry RUNTIME DESTINATION bin)
endif()
