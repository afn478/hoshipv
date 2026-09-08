# Changelog

## Unreleased

- Restored bounded nested dictionary lookup inside the Electron popup. Cross-reference
  and configured text interactions now support click/hover/Shift-hover child popups,
  request cancellation, depth limits, child highlighting, and deepest-first Escape;
  nested lookup remains outside the assignable gamepad action list.
- Hardened popup dismissal for canceled, lost-capture, focus-interrupted, and
  host-interrupted outside pointer gestures, preventing an interrupted native
  click from leaving the transparent popup surface open or retaining pointer
  ownership across a close/reopen cycle.
- Re-registered the current macOS arm64 directory package after quarantining
  stale duplicate development bundles that could win the `iinatan for mpv`
  LaunchServices name. The supplied MARRIAGETOXIN direct-mpv workflow then
  selected the current package and passed live Jitendex lookup, exact content
  geometry, renderer fail-closed/recovery, and native dismissal.
- Added a reproducible public mpv layout-interface probe. On the validated
  stock mpv `0.41.0` build, supported in-process `osd-overlay`/
  `compute_bounds` returns aggregate bounds for synthetic overlays but does not
  expose the built-in subtitle event's per-glyph layout or live style/collision
  state; the exact stock-mpv geometry gate remains explicit.
- Reaped stale native geometry sidecars for exited mpv processes, including
  interrupted `.next` writes, during session discovery while retaining dead
  session descriptors for crash-recovery replacement. The rebuilt signed
  package passed the direct-autostart cleanup replay with no leftover geometry
  sidecar after teardown.
- Forwarded live mpv `sub-ass-force-margins`, `sub-hinting`, and `sub-shaper`
  settings into the native geometry renderer instead of silently using helper
  defaults; the bridge regression now covers non-default values.
- Added explicit fail-closed detection for unrepresented mpv subtitle style,
  font-path, aspect, filter, and renderer-effect options so those settings do
  not receive a false exact-geometry result.
- Added early fail-closed detection for `sub-ass-justify`, non-auto
  `sub-justify`, and non-auto `sub-font-provider`, matching the native
  helper's supported renderer boundary instead of waiting for a native request
  failure.
- Added early fail-closed detection for `sub-ass-scale-with-window=yes`; the
  selected mpv build applies this ASS-only scaling control, which the native
  geometry helper does not model.
- Extended the signed macOS autostart replay to exercise and recover sixteen
  live unsupported-renderer boundaries, including ASS interpretation, scaling,
  justification, font provider, timing, fps/stretch, cue-cache/end-of-video,
  and subtitle-filter controls.
- Added a live supported-renderer replay for `embeddedfonts=no`; the signed
  native helper remained exact while the setting changed and after the default
  was restored.
- Added a dedicated multi-syllable karaoke ASS fixture to the independent
  stock-mpv pixel oracle; all four requested syllable/word regions retained
  nonzero coverage and the visible envelope matched at IoU `0.9953271028`.
- Added a packaged macOS autostart replay that mutates an unsupported live mpv
  renderer option, verifies exact geometry is withdrawn with a diagnostic, and
  verifies exact geometry recovers after the option is restored.
- Extended package validation to require the architecture, geometry, platform,
  input-state, feature-matrix, migration, security, and validation handoff
  documents inside the shipped ASAR.
- Added fail-closed player-surface suspension for minimized or display-unavailable
  macOS mpv windows, with native AppKit sidecar propagation of display visibility
  and sleep state and integration coverage for recovery.
- Added the standard macOS `Cmd+O` accelerator to the ordinary “Open media in
  mpv…” workflow and included it in the native Settings/menu contract smoke.
- Rebuilt the signed macOS arm64 directory package after the menu contract
  change. Package/release validation, the native Settings/profile/backup smoke,
  and final supplied-media windowed and native-fullscreen popup replays passed;
  evidence is under `/tmp/iinatan-e2e-macos-final-20260908/run-55885-1788872949696/`
  and `/tmp/iinatan-e2e-macos-fullscreen-final-20260908/run-56520-1788873129178/`.
  The isolated idle/no-media window probe still reports its known
  `fullscreen=true` versus AppKit style-mask mismatch and remains explicitly
  separate from supplied-media fullscreen acceptance.
- Extended the synthetic native-HID acceptance path to cover iinatan-style
  no-popup shoulder subtitle stepping and D-pad seeking, in addition to
  cursor-free popup targeting, entry navigation, proportional scrolling, and
  audio-menu controls.
- Hardened the stock-mpv native window smoke against the asynchronous runtime
  loading of the AppKit content shim, and retained diagnostic details when the
  native geometry helper exits unexpectedly.
- Added an opt-in signed macOS live-resize replay. Stock mpv now changes
  `window-scale` from exact `640x360` content to `480x270` and back while the
  native sidecar and Electron geometry generations follow and recover; evidence
  is under
  `/tmp/iinatan-e2e-macos-resize-current-20260908d/run-36848-1788869186590/`.
- Hardened the bounded native lifecycle replay to reacquire the current exact
  subtitle geometry and lookup unit on every cycle instead of reusing a stale
  target after outside-click dismissal. The signed 24-cycle macOS replay passed
  with non-empty dictionary headwords, popup dismissal, pause preservation,
  trusted input, and mpv liveness. Evidence is under
  `/tmp/iinatan-e2e-macos-lifecycle-current-20260908-headword24/run-39844-1788869843224/`.
- Repeated the signed native lifecycle replay on the single-display macOS
  desktop with Screen Recording enabled. The four-cycle run opened the real
  `careful` dictionary headword, preserved trusted native input and mpv
  liveness, and produced a usable `18,557,748`-byte desktop recording under
  `/tmp/iinatan-e2e-macos-single-display-recording-20260908/run-42106-1788870901542/`.
