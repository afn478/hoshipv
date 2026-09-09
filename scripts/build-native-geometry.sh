#!/usr/bin/env bash
set -euo pipefail

# Build the private instrumented libass helper from the corresponding-source
# bundle.  The script deliberately builds the helper separately from the
# dictionary worker: geometry is an independent capability and must never be
# satisfied by a dictionary-only executable.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)}"
case "$TARGET" in
  linux-x86_64|linux-amd64) TARGET="linux-x86_64" ;;
  windows-x86_64|windows-amd64|mingw-x86_64) TARGET="windows-x86_64" ;;
  *)
    echo "usage: $0 linux-x86_64|windows-x86_64" >&2
    exit 2
    ;;
esac

ARCHIVE="$ROOT/vendor/iina-hoshi-dicts-native-source.tar.gz"
ARCHIVE_SHA256="77292ffd1aa3e2ecc0f99f7c1973040a8261ecf4111bda76a5f8238c139d7326"
BUILD_ROOT="${IINATAN_NATIVE_BUILD_ROOT:-$ROOT/build/native-geometry-$TARGET}"
SOURCE_ROOT="$BUILD_ROOT/iinatan-native-source"
UPSTREAM="$SOURCE_ROOT/upstream"
SOURCES="$BUILD_ROOT/sources"
STAGE="$BUILD_ROOT/stage"
TOOLS="$BUILD_ROOT/tools"
PATCHES="$SOURCE_ROOT/patches"
JOBS="${IINATAN_NATIVE_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"

LIBASS_PROFILE="${IINATAN_LIBASS_PROFILE:-default}"
case "$LIBASS_PROFILE" in
  default)
    LIBASS_VERSION="0.17.5"
    LIBASS_PATCH_FILE="$PATCHES/libass-0.17.5-iinatan-unit-ids.patch"
    LIBASS_PATCH_NAME="libass-0.17.5-iinatan-unit-ids-v2"
    LIBASS_ENVELOPE_PATCH_FILE="$PATCHES/libass-0.17.5-iinatan-envelope-v1.patch"
    LIBASS_ENVELOPE_PATCH_NAME="libass-0.17.5-iinatan-envelope-v1"
    LIBASS_SOURCE_MODE="corresponding-archive"
    LIBASS_SOURCE_URL=""
    LIBASS_SOURCE_SHA256=""
    ;;
  windows-mpv-0.41.0-libass-0.17.4-external-subrip)
    if [[ "$TARGET" != "windows-x86_64" ]]; then
      echo "$LIBASS_PROFILE is only valid for windows-x86_64" >&2
      exit 2
    fi
    LIBASS_VERSION="0.17.4"
    LIBASS_PATCH_FILE="$ROOT/native/patches/libass-0.17.4-iinatan-geometry-v2.patch"
    LIBASS_PATCH_NAME="libass-0.17.4-iinatan-geometry-v2"
    LIBASS_ENVELOPE_PATCH_FILE=""
    LIBASS_ENVELOPE_PATCH_NAME="combined-with-unit-id-patch"
    LIBASS_SOURCE_MODE="locked-download"
    LIBASS_SOURCE_URL="https://github.com/libass/libass/releases/download/0.17.4/libass-0.17.4.tar.xz"
    LIBASS_SOURCE_SHA256="78f1179b838d025e9c26e8fef33f8092f65611444ffa1bfc0cfac6a33511a05"
    ;;
  *)
    echo "unknown IINATAN_LIBASS_PROFILE: $LIBASS_PROFILE" >&2
    exit 2
    ;;
esac

if [[ ! -f "$ARCHIVE" ]]; then
  echo "missing corresponding-source archive: $ARCHIVE" >&2
  exit 2
fi
actual_archive_sha256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
if [[ "$actual_archive_sha256" != "$ARCHIVE_SHA256" ]]; then
  echo "source archive checksum mismatch" >&2
  exit 2
fi

