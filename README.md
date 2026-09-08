# iinatan for stock mpv

This is the in-progress Electron successor to iinatan for ordinary desktop mpv.
It keeps mpv as the player and keeps mpv responsible for visible subtitles. The
HTML popup is displayed by normal transparent browser surfaces; it is not a
screenshot, OSD bitmap, replacement subtitle renderer, or embedded libmpv
player.

The repository is currently in Phase A. It contains the host protocol, native
window probe boundary, session-aware mpv IPC, coordinate contract, placement and
input state machine, secure demo popup, settings inventory, and unit/integration
tests. The validated HoshiDicts worker is bundled for macOS arm64 with a
corresponding-source archive, and Windows/Linux packages build a portable
dictionary-only worker from that same archive; user dictionaries still require
import. Language
candidate, bounded recommended dictionary downloads, audio-source, and
AnkiConnect service boundaries require their
respective configuration. The native ASS/libass client boundary ships that
helper on macOS. The packaged macOS companion enables the bounded,
tuple-gated backend by default; source development launches can opt in with
`--enable-patched-native-geometry`, and `--disable-patched-native-geometry` or
`IINATAN_DISABLE_NATIVE_GEOMETRY=1` disables the packaged default. Unsupported
renderer modes and player tuples still fail closed, while the full stock-mpv
glyph-equivalence oracle remains open.
The same signed macOS helper exposes Apple Vision OCR for selected bitmap
subtitle tracks through a bounded host request boundary. OCR boxes remain
approximate lookup geometry (`exact:false`) and are not used to close the
stock-mpv glyph-equivalence gate; Windows/Linux OCR is unverified.
Read `docs/architecture-decision-record.md`, `docs/coordinate-geometry.md`,
`docs/input-state-machine.md`, `docs/native-geometry.md`,
`docs/platform-capability-matrix.md`, `docs/deinflection.md`,
`docs/mpv-compatibility.md`, `docs/feature-matrix.json`,
`docs/settings-migration.md`, `docs/security.md`, and `docs/validation.md`
before treating a test as support evidence.

“x86” means x86-64 / AMD64, not 32-bit IA-32. Declared targets are macOS arm64,
Windows x86-64, and Linux x86-64. Linux Wayland compositors require separate
identified integration; generic Wayland is not silently downgraded to X11.

## Development

```sh
npm test
cmake --preset release
cmake --build --preset release
npm run test:mpv
npm run test:mpv:commands
npm run test:mpv:multi
npm run test:mpv:recovery
npm run test:mpv:subtitles
IINATAN_PUBLIC_LAYOUT_REQUIRED=1 npm run test:mpv:layout-interface
IINATAN_NATIVE_WINDOW=1 npm run test:mpv:window
npm run test:browser
npm run test:settings
npm run test:native:x11
npm run test:native:windows
npm run test:native:selection
npm run test:native:controller
IINATAN_E2E_AUTOSTART_REQUIRED=1 IINATAN_E2E_AUTOSTART_RESTART=1 \
npm run test:native:autostart
# Optional stronger macOS direct-launch replay: real Settings download + live popup
IINATAN_E2E_AUTOSTART_REQUIRED=1 IINATAN_E2E_AUTOSTART_RESTART=1 \
IINATAN_E2E_AUTOSTART_LIVE_POPUP=1 \
npm run test:native:autostart
IINATAN_E2E=1 npm run test:native:multi
npm run test:anki
npm run test:sentence-audio
npm run benchmark:phase-a
npm run validate:release
npm run validate:package
npm run test:hoshi
npm run test:hoshi:portable
npm run test:stock-pixels
```