- The current signed macOS arm64 package passed separate retained pointer/
  feature-parity and synthetic-controller replays against the supplied
  MARRIAGETOXIN media. Evidence is under
  `/tmp/iinatan-e2e-macos-feature-parity-current-20260908-pointer-only/` and
  `/tmp/iinatan-e2e-macos-controller-current-20260908-final-package/`.
  A final combined replay, including the 8-second Screen Recording gate, is
  retained under
  `/tmp/iinatan-e2e-macos-feature-parity-current-20260908-final-combined/run-30723-1788867582870/`.
- Made the packaged macOS companion select its bundled, validated native
  subtitle-geometry backend by default. Direct stock-mpv launches now reach
  lookupable exact geometry when the AppKit content shim and validated
  mpv/libass/FFmpeg tuple are present; an explicit disable switch remains
  available, and unsupported modes plus universal stock-glyph equivalence still
  fail closed.
- Corrected stock-mpv JSON IPC input framing. Controller seek, subtitle-step,
  frame-step, volume, speed, and pause commands now reach mpv as flat command
  arrays instead of being rejected as nested `command` parameters.
- Coalesced lookup highlights across the complete selected word and widened
  approximate wide-script glyph coverage without changing hit-test geometry;
  exact controller target identity now survives overlapping subtitle spans, and
  steady native HID samples are forwarded at the worker cadence for smoother
  popup scrolling.
- Preserved the native helper's additive visible-envelope rectangles through the
  geometry snapshot. Exact native highlights and popup anchors now cover the
  outline/shadow-visible glyph envelope while fill rectangles remain the
  per-unit hit-test boundary.
- Added a packaged macOS acceptance mode to the native desktop harness. The
  signed `dist/mac-arm64/iinatan for mpv.app` passed the supplied-media popup,
  selection, scroll, focus, dismissal, pause, liveness, and desktop-recording
  replay, and the same bundle passed the fullscreen variant with popup focus
  preservation; native input trust remains reported against the separately
  signed desktop-test helper used to inject events.
- Hardened native multi-session smoke cleanup so an already-exited mpv child is
  never mistaken for a live process group during teardown.
- Hardened browser-gamepad lifecycle handling. Blur, hidden-document, and
  page-teardown transitions now publish a forced neutral state and stop the
  browser poller, so a held controller input cannot survive a renderer focus
  change or be delivered to a later surface.
- Matched iinatan's controller repeat cadence: the first held-button or
  right-stick repeat arrives after 340 ms, followed by 120 ms intervals.
- Added a guarded macOS direct-mpv LaunchServices smoke. It verifies that an
  unconfigured ordinary stock-mpv process publishes its default descriptor and
  private IPC endpoint, starts a fresh installed companion through the session
  script, and requires that companion to attach to the exact new session before
  cleaning only its own player artifacts.
- Extended the guarded direct-mpv smoke through the real packaged Settings
  window and a live lookup. The signed macOS arm64 bundle now has replay
  evidence for downloading Jitendex through the visible Settings control,
  returning focus to the exact stock-mpv window, opening and capturing the
  highlighted `人` popup, dismissing it with Escape, and preserving mpv pause
  ownership.
- Added macOS session-script discovery for the bundled content shim. Direct
  stock-mpv launches now find a nearby or standard-user-location shim without
  an explicit path, while the content boundary remains fail-closed when no
  signed-compatible shim is available; the required stock-mpv auto-discovery
  smoke passed on the validated arm64 host.
- Added an integration regression for controller/mouse modality. A
  controller-selected subtitle target keeps its highlight and lookup ownership
  while the mouse travels through empty space or returns over the same word;
  only a real hit on another subtitle unit hands control back to the pointer.
- Aligned the no-popup controller defaults with iinatan's current profile:
  D-pad up/down adjust volume, while explicit long-seek actions remain
  available through the binding editor.
- Fixed macOS fullscreen companion focus behavior. Overlay surfaces now use
  non-activating AppKit panels, so opening, clicking, selecting, scrolling, and
  keyboard-navigating a popup does not activate the helper application or force
  mpv out of native fullscreen; dismissing the popup still returns focus to mpv.
  The native fullscreen replay now records foreground-preservation samples and
  fails closed if mpv stops being frontmost during popup interaction.
- Added a single-instance guard for the menu-bar companion so a background
  launch and a manual settings launch cannot create competing overlay hosts.
- Fixed native subtitle hover continuity while a dictionary popup is open.
  Moving to another lookupable subtitle unit now replaces the popup target and
  moves the selection-style highlight instead of leaving stale content in
  place. The highlight companion surface remains visible beneath the popup,
  and measured popup reflow no longer preserves a placement that covers the
  active subtitle anchor. A signed macOS replay verified the bound hit changing
  between adjacent units, retained native text selection and dismissal, and
  recorded both highlight positions in a 20-second desktop capture.
- Added a macOS native multi-instance smoke for ordinary stock mpv. Two real
  windows now attach to one Electron host through distinct session identities,
  switch foreground ownership independently, remove one player cleanly, and
  accept a replacement without IPC or controller cross-talk; Linux/Windows
  validation remains deferred.
- Extended the signed macOS Settings smoke through the real Save/Open panels.
  It now scrolls to the backup controls with native wheel input, exports a
  disposable wrapped settings document, selects it through the native file
  panel, and verifies restore; the migration variant passes the same backup /
  restore path while preserving its legacy dictionary reference.
- Replayed macOS feature parity with the current Apple Development-signed helper
  after rebuilding native text injection. The live Jitendex run passed five
  audio candidates, one loopback Anki `addNote`, custom CSS, native selection,
  scroll, focus, dismissal, pause, combined capture, and a 12-second desktop
  recording; Accessibility and post-event trust were both true. Evidence is in
  `/tmp/iinatan-e2e-macos-feature-parity-current-live/`.