if [[ ! -f "$SOURCE_ROOT/vendor/hoshidicts/CMakeLists.txt" ]]; then
  rm -rf "$SOURCE_ROOT"
  mkdir -p "$BUILD_ROOT"
  if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]] &&
     command -v 7z >/dev/null 2>&1; then
    # Windows' libarchive tar cannot materialize a few symlink entries from
    # the corresponding-source bundle.  7-Zip preserves the source tree and
    # avoids treating macOS extended-header metadata as files.
    local_archive_dir="$BUILD_ROOT/.source-archive"
    rm -rf "$local_archive_dir"
    mkdir -p "$local_archive_dir"
    7z x "$ARCHIVE" "-o$local_archive_dir" -y >/dev/null
    7z x "$local_archive_dir/iina-hoshi-dicts-native-source.tar" \
      "-o$BUILD_ROOT" -y >/dev/null
  else
    tar -xzf "$ARCHIVE" -C "$BUILD_ROOT"
  fi
fi

find "$SOURCE_ROOT" -type f \( -name '._*' -o -name '.DS_Store' \) -delete

rm -rf "$SOURCES" "$STAGE" "$TOOLS" "$BUILD_ROOT/build" "$BUILD_ROOT/helper"
mkdir -p "$SOURCES" "$STAGE" "$TOOLS" "$BUILD_ROOT/build"

extract_source() {
  local name="$1"
  local archive="$UPSTREAM/$2"
  local destination="$SOURCES/$name"
  mkdir -p "$destination"
  tar -xf "$archive" -C "$destination" --strip-components=1
}

extract_source_archive() {
  local name="$1"
  local archive="$2"
  local destination="$SOURCES/$name"
  mkdir -p "$destination"
  tar -xf "$archive" -C "$destination" --strip-components=1
}

extract_source pkgconf pkgconf-3.0.7.tar.xz
extract_source zlib zlib-1.3.2.tar.gz
extract_source freetype freetype-2.14.3.tar.xz
extract_source fribidi fribidi-1.0.16.tar.xz
extract_source harfbuzz harfbuzz-14.4.0.tar.xz
extract_source libunibreak libunibreak-7.0.tar.gz
extract_source ffmpeg ffmpeg-9.0.1.tar.xz

if [[ "$LIBASS_SOURCE_MODE" == "corresponding-archive" ]]; then
  extract_source libass "libass-$LIBASS_VERSION.tar.xz"
else
  LIBASS_DOWNLOAD="$BUILD_ROOT/downloads/libass-$LIBASS_VERSION.tar.xz"
  mkdir -p "$(dirname "$LIBASS_DOWNLOAD")"
  if [[ ! -f "$LIBASS_DOWNLOAD" ]]; then
    if command -v curl >/dev/null 2>&1; then
      curl --fail --location --retry 3 --output "$LIBASS_DOWNLOAD" "$LIBASS_SOURCE_URL"
    elif command -v wget >/dev/null 2>&1; then
      wget --tries=3 --output-document="$LIBASS_DOWNLOAD" "$LIBASS_SOURCE_URL"
    else
      echo "a downloader is required for the locked libass compatibility source" >&2
      exit 2
    fi
  fi
  printf '%s  %s\n' "$LIBASS_SOURCE_SHA256" "$LIBASS_DOWNLOAD" | sha256sum -c -
  extract_source_archive libass "$LIBASS_DOWNLOAD"
fi

patch -d "$SOURCES/libass" -p1 < "$LIBASS_PATCH_FILE"
if [[ -n "$LIBASS_ENVELOPE_PATCH_FILE" ]]; then
  patch -d "$SOURCES/libass" -p1 < "$LIBASS_ENVELOPE_PATCH_FILE"
fi

