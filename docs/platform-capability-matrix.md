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

| Environment            | Player/window identity                                   | Geometry path                                                                                                                                                                                                                                              | Surface/input path                                                                                                                          | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64, this host | mpv PID + CoreGraphics/AppKit window id + IPC descriptor | External CoreGraphics frame fallback is inexact; optional in-process C-plugin sidecar reports the AppKit content-view bounds and is accepted only for matching PID/window identity; fullscreen probes target the sidecar identity before the fallback scan | Electron transparent surfaces; popup focus path is implemented                                                                              | Homebrew mpv 0.41.0_9 (reported application version 0.41.0), real MARRIAGETOXIN media, exact AppKit content bounds (`640x360` windowed and `1470x923` fullscreen), instrumented libass subtitle geometry, native pointer movement, popup click, native text selection, popup-owned wheel scroll, Escape dismissal, and combined desktop capture all passed in the signed GUI-launched acceptance replays; the signed helper reported `accessibilityTrusted:true` and `postEventTrusted:true`, and the full desktop capture was `2940x1912`; live Jitendex catalog download/import and Hoshi-backed Japanese popup replay passed in both windowed and fullscreen modes; the signed native-HID semantic controller replay also passed cursor-free Cross lookup, right-stick subtitle navigation, proportional left-stick popup scrolling, D-pad entry navigation, Triangle/audio hold, Circle/back dismissal, pause preservation, and no-mpv-leak checks; the combined feature-parity replay additionally selected the Anki audio column through the native controller state contract, passed outside-panel dismissal after controller close/reopen, and recovered from Finder foregrounding through a trusted native user click while preserving pause; stock-mpv glyph-equivalence remains a separate evidence gate | windowed and supplied-media fullscreen Phase A native-desktop-tested with signed helper and instrumented geometry, demo and live Hoshi dictionaries; native selection/scroll passed on supplied media; native-HID semantic controller path passed through the live worker state contract, including proportional popup scrolling, audio-menu row/column selection, post-controller outside dismissal, and native-click foreground recovery; physical controller actuation, hotplug, device compatibility, and exact stock glyph oracle remain unverified |
| Windows x86-64         | PID + HWND + IPC descriptor                              | Win32 client rect in physical pixels plus `GetDpiForWindow`; Electron adapter converts both corners to DIP before surface placement                                                                                                                        | Electron transparent surfaces; PerMonitorV2 conversion is explicit; activation request and foreground observation are separate              | source and DPI manifest/conversion implemented; required CI smokes create real Electron windows, exercise HWND discovery/client geometry/DPI/activation/movement/resize, and perform a native drag selection in a transparent popup through `SendInput`; the local Windows run also attached two stock-mpv sessions, switched foreground ownership, removed one session, attached a replacement, and passed the supplied-media fullscreen companion replay with popup capture, native selection, and dismissal/liveness checks; the packaged Japanese external-SubRip fullscreen replay selected the locked libass 0.17.4 compatibility profile, reported exact native geometry, and passed popup capture, selection, dismissal, and liveness; the 2026-09-09 live feature-parity replay additionally passed dictionary import, scroll, custom CSS, audio, Anki, unrelated-app recovery, and cleanup; the bundled WinMM controller contract and connected DualSense worker state also passed; Chromium browser fallback remains activation-sensitive; arbitrary stock-mpv glyph equivalence remains separate                                                                                                                                                                                                        | source-implemented; required-Win32-window-and-popup-selection-smokes-defined; local-Windows-windowed-and-fullscreen-stock-mpv-native-desktop-tested-with-exact-external-subrip-profile-and-approximate-fallback;live-feature-parity-fullscreen-passed;windows-WinMM-native-controller-contract-and-connected-state-smoked;browser-fallback-activation-sensitive;stock-glyph-equivalence-open;hosted-CI-result-unverified                                                                                                                                 |
| Linux x86-64 X11       | PID + `_NET_WM_PID` + X11 window + IPC descriptor        | X11 pixel geometry is explicitly converted to Electron DIP coordinates; frame/content exactness still depends on WM                                                                                                                                        | Electron transparent surfaces; X11 input/stacking test required; activation is an EWMH request until the active-window property is observed | format-32 Xlib property parsing, client-list validation, and physical-to-DIP adapter path are implemented; required CI smokes create real Electron X11 windows under Xvfb/Openbox, exercise discovery/activation/movement/resize, and perform a native drag selection in a transparent popup through XTest; stock-mpv companion-overlay behavior remains separate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | source-implemented; required-X11-window-and-popup-selection-smokes-defined; stock-mpv-native-overlay-unverified                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Linux x86-64 XWayland  | explicit X11/XWayland descriptor only                    | must prove both apps use X11                                                                                                                                                                                                                               | same as X11 if identity/stacking are actually X11                                                                                           | not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | unverified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| KDE Plasma Wayland     | compositor-specific mechanism required                   | no generic guarantee                                                                                                                                                                                                                                       | no automatic downgrade                                                                                                                      | not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | unresolved support gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GNOME Wayland          | compositor-specific mechanism required                   | no generic guarantee                                                                                                                                                                                                                                       | no automatic downgrade                                                                                                                      | not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | unresolved support gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Other native Wayland   | identified protocol/compositor integration required      | `setPosition()` is not proof                                                                                                                                                                                                                               | no automatic downgrade                                                                                                                      | not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | unresolved support gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The app does not request Screen Recording or Accessibility permission merely to
start. If a platform's authoritative geometry or activation path genuinely
needs permission, the installer and diagnostics must say why before requesting
it. Generic Wayland is not reported as supported because a companion process
cannot universally position and attach to another client's surface.