- Made the signed native feature-parity harness self-contained by supplying a
  disposable loopback audio provider alongside its Anki mock. The current
  supplied-media English replay passed five audio candidates and controller
  audio selection without depending on a user-run service at `127.0.0.1:5050`;
  the focused controller replay uses the same provider.
- Added a live macOS six-language HoshiDicts matrix. The plugin downloaded and
  imported one recommended dictionary for Japanese, English, German, French,
  Korean, and Chinese, and each native popup replay passed selection, scroll,
  focus, dismissal, pause, and liveness checks on 2026-09-08. Evidence is under
  `/tmp/iinatan-e2e-macos-languages-live-current-20260908/`; other dictionaries
  and full corpus correctness remain outside this bounded matrix. macOS desktop capture now
  targets the display containing the player window and records its pixel
  origin/scale, avoiding false geometry failures on non-main displays.
- Added a bounded signed macOS native popup-lifecycle replay. The deterministic
  24-cycle run repeatedly verified foreground activation, trusted pointer and
  Escape input, popup dismissal, pause ownership, and mpv liveness, explicitly
  leaving the subtitle region between cycles so hover transitions are genuine.
  This is bounded lifecycle evidence and does not claim scanout timing or
  long-run compositor stress.
- Added a signed macOS six-language native routing matrix for Japanese, English,
  German, French, Korean, and Chinese. Each deterministic demo replay passed
  stock-mpv geometry, Electron popup, selection/focus, dismissal, and trusted
  native-input checks; live six-corpus dictionary correctness remains separate.
- Hardened transparent macOS popup input ownership: the host activates the
  application before interactive input and registers a popup-visibility-scoped
  global Escape fallback, then unregisters it on dismissal. The latest signed
  feature-parity replay passed audio, Anki, selection, scroll, focus,
  dismissal, pause, and combined-capture gates.
- Kept dictionary cross-references display-only in the shipped overlay.
  Nested lookup is intentionally excluded from iinatan-mp, matching the
  product scope; imported reference-profile keys remain only for migration
  compatibility and have no runtime effect.
- Extended the signed macOS Settings smoke to switch a disposable `default` /
  `study` profile through the real renderer control using native click and
  keyboard input, edit a profile name with native text input, and create/delete
  a disposable profile. The smoke now records the Electron content-boundary
  offset, verifies both macOS input trust checks for each event, and confirms
  the host profile state after each operation. An opt-in migration variant also
  loads a legacy-shaped document through the real app and verifies normalized
  schema, clamping, language values, and dictionary references.
- Added native macOS feature-parity evidence for profile custom CSS. The signed
  live replay applied a selector-based `#popup` rule through the disposable
  profile, confirmed its bounded computed `#popup-panel` background and border
  values in the real popup, and retained the audio, Anki, selection, scroll,
  focus, dismissal, pause, and combined-capture gates.
- Added the signed macOS native-controller contract smoke and corrected the
  DualSense button/trigger mapping. Connected native HID input takes priority
  over a duplicate browser Gamepad observation, while browser input remains a
  fallback for other macOS controllers; physical-device acceptance remains
  explicitly unverified.
- Added a signed macOS feature-parity replay for popup actions. The native
  harness now targets renderer-measured audio and Anki controls, verifies five
  live audio candidates, and adds one note through an ephemeral loopback
  AnkiConnect mock without touching the user's collection; the same run still
  passes native selection, scroll, focus, dismissal, pause, and combined-capture
  gates.
- Hardened macOS player-focus restoration by retrying native activation until
  the probe reports verified foreground ownership. The current signed
  deterministic and supplied-media replays now verify both the app's completed
  activation result and the subsequent mpv window readback after Escape and
  outside-popup dismissal.
- Added signed macOS native keyboard/focus evidence to the popup interaction
  matrix. The helper now verifies Tab and Shift-Tab focus transitions while the
  popup remains open, and the deterministic replay selected `samp`, preserved
  pause ownership, dismissed through both native paths, and produced a usable
  desktop interaction recording under `/tmp/iinatan-e2e-macos-keyboard-recorded-demo/`.
- Added a signed macOS native Settings-window acceptance path: the helper
  records the application-menu Settings item and trusted `Cmd+,` input path,
  then verifies focused settings-window bounds and foreground ownership against
  the AppKit probe. Profile lifecycle remains covered by the real settings
  document smoke; other menu accelerators remain explicitly outside this test.
- Replayed the packaged macOS `Open media in mpv…` menu path through the native
  file picker. The selected file was handed to the user's stock mpv with the
  bundled session script and a private IPC endpoint, without a terminal or
  mpv-configuration mutation; the desktop evidence is recorded separately from
  the explicit-path launcher smoke.
- Hardened macOS startup and resize recovery against mpv publishing subtitle
  properties before positive OSD dimensions exist; the controller now
  suspends geometry/input until the renderer dimensions are valid. Released
  mpv plain-subtitle observations also remain usable as a conservative
  approximate event target when `sub-text/ass-full` is unavailable.
- Tightened the supplied-media native selection replay to begin inside the
  measured popup headword region, and retained bounded native-input diagnostics
  when popup opening times out. The current signed macOS replay covers live
  Jitendex/Hoshi lookup, smooth popup transit, native selection and scroll,
  outside-click dismissal, and combined capture; screen recording remains a
  separate opt-in diagnostic.
- Replayed the current selectable-text telemetry against the required
  MARRIAGETOXIN English ASS track using the managed `wty-en-en` download path;
  the signed macOS run passed native `wit` selection, scroll, smooth transit,
  four source-unit probes, outside/Escape dismissal, pause preservation, and
  combined desktop capture.