if [[ "$TARGET" == "windows-x86_64" ]]; then
  : "${CROSS_PREFIX:=x86_64-w64-mingw32-}"
  CC="${CROSS_PREFIX}gcc"
  CXX="${CROSS_PREFIX}g++"
  AR="${CROSS_PREFIX}ar"
  if ! command -v "$AR" >/dev/null 2>&1; then
    AR=ar
  fi
  RANLIB="${CROSS_PREFIX}ranlib"
  if ! command -v "$RANLIB" >/dev/null 2>&1; then
    RANLIB=ranlib
  fi
  STRIP="${CROSS_PREFIX}strip"
  if ! command -v "$STRIP" >/dev/null 2>&1; then
    STRIP=strip
  fi
  RC="${CROSS_PREFIX}windres"
  if ! command -v "$RC" >/dev/null 2>&1; then
    RC=windres
  fi
  HOST="${CROSS_PREFIX%-}"
  TARGET_OS="mingw32"
  ARCH="x86_64"
  TOOLCHAIN="$BUILD_ROOT/toolchain.cmake"
  CMAKE_STAGE_PATH="$(cygpath -m "$STAGE")"
  cat > "$TOOLCHAIN" <<EOF
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER ${CC})
set(CMAKE_CXX_COMPILER ${CXX})
set(CMAKE_RC_COMPILER ${RC})
set(CMAKE_FIND_ROOT_PATH "$CMAKE_STAGE_PATH")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
EOF
  CMAKE_TOOLCHAIN="-DCMAKE_TOOLCHAIN_FILE=$(cygpath -m "$TOOLCHAIN")"
  PLATFORM_CFLAGS="-O2 -fvisibility=hidden"
  PLATFORM_LDFLAGS="-static-libgcc -static-libstdc++"
  CONFIGURE_HOST=(--host="$HOST")
  FFMPEG_CROSS_ARGS=(--enable-cross-compile --cross-prefix="$CROSS_PREFIX")
else
  CC="${CC:-cc}"
  CXX="${CXX:-c++}"
  AR="${AR:-ar}"
  RANLIB="${RANLIB:-ranlib}"
  STRIP="${STRIP:-strip}"
  HOST=""
  TARGET_OS="linux"
  ARCH="x86_64"
  TOOLCHAIN=""
  CMAKE_TOOLCHAIN=""
  CMAKE_STAGE_PATH="$STAGE"
  PLATFORM_CFLAGS="-O2 -fvisibility=hidden"
  PLATFORM_LDFLAGS=""
  CONFIGURE_HOST=()
  FFMPEG_CROSS_ARGS=()
fi

export CC CXX AR RANLIB
export PATH="$TOOLS/bin:$PATH"
export PKG_CONFIG="$TOOLS/bin/pkgconf"
export PKG_CONFIG_PATH="$STAGE/lib/pkgconfig:$STAGE/share/pkgconfig"
export CPPFLAGS="-I$STAGE/include -I$STAGE/include/freetype2 ${IINATAN_CPPFLAGS:-}"
export LDFLAGS="-L$STAGE/lib ${IINATAN_LDFLAGS:-}"
export CFLAGS="$PLATFORM_CFLAGS ${IINATAN_CFLAGS:-}"
export CXXFLAGS="$PLATFORM_CFLAGS ${IINATAN_CXXFLAGS:-}"

MAKE_SHELL_ARGS=()
if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; then
  # Native MinGW make resolves /bin/sh to Git's installation path.  When Git
  # is installed below a directory containing spaces, MinGW make emits that
  # path without quoting it.  Give it an equivalent shell at a workspace path.
  native_shell="${IINATAN_NATIVE_SHELL:-$BUILD_ROOT/iinatan-msys-sh.exe}"
  if [[ -z "${IINATAN_NATIVE_SHELL:-}" ]]; then
    cp "$(command -v sh.exe || command -v sh)" "$native_shell"
  fi
  MAKE_SHELL_ARGS=(SHELL="$native_shell")
fi

run_make() {
  make "${MAKE_SHELL_ARGS[@]}" "$@"
}

build_cmake() {
  local name="$1"
  local source="$2"
  shift 2
  cmake -S "$source" -B "$BUILD_ROOT/build/$name" \
    -G "${IINATAN_CMAKE_GENERATOR:-Unix Makefiles}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$CMAKE_STAGE_PATH" \
    -DBUILD_SHARED_LIBS=OFF \
    $CMAKE_TOOLCHAIN "$@"
  cmake --build "$BUILD_ROOT/build/$name" --config Release --parallel "$JOBS"
  cmake --install "$BUILD_ROOT/build/$name" --config Release
}

