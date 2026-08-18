cmake_minimum_required(VERSION 3.22)
project(iinatan_backend VERSION 3.0.0 LANGUAGES C CXX)

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
  src/native/bitmap_subtitle.cpp
)

if(APPLE)
  enable_language(OBJCXX)
  list(APPEND IINATAN_NATIVE_SOURCES src/native/vision_ocr.mm)
else()
  list(APPEND IINATAN_NATIVE_SOURCES src/native/vision_ocr_stub.cpp)
endif()

add_executable(iinatan-backend ${IINATAN_NATIVE_SOURCES})
target_include_directories(iinatan-backend PRIVATE src/native)
target_link_libraries(iinatan-backend PRIVATE hoshidicts)

if(IINATAN_ENABLE_ASS)
  set(IINATAN_GEOMETRY_STAGE "${CMAKE_SOURCE_DIR}/build/native-geometry-deps/stage")
  find_path(LIBASS_INCLUDE_DIR ass/ass.h HINTS "${IINATAN_GEOMETRY_STAGE}/include" /opt/homebrew/include /usr/local/include)
  find_library(LIBASS_LIBRARY ass HINTS "${IINATAN_GEOMETRY_STAGE}/lib" /opt/homebrew/lib /usr/local/lib NO_DEFAULT_PATH)
  set(UTF8PROC_INCLUDE_DIR "${CMAKE_SOURCE_DIR}/vendor/hoshidicts/external/utf8proc")
  if(NOT LIBASS_INCLUDE_DIR OR NOT LIBASS_LIBRARY OR NOT EXISTS "${UTF8PROC_INCLUDE_DIR}/utf8proc.h")
    message(FATAL_ERROR "libass and utf8proc development files are required")
  endif()
  target_compile_definitions(iinatan-backend PRIVATE IINATAN_ASS_GEOMETRY=1)
  target_include_directories(iinatan-backend PRIVATE ${LIBASS_INCLUDE_DIR} ${UTF8PROC_INCLUDE_DIR})
  target_link_libraries(iinatan-backend PRIVATE ${LIBASS_LIBRARY} utf8proc)
  foreach(IINATAN_DEP harfbuzz fribidi unibreak freetype avformat avcodec avutil z)
    find_library(IINATAN_${IINATAN_DEP}_LIBRARY ${IINATAN_DEP} HINTS "${IINATAN_GEOMETRY_STAGE}/lib" /opt/homebrew/lib /usr/local/lib)
    if(IINATAN_${IINATAN_DEP}_LIBRARY)
      target_link_libraries(iinatan-backend PRIVATE ${IINATAN_${IINATAN_DEP}_LIBRARY})
    endif()
  endforeach()
  if(APPLE)
    target_link_libraries(iinatan-backend PRIVATE "-framework CoreServices" "-framework Security" iconv bz2)
  endif()
endif()

if(IINATAN_ENABLE_HTTP)
  find_package(CURL REQUIRED)
  target_compile_definitions(iinatan-backend PRIVATE IINATAN_HTTP=1)
  target_link_libraries(iinatan-backend PRIVATE CURL::libcurl)
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
