# Third-party notices

- Electron and Chromium: see the Electron distribution notices included with
  the pinned Electron package.
- HoshiDicts: the macOS arm64 package includes the validated full helper and
  its corresponding source archive under `vendor/`. Windows/Linux packages
  include a dictionary-only portable helper built from that same archive. It
  is GPL-3.0-only and its pinned source/dependency checksums are recorded in
  `docs/native-backend.md`. User dictionaries are not bundled; import them
  through the managed settings path. Platform-specific geometry/OCR helpers
  remain separate acceptance gates.
- Yomitan language transforms: the bounded English, German, and French
  deinflection tables under `src/services/language-rules/` are derived from
  the GPL-3.0-or-later Yomitan language transform sources. Their upstream
  references and attribution are retained in each file; the host applies them
  only to bounded dictionary candidate generation and does not replace native
  subtitle rendering.
- mpv: the application integrates with a user-installed mpv executable and does
  not redistribute or replace it.
- ffmpeg-static 5.3.0: the package supplies GPL-licensed static ffmpeg
  binaries for the declared macOS arm64, Windows x86-64, and Linux x86-64
  targets. The build copies the platform-selected binary to the packaged
  `bin/ffmpeg.exe` helper path for sentence-audio capture. See the upstream
  project and its binary-source notices at
  https://github.com/eugeneware/ffmpeg-static.
- Recommended dictionaries: optional downloads remain under the individual
  upstream projects' licenses and attribution terms. The catalog and source
  homepages are recorded in `docs/dictionary-sources.md`; no dictionary archive
  is bundled in this repository or package.

Release packaging must generate a complete dependency/license inventory and
checksums before claiming a package is installable.