`test:mpv` launches the installed stock mpv headlessly to verify the bundled
session descriptor and real JSON IPC bridge. It is not native desktop proof;
run `npm run test:e2e` only in the documented isolated graphical environment.
`test:mpv:commands` loads the supplied real media and sends every mapped
controller player command—including seek, subtitle-step, frame-step, volume,
speed, and pause—through the live `PlayerBridge`, so command-routing regressions
cannot hide behind a successful socket connection.
`test:mpv:launcher` is opt-in. Set
`IINATAN_MPV_LAUNCHER_REQUIRED=1` to start the supplied or configured media
through the application launcher, read its real descriptor, connect to its
real IPC endpoint, and terminate it cleanly. It is ordinary stock-mpv launch
evidence, not native desktop composition or input proof.
`test:mpv:multi` launches two ordinary stock mpv processes, verifies distinct
PID/session/IPC identities, changes a property through each bridge, and checks
that the values do not cross session boundaries before both descriptors are
removed.
`test:native:multi` is the macOS graphical counterpart. With `IINATAN_E2E=1`
it launches two real stock-mpv windows using the supplied MARRIAGETOXIN media,
attaches the normal Electron process to both through their explicit session
descriptors and AppKit content sidecars, switches foreground ownership between
the two windows, removes one player, and attaches a replacement. It also
changes independent mpv properties through both live IPC sessions. This is
macOS multi-instance ownership evidence; it does not promote stock-mpv
per-glyph equivalence or Linux/Windows support.
`test:mpv:recovery` force-terminates a stock mpv process, verifies that its
stale descriptor is ignored, starts a replacement in the same descriptor
directory, and reconnects through the replacement's real IPC endpoint.
`test:mpv:subtitles` adds deterministic SRT/ASS primary-secondary track,
timing, switching, and seeking checks. It still does not prove native
per-glyph geometry or desktop composition.
`test:mpv:layout-interface` is a graphical, opt-in probe of mpv's supported
in-process `osd-overlay`/`compute_bounds` interface. It records the aggregate
rectangle returned for a synthetic ASS overlay and for separately submitted
single-glyph overlays. It does not query the built-in subtitle event and is
therefore evidence of the public API boundary, not runtime geometry proof.
`test:mpv:media` is an opt-in headless smoke for a real local file. Set
`IINATAN_MEDIA_PATH`, optionally `IINATAN_MEDIA_SUBTITLE_ID`, and choose a
cue-bearing `IINATAN_MEDIA_START_SECONDS`; it verifies the selected track,
source identity, ASS or converted-text payload, and live cue timing without
requiring OS input permissions.
`test:mpv:window` is opt-in native window identity/frame evidence; run it as
`IINATAN_NATIVE_WINDOW=1 npm run test:mpv:window` in a graphical session. It
does not prove combined compositor capture or native pointer/keyboard input.
On macOS, pass `IINATAN_NATIVE_SHIM=/absolute/path/to/iinatan-mpv-window-shim.so`
to include the optional in-process AppKit content-view sidecar; that promotes
the player bounds only when the sidecar's PID and window identity match. It
still does not promote subtitle registration or combined desktop evidence.
Set `IINATAN_NATIVE_WINDOW_FULLSCREEN=1` to exercise the same smoke against
mpv's fullscreen state. Without the shim, `fullscreenObserved` comes from mpv
IPC only. With the shim, the output also reports the public AppKit window-style
mask observation. The idle-only window smoke can report
`fullscreen=true` while the AppKit mask remains false because no media-backed
fullscreen transition has occurred; the strict shim smoke fails rather than
silently relabeling that case. The real-media desktop harness separately
passed stock mpv 0.41.0 fullscreen with exact AppKit content bounds after
targeting the sidecar's native window identity.
`test:browser` runs the real overlay HTML in the pinned Electron/Chromium
engine and checks large structured entries, cross-reference rendering,
selection, audio menus, keyboard/wheel/outside-pointer messages, accessibility
semantics, stale generations, highlight rendering, CSP, and custom-CSS
rejection. It is browser integration evidence, not OS-level focus or
click-through evidence. Nested lookups are available in the popup's configured
`click`, `hover`, and `shift-hover` modes with bounded depth; they are
intentionally not an assignable gamepad action.
Audio responses are correlated to the active request. These are renderer and
host behaviors; their separate native-desktop evidence remains labeled in the
feature matrix.
Selected macOS bitmap subtitle tracks use the bundled Vision OCR helper through
the decoded-subtitle path; the optional screenshot-diff fallback is restricted
to paused primary subtitles and is disabled by default. `npm test` covers the
request validation, response-to-hit geometry mapping, and controller lifecycle.
`test:settings` runs the real sandboxed profile/settings document and checks
profile rendering and save, dictionary enablement, capability diagnostics, CSP,
and preload request allowlisting. It does not prove native menu invocation or
settings-window focus.
`test:native:x11` and `test:native:windows` are required CI probe smokes for the
Linux X11 and Windows window-boundary implementations. They create real
Electron windows and verify native identity, physical geometry, activation
observation, movement, and resize. They do not substitute for stock-mpv
companion-overlay, native input, or combined-desktop evidence; on other hosts
they report an explicit skip unless their `*_REQUIRED` variable is set.
`test:native:selection` is the required Linux/Windows CI smoke for the native
desktop input helper and a real transparent Electron popup. It performs a
native drag and verifies browser text selection; it does not substitute for
stock-mpv subtitle attachment or combined mpv/overlay evidence.
`test:anki` starts an ephemeral loopback AnkiConnect mock and exercises deck/model
discovery, duplicate lookup/open, media storage, and note creation without
contacting or modifying the user's real Anki collection.
`test:settings:native` is an opt-in macOS graphical smoke. Set
`IINATAN_NATIVE_SETTINGS=1` to launch the normal app with Settings visible,
verify the application-menu Open Media (`Cmd+O`) and Settings (`Cmd+,`) items,
exercise the signed native Settings shortcut input path and its two macOS trust checks, compare the native window-probe frame
with Electron's reported bounds, and verify native activation/foreground
ownership. It also switches a disposable `default`/`study` profile through the
real settings select using trusted native click and key events, edits a profile
name through native text input, and creates/deletes a disposable profile. Set
`IINATAN_NATIVE_SETTINGS_MIGRATION=1` to feed the same real app a legacy-shaped
settings document and verify schema/language/clamp normalization. The smoke also
scrolls to the dictionary controls and drives the real macOS Save/Open panels
through a disposable backup path, then verifies restore; other menu accelerators
remain outside this test.
`test:sentence-audio` generates a bounded local fixture and runs the real
host-side ffmpeg capture boundary. It requires `ffmpeg` on PATH or an explicit
`IINATAN_FFMPEG` override and does not substitute for package-level codec
validation.
`benchmark:phase-a` reports p50/p95/p99 host and geometry microbenchmarks with
fixture size and environment metadata; it does not substitute for native
pointer-to-presentation or compositor latency measurements.
`validate:release` is the static release gate for the packaged Electron
security contract, pinned native/resource checksums, feature-matrix inventory,
and forbidden runtime mechanisms. Dependency freshness and vulnerability checks
are separate `npm outdated --json` and `npm audit --audit-level=moderate` gates.
`validate:package` checks the generated platform directory package, its asar
and native resources, and a copy/remove sandbox that preserves user settings
and dictionaries. On macOS it also checks the bundled full HoshiDicts helper
and source archive; Windows/Linux package validation checks the portable
dictionary helper. It does not claim signed-installer, notarization, or native
GUI evidence.
`test:e2e` is the stricter combined desktop harness; run it with
`IINATAN_E2E=1` after `npm run build:native` in an isolated graphical session.
The signed macOS path can claim exact instrumented geometry; Linux X11 and
Windows CI paths currently use explicit approximate-geometry mode until their
portable workers gain a geometry backend. For renderer diagnosis,
`IINATAN_E2E_GPU_CONTEXT=macvk` (or `displayvk`) passes an explicit mpv context; treat
permission/renderer failures as blockers rather than support evidence.
The macOS test helper reports Accessibility and CoreGraphics post-event access
separately; both must be true before native pointer/keyboard evidence can pass.
Screen capture can succeed while `postEventTrusted:false` still blocks synthetic
input, especially when the helper is launched from an SSH/tmux session.
After every native rebuild, a locally available Apple Development or Developer
ID Application identity can be applied to the finished test bundle with
`npm run sign:native:macos`. The command refuses to fall back to ad-hoc signing;
once signed, add that exact bundle to Accessibility and rerun the test. This
workspace's current signed acceptance bundle uses an Apple Development identity
with Team ID `VWU398WDQ6`; after re-signing or rebuilding, re-add the exact
finished bundle to Accessibility before rerunning the test. The signed GUI
launched acceptance replay reports both `accessibilityTrusted:true` and
`postEventTrusted:true`.
The popup assertion also requires the renderer's measured DOM size and a
desktop screenshot diff in the requested region; a bounded capture retry
allows compositor paint to settle, so a visible window by itself is not
treated as capture proof.
`IINATAN_E2E_ALLOW_APPROXIMATE=1` is an explicit integration-only mode for
testing compositor/input ownership when exact player-content bounds are not
available; it never claims exact subtitle alignment.
Set `IINATAN_E2E_REQUIRE_STABLE_SIGNING=1` for a TCC acceptance run; it records
and requires a non-ad-hoc signature on the helper bundle.
The default vertical slice uses the demo dictionary service and an explicit
English lookup-language override so the supplied English subtitle cue produces
a deterministic popup; this validates native windows, input, pause ownership,
and combined capture. The opt-in live mode accepts
`IINATAN_E2E_DICTIONARY_DOWNLOAD_ID` and a matching
`IINATAN_E2E_LOOKUP_LANGUAGE`, downloads/imports the catalog entry into a
disposable user-data directory, launches the real app without `--demo`, and
requires its status to report the Hoshi backend before native input assertions
continue.
`IINATAN_E2E_FULLSCREEN=1` selects native fullscreen for the same harness; a
fullscreen run is a separate acceptance result from windowed mode.
Set `IINATAN_E2E_ADDITIONAL_POINTER_PROBES=N` to move across N additional
lookupable subtitle units after the initial popup. Each probe must resolve to
the expected track, event, and unit, then close without changing pause
ownership or leaking Escape to mpv. This is opt-in because it intentionally
opens and dismisses several real native popups; a rapid popup flash during this
diagnostic is expected even when the pointer appears stationary.
Set `IINATAN_E2E_NATIVE_INTERACTION=1` to add real native popup text-selection
drag and wheel-scroll checks. The harness records DOM region telemetry, records
the popup window/panel bounds, and rejects native targets outside the open
popup. It also moves directly to a second reachable subtitle unit while the
first popup remains open, requires the popup's bound event/unit identity to
change, and requires the selection-style highlight surface to stay visible.
It requires scroll state to change when the measured popup actually
overflows; a short non-scrollable fixture records an explicit skip. Content
region telemetry is clipped to the visible scroll viewport so the helper never
targets offscreen content. The signed macOS run against the supplied
MARRIAGETOXIN media selected `unter`, reached scroll offset `480`, preserved
pause ownership, dismissed with native Escape, and left mpv alive; it also
reopened the popup and consumed an outside-panel click without toggling mpv.
On macOS this replay also records `popupForegroundSamples`: while the
non-activating panel is open, popup open, hover replacement, selection,
keyboard, wheel, and button-click stages must all still report mpv as the
frontmost application. The explicit Escape/outside dismissal boundary then
restores player focus normally.
On macOS, the same matrix also sends signed native Tab and Shift-Tab events
after selection and records the observed focus targets; the popup must remain
visible and focused while Tab moves from `popup-panel` to a real control and
Shift-Tab moves to a different popup control. A deterministic signed run
selected `samp`, passed those focus transitions, preserved pause ownership,
and left mpv alive.
The current deterministic signed replay changed the popup hit from `c` to the
adjacent `a` unit in `129.377 ms`; enlarged recording frames visibly show the
blue highlight move between those glyphs while the popup remains open. The
same run passed native selection, Escape, an explicit pointer leave/re-entry,
outside-panel dismissal, pause ownership, and mpv liveness. Evidence is under
`/tmp/iinatan-hover-fix-evidence4/run-18321-1788810223636/`.
Cross-reference text is included in the deterministic dictionary fixture. The
browser-document smoke verifies nested child navigation, bounded depth,
cancellation, and deepest-first Escape; native desktop evidence still labels
that child-result path separately because the native harness does not inject
dictionary results into a live nested popup.
Set `IINATAN_E2E_RESIZE_TRANSITION=1` with the native interaction matrix to
exercise a live stock-mpv `window-scale` transition. The signed macOS run
followed exact `640x360` to `480x270` content geometry and back, including the
native sidecar and Electron geometry-generation updates, while keeping the
popup dismissed. Evidence is under
`/tmp/iinatan-e2e-macos-resize-current-20260908d/run-36848-1788869186590/`.
This covers runtime resize/recovery; initial `--geometry` remains a launch-time
placement option rather than a runtime movement API.
Set `IINATAN_E2E_NATIVE_LIFECYCLE_CYCLES=N` with the native interaction matrix
to repeat the signed macOS hover, popup, native Escape, and pointer-reset path
for up to 24 bounded cycles. Every cycle verifies foreground ownership, trusted
Accessibility/post-event input, popup dismissal, pause ownership, and mpv
liveness; the pointer-reset step deliberately leaves the subtitle region before
the next hover so each replay models a real hover transition. A deterministic
24-cycle replay passed on 2026-09-08 after reacquiring the current exact
geometry/unit target on every cycle and requiring a non-empty dictionary
headword; evidence is in
`/tmp/iinatan-e2e-macos-lifecycle-current-20260908-headword24/run-39844-1788869843224/`. This is bounded
native lifecycle evidence and does not claim scanout timing or unbounded
compositor stress.
On 2026-09-08, the same signed four-cycle replay was repeated on the
single-display macOS desktop with `IINATAN_E2E_RECORD_SCREEN=1`. The recording
completed successfully (`18,557,748` bytes), and its still captures, structured
result, and movie are under
`/tmp/iinatan-e2e-macos-single-display-recording-20260908/run-42106-1788870901542/`.
Run `npm run test:native:languages` for the bounded macOS six-language matrix.
It runs the real stock-mpv/Electron/native-input replay once per configured
language using deterministic Japanese, English, German, French, Korean, and
Chinese subtitle fixtures plus the demo dictionary. The 2026-09-08 run passed
all six routes with trusted native input; evidence and the aggregate report are
under `/tmp/iinatan-e2e-macos-languages/`. This validates routing and desktop
interaction, not live corpus correctness for six downloaded dictionaries.
Run `npm run test:native:languages:live` for the corresponding disposable live
dictionary matrix. On 2026-09-08 it downloaded and imported one recommended
HoshiDicts dictionary for each language, then passed the same native popup,
selection, scroll, focus, dismissal, pause, and liveness checks. Evidence is
under `/tmp/iinatan-e2e-macos-languages-live-current-20260908/`; this does not claim that every
available dictionary or every corpus entry is correct. On macOS, the capture
helper selects the display containing the player window and reports its pixel
origin/scale, so native geometry assertions remain valid when the player is
opened on a non-main display.
The current native adapter also retries macOS player activation until foreground
ownership is verified; the supplied-media replay confirms both the completed
activation result and the follow-up mpv window readback after Escape and
outside-panel dismissal.
Set `IINATAN_E2E_RECORD_SCREEN=1` with this interaction matrix to add a
macOS `.mov` screen recording with the cursor and native click indicators.
The recording is stored as `desktop-interaction.mov` in the evidence directory
and is intended to make popup opening, in-popup dragging, Escape dismissal, and
outside-panel dismissal visually reviewable. Use
`IINATAN_E2E_RECORD_SECONDS=N` to change the bounded recording length (default
20 seconds); this requires macOS Screen Recording permission for the process
launching the harness.
Set `IINATAN_E2E_PACKAGED_APP=/absolute/path/to/iinatan for mpv.app` to launch
the finished bundle during the same replay instead of the source Electron
entrypoint. The `.app` path is resolved to its executable automatically; the
native event helper remains a separately signed test bundle so its Accessibility
and post-event grants stay attributable and stable.
Set `IINATAN_E2E_SMOOTH_POPUP_APPROACH=1` to exercise a stepped native cursor
transit from the subtitle target through the transparent companion surface into
the popup before starting text selection. This is a diagnostic for the real
hover-to-popup path, rather than a synthetic DOM event. The current regression
run kept the popup visible and focused at all 12 transit samples and completed
native selection, Escape, and outside-panel dismissal; evidence is preserved
under `/tmp/iinatan-e2e-evidence-smooth-fixed/run-71669-1788729618818/`.
Set `IINATAN_E2E_FEATURE_PARITY=1` with the native interaction matrix on macOS
to click the renderer-measured audio and Anki action rectangles. This opt-in
replay uses live Hoshi lookup, resolves the audio menu through the configured
sources, and sends the Anki note to an ephemeral loopback mock; it never opens
or modifies the user's Anki collection. Action rectangles are derived from the
open popup's DOM viewport geometry and are rejected if they fall outside the
native panel. The latest current-helper signed replay returned five audio
candidates and one successful mock `addNote`; it also exercised the
popup-visibility-scoped macOS
Escape fallback used when the transparent overlay reports focus while mpv
remains frontmost. Evidence is in
`/tmp/iinatan-e2e-macos-feature-parity-current-live/run-40085-1788798176485/`.
That replay also applied a disposable profile's selector-based custom CSS and
confirmed the live popup's computed background and border after `#popup` was
remapped to `#popup-panel`.
The native controller contract smoke separately validates the signed
DualSense HID schema and browser-gamepad fallback arbitration; a connected
controller is still required to claim physical focus, hotplug, and
device-compatibility support. This remains an opt-in test matrix because
rebuilding the native helper requires re-signing and re-adding that exact
bundle to macOS Accessibility.
The Settings window now exposes the same no-popup, popup, and audio-menu
bindings through a first-class per-control editor with independent context
reset buttons; the raw JSON fields remain available only under the advanced
disclosure for migration and unusual configurations.
Native runs also emit a `latency` summary for pointer-to-popup,
`combinedCapturePopupMs`, selection, scroll, additional pointer probes, and
Escape dismissal. `combinedCapturePopupMs` measures native pointer injection to
the first successful changed-pixel result in a combined desktop capture; it is
the strongest available compositor-visible upper-bound in this harness, but not
a scanout timestamp. The other timestamps include helper invocation, status
polling, and Electron/IPC scheduling.
To exercise a real local media file instead of the generated fixture, set
`IINATAN_E2E_MEDIA_PATH`, select its subtitle with `IINATAN_E2E_SUBTITLE_ID`,
and choose a cue-bearing `IINATAN_E2E_START_SECONDS`; the file is read in place
and `ffmpeg` generation is skipped:

```sh
IINATAN_E2E=1 \
IINATAN_E2E_MEDIA_PATH="/absolute/path/to/file.mkv" \
IINATAN_E2E_SUBTITLE_ID=1 \
IINATAN_E2E_START_SECONDS=19 \
npm run test:e2e
```

For the supplied MARRIAGETOXIN file, the adjacent Japanese subtitle is track 15. This runs the live Jitendex-backed path while keeping installed files
temporary:

```sh
IINATAN_E2E=1 \
IINATAN_E2E_MEDIA_PATH="/absolute/path/to/MARRIAGETOXIN.mkv" \
IINATAN_E2E_SUBTITLE_ID=15 \
IINATAN_E2E_LOOKUP_LANGUAGE=ja \
IINATAN_E2E_DICTIONARY_DOWNLOAD_ID=jitendex-ja-en \
IINATAN_E2E_START_SECONDS=19 \
npm run test:e2e
```

The default E2E startup preserves an already-paused player; set
`IINATAN_E2E_START_PAUSED=0` to verify that a plugin-owned pause is released
on dismissal. For short real-media cues, the harness asserts pause before the
bridge connects and reasserts it after the active subtitle event arrives.

`test:hoshi` is opt-in and requires a dictionary ZIP/path. It uses the bundled
macOS helper when present, or an explicitly supplied backend, and reports a
skip rather than using demo data when no backend or dictionary is available.
`test:hoshi:portable` is the deterministic cross-platform worker smoke. It
requires a portable helper path (or a built default target), imports a bounded
fixture, and verifies a real lookup; it does not claim geometry or native GUI
support.
`test:dictionary:download` is the opt-in live catalog smoke. With
`IINATAN_DICTIONARY_DOWNLOAD_REQUIRED=1`, it downloads the configured Jitendex
archive into a disposable root, imports it through the bundled HoshiDicts
worker, and verifies a real lookup; it never uses the user's settings or
dictionary directory.
`test:stock-pixels` runs independent stock-mpv pixel oracles for bottom, top,
simple external SubRip, supplementary/combining-mark, mixed-language, missing-font fallback,
color-separated and unique-color unit-identity, top-left positioned/italic-style, and
multiple-event/multiline/explicit-position/explicit-movement/static-tag/vector-clip/bounded-transform ASS fixtures,
plus simultaneous primary/secondary renders in explicit
`secondary-sub-ass-override=no` and stock's default `strip` modes. The
default `strip` case uses an observation-only, centered-top ASS reconstruction
and is bounded to that renderer shape; it is still not native desktop
composition proof. The explicit `\\pos(200,200)` fixture is also passed through
the native libass path and matched against stock pixels. The explicit
`\\move(100,200,500,200)` fixture is likewise passed through libass at the
midpoint of its event. The static-tag fixture covers inline alignment, font,
size, spacing, border, shadow, rotation, rectangular clipping, and bounded
karaoke through the native libass path. The bounded-transform fixture uses
numeric timing and a supported nested modifier; the stock-mpv comparison
produced IoU `0.8994301994301994`. Custom secondary alignments, colors, scale
options, per-unit identity probes, nested transforms, drawing mode, and other
advanced ASS modes remain native geometry gates. The vector-clip fixture passes
text through the same native libass path while drawing-only and unknown-tag
events continue to fail closed.
The unique-color identity fixture independently matches each annotated unit's
stock color bounds within one physical pixel; this is deterministic fixture
evidence, not universal stock-mpv glyph-layout proof.
The separate `test:stock-glyph-diagnostic` command adds a per-character
alpha-isolation fixture against unmodified stock mpv. Each character is
captured alone at its original layout position; the current macOS arm64 run
passed all seven bounds with IoU `1` and edge error `0`. A previous
color-composite probe produced false three-/two-pixel `r`/`l` edge reports
from antialiased overlap, so it is no longer used as the acceptance measure.
Universal stock-mpv equivalence for arbitrary fonts, advanced effects, and
decorative outline/shadow ownership remains a separate gate.
The opt-in `test:stock-pixels:media` command compares the supplied
MARRIAGETOXIN Japanese subtitle pixels from ordinary stock mpv against
predicted grapheme rectangles. Set `IINATAN_STOCK_PIXEL_REAL_REQUIRED=1` and
`IINATAN_STOCK_PIXEL_MEDIA_PATH` to run it; this is an independent pixel
comparison, not runtime bitmap transport.
The companion `test:stock-pixels:media:ass` smoke demuxes a real embedded ASS
stream and its attached fonts, checks stock-pixel coverage for word units, and
records the bounded envelope comparison; it does not claim exact glyph
equivalence while that comparison remains below the release gate.

