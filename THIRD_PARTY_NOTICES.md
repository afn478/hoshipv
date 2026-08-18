# Third-party notices

iinatan release archives contain a native backend, an FFmpeg executable, and
the Noto Sans CJK JP fallback font. The backend combines the components below.
Pinned source URLs and checksums are recorded in
`native-dependencies.lock.json`; exact linked versions and capabilities are
reported by `iinatan-backend version` in every release.

| Component | Version | License |
| --- | ---: | --- |
| FFmpeg libraries and executable | 7.0.1 or target release build | LGPL-2.1-or-later |
| libass (iinatan lookup-unit patch) | 0.17.2 | ISC |
| HarfBuzz | 8.5.0 | MIT |
| FreeType | 2.13.2 | FTL or GPL-2.0-or-later |
| FriBidi | 1.0.13 | LGPL-2.1-or-later |
| libunibreak | 6.1 | Zlib |
| zlib | 1.3.1 | Zlib |
| libcurl | platform build reported at runtime | curl license |
| miniaudio | 0.11.22 | MIT-0 or Unlicense |
| Noto Sans CJK JP | 2.004 | OFL-1.1 |
| HoshiDicts | pinned Git submodule | GPL-3.0-only |
| glaze | HoshiDicts pinned source | MIT |
| kanji-processor | HoshiDicts pinned source | bundled upstream license |
| libdeflate | HoshiDicts pinned source | MIT |
| unordered_dense | HoshiDicts pinned source | MIT |
| utf8proc | HoshiDicts pinned source | MIT |
| utfcpp | HoshiDicts pinned source | BSL-1.0 |
| xxHash | HoshiDicts pinned source | BSD-2-Clause |
| zstd | HoshiDicts pinned source | BSD-3-Clause |

The libass changes are in
`patches/libass-0.17.2-iinatan-unit-ids.patch`, with a pinned checksum. Apple
Vision and CoreText are used only through system frameworks on macOS. The
backend uses only the public dependencies listed here and operating-system frameworks.

Every platform archive includes the project license, these notices, the font's
OFL text, checksums, and a corresponding native-source archive. Upstream
license files remain in that source archive. The project as a whole is
GPL-3.0-only. No warranty is provided by upstream authors or iinatan.