The Windows and Linux geometry paths now include the bundled instrumented
helper required by the stock-mpv goal. Windows uses the shared libass core with
DirectWrite; Linux uses the same core with Fontconfig. Both helpers negotiate
the reviewed capability tuple and pass the multilingual native geometry smoke.
The Windows directory package also passed resource and startup validation. The
installed Windows stock build reports libass 0.17.4 and a different FFmpeg
revision than the primary helper's libass 0.17.5/FFmpeg 9.0.1 tuple, so the
package now carries a separately locked 0.17.4 profile for external SubRip
tracks and a second profile for embedded ASS sources with codec-private
extradata. The Japanese fullscreen replay passed with `source.exact:true` under
the external-SubRip profile, and the supplied embedded ASS track passed the
independent font-attachment oracle plus source and packaged fullscreen native
replays with `source.exact:true`. Mixed tracks, unmatched renderer options, and
arbitrary stock-mpv glyph equivalence remain separate gates.

The Windows feature-parity replay on 2026-09-09 passed against the packaged
application and the supplied Japanese external SubRip track in fullscreen. It
used the recommended `jitendex-ja-en` download/import path and packaged Hoshi
worker, then passed live lookup, native selection and keyboard focus, popup
scrolling to offset `1572`, selector-based custom CSS, five audio candidates,
loopback Anki `findNotes`/`addNote`, unrelated-app foreground recovery, and
cleanup. The helper recorded the exact compatibility profile above; companion
and helper processes peaked at approximately `481.1 MiB` working set and
`361.0 MiB` private memory across seven processes, excluding mpv and the
desktop test driver. Deterministic native nested-result injection and the live
Hoshi nested text replay both passed in the same fullscreen external-SubRip
slice; stock-glyph equivalence, the signed installer, and Linux native GUI
remain open.

The same Windows build produced an NSIS installer and ZIP artifact. The
installer lifecycle smoke installed the NSIS artifact, validated the installed
ASAR and native resources, removed the application files through the
uninstaller, and preserved a sentinel outside the application directory. The
installed executable then passed the fullscreen Japanese replay and measured
`99.8736%` popup-region change. The installer is currently unsigned under
Authenticode, so it is suitable as an installable preview; production signing
and SmartScreen acceptance remain open.

## Version/capability record for this phase

- Stock mpv: Homebrew `0.41.0_9` (the reported application version remains
  `v0.41.0`), detected at `/opt/homebrew/bin/mpv` on 2026-09-07.
