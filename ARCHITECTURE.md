# iinatan for stock mpv

This repository is the successor implementation for ordinary desktop mpv. The
reference IINA plugin remains in a separate checkout; it is an input and
behavior reference, not a runtime dependency and is not modified by this
project.

## Architecture decision

Electron is the primary browser host. It uses normal transparent, GPU-composed
browser windows. The browser is never rendered offscreen and copied into mpv:
there is no BGRA/PNG/video transport, `overlay-add` display path, graphics
injection, or replacement subtitle renderer.

The implementation is a program-managed companion surface. It can visually
follow an mpv content area while remaining a separate OS window. This is not an
IINA-style child view and it does not claim to be part of mpv's native view
hierarchy. A literal same-window/view requirement would require a separate
scope decision before implementation.

The companion is split into a passive highlight surface and a focused popup
surface. The passive surface ignores mouse input with platform forwarding;
the popup surface owns the whole player content area while active so outside
clicks can be consumed and cannot accidentally pause or seek mpv.
On macOS both surfaces are Electron `panel` windows, which map to AppKit's
non-activating panel style: the popup can receive native selection, keyboard,
wheel, and button input while mpv remains the active application and a native
fullscreen player is not forced into windowed mode. Dismissing the popup is the
explicit boundary that restores player focus.

The browser document does not import Electron. `app/preload.js` exposes a
versioned, allowlisted bridge. `src/platform/browser-host.js` owns Electron
window details; services, geometry, placement, and interaction logic are
host-neutral and are the future CEF reuse boundary.

## Main boundaries

- `PlayerBridge` — explicit mpv IPC session, property observation, allowlisted
  player commands, and media/geometry generations.
- `NativeWindowAdapter` — scalar native window/content geometry and foreground
  state. On macOS, an explicitly loaded stock-mpv C-plugin can publish an
  identity-checked AppKit content-view sidecar; the adapter never exposes
  cross-process pointers or pixels.
- `SubtitleGeometryProvider` — separate subtitle track/event/unit geometry.
  The current fallback is intentionally marked approximate and is disabled for
  ordinary lookup. `NativeSubtitleGeometryService` uses the bundled platform
  helper by default in packaged companions when the validated mpv/libass/
  FFmpeg tuple is present; macOS also requires its identity-checked AppKit
  content sidecar. Source-development launches require
  `--enable-patched-native-geometry`. Unsupported tuples and renderer modes
  still fail closed, and the independent stock-mpv glyph-equivalence gate
  remains separate.
- `CoordinateMapper` — the only transform implementation between OSD, desktop,
  physical, and browser CSS spaces.
- `InteractionController` — focus, ownership, cancellation, capture, and
  Escape ordering state machine.
- `BrowserHost` — Electron surfaces, positioning, passive/interactive native
  input regions, and lifecycle.
- `HoshiWorker` / `DictionaryService` — HoshiDicts process boundary;
  dictionary rendering consumes normalized structured data rather than raw
  executable HTML. The validated macOS arm64 helper is bundled with its
  corresponding-source archive; Windows/Linux packages build separate
  portable dictionary and instrumented geometry helpers from the same archive,
  while OCR and controller capabilities remain separate gates.
- `DictionaryCatalog`, `AudioSourceService`, and `AnkiConnectClient` — managed
  dictionary/profile references and explicitly bounded external services.
- `SettingsStore` — atomic, backed-up settings and migration boundary.

## Platform interpretation

“x86” in the product target means x86-64 / AMD64, not 32-bit IA-32. Declared
targets are macOS arm64, Windows x86-64, and Linux x86-64. Linux support is
split by display backend; native Wayland is not silently described as X11.

## Current phase

The repository contains the Phase A host/geometry/input vertical slice and
tests, plus the completed signed macOS arm64 native-desktop slice. The native
geometry client boundary has a validated protocol integration and bundled
platform helper builds; the stock-mpv content sidecar has passed its real-window
identity smoke; and the portable Windows/Linux dictionary and geometry workers
pass their package and fixture checks. Windows also has local Win32
native-desktop evidence for stock-mpv windowed/fullscreen composition, native
selection and keyboard input, multi-session ownership, and resize/lifecycle
recovery, while its exact subtitle geometry remains gated by the installed
stock renderer tuple. The remaining geometry gate is universal stock-mpv glyph
equivalence. Linux native desktop evidence remains unverified. See
`docs/native-geometry.md`,
`docs/platform-capability-matrix.md`, and `docs/feature-matrix.json`;
“implemented” there never means native desktop verified unless the evidence
column says so.