- Repeated that current required-media acceptance in native macOS fullscreen;
  AppKit reported exact `1470x923` content bounds and the live lookup,
  selection, scroll, dismissal, pause, and combined-capture gates remained
  green.
- Restored the popup's nested-reference parity surface for the Electron slice:
  click, hover, and Shift+hover modes now carry explicit depth, expose a visible
  parent-navigation control, and are covered by the browser smoke. Audio
  playback is stopped when popup context changes, and stale audio responses are
  ignored by request ID.
- Added X11 and Win32 desktop-test backends with native pointer/keyboard input
  and self-contained PNG desktop capture; the required CI smokes now exercise
  transparent Electron popup text selection on both targets.
- Wired the bundled macOS Apple Vision bitmap-subtitle OCR capability into the
  stock-mpv host: selected image subtitle tracks use bounded decoded-subtitle
  requests, paused primary subtitles may opt into screenshot-diff fallback, and
  validated OCR boxes remain explicitly approximate rather than closing the
  exact stock-mpv glyph-equivalence gate. Added request cancellation, per-cue
  caching, settings controls, and controller/geometry coverage.
- Accepted the macOS bitmap-subtitle path against a real PGS track from the
  mounted Hunter × Hunter Blu-ray fixture. The signed native replay now covers
  OCR-created character targets, popup capture, native selection, three
  additional character probes, Escape/outside dismissal, and pause ownership;
  Linux/Windows OCR remains deferred.
- Replayed that bitmap path with the app's live `wty-en-en` Hoshi dictionary,
  including managed download/import, structured popup content, native scroll,
  and the same selection/probe/dismissal matrix.
- Extended the combined stock-mpv/Electron harness to Linux X11 and Windows,
  including named-pipe IPC, platform helper selection, DPI-aware input
  coordinates, and virtual-desktop capture origins. Required hosted jobs are
  defined with explicit approximate-geometry limits; no runner result is
  claimed until CI executes them.
- Added CI dependency-freshness and moderate-or-higher vulnerability gates.
- Updated the Electron runtime to `44.2.0`, electron-builder to `26.15.3`,
  and Prettier to `3.9.6`; the supported Node engine is now `>=22.12.0`.
- Portable Windows/Linux HoshiDicts helpers now attest the pinned upstream
  revision in both `version` and `ready` responses; the portable smoke and
  package validator reject a mismatched backend or revision.
- Added a required Linux CI X11 native-window smoke. It runs a real Electron
  window under Xvfb/Openbox and verifies `_NET_WM_PID` discovery, activation
  observation, movement, and resize through the compiled X11 helper without
  mislabeling that narrower probe as full stock-mpv overlay evidence.
- Added a required Windows CI native-window smoke that verifies real HWND
  discovery, client-area/DPI conversion, foreground observation, movement, and
  resize through the compiled Win32 helper; stock-mpv overlay evidence remains
  a separate gate.
- Added the native application-menu `Open media in mpv…` bootstrap. It starts
  the user's existing mpv with the bundled session script and a private IPC
  endpoint without editing mpv configuration, invoking a shell, or opening a
  terminal; the launcher contract and platform-specific endpoint behavior are
  covered by integration tests.
- Added a non-terminal `--open-media` path for packaged Windows/Linux launches
  where no visible companion window exists to expose the application menu; it
  uses the same private session and descriptor-discovery contract.
- Extended Settings Diagnostics with the active subtitle-geometry source,
  exactness flag, and sanitized failure reason, so fail-closed stock-mpv lookup
  boundaries are visible without exposing host paths.
- Restored selector-based custom popup CSS, including the reference `#popup`
  selector, while retaining the local-only resource and expression security
  boundary; the real Electron browser smoke now verifies computed selector
  styling.
- Added an opt-in real stock-mpv launcher smoke against the supplied media,
  including descriptor/IPC identity and cleanup. It also caught and fixed a
  macOS Unix-socket path-length regression by shortening generated endpoints.
- Built and verified the signed macOS arm64 directory package, ZIP, and DMG;
  archive integrity and deep code-signature checks pass with the Apple
  Development identity. Notarization remains unavailable without Apple
  notarization credentials.
- Added a real two-process stock-mpv smoke that verifies distinct session
  descriptors, PID/IPC identity binding, isolated property updates, and
  descriptor cleanup without title-based cross-talk.
- Added a forced-termination/replacement smoke proving stale mpv descriptors
  are ignored and a replacement process can reconnect through its own IPC
  endpoint.
- Reviewed native dependencies against upstream: libass remains current at
  `0.17.5`, and HoshiDicts `main` still resolves to the pinned
  `a28d82eb0f169b8ceff79e8c99ffe0b96709ab27` revision. Refreshed the native
  support lock to FFmpeg `9.0.1`, HarfBuzz `14.4.0`, FreeType `2.14.3`,
  FriBidi `1.0.16`, libunibreak `7.0`, zlib `1.3.2`, and pkgconf `3.0.7`,
  rebuilt the macOS helper, removed stale build caches from the source archive,
  and reran dictionary, stock-pixel, package, and security validation; the
  remaining full ASS envelope gap is unchanged and explicit in
  `docs/native-backend.md`.
- Refreshed the host stock-mpv validation stack to Homebrew mpv `0.41.0_9`,
  FFmpeg `9.0.1_1`, and HarfBuzz `14.4.0`; libass stayed at current `0.17.5`
  and HoshiDicts stayed at the current `main` revision. Repeated subtitle,
  launcher, deterministic stock-pixel, and supplied-media ASS probes; the
  renderer-boundary exactness result is unchanged.
- Rebuilt the macOS HoshiDicts helper from the hash-locked libass `0.17.5`
  unit-ID and additive visible-envelope patches. The geometry protocol now
  reports `envelopeRects` for independent stock-pixel validation while keeping
  fill rectangles as the runtime hit target; deterministic fixture envelope
  IoUs range from `0.8845315904139434` to `1.0`, and the supplied-media run
  reports visible-envelope IoU `1.0` with fill IoU `0.9990138067061144`.
