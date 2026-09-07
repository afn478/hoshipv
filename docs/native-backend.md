# Native HoshiDicts backend

The macOS arm64 development/package path includes the validated
`bin/iina-hoshi-dicts` helper. It is a separate dictionary/geometry worker
process; it does not replace mpv and it is not used to transfer browser pixels
or subtitle images into mpv.

## Provenance

- Source reference: the corresponding-source archive listed below, including
  the pinned upstream HoshiDicts revision and native dependency lock.
- HoshiDicts revision: `a28d82eb0f169b8ceff79e8c99ffe0b96709ab27`.
- Helper artifact: `bin/iina-hoshi-dicts`.
- Corresponding-source archive: `vendor/iina-hoshi-dicts-native-source.tar.gz`.
- Helper SHA-256:
  `c10f850e6c6fcd1de95e4789259d938d6d4425985d46ca436abec92abb60ff07`.
- Source archive SHA-256:
  `05c0f105c3e7452f292ffcd1ff23c6f362eb01b856cec31790127fc5e8c4359a`.

The helper reports HoshiDicts revision `a28d82e`, patched libass 0.17.5
unit-ID geometry and additive visible-envelope rectangles, CoreText font metrics,
macOS Vision OCR, and the opt-in native HID controller capability through its
`version` command. The archive
contains the native wrapper, pinned HoshiDicts sources and dependencies, the
hash-locked libass unit-ID and visible-envelope patches, upstream archives,
licenses, and rebuild scripts. It is the
corresponding source for the checked-in macOS artifact; the portable
Windows/Linux target described below intentionally exposes a smaller
capability set.

