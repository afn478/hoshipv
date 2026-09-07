# Platform capability and support matrix

Target architecture is macOS arm64, Windows x86-64, and Linux x86-64. “x86”
means 64-bit Intel/AMD, not IA-32.

The Linux directory package is built on GitHub Actions `ubuntu-24.04` x86-64,
which is the current project build baseline. This repository does not claim
execution on an older distribution or a lower glibc baseline until a target
runtime probe has run there. The Electron runtime is pinned to `44.2.0`; its
supported architecture list includes 64-bit Linux, macOS, and Windows, but
that upstream statement is not a substitute for this application's native
window/input validation. See Electron's [installation architecture
documentation](https://www.electronjs.org/docs/latest/tutorial/installation).

| Environment            | Player/window identity                                   | Geometry path                                                                                                                                                                                                                                              | Surface/input path                                                                                                                          | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status                                                                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64, this host | mpv PID + CoreGraphics/AppKit window id + IPC descriptor | External CoreGraphics frame fallback is inexact; optional in-process C-plugin sidecar reports the AppKit content-view bounds and is accepted only for matching PID/window identity; fullscreen probes target the sidecar identity before the fallback scan | Electron transparent surfaces; popup focus path is implemented                                                                              | Homebrew mpv 0.41.0_9 (reported application version 0.41.0), real MARRIAGETOXIN media, exact AppKit content bounds (`640x360` windowed and `1470x923` fullscreen), instrumented libass subtitle geometry, native pointer movement, popup click, native text selection, popup-owned wheel scroll, Escape dismissal, and combined desktop capture all passed in the signed GUI-launched acceptance replays; the signed helper reported `accessibilityTrusted:true` and `postEventTrusted:true`, and the full desktop capture was `2940x1912`; live Jitendex catalog download/import and Hoshi-backed Japanese popup replay passed in both windowed and fullscreen modes; stock-mpv glyph-equivalence remains a separate evidence gate | windowed and supplied-media fullscreen Phase A native-desktop-tested with signed helper and instrumented geometry, demo and live Hoshi dictionaries; native selection/scroll passed on supplied media; stock glyph oracle and non-macOS GUI paths remain unverified |
| Windows x86-64         | PID + HWND + IPC descriptor                              | Win32 client rect in physical pixels plus `GetDpiForWindow`; Electron adapter converts both corners to DIP before surface placement                                                                                                                        | Electron transparent surfaces; PerMonitorV2 conversion is explicit; activation request and foreground observation are separate              | source and DPI manifest/conversion implemented; required CI smokes create real Electron windows, exercise HWND discovery/client geometry/DPI/activation/movement/resize, and perform a native drag selection in a transparent popup through `SendInput`; stock-mpv companion-overlay behavior remains separate                                                                                                                                                                                                                                                                                                                                                                                                                      | source-implemented; required-Win32-window-and-popup-selection-smokes-defined; stock-mpv-native-overlay-unverified                                                                                                                                                   |
| Linux x86-64 X11       | PID + `_NET_WM_PID` + X11 window + IPC descriptor        | X11 pixel geometry is explicitly converted to Electron DIP coordinates; frame/content exactness still depends on WM                                                                                                                                        | Electron transparent surfaces; X11 input/stacking test required; activation is an EWMH request until the active-window property is observed | format-32 Xlib property parsing, client-list validation, and physical-to-DIP adapter path are implemented; required CI smokes create real Electron X11 windows under Xvfb/Openbox, exercise discovery/activation/movement/resize, and perform a native drag selection in a transparent popup through XTest; stock-mpv companion-overlay behavior remains separate                                                                                                                                                                                                                                                                                                                                                                   | source-implemented; required-X11-window-and-popup-selection-smokes-defined; stock-mpv-native-overlay-unverified                                                                                                                                                     |
| Linux x86-64 XWayland  | explicit X11/XWayland descriptor only                    | must prove both apps use X11                                                                                                                                                                                                                               | same as X11 if identity/stacking are actually X11                                                                                           | not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | unverified                                                                                                                                                                                                                                                          |
| KDE Plasma Wayland     | compositor-specific mechanism required                   | no generic guarantee                                                                                                                                                                                                                                       | no automatic downgrade                                                                                                                      | not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | unresolved support gate                                                                                                                                                                                                                                             |
| GNOME Wayland          | compositor-specific mechanism required                   | no generic guarantee                                                                                                                                                                                                                                       | no automatic downgrade                                                                                                                      | not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | unresolved support gate                                                                                                                                                                                                                                             |
| Other native Wayland   | identified protocol/compositor integration required      | `setPosition()` is not proof                                                                                                                                                                                                                               | no automatic downgrade                                                                                                                      | not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | unresolved support gate                                                                                                                                                                                                                                             |

The app does not request Screen Recording or Accessibility permission merely to
start. If a platform's authoritative geometry or activation path genuinely
needs permission, the installer and diagnostics must say why before requesting
it. Generic Wayland is not reported as supported because a companion process
cannot universally position and attach to another client's surface.

## Version/capability record for this phase

- Stock mpv: Homebrew `0.41.0_9` (the reported application version remains
  `v0.41.0`), detected at `/opt/homebrew/bin/mpv` on 2026-09-07.
- Stock-mpv smoke: `npm run test:mpv` passed in headless mode on 2026-09-07;
  it verified the Lua descriptor, PID/session identity, real JSON IPC socket,
  bridge property reads, and descriptor cleanup. It did not create a native
  window or claim compositor/input evidence.
- Subtitle-property smoke: `npm run test:mpv:subtitles` passed against the refreshed
  unmodified mpv. It loaded committed SRT/ASS tracks, verified source and
  selection identity, primary cue timing, secondary selection transitions, and
  a later primary cue after seeking. It also changed primary delay, secondary
  delay, and subtitle speed, observed a new geometry generation for each, and
  restored the defaults. The bridge normalized the selected mpv build's
  same-seconds `/full` timing representation to milliseconds. With
  `--vo=null`, active secondary text
  and timing were not exposed; this is explicitly not simultaneous subtitle or
  geometry evidence.
- Independent pixel oracle: `npm run test:stock-pixels` passed against Homebrew
  mpv `0.41.0_9` for separate bottom, Unicode, mixed Japanese/English/German/French/
  Korean/Chinese, missing-font fallback, top, top-left positioned/italic style,
  and multiple-event/multiline/explicit-position/explicit-movement/static-tag/bounded-transform ASS fixtures and simultaneous
  primary/secondary fixtures with stock's default primary
  `sub-ass-override=scale`, one explicit `secondary-sub-ass-override=no` case,
  and one default `strip` case. Bounds IoU was `1.0` for the simple bottom,
  top, and explicit simultaneous cases, `0.9883720930232558` for the
  supplementary/combining-mark/newline case, and `0.9985119047619048` for the
  bounded default-strip case; the positioned/italic style case produced
  `0.8124381065557537`, `0.8630438324914453` for the mixed-language case, and
  `0.92` for two simultaneous events with an explicit line break, `0.875` for
  the missing-font fallback case, and `0.8612880870945387` for the
  color-separated unit-identity case, which had
  nonzero color-matched pixels for all four requested word regions. The unique-
  color identity case produced IoU `0.8628113879003558` and independent
  per-unit color-region IoUs from `0.9457755359394704` to
  `0.9615384615384616` and maximum annotated edge error of one physical pixel.
  The simple external SubRip case produced IoU
  `0.9036334913112164` with nonzero coverage for both requested word regions.
  The explicit-position fixture produced IoU `0.8614864864864865` with
  nonzero coverage for its requested phrase region. The explicit-movement
  fixture produced IoU `0.8862068965517241` with nonzero coverage for its
  requested phrase region. The static-tag fixture produced IoU
  `0.9422287390029326` with nonzero coverage for its requested phrase region.
  The bounded-transform fixture produced IoU `0.8994301994301994` with
  nonzero coverage for its requested phrase region. Across the seventeen
  cases, all fifty-two requested per-case unit regions had
  nonzero bounds coverage. This oracle checks bounds and independently
  annotated unit identity, not arbitrary stock-mpv glyph layout. The default-strip native path is
  observation-only and limited to centered-top text with the observed default
  renderer options; the SubRip path is limited to ordinary text conversion with
  the observed default renderer shape. The style-level case does not promote
  custom native adapter support, and platform scaling/native desktop composition
  remain unverified. The supplied MARRIAGETOXIN Japanese SubRip case additionally
  passed the independent stock-mpv media pixel oracle at IoU
  `0.9359332340531149` with visible-envelope IoU `1.0`; this SubRip-only run
  does not promote broader or unmeasured ASS renderer modes.
- The same deterministic fixture run records additive `envelopeRects` and
  visible-envelope IoUs from the rebuilt libass helper. These rectangles are
  independent stock-pixel evidence for outline/shadow bounds; fill rectangles
  remain the runtime hit/highlight contract. Across the seventeen deterministic
  cases, visible-envelope IoU ranged from `0.8845315904139434` to `1.0`.
- Supplied-media ASS attachment smoke: the selected real MKV stream demuxed
  24 embedded fonts, requested 30 visible graphemes, and produced nonzero
  coverage for all seven word probes. The visible-envelope IoU was `1.0`, while
  the primary-colour fill IoU was
  `0.9990138067061144`; the remaining renderer-envelope mismatch is the
  per-glyph decorative outline/shadow assignment, so exact full stock-mpv ASS
  equivalence remains open.
- Hoshi adapter smoke: `npm run test:hoshi` passed on 2026-09-06 with the
  bundled validated arm64 helper and a local Jitendex ZIP. Import, worker
  readiness, and lookup of `猫を見る` succeeded. The portable dictionary
  worker also builds from the pinned source archive and passes the deterministic
  import/worker/lookup smoke; its geometry, font-metric, OCR, and native-input
  capabilities are intentionally unavailable. The opt-in recommended catalog
  smoke also downloaded Jitendex over HTTPS, staged it under a disposable
  managed root, and passed the same real lookup. The user dictionary is not
  bundled.
- macOS bitmap OCR: the signed helper reports Vision revision 3 and the
  supported recognition-language list. The host/controller boundary,
  approximate hit mapping, real PGS decoding, and the signed native desktop
  replay pass on the mounted Hunter × Hunter Blu-ray fixture, including native
  popup input and dismissal. OCR remains deliberately approximate and the
  portable worker reports it unavailable on Windows/Linux.
- Electron: pinned to `44.2.0` in `package.json`; the direct runtime startup
  smoke test passed on this macOS arm64 host, including the settings
  BrowserWindow load. Headless stock-mpv IPC attachment and the signed
  windowed native desktop replay passed with both demo and live Jitendex/Hoshi
  dictionary modes; the replay still uses instrumented geometry, so stock glyph
  equivalence remains unverified.
- Native helper: CMake/AppleClang build succeeded on arm64; the opt-in native
  window smoke uses stock mpv's immediate window mode and explicit `gpu-next`,
  located a real stock-mpv window, and reported its scalar frame geometry
  (960×540 in the idle-window fixture; a separate 1280×720 fixture was also
  located manually). The optional public C-plugin shim now reports
  matching AppKit content-view bounds and the public fullscreen style-mask
  state in a PID-scoped scalar sidecar, and the adapter promotes content bounds
  only after identity checks. Windowed stock-mpv passed with
  `fullscreenObserved:false` from both mpv and AppKit. In the fullscreen
  request, mpv reported `fullscreen:true` but the AppKit style mask remained
  false, so the strict shim smoke rejects that native-fullscreen claim. The
  test-only CoreGraphics capture helper produced a 1920×1080 desktop image.
  The default/auto GPU paths did not service mpv IPC; an earlier diagnostic
  GPU context reached the real window, exact instrumented subtitle geometry,
  and Electron launch, but the host denied the explicit foreground hand-off
  (`activated:false`, target PID `36160`, frontmost PID `408` / `loginwindow`).
  The strict run stopped before native pointer/input, so this is not combined
  desktop evidence. A wake-assisted canonical `gpu-next`/`macvk` replay later
  reached exact instrumented geometry and exact AppKit content bounds with
  `displayAsleep:false`, then failed the same foreground gate. A prior run
  reached the native pointer phase and the helper reported Accessibility
  permission unavailable. `displayvk` exited during video startup. A separate
  `gpu`/`macvk` replay timed out on `video-out-params`.
  The current signed GUI-launched replay passed the native input gate and
  the complete windowed Phase A path: hover, normal transparent Electron
  popup, combined desktop capture, popup click, native selection and
  popup-owned scroll, pause ownership, and native Escape dismissal. It used the
  opt-in instrumented geometry backend, so
  stock-mpv glyph equivalence remains intentionally unpromoted.
- Fullscreen follow-up: the real supplied MARRIAGETOXIN MKV passed the same
  strict desktop harness with `IINATAN_E2E_FULLSCREEN=1`. The sidecar reported
  exact AppKit content bounds `1470x923`, `fullscreenObserved:true`, and the
  adapter selected the sidecar window after the unqualified CoreGraphics probe
  found a separate `1470x32` auxiliary window. The signed helper again
  reported `accessibilityTrusted:true` and `postEventTrusted:true`; combined
  capture, native click, pause ownership, and Escape dismissal passed. A live
  Jitendex/Hoshi Japanese replay passed the same fullscreen gates, including
  four additional native grapheme probes with screenshot-diff evidence.
- Packaging: `npm run package` produced macOS arm64 DMG, ZIP, and directory
  outputs on 2026-09-07; `unzip -t`, `hdiutil verify`, deep
  `codesign --verify --strict`, and `npm run validate:package` all passed. The
  app is signed with the Apple Development identity for Team `VWU398WDQ6`;
  notarization credentials are not configured, so these are signed development
  distributions rather than notarized release artifacts. Windows and Linux
  package jobs are defined in CI but remain unverified in this workspace.
- Native subtitle geometry: the JS client was exercised against the bundled
  `ass-geometry` backend and multilingual fixture on 2026-09-06. The packaged
  patched backend is opt-in at runtime. This remains protocol-compatibility
  evidence rather than release or stock-mpv evidence.
- Player properties used by the bridge include `window-id`, `osd-dimensions`,
  `sub-text/ass-full`, `sub-ass-extradata`, and the corresponding secondary
  properties. The bridge treats them as reconstruction inputs, not as a public
  per-glyph layout API.