- Hardened the Electron release contract with explicit web-security settings,
  redirect blocking, protocol-host validation, response CSP headers, stricter
  external URL parsing, and ZIP duplicate/special-entry/offset checks; added
  regression coverage for these untrusted-input boundaries.
- Added an 8 MiB cap for newline-delimited stock-mpv JSON-IPC responses so an
  oversized or unterminated local endpoint fails closed instead of growing the
  host buffer without bound.
- Bounded settings, session-descriptor, and Hoshi worker state/response file
  reads before JSON parsing, rejecting oversized or non-regular files.
- Wired the existing macOS Hoshi native-HID capability into the Electron
  worker/session controller path, with browser Gamepad fallback, capability
  negotiation, stale/disconnect handling, and contract tests; physical
  controller acceptance remains unverified.
- Kept native-HID polling alive through stale, malformed, or temporarily
  missing snapshots, emitting a neutral disconnect state while allowing a
  later device reconnect to be observed; added recovery coverage.
- Hardened browser-gamepad hot-swap handling so disconnects and replacement
  devices cannot inherit held-button or repeat state; browser hotplug events
  are published immediately where available; added a regression test.
- Added a supplied-media ASS attachment smoke that demuxes the real embedded
  subtitle stream and fonts, compares visible-grapheme rectangles with
  stock-mpv pixels, checks native word coverage, and records the remaining
  glyph-equivalence gap; it now separates the full rendered envelope
  (`0.785674887715704`) from primary-colour character registration
  (`0.9990138067061144`).
- Added controller integration coverage proving Anki duplicate-note opening,
  word-audio and mpv screenshot storage before note creation, alongside the
  existing duplicate-prevention and sentence-audio paths.
- Added a loopback mock AnkiConnect smoke covering deck/model discovery,
  duplicate lookup/open, word-media storage, and note creation without touching
  the user's real Anki collection.
- Added a Linux CI display job that runs the real Electron overlay and settings
  document smokes under an explicitly installed Xvfb server. The job records
  browser integration coverage separately from native X11/Wayland attachment
  and compositor evidence.
- Passed the signed macOS GUI-launched Phase A desktop replay against stock
  mpv 0.41.0 and the supplied MARRIAGETOXIN MKV: native subtitle hover,
  transparent Electron popup, combined desktop capture, native click, pause
  ownership, and Escape dismissal all completed with Accessibility and
  CoreGraphics post-event access granted.
- Added an E2E lookup-language override for real-media fixtures and made the
  pause assertion distinguish user-owned startup pause from plugin-owned pause.
- Corrected macOS signing diagnostics to parse the `codesign` identity output
  emitted on stderr.
- Added an opt-in live recommended-dictionary smoke that downloads Jitendex
  through the catalog, imports it with HoshiDicts, and verifies a real lookup
  in a disposable settings/install root.
- Added an opt-in live-dictionary native desktop mode that feeds the catalog's
  managed Jitendex install into the real Electron app and verifies the Hoshi
  backend during the supplied-media popup/input replay.
- Added an opt-in independent stock-mpv pixel oracle for the supplied
  MARRIAGETOXIN Japanese SubRip track; the real `1920x1080` capture passed
  grapheme-coverage checks with IoU `0.9359332340531149` and additive
  visible-envelope IoU `1.0`.
- Fixed macOS fullscreen content attachment by targeting the AppKit sidecar's
  native window identity before the unqualified CoreGraphics scan; the supplied
  media fullscreen desktop replay now passes with exact content bounds.
- Replayed the same fullscreen path with a real downloaded Jitendex import and
  Japanese lookup; signed native input, combined capture, pause ownership, and
  Escape dismissal all passed. Four additional grapheme probes also resolved
  to the expected units, and the popup capture used renderer-measured size
  plus a changed-pixel diff rather than window visibility alone.
- Made the short-cue startup assertion establish stock-mpv pause ownership
  before the bridge connects and reassert it after the active subtitle event;
  native player focus now yields the Electron app so foreground observation is
  meaningful after popup dismissal.
- Kept identity-checked macOS sidecar geometry usable during a transient
  CoreGraphics probe gap, while preserving the PID/window identity checks.
- Added opt-in native popup interaction coverage for wheel scrolling and text
  selection drags, with renderer-published region, scroll, and selection
  telemetry; clipped scrollable-content regions to the visible popup viewport;
  the signed supplied-media replay passed native selection (`unter`), scroll
  offset (`480`), combined capture, pause preservation, Escape dismissal, and
  mpv survival.
- Added an opt-in macOS native settings-window smoke that verifies the shipped
  Settings application-menu item, CoreGraphics window-probe bounds against
  Electron bounds, and native activation/foreground ownership; the signed
  `Cmd+,` menu-keystroke path is covered by the newer acceptance replay.
- Extended the native desktop latency report with a combined-capture popup
  sample: native pointer injection to the first changed-pixel result in a
  compositor capture containing both mpv and Electron. The report labels this
  as an upper-bound observation rather than scanout timing.
- Made popup input ownership explicit while the popup is open: the passive
  highlight surface is hidden/non-forwarding, the popup is raised as the sole
  floating input surface, and native selection evidence records window/panel
  bounds for both drag endpoints. The native matrix now reports a deliberate
  skip when a short fixture has no scrollable popup content and verifies that
  an outside-panel click is consumed without toggling mpv.

- Reflowed active popup placement from the renderer's measured layout after
  dictionary content, font, audio-menu, or custom-CSS changes; layout-only
  updates preserve the existing DOM, focus, and selection.