The Electron host uses the helper's `bitmap-subtitle-ocr` command for selected
PGS/DVD/VobSub/DVB/bitmap tracks. `src/services/native-bitmap-ocr-client.js`
validates the request and response contract, while
`src/player/application-controller.js` keeps one bounded result per subtitle
cue and treats its boxes as approximate lookup geometry. The paused screenshot
diff path is opt-in; it remains a native mpv screenshot command boundary and is
not a renderer-pixel transport. Apple Vision recognition is on-device and
language capability is taken from the helper rather than assumed; see Apple's
[Vision text-recognition documentation](https://developer.apple.com/documentation/vision/recognizing-text-in-images).

## Dependency review

The dependency refresh on 2026-09-07 kept the already-current top-level pins
and updated the supporting native lock:

- The official [libass releases](https://github.com/libass/libass/releases)
  page lists 0.17.5 as the current release. The native lock therefore keeps
  libass 0.17.5 together with the project-specific unit-ID and additive
  visible-envelope patches; changing the renderer version would require
  rerunning the stock-mpv pixel oracle before the native geometry path could
  be reconsidered.
- The pinned HoshiDicts revision resolves to the current upstream `main` ref
  (`a28d82eb0f169b8ceff79e8c99ffe0b96709ab27`) in the [HoshiDicts
  repository](https://github.com/Manhhao/hoshidicts/). The helper and source
  archive were rebuilt from that revision; the new checksums are recorded
  above.
- The native support lock now uses FFmpeg 9.0.1, HarfBuzz 14.4.0, FreeType
  2.14.3, FriBidi 1.0.16, libunibreak 7.0, zlib 1.3.2, and pkgconf 3.0.7.
  The updated zlib build uses its current `ZLIB_BUILD_*` controls and the
  source archive excludes generated build caches.
- `npm outdated --json` returned `{}`, and `npm audit --audit-level=moderate`
  plus the production-only audit reported no vulnerabilities. The reviewed
  JavaScript runtime pins are Electron 44.2.0, electron-builder 26.15.3,
  ffmpeg-static 5.3.0, and Prettier 3.9.6.

The refreshed helper reports FFmpeg 9.0.1 and libass 0.17.5, passed the
recommended-dictionary import/lookup smoke, and passed the deterministic
stock-pixel oracle. Fixture runs now record the
additive visible-envelope rectangles as well as fill rectangles; the runtime
still uses fill rectangles for hit testing. The supplied-media run now records
visible-envelope IoU `1.0` alongside fill IoU `0.9990138067061144`; exact
per-glyph stock-mpv equivalence remains open because the envelope does not
assign decorative pixels to individual units.

When controller support is enabled on macOS, the helper publishes a bounded
`state/controller.json` snapshot for its recognized DualSense HID devices. The
Electron main process consumes the snapshot and routes it through the same binding and
focus state machine as browser Gamepad input. The transport, stale-state, and
disconnect-recovery behavior are covered by unit tests; polling remains active
after a stale or missing snapshot so a later reconnect can be observed.
Physical device/focus/hotplug acceptance remains a native-desktop gate.

## Stock-mpv content bounds

`native/mpv_window_shim_macos.mm` is a separate, optional macOS stock-mpv
C-plugin. It uses mpv's public C-plugin entry point and event wait API, then
enumerates the ordinary mpv AppKit window on the AppKit main thread and writes
only a bounded scalar JSON sidecar: PID, window number, content-view bounds,
foreground state, and protocol version. The host accepts that sidecar only
after its PID and observed native window identity match; when the sidecar
supplies an identity, the host asks the external probe for that exact window
before trying an unqualified PID scan. This matters in fullscreen, where mpv
can expose a small auxiliary CoreGraphics window alongside the real content
window. On macOS the descriptor's `window-id` is intentionally optional
because mpv may expose a non-CoreGraphics value there. It does
not link against libmpv, pass raw pointers, share textures, transport pixels,
or replace mpv's subtitle renderer.

The plugin is built as a Mach-O module with the `.so` suffix recognized by
mpv's C-plugin loader. It must be loaded explicitly with `--script=/path/to/`
`iinatan-mpv-window-shim.so`, or through `IINATAN_NATIVE_SHIM` / the
`iinatan-native-shim` script option used by `mpv/iinatan-session.lua`. A stock
mpv process without the plugin continues through the external CoreGraphics
window probe and remains content-inexact. The sidecar is authoritative for
the player content view. The session descriptor publishes PID/session/IPC
identity without blocking on early Cocoa window properties; the native probe
then supplies and identity-checks the real window ID. On macOS, the session
script does not promote mpv's non-CoreGraphics `window-id` value into that
contract. Independent stock-mpv
pixel-oracle and real desktop/input tests remain separate acceptance gates.

The entry-point and event-loop shape follows mpv's [C-plugin documentation](https://github.com/mpv-player/mpv/blob/master/DOCS/man/libmpv.rst)
and its [minimal public-API C-plugin example](https://raw.githubusercontent.com/mpv-player/mpv-examples/master/cplugins/simple/simple.c).

## Validation

With a local Yomitan-compatible dictionary ZIP:

```sh
IINATAN_DICTIONARY_ZIP=/path/to/dictionary.zip npm run test:hoshi
```

The smoke imports the ZIP, starts the worker through `HoshiWorker`, checks the
ready capability response, and performs a real lookup. The current fixture
run imported Jitendex and returned results for `猫を見る`.

The deterministic geometry boundary smoke is:

```sh
npm run test:native-geometry
```

It validates three primary returned word ranges and the six lookupable ranges
from the bounded secondary-`strip` observation path through the bundled helper.
The measured rectangles are helper diagnostics; the independent stock-mpv
pixel oracle is the evidence that promotes the bounded path.

The worker's ASS geometry capability remains an optional explicit geometry
backend. Its passing response is protocol compatibility evidence only; it does
not prove that its fill rectangles agree with ordinary stock mpv's private
subtitle renderer. The additive envelope rectangles are an independent
stock-pixel validation aid, not a replacement for fill-based hit geometry.
Exact stock-mpv lookup remains gated by the
independent geometry oracle described in `docs/native-geometry.md` and
`docs/validation.md`.

The current stock-mpv oracle covers simple external SubRip plus simultaneous
primary and secondary ASS tracks with explicit
`secondary-sub-ass-override=no` and with stock's default
`strip` mode at the bounded centered-top position. The latter uses an
observation-only ASS reconstruction, as does the bounded ordinary-SubRip
conversion path. The independent fixture set also covers
mixed-language text, missing-font fallback, simultaneous events, bounded
color-separated, single-event inline-color, unique-color unit-identity, and
validated explicit-position, explicit-movement, static-tag, and bounded-transform cases; arbitrary secondary positions, alignments,
fonts, colors, scale options, and advanced ASS features remain outside the
native adapter claim.

The supplied-media ASS attachment smoke is:

```sh
IINATAN_STOCK_PIXEL_ASS_REQUIRED=1 \
IINATAN_STOCK_PIXEL_MEDIA_PATH="/absolute/path/to/MARRIAGETOXIN.mkv" \
IINATAN_STOCK_PIXEL_ASS_FF_INDEX=2 \
IINATAN_STOCK_PIXEL_ASS_ID=1 \
npm run test:stock-pixels:media:ass
```

On the supplied MARRIAGETOXIN MKV, stock mpv `0.41.0` exposed the English
ASS cue at `18.170–20.580` seconds. The native demux path discovered 24
embedded font attachments and produced nonzero stock-pixel coverage for all
30 requested visible graphemes and seven word probes; the visible-envelope
IoU was `1.0`. The ASS style's primary-colour fill, separated
from its decorative outline/shadow in the oracle, registered at IoU
`0.9990138067061144` against the character-plane rectangles. This distinguishes
the usable per-character registration from the still-unresolved per-glyph
assignment problem. Exact stock-mpv glyph equivalence remains open because
outline and shadow pixels cannot be assigned to adjacent units without risking
identity overlap.

## Portable dictionary worker

Windows x86-64 and Linux x86-64 use a separate portable target built from the
same pinned HoshiDicts source archive. Non-macOS CMake configurations extract
the archive, link the dictionary/importer library into
`native/portable_hoshi_main.cpp`, and stage `iina-hoshi-dicts` for the package.
MSVC builds select the static CRT so the packaged helper does not add a Visual
C++ runtime installation prerequisite.
The worker supports dictionary import, managed lookup, and the existing queue
protocol. Its `version` and `ready` responses attest the same HoshiDicts
revision recorded in the native lock. It explicitly reports ASS geometry,
CoreText font metrics, OCR, and controller capabilities as unavailable; those
platform-specific capabilities are not inferred from a dictionary-only binary.

Validate the portable boundary with:

```sh
IINATAN_PORTABLE_HOSHI=/absolute/path/to/iina-hoshi-dicts \
IINATAN_PORTABLE_HOSHI_REQUIRED=1 npm run test:hoshi:portable
```

This smoke creates a bounded fixture ZIP, imports it, starts the worker, and
performs a real lookup. It is dictionary/backend evidence, not native desktop
or exact subtitle-geometry evidence.