(
  cd "$SOURCES/pkgconf"
  if [[ "$TARGET" == "windows-x86_64" ]]; then
    # pkgconf is a build-time tool.  Build it for the MSYS host so it can run
    # while the remaining libraries are cross-compiled for Windows.
    CPPFLAGS="$CPPFLAGS -DPKGCONFIG_IS_STATIC" \
      CC=gcc CXX=g++ AR=ar RANLIB=ranlib \
      ./configure --prefix="$TOOLS" --disable-shared --enable-static
  else
    ./configure --prefix="$TOOLS" --disable-shared --enable-static
  fi
  if [[ "$TARGET" == "windows-x86_64" ]]; then
    MSYS2_ARG_CONV_EXCL="${IINATAN_MSYS_ARG_CONV_EXCL:--D}" \
      run_make -j "$JOBS"
    MSYS2_ARG_CONV_EXCL="${IINATAN_MSYS_ARG_CONV_EXCL:--D}" \
      run_make install
  else
    run_make -j "$JOBS"
    run_make install
  fi
)

if [[ "$TARGET" == "linux-x86_64" ]]; then
  # Fontconfig is the Linux system font-provider adapter.  The helper still
  # links its own pinned libass/FreeType/HarfBuzz stack; this input supplies
  # the provider headers and archive without requiring a development package
  # on the end user's machine.  A staged Debian package root is convenient
  # for reproducible builders, while a normal system development install is
  # also accepted.
  if [[ -n "${IINATAN_FONTCONFIG_ROOT:-}" ]]; then
    fontconfig_root="$IINATAN_FONTCONFIG_ROOT"
    if [[ ! -f "$fontconfig_root/usr/include/fontconfig/fontconfig.h" ||
          ! -f "$fontconfig_root/usr/lib/x86_64-linux-gnu/libfontconfig.a" ]]; then
      echo "IINATAN_FONTCONFIG_ROOT does not contain the Fontconfig development files" >&2
      exit 2
    fi
    mkdir -p "$STAGE/include" "$STAGE/lib/pkgconfig"
    cp -R "$fontconfig_root/usr/include/fontconfig" "$STAGE/include/"
    cp "$fontconfig_root/usr/lib/x86_64-linux-gnu/libfontconfig.a" "$STAGE/lib/"
    if [[ -f "$fontconfig_root/usr/lib/x86_64-linux-gnu/pkgconfig/fontconfig.pc" ]]; then
      cp "$fontconfig_root/usr/lib/x86_64-linux-gnu/pkgconfig/fontconfig.pc" \
        "$STAGE/lib/pkgconfig/"
    fi
    if [[ -n "${IINATAN_EXPAT_ROOT:-}" ]]; then
      cp "$IINATAN_EXPAT_ROOT/usr/include/expat.h" "$STAGE/include/"
      cp "$IINATAN_EXPAT_ROOT/usr/include/expat_external.h" "$STAGE/include/"
      cp "$IINATAN_EXPAT_ROOT/usr/lib/x86_64-linux-gnu/libexpat.a" "$STAGE/lib/"
      if [[ -f "$IINATAN_EXPAT_ROOT/usr/lib/x86_64-linux-gnu/pkgconfig/expat.pc" ]]; then
        cp "$IINATAN_EXPAT_ROOT/usr/lib/x86_64-linux-gnu/pkgconfig/expat.pc" \
          "$STAGE/lib/pkgconfig/"
      fi
    fi
    # The Ubuntu metadata names the system prefix.  Rewrite it to the staged
    # prefix so CMake and the libass configure test cannot accidentally bind
    # to an unreviewed provider archive.
    if [[ -f "$STAGE/lib/pkgconfig/fontconfig.pc" ]]; then
      sed -i \
        -e "s|^prefix=.*|prefix=$STAGE|" \
        -e 's|^exec_prefix=.*|exec_prefix=${prefix}|' \
        -e 's|^libdir=.*|libdir=${prefix}/lib|' \
        -e 's|^includedir=.*|includedir=${prefix}/include|' \
        "$STAGE/lib/pkgconfig/fontconfig.pc"
    fi
  fi
fi

build_cmake zlib "$SOURCES/zlib" \
  -DZLIB_BUILD_TESTING=OFF \
  -DZLIB_BUILD_SHARED=OFF \
  -DZLIB_BUILD_STATIC=ON

# zlib's CMake install target is named `zs` on MinGW, while the pkg-config
# metadata and the native helper link line use the conventional libz name.
if [[ ! -f "$STAGE/lib/libz.a" && -f "$STAGE/lib/libzs.a" ]]; then
  cp "$STAGE/lib/libzs.a" "$STAGE/lib/libz.a"