- Kept popup wheel scrolling entirely in the native browser surface instead of
  forwarding an unused duplicate action through the host bridge.
- Ignored stale passive subtitle targets while popup, nested-popup, selection,
  or audio-menu states own interaction, closing a crossed-word lookup race.
- Explicitly released renderer pointer capture when the host dismisses a popup
  during an active text selection.
- Normalized host-driven popup dismissal through the interaction state machine
  so geometry invalidation and shutdown cannot leave selection capture active.
- Kept the popup companion surface hidden until its renderer readiness
  handshake completes, closing a startup/recovery input race.
- Added per-surface renderer-readiness state to the persisted E2E diagnostics.
- Cancelled popup text-selection capture on renderer focus loss and covered the
  recovery path in the real Electron browser smoke.
- Wired popup text-selection drags through the explicit interaction state
  machine and DOM pointer capture, including release/cancel recovery and a
  real Electron browser-integration check; control clicks remain on the
  ordinary popup-action path.
- Extended the native E2E status snapshot with the interaction capture and
  native-geometry diagnostic state so blocked runs preserve the reason for
  their current input/geometry boundary.
- Added a non-deprecated macOS activation fallback using
  `activateWithOptions:0` after a rejected cooperative activation request;
  foreground observation remains mandatory and the deprecated
  `activateIgnoringOtherApps` path is still excluded.
- Added a surface-readiness capability handshake that explicitly reports DOM
  transport, native input mode, and the absence of offscreen/bitmap transport
  to the document while keeping Electron window management host-owned.
- Started the Electron companion-surface implementation for stock mpv.
- Added versioned host protocol, coordinate mapper, immutable geometry snapshots,
  popup placement, interaction state machine, pause ownership, and settings
  inventory.
- Added platform-specific native window probe sources and an optional mpv
  session-descriptor script.
- Added a reproducible stock-mpv headless smoke (`npm run test:mpv`) covering
  descriptor creation/cleanup, PID/session identity, and the real JSON IPC
  bridge; this is explicitly not native window/input evidence.
- Added an opt-in native stock-mpv window smoke for real PID/window/frame
  probing and activation-boundary checks; it remains below combined desktop
  composition and input evidence.
- Added a macOS-only desktop test helper and vertical slice that can capture
  the combined compositor and inject isolated input while recording explicit
  Screen Recording/Accessibility capability failures. The current host is
  blocked before the full GPU/input claim.
- Added the macOS 14+ cooperative activation attempt and target diagnostics;
  the current host still reports a live regular mpv target but denies
  foreground hand-off to `loginwindow`, so activation is never treated as
  proof of focus.
- Added an opt-in real-media mode to the native desktop harness via
  `IINATAN_E2E_MEDIA_PATH`, with embedded subtitle selection and a configurable
  cue-bearing start time; the supplied MARRIAGETOXIN MKV reached exact
  instrumented geometry and AppKit content bounds before the host Accessibility
  gate blocked native pointer input.
- Added an opt-in headless real-media stock-mpv smoke
  (`npm run test:mpv:media`) that verifies embedded subtitle track identity,
  ASS payload, source path, and live cue timing without requiring OS input
  permissions.
- Added a bounded external SubRip observation path that mirrors stock mpv's
  text-to-ASS conversion for simple `.srt`/`.subrip` cues, with unsupported
  tags and non-default border styles still rejected; the independent stock-mpv
  pixel oracle now covers the path with IoU `0.9036334913112164`.
- Fixed mpv session callbacks so event payloads cannot be serialized as a
  window id, omitted the non-CoreGraphics macOS `window-id` hint from native
  identity matching, and made the bridge observe properties before reading
  their current values to preserve already-active subtitle cues.
- Made every stock-mpv smoke select the PID-named session descriptor, so a
  native geometry sidecar can never be mistaken for the descriptor by JSON
  directory ordering.
- Made directory-package validation target-aware and added a three-OS CI
  package job; hosted package runners remain separate from GUI acceptance.
- Added a deterministic stock-mpv subtitle-property smoke for SRT/ASS track
  identity, timing, switching, and seeking, plus an opt-in HoshiDicts
  import/worker/lookup smoke with the validated backend command contract.
- Added a portable dictionary-only HoshiDicts worker target for Windows/Linux,
  with source-archive extraction, package staging, and a deterministic
  import/worker/lookup smoke. It explicitly does not advertise platform
  geometry, font-metric, OCR, or native-input capabilities.
- Built the portable worker explicitly on the macOS arm64 host and passed its
  required import/worker/lookup smoke; the cross-platform build target is now
  locally exercised while native GUI/geometry capabilities remain unavailable.
- Added independent stock-mpv `vo=image` pixel oracles for separate bottom, top,
  and supplementary/combining-mark ASS fixtures and simultaneous
  primary/secondary renders in explicit `secondary-sub-ass-override=no` and
  stock's default `strip` modes, compared against no-subtitle baselines and
  native geometry responses. The default `strip` path is bounded to an
  observation-only centered-top reconstruction; this is not desktop composition
  proof.
- Extended the independent pixel oracle with a top-left positioned ASS style
  fixture covering italic text, spacing, outline, shadow, and margins. The
  stock-mpv 0.41.0 run produced bounds IoU `0.8124381065557537` with nonzero
  coverage for both requested units; this remains pixel-bounds evidence and
  does not promote custom native-adapter or per-glyph support.
- Added a stock-mpv oracle fixture for two simultaneous events in one track
  with an explicit `\\N` line break. The unmodified mpv comparison produced
  bounds IoU `0.92` with nonzero coverage for all five requested word regions,
  and the native request regression now preserves both event boundaries.
- Added an explicit-position ASS fixture: valid inline `\\pos(200,200)` is
  passed through the native libass path and matched against stock pixels with
  IoU `0.8614864864864865`; malformed positions remain fail-closed.