The optional demo needs Electron installed from the pinned development
dependency:

```sh
npm install
npm run start:demo
```

The source-development entry point keeps the patched ASS geometry backend
explicit while the stock-mpv equivalence oracle remains open:

```sh
npm run start -- --enable-patched-native-geometry
```

The packaged macOS companion selects the same bounded backend by default. Use
`--disable-patched-native-geometry` or
`IINATAN_DISABLE_NATIVE_GEOMETRY=1` for a diagnostic run without it.

The ordinary attachment path uses the bundled `mpv/iinatan-session.lua`. On
macOS, the packaged companion uses the bounded native geometry backend by
default; the backend is still only considered exact when the content shim,
validated player tuple, and response validation all succeed.
Explicit `--input-ipc-server` and `IINATAN_SESSION_DIR` values remain useful
for test harnesses and application-owned launches, but a direct macOS launch
with only `--script=/absolute/path/to/iinatan-session.lua` now gets a private
IPC endpoint and descriptor directory automatically. The script starts the
installed `iinatan for mpv` companion as a menu-bar app when needed; set
`IINATAN_AUTO_START_COMPANION=0` or
`--script-opts=iinatan-session-auto-start=no` to disable that bootstrap, and
use `IINATAN_COMPANION_APP` when the installed application has a different
name. The companion matches session id, PID, and IPC endpoint; native window
attachment additionally verifies the real PID/window identity and uses a
descriptor window id when mpv has published a usable platform-native value.
On macOS, mpv's documented `window-id` may not be the CoreGraphics window
number, so the PID-scoped probe establishes the authoritative window identity.
Window titles are not identity.
On macOS, exact player-content bounds additionally require stock mpv's
documented C-plugin loader and the bundled `bin/iinatan-mpv-window-shim.so`.
Load it alongside the session script, or set `IINATAN_NATIVE_SHIM` so the
session script loads it with `load-script`; the shim exchanges only an
owner-readable scalar JSON geometry sidecar and never replaces mpv's renderer
or transports pixels. When no explicit shim path is supplied, the macOS session
script also searches the session-script directory, adjacent `bin/`/`build/native/`
directories, and the standard per-user mpv script locations. If the shim is
absent, the app keeps the CoreGraphics window-frame result explicitly inexact.
The automatic path is covered by
`IINATAN_NATIVE_SHIM_AUTO_REQUIRED=1 npm run test:mpv:window`.
The application menu also provides `Open media in mpv…` as a non-destructive
bootstrap for this ordinary workflow. It asks the native file picker for one
local media file and starts the user's existing `mpv` executable with only the
bundled session script, a private IPC endpoint, and the selected file. The
session directory is passed through `IINATAN_SESSION_DIR`; no mpv configuration
file, script directory, or unrelated plugin is edited. The child is started
without a shell or terminal window and remains the user's player if the
companion exits. Set `IINATAN_MPV` or pass `--mpv-executable=/absolute/path`
when `mpv` is not available on `PATH`. On Windows the private endpoint is a
named pipe, as required by mpv's documented IPC option.
On platforms where no companion window is visible to carry an application menu,
the same bootstrap is available without a terminal through
`--open-media=/absolute/path/to/video.mkv` (or `--open-media /absolute/path/to/video.mkv`).
It starts mpv and then lets normal descriptor discovery attach the companion
surfaces when the player window is available.
For normal macOS use, the companion can run as a menu-bar-only background
process; it claims one per-user instance and discovers ordinary Homebrew mpv
sessions through their descriptors. The player does not need to be launched
from Electron, and opening a popup does not activate the companion application.
When several descriptors are present, each live mpv session receives an
isolated controller and browser-surface pair; settings and optional services
are shared without sharing session identity or popup state.

Open the profile/settings window from the native application menu or with
`--settings`. It provides profile switching, the migrated preference inventory,
popup/audio customization, AnkiConnect setup, host-controlled dictionary
import/removal, bounded recommended dictionary downloads/updates, and a
read-only Diagnostics card for platform/backend capability and current-session
evidence. The
settings window remains local, sandboxed, and
context-isolated; it does not become a general-purpose file or command bridge.
Anki card creation, duplicate checks, word-audio download, screenshots, and
bounded sentence-audio export are host-mediated. Sentence audio is enabled only
when the packaged `ffmpeg` helper (or an explicit `--ffmpeg=/absolute/path`
override) is available; otherwise the card is added with a visible media
warning rather than silently invoking a system shell or pretending capture
succeeded. The controller integration suite covers duplicate prevention and
explicit override, word-audio storage, mpv screenshot storage, and
sentence-audio storage before `addNote`; the real encoder smoke separately
covers the ffmpeg subprocess boundary.

## Reference and scope

The working IINA implementation at `/Users/rahulb/Documents/iinatan` is kept
intact and is used for settings, dictionary, Anki, audio, controller, and popup
behavior inventory. It is not changed by this repository.
