vcpkg_download_distfile(ARCHIVE
  URLS "https://github.com/libass/libass/releases/download/0.17.2/libass-0.17.2.tar.xz"
  FILENAME "libass-0.17.2.tar.xz"
  SHA512 adb868d1adc6bc661bb2ba701fc775f2db698e3eb933d6c98e7969c1c039fdbae01ef35ceda002c9bac3614bc60eba73d09c03f1764edafa32d036891cc10341
)
vcpkg_extract_source_archive(SOURCE_PATH
  ARCHIVE "${ARCHIVE}"
  PATCHES "../../../patches/libass-0.17.2-iinatan-unit-ids.patch"
)
vcpkg_find_acquire_program(PKGCONFIG)
get_filename_component(PKGCONFIG_EXE_PATH "${PKGCONFIG}" DIRECTORY)
vcpkg_add_to_path("${PKGCONFIG_EXE_PATH}")
vcpkg_configure_meson(
  SOURCE_PATH "${SOURCE_PATH}"
  OPTIONS
    -Dcheckasm=disabled
    -Dcompare=disabled
    -Dfuzz=disabled
    -Dprofile=disabled
    -Dtest=disabled
    -Dasm=enabled
)
vcpkg_install_meson()
vcpkg_copy_pdbs()
vcpkg_fixup_pkgconfig()
vcpkg_install_copyright(FILE_LIST "${SOURCE_PATH}/COPYING")