- Added an explicit-movement ASS fixture: four-argument `\\move` is passed
  through the native libass path at the event midpoint and matched against
  stock pixels with IoU `0.8862068965517241`; malformed movement remains
  fail-closed.
- Added a bounded static ASS-tag fixture for inline alignment, font, size,
  spacing, border, shadow, rotation, rectangular clipping, and karaoke; the
  stock-mpv comparison produced IoU `0.9422287390029326` with nonzero unit
  coverage.
- Added a bounded ASS-transform fixture with numeric timing and a supported
  nested font-size modifier; the stock-mpv comparison produced IoU
  `0.8994301994301994` with nonzero unit coverage. Nested transforms remain
  fail-closed.
- Added a fail-closed advanced-ASS fixture and regression for vector clipping,
  drawing mode, and unknown tags; unsupported
  native geometry remains visible through bounded
  diagnostics rather than guessed lookup rectangles.
- Added an independent mixed-language ASS oracle covering Japanese, English,
  German, French, Korean, and Chinese. The stock-mpv 0.41.0 comparison produced
  bounds IoU `0.8630438324914453` with nonzero coverage for all six requested
  word regions.
- Added a color-separated unit-identity ASS oracle with simultaneous red and
  blue events. The stock-mpv 0.41.0 comparison produced bounds IoU
  `0.8612880870945387` with nonzero color-matched pixels for all four requested
  word regions; this is bounded event/unit correspondence evidence, not native
  pointer probes or per-glyph exactness.
- Added a missing-font ASS oracle fixture. The stock-mpv 0.41.0 comparison
  produced bounds IoU `0.875` with nonzero coverage for both requested word
  regions, recording fallback-font behavior without claiming a specific font
  on every platform.
- Hardened stock-mpv window discovery for Cocoa initialization: the native
  harness uses mpv's immediate window mode and explicit `gpu-next`, while the
  session descriptor publishes safe PID/session/IPC identity before optional
  window properties are available. Wake-assisted validation now passes the
  exact AppKit content sidecar; host foreground hand-off remains a separate
  blocked gate.
- Added the bounded secondary-`strip` native adapter: it reconstructs plain
  centered-top ASS styling from observed stock-mpv options and fails closed for
  custom positions, alignments, malformed style values, and unsupported text.
- Added explicit subtitle-visibility and secondary ASS-override handling to the
  mpv bridge, plus a bounded JSON-IPC connection timeout for renderer-stalled
  sessions.
- Made stalled mpv property attachment fail fast and bounded native E2E cleanup,
  preserving a structured GPU/IPC blocker instead of hanging the harness.
- Added explicit mpv GPU-context selection and property-level timeout diagnostics
  to the native desktop harness; the current host still blocks combined evidence
  because default/auto contexts stall JSON IPC and the explicit
  `gpu/macvk/system` path cannot restore mpv foreground ownership on this host.
  The harness now waits for active subtitle geometry, isolates task-owned
  children in process groups, and cleans them up on blocked runs.
- Rechecked the native harness with mpv's canonical `macvk` context for both
  `gpu-next` and `gpu`; the host still stops before active playback properties,
  so these runs add renderer/IPC blocker evidence rather than native support.
- A wake-assisted canonical `gpu-next`/`macvk` replay reached exact instrumented
  two-track geometry and exact AppKit content bounds with the display awake;
  foreground activation was still denied by `loginwindow` before native input.
- Corrected the Phase A vertical-slice fixture to load independent bottom and
  top subtitle tracks before probing secondary-track properties; the current
  macOS GPU session now reaches the subtitle-event gate before blocking.
- Added early player activation and bounded mpv debug-log capture to the native
  vertical slice; a current run reaches exact instrumented geometry and the
  AppKit content sidecar before the host rejects foreground hand-off.
- Added opt-in native-E2E evidence preservation for structured reports, status
  snapshots, desktop captures, input configuration, and renderer logs.
- Added a read-only settings Diagnostics card for platform/backend capability,
  active-session geometry state, and explicit native-desktop evidence boundaries;
  it does not expose host paths or claim unverified stock-mpv behavior.
- Native geometry failures now retain a bounded, path-redacted code/message in
  per-session Diagnostics, making fail-closed unsupported ASS cases visible
  without exposing request or dictionary paths.
- Added a deterministic BrowserHost window/input lifecycle test and made the
  native macOS E2E record failed foreground activation details instead of
  treating an AppKit activation request as proof of focus.
- Exact geometry promotion now requires both validated subtitle rectangles and
  authoritative native player-content bounds; a macOS window-frame probe cannot
  silently become an exact desktop lookup path.
- Companion surfaces now use foreground-owned floating z-order and release it
  when the player session is backgrounded, with BrowserHost coverage for that
  ownership transition.
- Added an explicit approximate-geometry desktop-E2E mode for future graphical
  runners to test compositor/input ownership without relabeling the result as
  exact subtitle alignment.
- Added a real Electron/Chromium browser-document integration smoke covering
  structured entries, nested lookup, selection, audio/controller actions,
  stale generations, accessibility semantics, CSP, and custom CSS, plus a
  repeated controller attach/detach stress case and a Phase A performance
  benchmark with environment metadata.
- Added a real Electron settings-document smoke covering the sandboxed
  settings preload, profile rename/save/create/switch/delete lifecycle,
  dictionary enablement, capability diagnostics, CSP, and request allowlisting.
- Wired the profile's lookup, hover-request, backend-IPC, subtitle-refresh, and
  dictionary-worker polling timeouts into the live controller and worker paths;
  stalled lookups now produce a distinct bounded timeout and cancel backend
  work.
- Applied popup minimum-width and subtitle-line-break preferences at the
  browser/controller boundary, and documented which migrated IINA-only controls
  remain preserved but intentionally unsupported.