fi

build_cmake freetype "$SOURCES/freetype" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DFT_DISABLE_BZIP2=TRUE \
  -DFT_DISABLE_BROTLI=TRUE \
  -DFT_DISABLE_HARFBUZZ=TRUE \
  -DFT_DISABLE_PNG=TRUE \
  -DFT_DISABLE_ZLIB=FALSE \
  -DZLIB_ROOT="$STAGE" \
  -DZLIB_LIBRARY="$STAGE/lib/libz.a" \
  -DZLIB_INCLUDE_DIR="$STAGE/include"

(
  cd "$SOURCES/fribidi"
  ./configure --prefix="$STAGE" "${CONFIGURE_HOST[@]}" \
    --disable-shared --enable-static --disable-deprecated \
    --disable-docs --disable-debug
  run_make -j "$JOBS"
  run_make install
)

build_cmake harfbuzz "$SOURCES/harfbuzz" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DHB_BUILD_UTILS=OFF \
  -DHB_BUILD_SUBSET=OFF \
  -DHB_BUILD_TESTS=OFF \
  -DHB_HAVE_FREETYPE=ON \
  -DFREETYPE_INCLUDE_DIRS="$STAGE/include/freetype2" \
  -DFREETYPE_LIBRARY="$STAGE/lib/libfreetype.a" \
  -DZLIB_ROOT="$STAGE"

(
  cd "$SOURCES/libunibreak"
  ./configure --prefix="$STAGE" "${CONFIGURE_HOST[@]}" \
    --disable-shared --enable-static
  run_make -j "$JOBS"
  run_make install
)

if [[ "$TARGET" == "linux-x86_64" ]] &&
   ! "$TOOLS/bin/pkgconf" --exists fontconfig; then
  echo "Linux geometry builds require Fontconfig development metadata; set IINATAN_FONTCONFIG_ROOT or install it" >&2
  exit 2
fi

if [[ "$TARGET" == "windows-x86_64" ]]; then
  LIBASS_FONT_FLAGS=(--disable-fontconfig --enable-directwrite)
else
  LIBASS_FONT_FLAGS=(--enable-fontconfig --disable-directwrite)
fi
(
  cd "$SOURCES/libass"
  ./configure --prefix="$STAGE" "${CONFIGURE_HOST[@]}" \
    --disable-shared --enable-static --disable-test --disable-profile \
    --enable-libunibreak --disable-asm "${LIBASS_FONT_FLAGS[@]}"
  run_make -j "$JOBS"
  run_make install
)

(
  cd "$SOURCES/ffmpeg"
  ./configure --prefix="$STAGE" --cc="$CC" --ar="$AR" \
    --ranlib="$RANLIB" --arch="$ARCH" --target-os="$TARGET_OS" \
    "${FFMPEG_CROSS_ARGS[@]}" \
    --disable-shared --enable-static --disable-programs --disable-doc \
    --disable-autodetect --disable-everything --enable-avutil \
    --enable-avcodec --enable-avformat --enable-protocol=file \
    --enable-demuxer=matroska,ass --enable-zlib --disable-x86asm \
    --extra-cflags="-I$STAGE/include" \
    --extra-ldflags="-L$STAGE/lib" --extra-libs="-lz"
  run_make -j "$JOBS"
  run_make install
)

mkdir -p "$BUILD_ROOT/helper"
cat > "$BUILD_ROOT/helper/BUILD-METADATA.txt" <<EOF
target=$TARGET
profile=$LIBASS_PROFILE
libass=$LIBASS_VERSION
ffmpeg=9.0.1
harfbuzz=14.4.0
freetype=2.14.3
fribidi=1.0.16
libunibreak=7.0
zlib=1.3.2
libassPatch=$LIBASS_PATCH_NAME
libassEnvelopePatch=$LIBASS_ENVELOPE_PATCH_NAME
fontProvider=$(if [[ "$TARGET" == "windows-x86_64" ]]; then echo directwrite; else echo fontconfig; fi)
EOF

echo "native geometry dependency stage ready: $STAGE"
