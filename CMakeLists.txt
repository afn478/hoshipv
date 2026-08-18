cmake_minimum_required(VERSION 3.22)
project(iinatan_backend VERSION 3.0.0 LANGUAGES C CXX)

include(FetchContent)

option(IINATAN_ENABLE_ASS "Enable libass geometry and text layout" ON)
option(IINATAN_ENABLE_HTTP "Enable libcurl HTTP service" ON)
option(IINATAN_ENABLE_AUDIO "Enable FFmpeg/miniaudio preview" ON)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_subdirectory(vendor/hoshidicts)

set(IINATAN_NATIVE_SOURCES
  src/native/iina_hoshi.cpp
  src/native/worker_protocol.cpp
  src/native/media_demux.cpp
  src/native/ass_geometry.cpp
  src/native/text_layout.cpp
  src/native/http_service.cpp
  src/native/audio_preview.cpp
  src/native/bitmap_subtitle.cpp
  src/native/platform_posix.cpp
  src/native/platform_windows.cpp
)

if(APPLE)
  enable_language(OBJCXX)
  list(APPEND IINATAN_NATIVE_SOURCES src/native/vision_ocr.mm)
else()
  list(APPEND IINATAN_NATIVE_SOURCES src/native/vision_ocr_stub.cpp)
endif()

add_executable(iinatan-backend ${IINATAN_NATIVE_SOURCES})
target_include_directories(iinatan-backend PRIVATE
  src/native
  vendor/hoshidicts/src
)
target_link_libraries(iinatan-backend PRIVATE hoshidicts)

if(IINATAN_ENABLE_ASS)
  set(IINATAN_GEOMETRY_STAGE "${CMAKE_SOURCE_DIR}/build/native-geometry-deps/stage")
  find_path(LIBASS_INCLUDE_DIR ass/ass.h HINTS "${IINATAN_GEOMETRY_STAGE}/include" /opt/homebrew/include /usr/local/include)
  if(EXISTS "${IINATAN_GEOMETRY_STAGE}/lib/libass.a")
    set(LIBASS_LIBRARY "${IINATAN_GEOMETRY_STAGE}/lib/libass.a")
  else()
    find_library(LIBASS_LIBRARY ass REQUIRED)
  endif()
  set(UTF8PROC_INCLUDE_DIR "${CMAKE_SOURCE_DIR}/vendor/hoshidicts/external/utf8proc")
  if(NOT LIBASS_INCLUDE_DIR OR NOT LIBASS_LIBRARY OR NOT EXISTS "${UTF8PROC_INCLUDE_DIR}/utf8proc.h")
    message(FATAL_ERROR "libass and utf8proc development files are required")
  endif()
  target_compile_definitions(iinatan-backend PRIVATE IINATAN_ASS_GEOMETRY=1)
  target_include_directories(iinatan-backend PRIVATE ${LIBASS_INCLUDE_DIR} ${UTF8PROC_INCLUDE_DIR} "${IINATAN_GEOMETRY_STAGE}/include")
  target_link_libraries(iinatan-backend PRIVATE utf8proc)
  if(WIN32)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(IINATAN_LIBASS REQUIRED IMPORTED_TARGET libass)
    pkg_check_modules(IINATAN_FFMPEG REQUIRED IMPORTED_TARGET
      libavformat libavcodec libavutil libswresample)
    target_link_libraries(iinatan-backend PRIVATE
      PkgConfig::IINATAN_LIBASS
      PkgConfig::IINATAN_FFMPEG)
  else()
    target_link_libraries(iinatan-backend PRIVATE ${LIBASS_LIBRARY})
    foreach(IINATAN_DEP harfbuzz fribidi unibreak freetype avformat avcodec avutil z)
      if(EXISTS "${IINATAN_GEOMETRY_STAGE}/lib/lib${IINATAN_DEP}.a")
        set(IINATAN_${IINATAN_DEP}_LIBRARY "${IINATAN_GEOMETRY_STAGE}/lib/lib${IINATAN_DEP}.a")
      else()
        find_library(IINATAN_${IINATAN_DEP}_LIBRARY ${IINATAN_DEP} REQUIRED)
      endif()
      target_link_libraries(iinatan-backend PRIVATE ${IINATAN_${IINATAN_DEP}_LIBRARY})
    endforeach()
  endif()
  if(APPLE)
    target_link_libraries(iinatan-backend PRIVATE "-framework CoreServices" "-framework Security" iconv bz2)
  endif()
endif()

if(IINATAN_ENABLE_HTTP)
  find_package(CURL REQUIRED)
  target_compile_definitions(iinatan-backend PRIVATE IINATAN_HTTP=1)
  target_link_libraries(iinatan-backend PRIVATE CURL::libcurl)
endif()

if(IINATAN_ENABLE_AUDIO)
  FetchContent_Declare(
    miniaudio
    GIT_REPOSITORY https://github.com/mackron/miniaudio.git
    GIT_TAG 0.11.22
    GIT_SHALLOW TRUE
  )
  FetchContent_MakeAvailable(miniaudio)
  target_include_directories(iinatan-backend PRIVATE ${miniaudio_SOURCE_DIR})
  target_compile_definitions(iinatan-backend PRIVATE IINATAN_AUDIO_PREVIEW=1)
  if(WIN32)
    set(IINATAN_SWRESAMPLE_LIBRARY "")
  elseif(EXISTS "${IINATAN_GEOMETRY_STAGE}/lib/libswresample.a")
    set(IINATAN_SWRESAMPLE_LIBRARY "${IINATAN_GEOMETRY_STAGE}/lib/libswresample.a")
  else()
    find_library(IINATAN_SWRESAMPLE_LIBRARY swresample REQUIRED)
  endif()
  if(NOT WIN32 AND NOT IINATAN_SWRESAMPLE_LIBRARY)
    message(FATAL_ERROR "FFmpeg libswresample is required for audio preview")
  endif()
  if(IINATAN_SWRESAMPLE_LIBRARY)
    target_link_libraries(iinatan-backend PRIVATE ${IINATAN_SWRESAMPLE_LIBRARY})
  endif()
  if(UNIX AND NOT APPLE)
    target_link_libraries(iinatan-backend PRIVATE dl pthread m)
  endif()
endif()

if(APPLE)
  find_library(CORETEXT_FRAMEWORK CoreText REQUIRED)
  find_library(COREFOUNDATION_FRAMEWORK CoreFoundation REQUIRED)
  find_library(FOUNDATION_FRAMEWORK Foundation REQUIRED)
  find_library(VISION_FRAMEWORK Vision REQUIRED)
  find_library(COREGRAPHICS_FRAMEWORK CoreGraphics REQUIRED)
  find_library(IMAGEIO_FRAMEWORK ImageIO REQUIRED)
  target_link_libraries(iinatan-backend PRIVATE ${CORETEXT_FRAMEWORK} ${COREFOUNDATION_FRAMEWORK} ${FOUNDATION_FRAMEWORK} ${VISION_FRAMEWORK} ${COREGRAPHICS_FRAMEWORK} ${IMAGEIO_FRAMEWORK})
  set_source_files_properties(src/native/vision_ocr.mm PROPERTIES COMPILE_FLAGS "-fobjc-arc")
endif()

install(TARGETS iinatan-backend RUNTIME DESTINATION bin)