- Windows stock-mpv replay: official CI/MSVC mpv `0.41.0` was exercised with
  the supplied Japanese SubRip cue in fullscreen. The independent pixel oracle
  measured fill IoU `0.9341666666666667` and visible-envelope IoU
  `0.9900990099009901`, with nonzero coverage for every requested Japanese
  grapheme. The packaged replay then selected the locked 0.17.4 external-SubRip
  profile and passed the exact native geometry and combined popup/input path.
  The same build's embedded ASS stream was demuxed with 24 attached fonts; the
  fill IoU was `0.9990138067061144`, visible-envelope IoU was `1.0`, and both
  source and packaged native replays selected the locked embedded-ASS profile.
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
  nonzero coverage for its requested phrase region. The dedicated karaoke
  fixture produced IoU `0.8325508607198748`, visible-envelope IoU
  `0.9953271028037384`, and nonzero coverage for all four requested
  syllable/word regions. Across the twenty cases, all fifty-eight requested
  per-case unit regions had nonzero bounds coverage. This oracle checks bounds and independently
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
  remain the runtime hit/highlight contract. Across the twenty deterministic
  cases, visible-envelope IoU ranged from `0.8845315904139434` to `1.0`.
- Supplied-media ASS attachment smoke: the selected real MKV stream demuxed
  24 embedded fonts, requested 30 visible graphemes, and produced nonzero
  coverage for all seven word probes. The visible-envelope IoU was `1.0`, while
  the primary-colour fill IoU was
  `0.9990138067061144`; the selected alpha-isolated per-glyph fixture also
  passed all seven visible-fill comparisons. Decorative outline/shadow
  ownership for arbitrary ASS remains outside the exact full stock-mpv gate.
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
- macOS controller transport: the signed helper's native HID probe now reports
  the complete configured button/trigger schema, including Square and analog
  L2/R2 thresholds. The host arbitrates native HID ahead of the browser
  Gamepad fallback so unrecognized macOS controllers can still use the same
  bindings. A signed live Electron/stock-mpv replay passed cursor-free Cross
  lookup, right-stick subtitle targeting, proportional left-stick popup
  scrolling, Cross/D-pad dictionary-entry navigation, Triangle/audio hold,
  Circle/back dismissal, pause preservation, and no-mpv-leak checks using the
  real downloaded Jitendex catalog. The combined feature-parity replay also
  selected an Anki-capable source using native D-pad row/column navigation,
  passed the subsequent outside-panel dismissal after controller close/reopen,
  and recovered from Finder foregrounding through a trusted native user click
  while preserving the user's pause state. These replays inject the native-HID
  state contract rather than asserting physical button actuation; physical
  focus, hotplug, device-compatibility, and exact stock-mpv decorative glyph
  acceptance remain unverified.
- macOS hover continuity: the passive highlight surface now remains visible
  while the popup is open, and cursor polling outside the measured popup panel
  replaces the popup when another subtitle unit is entered. A signed native
  replay observed the popup's bound unit change from `c` to adjacent `a` in
  `129.377 ms`; enlarged recording frames showed the selection-style highlight
  move between those glyphs while native selection and both dismissal paths
  remained green. Evidence is under `/tmp/iinatan-hover-fix-evidence4/`.
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
- Feature-parity extension: the signed live Japanese replay exercised measured
  native audio and Anki action regions before selection/scroll. It also applied
  the profile's selector-based custom CSS to the live popup and confirmed the
  computed reference-popup background, border color, and border width. Audio
  returned five bounded candidates; the loopback Anki service recorded
  `findNotes` and one `addNote` without touching the user's collection. The
  popup-visibility-scoped macOS Escape fallback was also exercised because a
  transparent overlay can retain Electron window focus while mpv remains the
  frontmost application. This feature-parity extension remains bounded to the
  signed macOS slice; Windows native composition, input, and session evidence
  is recorded separately, while Linux remains unverified.
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
  patched backend is automatically selected on Windows/Linux after capability
  negotiation. The Windows DirectWrite and Linux Fontconfig helpers were built
  from the pinned dependency stage and passed the native geometry smoke; the
  Windows directory package passed helper version/resource validation. This is
  helper and protocol evidence, while exact stock-mpv glyph equivalence remains
  a separate per-renderer tuple gate.
- Player properties used by the bridge include `window-id`, `osd-dimensions`,
  `sub-text/ass-full`, `sub-ass-extradata`, and the corresponding secondary
  properties. The bridge treats them as reconstruction inputs, not as a public
  per-glyph layout API.