- Added host-managed recommended dictionary downloads and staged updates for
  all six configured lookup languages, with HTTPS redirect limits, streaming
  size bounds, ZIP validation, and upstream-source documentation.
- Replaced the six-language lookup scaffold with bounded Yomitan-derived
  English/German/French deinflection candidates, Japanese furigana skipping,
  German separable-verb candidates, and host-side worker candidate merging;
  surface and lemma results are deduplicated under cancellation.
- Added bounded non-lemma glossary-reference follow-up with a safe tagged-form
  fallback when no authoritative lemma entry is available.
- Preserved dictionary-scoped Etymology presentation in the safe structured
  renderer, including global collapse settings, Wiktionary/Kaikki overrides,
  `inherit`, native `<details>` state, Grammar rows, and bounded non-lemma
  Form-of/Inflection rows in the Electron document.
- Added macOS directory-package validation for asar/native-resource
  completeness and non-destructive copy/remove installation layout; signing,
  notarization, and other platform installers remain explicitly unverified.
- Added honest Phase A capability and feature matrices; exact ASS geometry,
  native desktop evidence, full dictionary services, and packaging remain
  open gates.
- Hardened the Phase A lifecycle path: plugin-owned pause generation survives
  geometry refreshes correctly, stale popups are dismissed on media/window
  changes, unavailable player windows suspend surfaces and recover cleanly,
  stale worker responses are discarded, and malformed native bounds are
  rejected before coordinate mapping.
- Added the opt-in native ASS geometry client/service boundary, validated
  response merging, UTF-16 range preservation around browser graphemes,
  drawing/unsupported-tag fail-closed behavior, and controller stale-refresh
  protection. The validated macOS backend is bundled but remains opt-in
  pending broader stock-mpv oracle evidence.
- Added the optional macOS stock-mpv C-plugin content shim. It publishes an
  identity-checked AppKit content-view sidecar with scalar geometry only; the
  host promotes it to exact player bounds while keeping the external frame
  fallback inexact. The stock-mpv sidecar smoke passed, but the combined
  desktop/input gate remains blocked by host foreground ownership.
- Added an explicit stock-mpv compatibility contract and `cplugins` capability
  check so unsupported builds fail with a diagnostic instead of being treated
  as exact-content support.
- Added explicit windowed/fullscreen switches to the stock-mpv geometry smoke
  and combined desktop harness; fullscreen results are labeled as separate
  acceptance evidence rather than inferred from a requested flag. The window
  smoke now records mpv's observed `fullscreen` property and, when the macOS
  shim is present, the public AppKit fullscreen style-mask observation. The
  validated stock-mpv fullscreen request reported true through mpv but false
  through AppKit, so the strict shim smoke fails instead of claiming native
  Spaces/compositor fullscreen.
- Added a PerMonitorV2 manifest to the Windows native probe so mixed-DPI
  geometry is not silently collected through an unaware helper; actual Windows
  multi-DPI and fullscreen behavior remains unverified without a GUI runner.
- Made the Windows and X11 probes label their desktop-physical coordinates and
  convert both rectangle corners through Electron's DIP boundary before surface
  placement; the conversion and fail-closed behavior are unit-tested.
- Hardened the Linux X11 probe's EWMH property parsing against malformed or
  truncated format-32 data, and label `_NET_ACTIVE_WINDOW` activation as a
  request until a later foreground observation verifies it.
- Made native activation results consistent across Windows, macOS, and Linux:
  request acceptance and observed foreground state are reported separately.
- Verified the X11-enabled Linux probe branch compiles and links against the
  host's 64-bit Xlib ABI; the host still has no X11 display for GUI evidence.
- Added primary/secondary subtitle delay and subtitle-speed invalidation to the
  player bridge so timing-control changes publish a new geometry generation;
  the stock-mpv subtitle smoke now exercises and restores those controls.
- Corrected the bridge's `sub-start/full` and `sub-end/full` handling to retain
  mpv's documented millisecond units instead of scaling them a second time.
- Verified unsigned macOS arm64 directory, DMG, and ZIP outputs plus direct
  Electron runtime startup; CI now packages and uploads Windows/Linux
  distributables and validated directories, with Ubuntu 24.04 x86-64 recorded
  as the Linux build baseline. Windows/Linux execution and native desktop input
  remain unverified.
- Added the sandboxed profile/settings window with dictionary ordering,
  enablement, managed import/removal, backup/restore, Anki model-field helpers,
  and controller binding editors.
- Added nested lookup, bounded audio-source menus, dictionary audio nodes, and
  deadzone-aware Gamepad routing across popup and audio-menu contexts.
- Added host-rendered Anki duplicate/open flows, bounded word-audio and
  screenshot media handling, plus a bounded sentence-audio capture service
  that uses an explicit or packaged ffmpeg executable through `execFile` and
  preserves a visible warning when that capability is not installed.
- Made unknown-length legacy audio and media response shims fail closed before
  an unbounded fallback read, and removed the unbounded Anki JSON-only
  compatibility path; streamed responses remain incrementally size-bounded.
- Preserved Hoshi/Yomitan structured-content glossaries through a bounded,
  allowlisted node model, including safe links, tables, ruby, details, and
  dictionary metadata used by Anki markers for frequency, pitch, phonetics,
  and selected definitions.
- Isolated each live mpv session behind its own controller and pair of browser
  surfaces, synchronized shared settings across sessions, and treated focused
  popup windows as part of the owning session for foreground tracking. Gamepad
  events are accepted only by the foreground session (or its focused popup).
- Scoped dictionary cancellation to the owning controller and completed the
  migrated `shift-hover` lookup mode through the passive pointer-move bridge.
- Preserved popup text selection through host-mediated Anki note creation,
  including nested-popup selection restoration.
