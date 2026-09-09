# Validation plan and evidence levels

Evidence is reported separately for:

- implemented: code exists behind the intended boundary;
- unit-tested: pure behavior has automated coverage;
- integration-tested: real IPC/service boundaries are exercised with an
  injected or local test transport;
- native-desktop-tested: real mpv, real helper, real Electron windows, and
  native input are tested together;
- unverified: no authoritative test has run;
- blocked: a concrete platform or dependency gate prevents the test.

For the current implementation pass, macOS arm64 and Windows x86-64 have
native desktop evidence in this workspace. Linux native-desktop execution
remains deferred until a native Linux host or a successful hosted job provides
authoritative results; it remains explicitly unverified rather than being
inferred from macOS or Windows coverage.

The initial commands are:

```sh
npm test
cmake --preset release
cmake --build --preset release
npm run validate:release
npm audit --audit-level=moderate
npm outdated --json
```

The real-media command-routing smoke is:

```sh
npm run test:mpv:commands
```

It sends the complete mapped player-command set through the live JSON-IPC
bridge, including seek, subtitle-step, frame-step, volume, speed, and pause,
and requires every command to be accepted by the installed stock mpv. The
2026-09-08 run passed against mpv `0.41.0` and the supplied MARRIAGETOXIN file.

On the 2026-09-08 dependency/security review, `npm outdated --json` returned
`{}`, both regular and production-only `npm audit` runs reported zero
vulnerabilities, and `validate:release` reported 34 feature-matrix rows and 51
runtime files. The native refresh kept libass `0.17.5` and the current
HoshiDicts `main` revision while updating FFmpeg `9.0.1`, HarfBuzz `14.4.0`,
FreeType `2.14.3`, FriBidi `1.0.16`, libunibreak `7.0`, zlib `1.3.2`, and
pkgconf `3.0.7`; the refreshed helper was rebuilt before validation. That
release gate also checks the sandbox/context-isolation and web-security
settings, restrictive CSP directives, redirect/navigation/new-window blocking,
protocol-host validation, and the reviewed native checksums.

The rebuilt macOS helper applies two hash-locked libass `0.17.5` patches: the
unit-ID patch used for fill rectangles and an additive visible-envelope patch.
The latter is exposed as `envelopeRects`; it does not widen the fill rectangles
used by runtime hit testing, and is used by the runtime only to cover the
visible highlight and popup anchor.

For stable macOS TCC attribution, sign the finished test helper after every
native rebuild:

```sh
npm run sign:native:macos
```

The command selects an Apple Development identity (or an explicitly configured
`IINATAN_MACOS_CODESIGN_IDENTITY`), refuses ad-hoc fallback, and verifies the
resulting bundle. The current host uses an Apple Development identity with Team
ID `VWU398WDQ6`; the finished bundle was re-added to Accessibility before the
latest GUI-launched replay. Apple DTS recommends a stable signing identity because TCC
uses the app's designated requirement when attributing grants:
[Apple Developer Forums](https://developer.apple.com/forums/thread/730043).

The macOS native-controller contract smoke is:

```sh
IINATAN_NATIVE_CONTROLLER_REQUIRED=1 \
IINATAN_NATIVE_CONTROLLER_REQUIRE_STABLE_SIGNING=1 \
npm run test:native:controller
```

It runs the finished helper's version and `controller-state` commands, checks
the complete button/trigger schema and generic `gamepad` capability, and
records the signer/CDHash. The current host reported a valid Apple Development
signature and an attached DualSense through that generic HID path; physical
controller focus, hotplug, and device-compatibility acceptance remain separate
evidence gates.

On Windows, the same command uses the rebuilt portable HoshiDicts helper:

```sh
IINATAN_NATIVE_CONTROLLER_REQUIRED=1 \
npm run test:native:controller
```

The Windows smoke passed with the bundled WinMM joystick adapter, reporting the
connected DualSense as a native-HID snapshot with the complete canonical button
contract; the adapter now normalizes axes from each device's declared WinMM
range rather than assuming a fixed `0..65535` range. The separate Chromium fallback smoke remains activation-sensitive
because an already-connected controller may stay hidden from
`navigator.getGamepads()` until the focused page receives a button or axis
event.

The macOS and Windows multi-instance native smoke is:

```sh
IINATAN_E2E=1 npm run test:native:multi
```

It launches two ordinary stock-mpv windows using the supplied MARRIAGETOXIN
media and starts one normal Electron host against the shared session directory.
The host must attach two distinct PID/session/window identities with exact
content bounds. macOS uses the AppKit content sidecar; Windows uses the Win32
client-area probe and DIP conversion. The smoke changes `volume` independently
through both live JSON-IPC endpoints, requests foreground ownership for each
player in turn through trusted native move/click input, closes one player and
waits for its controller to disappear and its descriptor to become non-live,
then starts a replacement and checks that the surviving and replacement
sessions remain isolated. This extends the headless identity test into the
real window/host lifecycle; it remains separate from the stock-mpv per-glyph
equivalence oracle.
The latest 2026-09-08 rerun passed the initial two-session attachment,
independent volumes `17`/`63`, trusted foreground clicks on both windows,
removal of the closed session, replacement attachment, replacement volumes
`29`/`77`, and surviving/replacement isolation. Evidence is in
`/tmp/iinatan-native-multi-current/result.json`.

The Windows x86-64 rerun on 2026-09-08 passed the same sequence against stock
mpv `0.41.0`: both sessions reported exact `client-area` content bounds at
`640x360`, `SendInput` foreground clicks selected each player in turn, the
independent volumes were `17`/`63`, and the replacement values were `29`/`77`.
Its subtitle source remained the explicit plain-text approximation because the
stock-mpv glyph oracle and patched ASS geometry backend are not claimed on
Windows.

The Windows combined desktop harness also passed the supplied MARRIAGETOXIN
fullscreen replay on 2026-09-08. mpv reported fullscreen at `1920x1080`, the
popup remained composited above the fullscreen player through the Windows
`screen-saver` topmost level, the changed-pixel popup region was
`126193/126360` (`0.998678`), native hover replacement and selection produced
`wit`, and Escape, outside dismissal, pause ownership, and mpv liveness all
passed. This is native composition/input evidence with approximate subtitle
geometry; it does not promote exact stock-mpv per-glyph equivalence.

The same Windows replay was run against the supplied external Japanese track
(`ja.hi.srt`, subtitle id `15`) in both windowed `1280x720` and fullscreen
`1920x1080` modes. The cue `人のぬくもりを / モットーに` remained lookupable;
native hover moved between adjacent Japanese units, native selection returned
`のぬくもり`, Tab and Shift+Tab moved focus through the popup, and the popup
capture changed `99.71%` of its measured region in fullscreen. Both runs
reported exact Win32 client bounds but deliberately retained
`plain-text-approximation`/`exact:false`, since ordinary stock mpv does not
publish its per-grapheme libass layout.

On 2026-09-09, the same packaged Windows replay used the plugin's own
recommended-dictionary download/import path for live Jitendex. The packaged
Hoshi worker reported one enabled dictionary; the Japanese popup opened from
the real external subtitle, native selection returned a Jitendex headword,
popup scrolling reached offset `1483`, Tab/Shift+Tab focus transitions passed,
and fullscreen combined capture, Escape dismissal, outside dismissal, pause
ownership, and mpv liveness all passed. This remains approximate subtitle
geometry because the installed stock-mpv renderer tuple is incompatible with
the primary libass `0.17.5` helper. The explicit `--allow-approximate-geometry`
handoff is restricted to this diagnostic E2E mode; unsupported production
inputs still fail closed.

The packaged Windows replay was rerun on 2026-09-09 with the locked
`windows-mpv-0.41.0-libass-0.17.4-external-subrip` compatibility profile. The
real external Japanese SubRip track selected the instrumented native libass
source with `exact:true`, remained exact through the `1920x1080` fullscreen
transition, and completed the native hover, popup capture, selection, Escape,
outside dismissal, and mpv-liveness checks. The popup capture changed
`99.7611%` of its measured region. Both transparent surfaces reported applied
and verified Windows transition suppression. The profile is limited to
external SubRip input without codec-private ASS extradata; embedded-media ASS
and other unmatched renderer tuples remain fail-closed. Companion processes
excluding mpv and the desktop test driver peaked at approximately `610.5 MiB`
working set and `512.8 MiB` private memory across 11 processes.

The full Windows feature-parity replay completed on 2026-09-09 using the same
packaged app, the recommended `jitendex-ja-en` download/import path, the real
packaged Hoshi worker, and the `windows-mpv-0.41.0-libass-0.17.4-external-subrip`
profile. It passed fullscreen combined capture at `1920x1080`, live Japanese
lookup, native selection, keyboard focus traversal, popup scrolling to offset
`1572`, selector-based custom CSS (`rgb(236, 253, 245)` background,
`rgb(13, 148, 136)` border, `1px` border width), five audio candidates, and
loopback Anki `findNotes`/`addNote` actions. It also positioned a temporary
unrelated Windows app over the player, verified foreground recovery through a
real exposed player coordinate, restored the test-induced pause toggle, and
confirmed that the popup remained transitionless with no thick frame. The
temporary app and all mpv, Electron, Hoshi, geometry-helper, and desktop-driver
processes were cleaned up. Evidence is in
`build/e2e-evidence-windows-feature-current/run-28644-1788941753528/`.
The companion/helper memory sample peaked at approximately `481.1 MiB`
working set and `361.0 MiB` private memory across seven processes, excluding
mpv and the desktop test driver. This promotes the supported external-SubRip
Windows slice; arbitrary stock glyph equivalence, the signed Windows installer,
and Linux native GUI execution remain open gates.

On 2026-09-09, `npm run package` also produced the Windows NSIS installer and
ZIP artifact. `npm run test:installer:windows` installed the NSIS artifact into
a generated test directory, ran `validate:package` against the installed
resources and ASAR, verified that the uninstaller removed the application
files, and verified that a sentinel outside the install directory survived.
The installed executable then passed the same fullscreen Japanese
external-SubRip/native-controller replay: exact compatibility-profile
selection, semantic-region input, popup capture, lookup selection, scrolling,
audio-menu open/close, dismissal, pause ownership, and process cleanup all
passed. The popup changed `99.8736%` of its measured region. A quick filtered
sample during that replay measured `69.8 MiB` peak working set and `40.3 MiB`
peak private memory across four plugin/helper processes; it is an indicative
active-process sample rather than the broader feature-parity memory benchmark.
The generated Windows installer currently reports `NotSigned` under
Authenticode, so this is an installable preview artifact and the production
Windows signing/SmartScreen gate remains open.

After the renderer bootstrap changes, `npm run package` rebuilt the NSIS and
ZIP artifacts from the current source. `npm run test:installer:windows` again
installed the NSIS artifact into an isolated directory, validated its ASAR and
external resources, removed the application files with the uninstaller, and
confirmed that the sentinel outside the install directory survived. The
rebuilt installer remains an unsigned preview (`NotSigned`); its install and
uninstall behavior passed.

After the branch push, the packaged Windows feature-parity replay was repeated
against the supplied Japanese SubRip media with the same exact
`windows-mpv-0.41.0-libass-0.17.4-external-subrip` profile. Live Jitendex
download/import, fullscreen, native selection and focus traversal, scrolling,
custom CSS, audio candidates, Anki actions, outside dismissal, pause ownership,
and mpv liveness passed again. The active packaged companion/helper sample
peaked at approximately `469.1 MiB` working set and `355.2 MiB` private memory
across up to seven processes, excluding mpv; the native desktop test drivers
added approximately `6.6 MiB` working set and `1.2 MiB` private memory.

The freshly rebuilt package was replayed again after the renderer bootstrap
failure handling and subtitle-owner assertions were added. The fullscreen
Japanese feature-parity run passed with exact compatibility-profile geometry,
`1920x1080` fullscreen observation, native semantic-region selection, keyboard
focus traversal, scrolling to offset `2036`, custom CSS, audio candidates,
loopback Anki actions, popup capture, Escape/outside dismissal, pause
ownership, and mpv liveness. Both transparent surfaces reported verified
transition suppression. The popup capture changed `99.7779%` of its measured
region. The active companion/helper memory sample was not retained for this
short replay because the processes had exited before the asynchronous poll;
the preceding seven-process sample above remains the current memory benchmark.

The renderer bootstrap now reports a bounded `surface-bootstrap-failed`
diagnostic when a sequential overlay asset cannot load. BrowserHost makes the
affected surface passive, dismisses an active popup, and the controller
releases plugin-owned pause. The renderer bootstrap unit, BrowserHost, and
controller integration checks passed on Windows; the normal popup presentation
and host integration remain unchanged.

The real Electron browser integration also confirmed that the imported popup
renderer does not become a second subtitle owner: mpv popup integration applies
`experimentalNativeSubtitleHitLayer: false` and
`experimentalNativeSubtitleLookupHighlight: false`, and the popup document has
no native subtitle host or hit-box layer. The separate highlight surface and
stock-mpv/native geometry path remain the only subtitle interaction owner.

The Windows `window-scale` transition probe also passed separately in windowed
mode, changing exact client content from `1280x720` to `960x540` and back while
refreshing Electron geometry generations and keeping both surfaces
transitionless. Native fullscreen does not resize the client area in response
to this stock-mpv property, so `IINATAN_E2E_RESIZE_TRANSITION=1` is a windowed
runtime-resize check on Windows.

The dedicated Windows nested-popup replay completed on 2026-09-09 with the
same exact external-SubRip profile and fullscreen stock-mpv window. The
deterministic cross-reference replay received a depth-one result and captured a
`0.9983` changed-pixel fraction. The live Hoshi replay then clicked an ordinary
Japanese text range in the Jitendex body, received the depth-one child result,
captured `0.9997` changed pixels in the nested-panel region, preserved the
player's paused state, and closed the child with native Escape. Both popup
surfaces reported verified transition suppression. The live target is exposed
through renderer-measured semantic region telemetry, so dictionary entries do
not need to contain a cross-reference element for nested text lookup.
The active packaged replay sampled `467.2 MiB` peak working set and `348.4 MiB`
peak private memory across six companion/helper processes, excluding mpv,
desktop input drivers, and console hosts.

The Windows embedded-ASS compatibility slice was then validated against the
same supplied MKV with stock mpv `0.41.0`, libass `0.17.4`, DirectWrite, and
24 Matroska font attachments. The independent pixel smoke reported fill IoU
`0.9990138067061144`, visible-envelope IoU `1.0`, and nonzero coverage for all
30 visible graphemes and seven word probes. Both source and automatically
selected packaged replays reported
`windows-mpv-0.41.0-libass-0.17.4-embedded-ass` with `exact:true`; fullscreen,
native selection, focus traversal including a valid one-control Shift+Tab
wrap, Escape/outside dismissal, pause ownership, and mpv liveness passed. This
profile requires an embedded ASS source with codec-private ASS extradata and
the matched renderer tuple. Mixed tracks, unmatched options, and arbitrary
stock-mpv glyph equivalence remain fail-closed or unverified.

The Windows resize transition now restores mpv's observed effective scale
when the configured scale is automatic. The English supplied-media run passed
the resize/recovery check and three native attach/lookup/dismiss cycles. Popup
surfaces also disable Chromium transitions, set the Windows DWM transition
attribute, and keep the transparent popup surface resident at zero opacity
while it is logically hidden. The popup is made opaque only after its first
painted frame, so opening it does not invoke a native hide/show animation.
The focused packaged Japanese fullscreen replay passed native selection,
keyboard focus, Escape and outside dismissal, with both surface transition
states reported `applied:true` and `verified:true`; evidence is under
`build/e2e-evidence-windows-popup/run-20344-1788940649057/`.

The real browser-document integration smoke is:

```sh
npm run test:browser
```

The release workflow also runs this smoke on Ubuntu under an explicit Xvfb
display, together with `npm run test:settings`, after installing the virtual
X11 display package. This is real Electron/Chromium document integration on a
Linux CI display server; it is not evidence for native X11 window attachment,
Wayland behavior, compositor stacking, or native pointer injection.

It runs the shipped overlay document in the pinned Electron/Chromium engine,
with the sandboxed preload and actual renderer event handlers. It exercises a
large structured dictionary entry, cross-reference rendering, nested child
lookups, selection reporting, audio source menus, controller commands, keyboard/wheel/outside-
pointer messages, highlight rendering, accessibility semantics, stale-
generation rejection, right-click/context-menu pass-through, focus retention,
content security policy, and unsafe custom-CSS rejection. Nested coverage
includes request correlation, bounded depth, child replacement, cancellation,
and deepest-first Escape dismissal. Audio coverage includes request-ID
stale-result rejection. It is intentionally separate from native desktop evidence:
synthetic DOM events and hidden browser windows cannot prove OS focus,
compositor stacking, click-through, or native input. It also delivers
the typed `capabilities` event to both surfaces and asserts the
passive-forwarded versus interactive-native input modes and the layout-only
popup reflow path in the real Chromium document. The current run also
dispatches a renderer blur and verifies that the browser fallback publishes a
forced neutral controller state, closing the lifecycle edge where a held input
could otherwise survive a surface focus change.

The native desktop replay derives popup input from renderer-published semantic
regions. It converts the measured panel, text-selection, headword, nested,
audio-source-menu, and Anki rectangles through the live browser scale, checks
each injected point against both the native popup window and its panel, and
then sends the Win32 input. This replaces fixed offsets from the popup
placement, so the E2E coordinates follow the reference popup's actual DOM
layout after scaling, scrolling, fullscreen changes, and font reflow.

The packaged Windows fullscreen replay also passed the live Japanese fixture
with the bundled WinMM controller contract and a connected native controller
state. It moved between adjacent subtitle units without a pointer, selected a
dictionary entry, scrolled the measured popup, opened and closed the audio
menu, dismissed the popup, preserved mpv pause ownership, and completed the
no-popup seek path. The popup capture changed `99.848%` of its measured
region. The one-cue fixture records subtitle seek as unsupported; multi-cue
fixtures keep the strict next/previous seek assertion.

The real settings-document integration smoke is:

```sh
npm run test:settings
```

It loads the shipped settings document in a sandboxed Electron BrowserWindow,
uses the shipped settings preload, and exercises profile rendering, rename/save,
create/switch/delete lifecycle, dictionary enablement, the recommended-dictionary
Download/Update fixture flow, CSP, and rejection of an unallowlisted settings
request. It also renders a sanitized native-geometry failure code/message in
Diagnostics without exposing host paths, including the reconstructed geometry
source and its explicit stock-mpv limitation. It does not prove native menu
invocation or settings-window focus. The unit suite
separately exercises the real recommended-download path with a local bounded
transport and staged replacement; it does not download external archives
during automated tests.

The Phase A host/geometry performance report is:

```sh
npm run benchmark:phase-a
```

It reports p50/p95/p99 distributions for coordinate round trips, hit testing,
popup placement, plain subtitle geometry, and structured dictionary
normalization, together with CPU/OS/Node/Electron and fixture-size metadata.
These are not screen-presentation timings. Pointer-to-highlight, lookup,
cached/cold popup presentation, geometry-change latency, and compositor input
latency remain native desktop measurements. The windowed and supplied-media
fullscreen graphical E2E gates are exercised on this host; stock-mpv
glyph-equivalence for advanced rendering and other platform claims remain
separate gates.

The latest rerun on 2026-09-08 at 15:03 UTC on macOS 25.6.0 arm64, Apple M4,
Node v24.16.0, with Electron 44.2.0 pinned and a 480-unit/two-track fixture,
measured coordinate round trip p95 `0.000192 ms/op`, hit testing p95
`0.026623 ms/op`, popup placement p95 `0.000930 ms/op`, plain subtitle geometry
p95 `0.010314 ms/op`, and structured dictionary normalization p95
`0.635148 ms/op`. These values are reproducible microbenchmark observations,
not display-latency guarantees; rerunning the benchmark may produce small
changes from normal host scheduling variance.

After the live renderer-option fail-closed change, the same benchmark measured
coordinate round trip p95 `0.000271 ms/op`, hit testing p95 `0.026559 ms/op`,
popup placement p95 `0.001048 ms/op`, plain subtitle geometry p95
`0.010141 ms/op`, and structured dictionary normalization p95
`0.634319 ms/op`. This follow-up remains a host-side regression check, not a
screen-presentation measurement.

The native desktop vertical slice can target the finished packaged application
instead of the source Electron entrypoint by setting
`IINATAN_E2E_PACKAGED_APP` to either the `.app` bundle or its executable. The
current signed bundle passed the supplied MARRIAGETOXIN replay with exact
AppKit content geometry, trusted native pointer/keyboard/scroll input, hover
replacement, native text selection, popup foreground preservation, Escape and
outside-panel dismissal, pause/liveness checks, and an 8-second Screen
Recording capture. Structured evidence is in
`/tmp/iinatan-e2e-packaged-current-20260908/run-24070-1788854673524/`.
The packaged fullscreen variant also passed exact `1470x923` AppKit content
bounds, popup replacement, selection, keyboard focus, Escape, outside-panel
dismissal, pause ownership, and mpv liveness; its evidence is under
`/tmp/iinatan-e2e-packaged-fullscreen-20260908/run-27441-1788855636525/`.
The packaged companion grant and the native synthetic-input grant are separate
boundaries: the former belongs to
`dist/mac-arm64/iinatan for mpv.app`, while the latter is attributed to the
stable-signed `build/native/iinatan-desktop-test.app` helper that emits test
events.

The native desktop harness separately emits `latency` distributions for
pointer-to-popup, combined-capture popup visibility, native selection, popup
scroll, additional pointer probes, and Escape dismissal when those phases are
enabled. `combinedCapturePopupMs` starts at the native pointer injection and
ends at the first successful changed-pixel result in a desktop capture that
contains both mpv and Electron. It is a compositor-visible upper-bound rather
than a scanout timestamp; the other values also include helper startup, status
polling, and Electron/IPC scheduling.

The native interaction matrix also guards popup/highlight hover continuity. It
requires the highlight window to remain visible and above the owned player
while the popup is open, moves directly to a second subtitle unit outside the
measured popup panel, and waits for the popup's bound track/event/unit identity
to change. The signed 2026-09-07 replay changed adjacent `careful` units from
`c` to `a` in `129.377 ms`; frame inspection showed the blue highlight move to
the new glyph without the popup covering the active subtitle anchor. The run
then passed native text selection, Escape dismissal, explicit leave/re-entry,
outside-panel dismissal, pause preservation, and mpv liveness. Its screenshot,
20-second recording, status, and report are under
`/tmp/iinatan-hover-fix-evidence4/run-18321-1788810223636/`.

After `npm run package:dir` (or `npm run package` when distributable targets are
also wanted), validate the generated platform directory package:

```sh
npm run validate:package
```

This checks the asar contents, executable/helper resources, session script, and
a copy/remove install-layout sandbox that preserves a sentinel settings file
and dictionary. On macOS it also checks the bundled HoshiDicts helper and
corresponding-source archive. It is not evidence for a signed/notarized
installer or native GUI behavior.

After `npm run package` on Windows, run the real installer lifecycle smoke:

```sh
npm run test:installer:windows
```

It installs the NSIS artifact, validates the installed helper resources, runs
the uninstaller, and checks that generated user-data outside the application
directory is preserved. The smoke uses Windows `Start-Process` for the GUI
installer lifecycle and does not add a runtime dependency to the shipped app.

For the drop-in mpv installation, run:

```sh
npm run package:plugin:windows
npm run test:native:plugin-autostart
```

The first command builds the portable Windows companion and assembles exactly
two files under `dist/mpv-plugin`: `iinatan.lua` and
`iinatan-companion.exe`. Copy them into the mpv config root so the Lua script is
under `%APPDATA%\mpv\scripts` and the companion is directly under
`%APPDATA%\mpv`. The first launch creates `iinatan/config.json`,
`dictionaries/`, `backups/`, `cache/`, and `logs/`; no settings or dictionary
files are shipped in the plugin bundle. The Windows smoke exercises automatic
script loading with no explicit companion or session environment variables,
reports the working/private memory of the launched companion process tree, and
tears down only its own mpv and companion tree. `--load-scripts=no` and the
script's auto-start option remain explicit opt-outs. The smoke reports the
active companion process tree's Windows working-set and private-memory totals
on each run; values are machine and workload dependent, and processes outside
the test tree are excluded.

The storage-layout tests cover fresh creation under spaces and Unicode,
non-destructive migration with dictionary path rewrites and conflict reports,
atomic settings updates from multiple instances, and bounded log rotation.
Package validation also checks that copying or removing the installed
application leaves the `iinatan/` data root intact; the Windows NSIS settings
keep application data during uninstall unless the user explicitly removes it.

The current macOS arm64 package run additionally produced and verified
`dist/iinatan for mpv-0.1.0-arm64-mac.zip` and
`dist/iinatan for mpv-0.1.0-arm64.dmg`. `unzip -t`, `hdiutil verify`, and deep
`codesign --verify --strict` checks passed, and the extracted ZIP app retained
the Apple Development identity with Team ID `VWU398WDQ6`. Electron-builder
skipped notarization because no notarization credentials were configured; the
artifacts are signed development distributions, not notarized release claims.

CI builds the Linux directory package and its configured AppImage/tar.gz
targets on `ubuntu-24.04` x86-64, then uploads both the validated directory and
the distributables as workflow artifacts. That is the project's Linux build
baseline, not a claim that the package runs on older glibc distributions. A
future compatibility claim must add a runtime probe on the intended minimum
distribution and record its observed loader baseline.

The settings smoke path can be launched in the demo environment with:

```sh
npm run start -- --settings --demo
```

This checks that the local settings BrowserWindow, sandboxed preload, profile
state request, and native application-menu entry start together. It is not a
substitute for a real mpv/window/input test.

The opt-in macOS native settings-window smoke is:

```sh
IINATAN_NATIVE_SETTINGS=1 npm run test:settings:native
```

It launches the normal Electron application with the Settings window visible in
a disposable user-data directory, checks the real application-menu Settings
item and the Open Media `Cmd+O` item, exercises the signed native `Cmd+,` input
path and records both macOS trust checks, compares the CoreGraphics window-probe frame with Electron's
window bounds, verifies native activation plus foreground ownership for the
focused Settings window, and switches a disposable `default`/`study` profile
through the renderer-measured `<select>` with trusted native click/down/return
and click/up/return sequences. It then uses trusted native text input to edit a
profile name and the real create/delete controls for a disposable profile.
Set `IINATAN_NATIVE_SETTINGS_MIGRATION=1` to feed the same real application a
legacy-shaped settings document first; the smoke then verifies normalized
schema, language, clamp, and preserved dictionary-reference values after the
first profile action. It also uses trusted native scrolling and key events to
drive the real macOS Save/Open panels through a disposable backup path, verifies
the wrapped export document, mutates only the disposable settings file, and
confirms restore through the real app. Other menu accelerators remain outside
this test.

The profile runtime timing controls are bounded during settings normalization and
are applied to the live session: dictionary lookup and hover-request deadlines,
mpv JSON-IPC backend timeout, subtitle geometry refresh interval, and HoshiDicts
worker queue polling/idle sleep. A lookup timeout is a distinct error from an
ordinary cancellation, and the controller cancels the corresponding backend
request before releasing its pause transaction. The unit and controller
integration suites cover the timeout boundary; this does not replace native GUI
latency evidence.

The reproducible stock-mpv session/IPC smoke is:

```sh
npm run test:mpv
```

The ordinary-workflow bootstrap is covered by the integration test suite. It
checks that the application-owned launcher passes the bundled session script,
uses a private platform-appropriate IPC endpoint, starts with `shell: false`
and hidden stdio, and cleans only its own descriptor/socket artifacts after the
player exits. It does not mutate the user's mpv configuration. A packaged GUI
run of `Open media in mpv…` remains a native desktop workflow check separate
from the headless launcher contract.

It launches the installed, unmodified mpv with video output disabled, loads
`mpv/iinatan.lua`, verifies the descriptor PID/session/IPC identity,
connects through the real JSON IPC socket, reads bridge properties, and checks
descriptor cleanup on shutdown. This is headless stock-mpv evidence only; it
does not prove native window geometry, Electron composition, or OS input.

The launcher-backed stock-mpv smoke is opt-in:

```sh
IINATAN_MPV_LAUNCHER_REQUIRED=1 \
npm run test:mpv:launcher
```

It uses the application launcher against the supplied MARRIAGETOXIN media by
default (or `IINATAN_MPV_LAUNCHER_MEDIA_PATH`), verifies the real descriptor and
IPC PID identity, and terminates the child through the launch handle. It is
separate from the no-config IPC fixture because it exercises the ordinary
launch argument path; it still does not claim native desktop composition or
input evidence.
The latest macOS arm64 run passed against stock mpv `0.41.0` and the supplied
MARRIAGETOXIN file, including the bundled macOS content shim path. The Unix
socket endpoint is deliberately kept short because macOS limits Unix socket
address lengths; the test therefore also protects the ordinary launcher from a
platform-specific path-length regression.

A direct-session probe was also run against the same stock mpv without an
explicit session directory or IPC endpoint. With companion auto-start disabled
for isolation, `iinatan.lua` created the default macOS descriptor and
Unix socket, published matching PID/IPC identity, and removed both artifacts
after a graceful JSON-IPC quit. A controlled `open -g -a` probe verified the
macOS companion auto-start command and default application name; the live
unconfigured direct-mpv LaunchServices check is recorded below.

The refreshed signed macOS arm64 directory package was then launched with an
isolated user-data directory and attached to the same direct stock-mpv default
session contract. The package discovered the real PID/IPC descriptor, stayed
attached while mpv was alive, and removed the session after graceful mpv quit;
the bounded process was then stopped. This proves packaged direct attach/detach
independently of any existing menu-bar companion; the fresh-LaunchServices
auto-start path is validated separately below.

The guarded direct-launch smoke closes that final bootstrap check:

```sh
IINATAN_E2E_AUTOSTART_REQUIRED=1 \
IINATAN_E2E_AUTOSTART_RESTART=1 \
IINATAN_E2E_AUTOSTART_NATIVE_GEOMETRY_DEFAULT_REQUIRED=1 \
IINATAN_E2E_EVIDENCE_DIR=/tmp/iinatan-autostart-evidence-20260908b \
npm run test:native:autostart
```

It temporarily stops the existing project companion, launches ordinary
Homebrew mpv with only the bundled session script and supplied MARRIAGETOXIN
media, verifies the default descriptor and live JSON-IPC PID, and observes a
fresh `iinatan for mpv` process selected by LaunchServices. The smoke then
requires the fresh companion's own status document to report the exact new
session ID and PID, so process existence alone cannot satisfy the bootstrap
gate. With
`IINATAN_E2E_AUTOSTART_NATIVE_GEOMETRY_DEFAULT_REQUIRED=1`, it additionally
requires `native-libass-instrumented`, `contentExact:true`, and `exact:true`
without passing an explicit geometry-enable flag. The refreshed signed package
passed that stronger replay on 2026-09-08 with descriptor PID `65276`,
companion PID `65278`, and native geometry diagnostics showing validation
enabled; evidence is in
`/tmp/iinatan-e2e-macos-autostart-default-geometry-20260908/result.json` and
`/tmp/iinatan-e2e-macos-autostart-default-geometry-20260908/last-status.json`.
The smoke removes only its test mpv descriptor/socket and restores a normal
menu-bar companion when one was running before the test.

The same acceptance was rerun against the isolated final arm64 directory
package, rather than the previously registered development application, by
setting `IINATAN_E2E_AUTOSTART_COMPANION_APP` and
`IINATAN_E2E_AUTOSTART_EXPECTED_APP` to
`build/final-macos-arm64/mac-arm64/iinatan for mpv.app`. It passed on
2026-09-08 with direct-session PID `38957`, fresh packaged companion PID
`38959`, `contentExact:true`, `instrumentationValidated:true`, and
`exact:true`; evidence is in
`/tmp/iinatan-autostart-final-package-20260908/result.json` and
`/tmp/iinatan-autostart-final-package-20260908/last-status.json`.

The stronger isolated direct-launch replay also exercises the real Settings
window and a live lookup before teardown:

```sh
IINATAN_E2E_AUTOSTART_REQUIRED=1 \
IINATAN_E2E_AUTOSTART_RESTART=1 \
IINATAN_E2E_AUTOSTART_LIVE_POPUP=1 \
IINATAN_E2E_AUTOSTART_DICTIONARY_ID=jitendex-ja-en \
IINATAN_E2E_EVIDENCE_DIR=/tmp/iinatan-e2e-macos-autostart-live-popup-20260908-successful \
npm run test:native:autostart
```

On 2026-09-08 this passed with a fresh packaged companion and an isolated
temporary user-data directory. The smoke opened Settings, scrolled to the
actual recommended dictionary control, downloaded Jitendex through its real
Download button, closed Settings, re-activated the exact stock-mpv window by
PID identity, opened the live `人` popup with its native highlight, captured
the desktop, dismissed with Escape, and verified that mpv remained paused.
The native helper reported both `accessibilityTrusted:true` and
`postEventTrusted:true`; the evidence is in
`/tmp/iinatan-e2e-macos-autostart-live-popup-20260908-successful/result.json`,
`last-status.json`, and `direct-live-popup.png`. This is packaged macOS
direct-workflow evidence; it does not claim universal stock-glyph equivalence
or acceptance of every dictionary corpus.

The current post-rebuild replay used the supplied MARRIAGETOXIN file and the
current `dist/mac-arm64/iinatan for mpv.app` bundle through the ordinary
LaunchServices name, after stale duplicate development bundles were
unregistered and moved to a recoverable quarantine. It passed with direct mpv
PID `77215` and companion PID `77217`, exact AppKit content geometry,
`native-libass-instrumented`, `contentExact:true`, and `exact:true`. The live
Settings flow downloaded `jitendex-ja-en`, then native pointer input targeted
`人` and opened the live `人間` result; trusted Settings/input/dismissal,
renderer-option fail-closed/recovery, pause preservation, and teardown all
passed. Evidence is in
`/tmp/iinatan-functional-current-direct-supplied-media-20260908/`.

The same direct workflow was repeated against the final rebuilt arm64 package
with the native-geometry-default requirement enabled. It again passed fresh
LaunchServices companion selection, exact AppKit content attachment, real
Settings dictionary download, live `人` lookup/highlight, native dismissal,
pause preservation, and trusted native input. Evidence is in
`/tmp/iinatan-e2e-macos-autostart-current-20260908-final-package/`.

The current final-package rerun recorded the complete structured result in
`/tmp/iinatan-autostart-live-final-package-current-20260908/result.json` and
the desktop capture in `direct-live-popup.png`. It used direct mpv PID `40047`
and packaged companion PID `40053`; the Jitendex download completed in
`3943 ms`, the live unit was `人`, and the combined ScreenCaptureKit result was
`2940x1912` at scale `2`. Native input reported both accessibility and
post-event trust for Settings scroll/click, lookup movement, and Escape.

The post-rebuild session-discovery cleanup replay then used the final package
against direct mpv PID `49746` and companion PID `49748`. It passed exact native
geometry attachment and teardown with no `.geometry.json` sidecar remaining;
the cleanup is limited to sidecars whose PID is no longer alive, including
interrupted `.next` writes, and intentionally leaves dead session descriptors
available for the existing crash-recovery replacement path. Evidence is in
`/tmp/iinatan-autostart-sidecar-reap-20260908/`.

After the renderer-setting forwarding change, the rebuilt final package passed
the direct LaunchServices attach/default-geometry replay again with direct mpv
PID `60019` and companion PID `60021`; the native source reported
`native-libass-instrumented`, `instrumentationValidated:true`,
`contentExact:true`, and `exact:true`. The bridge unit regression separately
exercises non-default force-margin, hinting, and shaper values. Evidence for
the packaged replay is in `/tmp/iinatan-autostart-renderer-options-20260908/`.

The subsequent package containing the fail-closed renderer-option gate passed
the same direct replay with mpv PID `70239` and companion PID `70257`, again
reporting exact AppKit content geometry and instrumented validation. Its
package evidence is in `/tmp/iinatan-autostart-renderer-gate-20260908/`.

The live fail-closed replay mutates the running stock mpv through JSON IPC with
sixteen unsupported renderer cases: `sub-ass-style-overrides`, `sub-ass=no`,
`sub-ass-scale-with-window=yes`, `sub-ass-justify=yes`, `sub-justify=left`,
`sub-font-provider=none`, `sub-fix-timing=yes`, non-default
`sub-fix-timing-threshold` and `sub-fix-timing-keep`, non-default `sub-fps`,
`sub-stretch-durations=yes`, `sub-clear-on-seek=yes`,
`sub-past-video-end=yes`, non-empty `sub-filter-regex` and `sub-filter-jsre`,
and non-default `sub-filter-sdh-enclosures`. For each case the packaged helper
withdraws exact geometry, reports
`NATIVE_GEOMETRY_INPUT_UNSUPPORTED`, and exposes only the conservative
plain-text approximation; restoring the original value recovers instrumented
exact geometry. The replay records one invalidation/recovery pair per option in
`result.json`. The latest signed-package run covered geometry generations
`83`–`138` for direct mpv PID `33805` and companion PID `33807`; the same run
then toggled the supported `embeddedfonts=no` control while retaining exact
instrumented geometry and recovered the default at generations `139`–`140`.
Evidence is in
`/tmp/iinatan-autostart-renderer-boundaries-embeddedfonts-20260908/`. The
replay command is:

```sh
IINATAN_E2E_AUTOSTART_REQUIRED=1 \
IINATAN_E2E_AUTOSTART_RESTART=1 \
IINATAN_E2E_AUTOSTART_NATIVE_GEOMETRY_DEFAULT_REQUIRED=1 \
IINATAN_E2E_AUTOSTART_FAIL_CLOSED_REQUIRED=1 \
IINATAN_E2E_AUTOSTART_COMPANION_APP="/absolute/path/to/iinatan for mpv.app" \
IINATAN_E2E_AUTOSTART_EXPECTED_APP="/absolute/path/to/iinatan for mpv.app" \
npm run test:native:autostart
```

A fresh post-rebuild default-geometry replay on the single-display desktop
also passed without the live-popup extension: LaunchServices selected the
newly started companion PID `57031` for stock-mpv PID `57027`, and the status
contract reported `native-libass-instrumented`, `exact:true`,
`contentExact:true`, and instrumentation validation enabled. The smoke restored
the normal menu-bar companion and left no test mpv process running.

After the public layout-interface probe was added, the newly rebuilt and
Apple-Development-signed package passed the same direct stock-mpv attach again:
mpv PID `63613` attached to companion PID `63627`, with
`native-libass-instrumented`, `instrumentationValidated:true`,
`contentExact:true`, and `exact:true`. Evidence is in
`/tmp/iinatan-autostart-final-package-layout-interface-20260908/`; the teardown
left the normal companion running and no test mpv or geometry sidecar.

The packaged launcher also accepts an explicit media path without requiring an
application window or terminal:

```sh
iinatan\ for\ mpv --open-media=/absolute/path/to/video.mkv
```

The application resolves that path, starts the user's existing mpv through the
same private session/IPC contract, and relies on ordinary descriptor discovery
for attachment. This is a cross-platform bootstrap path; it is not evidence of
native window placement or input behavior.

The packaged macOS arm64 menu path has also been replayed against the real
desktop surface. The signed app opened the native `Open media in mpv…` file
picker; selecting a media file started `/opt/homebrew/bin/mpv` without a
terminal, with the bundled `mpv/iinatan.lua`, a private Unix IPC socket,
and the selected path. The resulting process and descriptor were observed in
`/tmp/iinatan-menu-launch-E7N18n/packaged-status.json`; the picker and launch
screen capture are in the same directory. This proves the macOS GUI bootstrap
and selected-file handoff, while the separate native overlay/input replay
remains the evidence for subtitle interaction.

The multiple-instance isolation smoke is:

```sh
npm run test:mpv:multi
```

It launches two ordinary stock mpv processes in one descriptor directory,
requires distinct PIDs/session IDs/IPC endpoints, verifies that each bridge's
identity matches its descriptor, sets different volume values through the two
real sockets, and confirms that each value remains isolated. It also checks
descriptor cleanup on shutdown. The current mpv 0.41.0 run passed with
session volumes `17` and `63`; this is headless session-isolation evidence,
not native window or input evidence.

The forced-termination/replacement smoke is:

```sh
npm run test:mpv:recovery
```

It kills one ordinary mpv process, observes its stale descriptor, filters it
out using process identity, starts a replacement in the same descriptor
directory, reconnects through the replacement's IPC endpoint, and verifies a
property update. This covers the crash/replacement session boundary without
claiming renderer or native-window recovery.

The opt-in native window identity smoke is:

```sh
IINATAN_NATIVE_WINDOW=1 npm run test:mpv:window
```

On macOS, include the optional in-process content-boundary smoke with:

```sh
IINATAN_NATIVE_WINDOW=1 \
IINATAN_NATIVE_SHIM=/absolute/path/to/build/native/iinatan-mpv-window-shim.so \
npm run test:mpv:window
```

The normal macOS session script also auto-discovers the bundled content shim
from its own directory, adjacent `bin/` or `build/native/` directories, and
the standard per-user mpv script locations. The discovery path is required by
this focused smoke with:

```sh
IINATAN_NATIVE_WINDOW=1 \
IINATAN_NATIVE_SHIM_AUTO_REQUIRED=1 \
npm run test:mpv:window
```

The 2026-09-08 macOS arm64 run passed against stock mpv `0.41.0` without an
explicit `IINATAN_NATIVE_SHIM`, reporting AppKit content bounds `480x270`,
`contentSource:"appkit-content-view"`, and `contentExact:true`. This is
content-sidecar loading evidence only; subtitle glyph equivalence remains a
separate geometry-oracle boundary.

It launches a visible, unmodified stock mpv, reads the repository session
descriptor, and uses the platform window probe to verify the real process
window and scalar frame geometry. With the shim, it additionally verifies the
identity-checked AppKit content-view sidecar and promotes the adapter result to
`contentExact:true` with capability `macos-appkit-content-shim`; the sidecar
contains no pixels. `IINATAN_NATIVE_WINDOW_ACTIVATE=1`
also checks the native activation boundary when the platform reports foreground
state. This is still window/content-boundary evidence only: it does not prove
Electron composition, pointer/keyboard injection, subtitle pixels, or combined
desktop capture. It is intentionally opt-in because headless CI cannot provide
a native graphical session.

The harness uses stock mpv's `--force-window=immediate` and explicit
`--vo=gpu-next`. This keeps the real window and JSON IPC initialized together
on the validated macOS mpv 0.41.0 build; the session script receives the
explicit IPC endpoint as a script option because early Cocoa initialization
can block optional `window-id` and `gpu-api` property reads. The descriptor
publishes PID/session/IPC identity immediately, while the native probe and
AppKit sidecar perform the authoritative window-identity match.

With the display briefly kept awake on 2026-09-06, the shim-enabled smoke
passed with a real window, matching AppKit content bounds `960x540`,
`contentExact:true`, `fullscreenObserved:false` from both mpv and AppKit, and
`contentSource:"appkit-content-view"`. A separate activation run kept the
display awake but was denied by the host (`activated:false`,
`requestAccepted:false`, `foregroundVerified:false`, frontmost PID `408`,
`loginwindow`); that remains an activation/input limitation rather than a
geometry claim. Earlier timeout runs are retained below as historical host-state
observations.

On Linux X11, the same helper validates the returned EWMH property type and
format before reading `_NET_WM_PID`, `_NET_CLIENT_LIST`, and
`_NET_ACTIVE_WINDOW`. Xlib exposes format-32 property data through its
documented `long` representation, so the helper narrows those values only
after reading that representation and checking the 32-bit range. A complete
client list is required; a truncated list is not used for identity matching.
Activation reports `activationRequested:true`, `requestAccepted:true`, and
`foregroundVerified:false` after sending the EWMH request. It does not claim
`activated:true` from `XSendEvent` alone, because `_NET_ACTIVE_WINDOW` is a
window-manager request and the active-window property is the authoritative
observation. See the [Xlib `XGetWindowProperty` documentation](https://www.x.org/releases/X11R7.6/doc/libX11/specs/libX11/libX11.html)
and the [EWMH `_NET_ACTIVE_WINDOW` specification](https://specifications.freedesktop.org/wm/latest-single/).
The X11 window-probe and desktop-input sources are built in CI with
`libx11-dev` and `libxtst-dev`. This macOS host has X11 headers but not the
XTest development headers, so it has no local Linux link result to claim; with
no `DISPLAY` available, running an X11-linked probe would report
`x11-display-unavailable` and would not count as GUI evidence anyway.

The Windows helper similarly reports `activationRequested`, the
`SetForegroundWindow` return as `requestAccepted`, and an immediate
`foregroundVerified` observation from `GetForegroundWindow`; it does not
collapse those values into an unconditional activation claim. Windows can
restrict which process may set the foreground window, so a graphical runner
must still poll the helper and verify the resulting HWND. See the [Microsoft
`SetForegroundWindow` documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
and [`GetForegroundWindow`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow).

The Windows native-window probe smoke is:

```sh
IINATAN_WINDOWS_REQUIRED=1 npm run test:native:windows
```

The required Windows CI job creates a real Electron window, checks the
compiled helper's HWND/client-area and PerMonitorV2 DPI contract, requests
activation and observes the foreground HWND, then verifies movement and
resize. This is a native Win32 window-boundary result only; it does not claim
stock-mpv overlay, subtitle geometry, or popup input evidence.

The Windows native-controller smoke is:

```sh
IINATAN_NATIVE_CONTROLLER_REQUIRED=1 npm run test:native:controller
```

It validates the portable helper's native-HID capability and the complete
canonical button/trigger schema, then samples the connected DualSense through
the bundled WinMM joystick adapter. The worker integration variant also passed
with controller polling enabled and a connected native state.

The Windows browser-gamepad fallback smoke is:

```sh
npm run test:native:gamepad
```

It loads the shipped passive overlay with the real preload and records the
controller state emitted by Chromium's Gamepad API. A device connected before
the page loads can remain hidden from `navigator.getGamepads()` until a button
or axis is actuated in the focused page, so the default smoke reports that
observation without failing. `IINATAN_NATIVE_GAMEPAD_REQUIRED=1` makes that
absence a failure when physical activation is part of the run. See [MDN's
Gamepad API activation guidance](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)
and [`Navigator.getGamepads()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads).

An earlier macOS activation-only retry on this host was denied before native
input: the helper reported `activated:false`, `requestAccepted:false`,
`foregroundVerified:false`, `displayAsleep:true`, and foreground PID `408`
(`loginwindow`). That remains host-state evidence for the blocked run, not a
claim that AppKit activation is universally unavailable. A subsequent
macOS arm64 stock-mpv window smoke passed with the signed helper's activation
request accepted, foreground verification true, and the AppKit content shim
reporting exact `480x270` content bounds for window ID `13693`.

The same stock-mpv window smoke can request native fullscreen with
`IINATAN_NATIVE_WINDOW_FULLSCREEN=1`. The combined desktop harness accepts
`IINATAN_E2E_FULLSCREEN=1`; windowed and fullscreen runs are recorded as
separate platform results because Spaces, display scaling, and input focus can
change across the transition. The window smoke also reads mpv's real
`fullscreen` property. When the macOS shim is present, it additionally reports
the public AppKit `NSWindowStyleMaskFullScreen` observation as
`fullscreenEvidence:"appkit-window-style-mask"`. The strict shim smoke requires
that observation to match the requested state. The idle-only window smoke can
still report `fullscreen=true` while AppKit reports `fullscreenObserved:false`
before a media-backed fullscreen transition, so it fails explicitly rather
than claiming native Spaces/compositor fullscreen. In the real-media desktop
harness, the AppKit sidecar's window ID is now passed back to the external
probe before the unqualified scan; this handles mpv's separate fullscreen
auxiliary window while retaining the PID/window identity check. The supplied
MARRIAGETOXIN replay passed with exact `1470x923` content bounds and
`fullscreenObserved:true`; the live Jitendex/Hoshi Japanese replay passed the
same fullscreen and native-input gates. Without the shim,
`fullscreenObserved` remains mpv-property-only evidence.
The sidecar reads the public `NSWindow.styleMask` property, whose documentation
defines the full-screen mask: [Apple AppKit documentation](https://developer.apple.com/documentation/appkit/nswindow/stylemask-swift.property?language=objc).

The deterministic subtitle-property smoke is:

```sh
npm run test:mpv:subtitles
```

It generates a solid-color test video, loads committed SRT and ASS fixtures as
separate primary and secondary tracks in unmodified stock mpv, and verifies
track identity, source paths, primary cue timing, separate secondary-track
selection, secondary-track disable/restore, and a seek to a later cue through
the real JSON IPC bridge. If the selected video-output backend exposes active
secondary subtitle text/timing, the same test also records those values. On
mpv 0.41.0 with the intentionally headless `--vo=null` backend in the current
environment, the secondary track was selected but its active text/timing
properties were empty; the test reports that capability boundary rather than
claiming simultaneous subtitle evidence. The public
`secondary-sub-text/ass-full` property was also unavailable, so plain
secondary text is never treated as ASS geometry. This is subtitle-property
evidence only: it does not prove per-glyph layout, native window placement, or
combined compositor capture.

The opt-in real-media stock-mpv smoke is:

```sh
IINATAN_MEDIA_PATH="/absolute/path/to/file.mkv" \
IINATAN_MEDIA_SUBTITLE_ID=1 \
IINATAN_MEDIA_START_SECONDS=19 \
npm run test:mpv:media
```

It uses unmodified stock mpv with `--vo=null`, preserves the real media path
and embedded ASS stream identity, and requires an active cue at the chosen
start time. On the supplied MARRIAGETOXIN episode, the 2026-09-06 run selected
English ASS track `1` (`ffIndex:2`), reported `time-pos:19.061`, preserved the
embedded source path, and returned the `18.170–20.580` second cue with ASS
extradata. This is independent subtitle-property evidence; it does not claim
desktop composition or native input.

The same exact-media smoke also selected the adjacent external Japanese
SubRip track:

```sh
IINATAN_MEDIA_PATH="/Volumes/Media Files/anime/MARRIAGETOXIN/Season 01/MARRIAGETOXIN (2026) - S01E01 - The Poison Masters Search for a Bride [HDTV-1080p][AAC 2.0][x265]-DKB.mkv" \
IINATAN_MEDIA_SUBTITLE_ID=15 \
IINATAN_MEDIA_START_SECONDS=19 \
npm run test:mpv:media
```

The 2026-09-06 run reported mpv id `15`, codec `subrip`, external source
`...DKB.ja.hi.srt`, `time-pos:19.102`, and the
`18.150–20.450` second cue with two Japanese lines. Its `ass-full` payload was
available while `sub-ass-extradata` was empty; the bounded SubRip observation
path is what supplies the conversion metadata for native geometry.

The bridge also observes mpv's primary `sub-delay`, secondary
`secondary-sub-delay`, and `sub-speed` controls as geometry dependencies. A
change invalidates the immutable geometry generation before the next native or
approximate snapshot is published, so subtitle timing changes cannot reuse a
previous lookup registration. The stock-mpv subtitle smoke changes each
control, observes the generation transition, and restores the defaults before
continuing its track-switch and seek checks. These properties are documented in mpv's
[subtitle options](https://mpv.io/manual/stable/#options-subtitles). The bridge
also uses the documented millisecond units from `sub-start/full` and
`sub-end/full`; it additionally recognizes the same-seconds representation
returned by the validated mpv 0.41.0 JSON-IPC build and converts that form
once.

The optional HoshiDicts worker smoke is:

```sh
IINATAN_HOSHI=/path/to/iina-hoshi-dicts \\
IINATAN_DICTIONARY_ZIP=/path/to/dictionary.zip \\
npm run test:hoshi
```

It imports a validated Yomitan ZIP when requested, starts the worker through
the repository adapter, waits for its ready handshake, and performs one real
lookup. The macOS arm64 package supplies the helper; other platforms require
`IINATAN_HOSHI`. Without a backend or dictionary input it prints an explicit
skip. It is dictionary/backend evidence, not native desktop or stock-mpv
geometry evidence.

The macOS bitmap-subtitle OCR boundary is exercised by the core and controller
tests:

```sh
npm test
```

The signed macOS helper reports `bitmapOcr.available:true`, Vision revision 3,
and its supported recognition languages through `./bin/iina-hoshi-dicts version`.
The host uses the decoded-subtitle request path for selected bitmap
tracks and can use the paused screenshot-diff path when
`bitmapSubtitleOcrScreenshotFallbackEnabled` is enabled. OCR results are
lookupable approximate geometry (`exact:false`); this does not close the
separate stock-mpv glyph-equivalence gate. Windows/Linux OCR remains
unverified and is not run from this macOS workspace.

The native desktop OCR acceptance also passed on 2026-09-07 using the real
Hunter × Hunter Blu-ray MKV mounted at
`/Volumes/Media Files/anime/Hunter x Hunter (2011)/Season 01/Hunter x Hunter
(2011) - S01E13 - 013 - Letter x From x Gon [Bluray-1080p][10bit][h265][AAC
2.0][EN+JA]-Anime Time.mkv`. The selected stock-mpv track was subtitle id `2`
(`ff-index: 4`, `hdmv_pgs_subtitle`); Vision decoded the active cue as
`Monsters and beasts...` and returned 20 bounded lookup units. The signed
macOS vertical slice ran with approximate geometry explicitly allowed and
passed the real popup, combined desktop capture, native selection drag,
Escape/outside dismissal, pause ownership, and three additional character
probes. Evidence is preserved under
`/tmp/iinatan-e2e-evidence-macos-bitmap-r8`; the helper-only request measured
519 ms end-to-end, while the native replay recorded pointer-to-popup 185.189
ms and combined popup capture 554.516 ms. The harness accepts bitmap tracks
with finite cue timing even though stock mpv does not expose a `sub-text`
string for PGS; it does not relax the exact-geometry gate for ASS/text tracks.

The same replay also passed with the app's live recommended-dictionary path on
2026-09-07. `wty-en-en` downloaded and imported 102.0 MiB in 20.317 seconds,
the Electron status reported the HoshiDicts backend with one enabled managed
dictionary, and the popup used the real structured English result. The live
replay recorded pointer-to-popup 34.860 ms, combined popup capture 428.114 ms,
native selection 218.757 ms, native scroll 117.347 ms, and all three character
probes. Evidence is preserved under
`/tmp/iinatan-e2e-evidence-macos-bitmap-live-r2`.

The non-macOS portable dictionary worker smoke is:

```sh
IINATAN_PORTABLE_HOSHI=/absolute/path/to/iina-hoshi-dicts \
IINATAN_PORTABLE_HOSHI_REQUIRED=1 npm run test:hoshi:portable
```

It creates a bounded Yomitan fixture in a temporary directory, exercises the
real importer and worker queue, and checks one lookup. The portable helper
reports the pinned HoshiDicts revision in both its `version` and `ready`
responses; the smoke rejects a revision mismatch and confirms that ASS
geometry remains explicitly unavailable on these targets. This test does not
provide native desktop or subtitle-registration evidence. On 2026-09-06, the
target was explicitly enabled in the macOS arm64 CMake build and the required
smoke passed with one imported dictionary and one lookup.

The Linux X11 native-window probe smoke is:

```sh
IINATAN_X11_REQUIRED=1 npm run test:native:x11
```

The CI job runs this under Xvfb with Openbox, creates a real Electron X11
window, and exercises `_NET_WM_PID` discovery, native activation followed by
foreground observation, movement, and resize through the compiled helper. It
is deliberately narrower than stock-mpv companion-overlay evidence; a passing
probe smoke does not promote Linux native subtitle geometry or popup input to
verified status.

The same Linux and Windows CI jobs also build the platform desktop test helper
and run the real Electron popup selection smoke:

```sh
IINATAN_NATIVE_SELECTION=1 \
IINATAN_NATIVE_SELECTION_OVERLAY=1 npm run test:native:selection
```

The X11 helper uses the XTest extension for pointer/keyboard delivery and
captures the X11 desktop through `XGetImage`; the Win32 helper uses
`SendInput` and GDI capture. This is native input and transparent-popup
evidence, not stock-mpv subtitle attachment or combined mpv/overlay evidence.
The CI definitions are required, but their hosted-runner results remain
unverified until those jobs execute successfully.

The local Windows x86-64 run on 2026-09-09 passed `test:native:windows`, the
bundled native geometry smoke, `test:native:selection`, and the real stock-mpv
multi-session ownership smoke. The Windows helper reported DirectWrite,
libass `0.17.5`, FFmpeg `9.0.1`, three primary fixture units, six secondary
strip units, and seven Unicode units. The multi-session run kept two stock-mpv
sessions isolated, replaced one after shutdown, and verified native focus for
the replacement. The stock-mpv recovery smoke also forced one player to exit,
ignored its stale descriptor, recovered IPC through a replacement player, and
left no mpv process behind. The standalone native window smoke passed in both
windowed and fullscreen modes, including descriptor-based player identity and
foreground activation. Windows cleanup targets the actual player PID recorded
by the session descriptor because the `mpv` command can create a separate
launcher process. These results are local Windows evidence; they do not
promote the hosted Linux jobs.

The workflow also defines required stock-mpv/Electron combined-desktop jobs for
Linux X11 and Windows. They install a real stock mpv, launch the normal
transparent companion surfaces, inject native pointer/keyboard input, capture
the desktop containing both applications, and upload the evidence directory.
Those jobs currently set `IINATAN_E2E_ALLOW_APPROXIMATE=1` because the portable
Linux/Windows workers do not provide the patched ASS geometry backend. A passing
job would therefore prove native composition/input and no leaked mpv action,
but not exact subtitle registration; no hosted-runner result is claimed yet.

The live recommended-dictionary path is separately exercised with the
application catalog and its own HTTPS downloader:

```sh
IINATAN_DICTIONARY_DOWNLOAD_REQUIRED=1 npm run test:dictionary:download
```

This uses a disposable settings/install root, downloads the configured
Jitendex release, validates and imports it through HoshiDicts, starts the
worker from the managed path, and performs a real `猫を見る` lookup. The
latest macOS arm64 run on 2026-09-08 downloaded 36.9 MiB, installed one
enabled dictionary, and returned two lookup results in 2.197 seconds for
download/import, 15 ms for worker readiness, and 23 ms for lookup. The same
run reported the signed HoshiDicts `1.11.0` wrapper with revision
`a28d82eb0f169b8ceff79e8c99ffe0b96709ab27`, libass `0.17.5`, FFmpeg `9.0.1`,
and arm64 ASS geometry support. It is
opt-in because it requires network access and an upstream archive; it does
not modify the user's settings or dictionary directory.

The AnkiConnect loopback mock smoke is:

```sh
npm run test:anki
```

It starts an ephemeral localhost-only HTTP service rather than contacting the
user's Anki collection, then exercises version/deck/model discovery, field
discovery, duplicate lookup, opening an existing note, media storage, and note
creation through the same bounded `AnkiConnectClient` used by the application.
No real note is created or modified.

Anki sentence-audio capture uses the optional host-side
`src/services/sentence-audio-service.js` boundary. It derives a bounded window
from immutable subtitle-event context, applies the selected track's delay and
`sub-speed`, adds configured padding, and invokes an explicitly configured or
packaged `ffmpeg` executable through an argument vector. Capture is limited to
35 seconds and 8 MiB. Package preparation copies the platform-selected
`ffmpeg-static` binary to the external `bin/ffmpeg.exe` resource, while
`IINATAN_FFMPEG=/absolute/path/to/ffmpeg` or
`--ffmpeg=/absolute/path/to/ffmpeg` remains available for validation overrides.
If neither resource is available, Anki reports a visible media warning. mpv
documents that `sub-delay` shifts subtitle timestamps and `sub-speed` multiplies
them in the
[subtitle options](https://mpv.io/manual/stable/#options-subtitles).

The real encoder smoke is:

```sh
npm run test:sentence-audio
```

It generates a bounded local audio fixture and captures a padded MP3 through
the same service and subprocess boundary used by Anki. It does not prove that
every distributed ffmpeg build has the requested codecs; package acceptance
must still validate the bundled helper on each target.

The bundled ASS backend protocol smoke is:

```sh
npm run test:native-geometry
```

It sends a deterministic three-word ASS request through the native worker
boundary and verifies the returned unit positions, positive rectangles, and
diagnostics. On Windows the local run selected the DirectWrite helper and
returned three primary units, six secondary-strip units, and seven Unicode
units. This proves the packaged helper and JavaScript protocol interoperate; it
does not by itself compare those rectangles with pixels from ordinary stock
mpv, so it cannot promote exact stock-mpv lookup support.

The independent stock-mpv pixel oracle is:

```sh
npm run test:stock-pixels
```

It renders deterministic bottom, Unicode, mixed-language, missing-font
fallback, simple external SubRip, color-separated, single-event inline-color,
unique-color unit-identity, top,
style-level positioned, explicit-position, explicit-movement, static-tag,
vector-clip, advanced-non-drawing-tag, bounded-transform, and
multiple-event/multiline ASS fixtures separately, then renders both fixtures
simultaneously with unmodified stock mpv's `vo=image`,
once with explicit `secondary-sub-ass-override=no` and once with stock's
default `secondary-sub-ass-override=strip`. The primary track uses stock
mpv's default `sub-ass-override=scale`. Each case gets a matching no-subtitle
baseline; changed subtitle-pixel bounds are then compared with separately
requested native geometry, including every requested word range. The current
macOS arm64 run against mpv 0.41.0 produced IoU `1.0` for the simple bottom,
top, and explicit simultaneous cases, `0.9883720930232558` for the
supplementary/combining-mark/newline case, and `0.9985119047619048` for the
bounded default-strip case; the top-left, italic, spacing, outline, shadow, and
margin style case produced IoU `0.8124381065557537`, the mixed-language case
produced IoU `0.8630438324914453`, and the two simultaneous events with an
explicit line break produced IoU `0.92`. The color-separated unit-identity
case produced IoU `0.8612880870945387` with nonzero color-matched pixels for
all four requested word regions. The missing-font fallback case produced IoU
`0.875` with nonzero coverage for both requested word regions. The simple
external SubRip case produced IoU `0.9036334913112164` with nonzero coverage
for both requested word regions. The unique-color identity fixture produced
IoU `0.8628113879003558`, with independent per-unit color-region IoUs from
`0.9457755359394704` to `0.9615384615384616` and a maximum annotated edge
error of one physical pixel. The single-event
inline-color identity fixture produced IoU `0.9229957805907173`, with
nonzero color-matched pixels for all four word regions and a maximum annotated
edge error of one physical pixel. The explicit-position fixture produced IoU
`0.8614864864864865` with nonzero coverage for its requested phrase region.
The explicit-movement fixture produced IoU `0.8862068965517241` with nonzero
coverage for its requested phrase region. The static-tag fixture produced IoU
`0.9422287390029326` with nonzero coverage for its requested phrase region.
The bounded-transform fixture produced IoU `0.8994301994301994` with nonzero
coverage for its requested phrase region. The vector-clip fixture produced IoU
`0.8388552093613422`; its visible-envelope IoU was `0.9971181556195965`.
The advanced non-drawing-tag fixture produced IoU `0.9065478657273104`; its
visible-envelope IoU was `1.0`. The dedicated multi-syllable karaoke fixture
produced IoU `0.8325508607198748`, visible-envelope IoU
`0.9953271028037384`, and nonzero coverage for all four requested
syllable/word regions. Across the twenty cases, all fifty-eight requested
per-case unit observations had nonzero bounds coverage.
This is a bounds-and-unit coverage oracle with independently annotated unit
identity evidence, not proof that arbitrary stock-mpv glyph layout has been
exposed. The same run also records additive visible-envelope IoUs; those
validate the visual envelope used by highlights and popup anchors but do not
change the fill-based hit-test contract.
Across the twenty cases, visible-envelope IoU ranged from
`0.8845315904139434` to `1.0`.
The final post-package-rebuild rerun on 2026-09-08 exited successfully across
the complete selected fixture set, including the simultaneous primary and
secondary-track cases; the optional alpha-isolated per-glyph diagnostic is
recorded separately below.

The Windows x86-64 rerun on 2026-09-09 used the locked libass 0.17.4
compatibility helper against stock mpv `0.41.0-dev` and passed all 21 selected
and simultaneous fixture cases, including the seven isolated per-glyph probes.
The isolated probes each had IoU `1.0`; the minimum independent identity-group
IoU was `0.894230769230769` for unique color spans and `0.916466346153846` for
inline color spans. Windows DirectWrite primary-colour cores are allowed a
diagnostic edge tolerance of three pixels while the group IoU, fill-bounds,
visible-envelope, and isolated-glyph checks remain enforced. This broadens
Windows evidence across mixed scripts, missing-font fallback, positions,
transforms, karaoke, two-track events, and unit identity; it still does not
promote arbitrary stock-mpv renderer tuples to exact support.

The simple external SubRip native request mirrors stock mpv's text-to-ASS
conversion for ordinary `.srt`/`.subrip` cues. It is bounded to the observed
renderer shape and fails closed for unsupported tags or options.
The default-strip native request is observation-only: it strips ASS formatting
and synthesizes a centered-top ASS style from the observed stock-mpv renderer
options. It is accepted only for the default top position and centered
alignment and the observed default renderer options; arbitrary custom positions,
alignments, fonts, colors, scale options, advanced ASS features, native per-unit
identity probes, platform scaling, and combined compositor capture remain open
for the native adapter and desktop path. The explicit-position,
explicit-movement, static-tag, vector-clip, advanced-non-drawing-tag, and
bounded-transform fixtures are the bounded exceptions: valid
`\\pos(x,y)`, `\\move(x1,y1,x2,y2[,t1,t2])`, and the validated static renderer
tags (including `\\an`, `\\fn`, `\\fs`, `\\fsp`, `\\bord`, `\\shad`, `\\frz`,
rectangular `\\clip` including bounded vector paths, and bounded `\\k` karaoke),
the non-drawing `\\fad`, `\\fade`, `\\org`, legacy alignment,
underline/strikeout, axis-border, font-encoding, and explicit text-mode forms,
plus bounded `\\t(...)` forms
with numeric timing and supported nested modifiers, are passed through to
libass and covered by the stock-pixel oracle. The
style-level fixture is independent stock-mpv pixel
evidence; it does not promote those other modes to native adapter support.

The separate `native-ass-geometry-explicit-position-smoke.ass` fixture contains
an inline `\\pos(200,200)` event. The native request builder and bundled helper
preserve the tag, and the stock-pixel oracle records IoU
`0.8614864864864865`; malformed position syntax still fails closed. The
`native-ass-geometry-explicit-movement-smoke.ass` fixture covers a four-argument
`\\move` event at its midpoint with IoU `0.8862068965517241`; malformed movement
syntax still fails closed. The `native-ass-geometry-static-tags-smoke.ass`
fixture covers inline alignment, font, size, spacing, border, shadow, rotation,
rectangular clipping, and bounded karaoke at the sampled event midpoint with
IoU `0.9422287390029326`.

The `native-ass-geometry-transform-smoke.ass` fixture covers a bounded
numeric-timing `\\t(...)` event with a supported nested font-size modifier at
the sampled event midpoint; the stock-mpv comparison produced IoU
`0.8994301994301994`. Nested transforms and malformed timing remain
fail-closed.

The `native-ass-geometry-vector-clip-smoke.ass` fixture covers a bounded
vector path around lookupable text. Its native fill bounds had IoU
`0.8388552093613422` against unmodified stock mpv, while the additive visible
envelope had IoU `0.9971181556195965`; malformed vector paths still fail closed.

The `native-ass-geometry-advanced-tags-smoke.ass` fixture covers non-drawing
`\\fad`, `\\fade`, `\\org`, legacy alignment, axis-border, underline/strikeout,
font-encoding, and explicit text-mode tags. Its native fill bounds had IoU
`0.9065478657273104`, while the additive visible envelope had IoU `1.0`.
Drawing mode, unknown tags, and malformed forms remain fail-closed.

The supplied-media ASS attachment smoke uses the real MARRIAGETOXIN MKV, the
selected embedded ASS stream, and its attached fonts:

```sh
IINATAN_STOCK_PIXEL_ASS_REQUIRED=1 \
IINATAN_STOCK_PIXEL_MEDIA_PATH="/absolute/path/to/MARRIAGETOXIN.mkv" \
IINATAN_STOCK_PIXEL_ASS_FF_INDEX=2 \
IINATAN_STOCK_PIXEL_ASS_ID=1 \
npm run test:stock-pixels:media:ass
```

The current run found 24 attachments, requested 30 visible graphemes, and
reported nonzero coverage for all seven word probes. Visible-envelope IoU was
`1.0`; the primary-colour fill IoU was `0.9990138067061144`. This confirms
character-plane registration and whole-subtitle envelope alignment; the
selected alpha-isolated per-glyph fixture also passed all seven visible-fill
comparisons. Decorative outline/shadow assignment for arbitrary ASS remains
outside the full stock-mpv equivalence gate.

The Windows x86-64 real-media Japanese SubRip oracle also passed on
2026-09-09. At the `18.157–20.451` second cue, the independent stock-mpv
capture measured `240x100` visible subtitle bounds; the DirectWrite helper
predicted a `240x101` visible envelope with IoU `0.9900990099009901` and
nonzero captured-pixel coverage for every grapheme in both lines. The fill-box
IoU was `0.9341666666666667`. This is direct Windows stock-mpv pixel evidence
for the tested subtitle and tuple; it does not promote unsupported renderer
tuples or every fullscreen configuration to exact runtime support.

After the envelope field was propagated into the runtime snapshot, the refreshed
signed directory package passed a deterministic packaged macOS replay with
native selection, popup scrolling, hover replacement, focus preservation,
outside dismissal, pause/liveness, combined desktop capture, and an 8-second
Screen Recording. The snapshot evidence contained both fill and envelope
rectangles. Evidence is retained under
`/tmp/iinatan-e2e-packaged-envelope-20260908/run-47341-1788859913808/`.

The same refreshed package was then replayed against the supplied
MARRIAGETOXIN MKV using subtitle track `15`, live `jitendex-ja-en` import, and
the Japanese lookup path. It passed native selection (`Jitendex.`), popup
scrolling (`1501.5`), hover replacement, popup focus preservation, outside
dismissal, pause/liveness, combined capture, and an 8-second Screen Recording.
Evidence is retained under
`/tmp/iinatan-e2e-packaged-marragiatoxin-envelope-20260908/run-47815-1788860079676/`.

`native-ass-geometry-unsupported-modes-smoke.ass` exercises drawing mode and
unknown tags. Vector clipping is covered by the separate bounded fixture above.
The native request builder rejects each unsupported case, and the controller exposes the
bounded failure code/message through Settings Diagnostics instead of publishing
approximate lookup rectangles in ordinary runtime mode.

The desktop vertical-slice command is:

```sh
npm run test:e2e
```

It refuses to call a headless or mocked run native evidence. Set
`IINATAN_E2E=1` only in an isolated graphical environment with a real stock
mpv, the packaged helper, the macOS `iinatan-desktop-test` helper from
`npm run build:native`, and native pointer/keyboard injection available. The
helper records independent `accessibilityTrusted` and `postEventTrusted`
checks; a run with either false is blocked before popup interaction and cannot
claim combined input/capture evidence. The default video output is `gpu-next`;
`IINATAN_E2E_VO` records an explicit
alternative for diagnosis, but `null` is not visible-subtitle evidence. The
test captures the combined desktop/compositor result and records mpv state
before and after popup interaction. A browser screenshot or mpv screenshot
alone is not sufficient. `IINATAN_E2E_GPU_CONTEXT` optionally passes an
explicit mpv GPU context such as `macvk` or `displayvk`; it is a renderer
diagnostic, not a support claim. `IINATAN_E2E_START_PAUSED=0` optionally tests a playing
startup; the default keeps an already-paused player paused and the assertion
checks that user-owned pause is preserved. `IINATAN_E2E_CAPTURE_PATH=/absolute/path.png` keeps the after-capture
artifact for inspection. The harness waits for the active subtitle event,
restores mpv foreground ownership before native pointer injection, and records
the activation result rather than treating an activation request as proof.
`IINATAN_E2E_EVIDENCE_DIR=/absolute/path` additionally preserves a structured
`result.json`, status snapshot, input configuration, desktop captures when they
exist, stderr logs, and the debug mpv log after cleanup. The status snapshot
includes the interaction capture, native-geometry diagnostic, and per-surface
renderer-readiness state. The directory is
created with owner-only permissions and is opt-in so ordinary runs retain their
temporary-file cleanup behavior.
`IINATAN_E2E_ALLOW_APPROXIMATE=1` explicitly bypasses only the exact-content
readiness gate so a graphical runner can test compositor/input ownership; its
output is always labeled approximate and cannot claim exact alignment.
`IINATAN_E2E_REQUIRE_STABLE_SIGNING=1` adds a macOS acceptance gate that
requires the desktop-test bundle to be non-ad-hoc signed and records its
identifier, Team ID, and CDHash in the evidence result.
`IINATAN_E2E_FULLSCREEN=1` requests native fullscreen and must be run as a
separate acceptance case; the harness records the request separately from
observed geometry and does not treat the flag alone as fullscreen proof.
`IINATAN_E2E_ADDITIONAL_POINTER_PROBES=N` adds N additional native pointer
probes after the initial popup. The harness moves to each predicted unit,
requires the live status diagnostic to report the same track/event/unit and
text, dismisses the popup with native Escape, and verifies pause ownership and
mpv liveness after every probe.
To run the same harness against a real local file rather than its generated
fixture, set `IINATAN_E2E_MEDIA_PATH` and select an embedded subtitle track:

```sh
IINATAN_E2E=1 \
IINATAN_E2E_MEDIA_PATH="/absolute/path/to/file.mkv" \
IINATAN_E2E_SUBTITLE_ID=1 \
IINATAN_E2E_START_SECONDS=19 \
npm run test:e2e
```

The external path is read in place, `ffmpeg` generation is skipped, and the
synthetic primary/secondary subtitle files are not added. The default
subtitle id is `1` for an external file; `IINATAN_E2E_SECONDARY_SUBTITLE_ID`
can select a second embedded track. The bridge installs mpv observers before
reading current values so a cue already active at the chosen start time is
not lost; mpv documents both the initial observation notification and the
possibility that `window-id` is unavailable or VO-specific in its [property
and Lua documentation](https://mpv.io/manual/stable/).
Earlier renderer diagnostics on this host found the default/auto GPU paths stalled
JSON IPC and
`displayvk` exited while opening the video. One earlier diagnostic run reached
the real window and validated instrumented subtitle geometry. With the
optional shim, the Electron status also reported `contentExact:true` and
`contentSource:"appkit-content-view"`; the host then denied foreground hand-off
(`activated:false`, frontmost PID `408` / `loginwindow`) before native
pointer/input. Those earlier runs were blocked before combined compositor/input
evidence; a later signed GUI-launched replay is the current positive result.
AppKit activation is also documented as a request that may be denied or may
not guarantee foreground state: [NSRunningApplication activation](https://developer.apple.com/documentation/appkit/nsrunningapplication/activate%28from%3Aoptions%3A%29?language=objc).
The probe now records both the cooperative request and a bounded direct
`activateWithOptions:0` fallback; neither result is accepted as focus without
the observed foreground PID.
The macOS 14+ cooperative activation path was also exercised with the display
kept awake. It reported `displayAsleep:false`,
`targetFinishedLaunching:true`, and `targetActivationPolicy:0` for the test
mpv, but still returned `activated:false` with frontmost PID `408`
(`loginwindow`). This distinguishes a live regular target from a display-sleep
failure; it is still not native focus/input evidence.
After both desktop harnesses were changed to select the PID-named session
descriptor instead of the first JSON file, a fresh strict run reached stock-mpv
IPC, exact instrumented subtitle geometry, and exact AppKit content bounds
before stopping at that same activation boundary.
A later wake-assisted run with the immediate-window/explicit-VO harness reached
the same exact instrumented geometry and AppKit content bounds for both
subtitle tracks, with `contentExact:true`, before the foreground gate again
reported `activated:false` and frontmost PID `408` (`loginwindow`). It did not
inject native pointer input or claim combined compositor evidence.
A separate idle-only fullscreen stock-mpv window smoke reported
`fullscreenObserved:true` from mpv IPC but `fullscreenObserved:false` from the
AppKit style mask, then stopped at that explicit native-fullscreen mismatch.
The later supplied-media fullscreen desktop replay passed the exact geometry,
combined capture, native input, pause-ownership, and Escape gates; its evidence
is retained separately from that idle-only limitation.
An earlier 2026-09-06 rerun, while macOS reported `loginwindow` as the
frontmost process, timed out before the stock-mpv descriptor and adds no
positive desktop evidence; the shim-enabled run reached the exactness gate
and then stopped at the same host foreground boundary.
Subsequent canonical `gpu-next`/`macvk` retries populated both independent
subtitle tracks but stalled before the active subtitle event: `path`,
`time-pos`, and subtitle text remained unavailable. A `gpu`/`macvk` retry
instead timed out on the `video-out-params` property bridge. These are
renderer/IPC blockers rather than native-input evidence. The vertical-slice
launcher now loads independent bottom and top fixtures and explicitly starts
playback; the failure persists after removing those harness ambiguities.
With a reversible `caffeinate -u -i -d` wake assertion, the canonical
`gpu-next`/`macvk` run reached the real stock-mpv window, exact AppKit content
bounds, and `source.exact:true` instrumented geometry for both tracks while
`displayAsleep:false`; it then failed the separate foreground gate with
`activated:false`, `requestAccepted:false`, `targetActivationPolicy:0`, and
frontmost PID `408` (`loginwindow`). This is stronger renderer/content-boundary
evidence, but still not stock-mpv glyph equivalence or native pointer/input
evidence.
A strict replay on 2026-09-06 with the earlier diagnostic context string
`gpu/macvk/system` and
`IINATAN_E2E_START_PAUSED=0` timed out before the stock-mpv descriptor and
preserved a structured result with no player window, Electron status, capture,
or input evidence. The opt-in evidence directory is intended to make this
distinction reproducible without treating an empty capture as a passing result.
A preceding debug run reached the exact instrumented geometry response and the
identity-checked AppKit content sidecar before the foreground wait reported
`activated:false`, `requestAccepted:false`, and `foregroundPid:408`
(`loginwindow`). Debug runs retain the final 4,000 characters of mpv's temporary
`--log-file` output so a future graphical runner can distinguish renderer
startup failures from activation failures.
The supplied real-media replay on 2026-09-06 used the MARRIAGETOXIN MKV with
`IINATAN_E2E_MEDIA_PATH`, embedded English ASS subtitle id `1`, and start time
19 seconds. Stock mpv 0.41.0 decoded the 1920x1080 HEVC file and exposed the
18.170–20.580 second cue; the bridge produced exact instrumented libass unit
geometry, the AppKit sidecar reported exact `640x360` content bounds, and
activation verified mpv as foreground. The desktop capture-before step also
completed. The same run stopped before popup interaction because the native
input helper reported `accessibilityTrusted:false`; it therefore does not
claim native pointer input or combined popup capture.

The latest rerun in the fresh SSH/tmux session reached the same real-media
boundary: stock mpv, exact AppKit content bounds (`640x360`), instrumented
subtitle geometry, foreground ownership, and desktop capture-before all
passed. The helper then reported both `accessibilityTrusted:false` and
`postEventTrusted:false`; the explicit `CGRequestPostEventAccess()` request,
including a Launch Services app-bundle launch, produced no grant or dialog.
This is recorded as a native synthetic-input gate, not as a Screen Recording
failure; the popup, click, Escape, and combined after-capture stages remain
unverified.

A second exact-media replay used external subtitle id `15` from the adjacent
`ja.hi.srt` file. The bounded SubRip request reached the instrumented native
geometry helper with `assObservation:true`, `validationEnabled:true`, and the
same identity-checked `640x360` AppKit content bounds. This run stopped at the
host foreground-ownership gate (`activated:false`, frontmost PID `408`), so it
adds native SubRip geometry evidence but no popup, pointer, or compositor-input
claim.
A subsequent replay also persisted the interaction snapshot in the E2E status
file: the controller remained in `player-interaction` with `capture:null` and
`nativeGeometryError:null` when the foreground wait timed out. This confirms
the new text-selection capture path was not exercised or misreported by a run
that never reached native pointer input.

The 2026-09-07 replay used the supplied MKV, embedded ASS subtitle id `1`,
the live Jitendex download/import path, `IINATAN_E2E_NATIVE_INTERACTION=1`,
and screen recording enabled. Dictionary download/import and the Hoshi-backed
lookup setup completed; stock mpv reached exact instrumented geometry and the
capture-before stage. The run then stopped at the same locked-session boundary:
`requestAccepted:false`, frontmost PID `408` (`loginwindow`), before the helper
could report input permissions or start the recording phase. It adds no native
popup/input/capture claim and confirms that SSH/tmux execution cannot substitute
for an unlocked local graphical session.

Current GUI-launched acceptance replay (2026-09-06) used the supplied
MARRIAGETOXIN MKV, embedded English ASS subtitle id `1`, cue start `19`,
stock mpv `0.41.0`, the Apple Development-signed helper, and exact AppKit
content bounds (`640x360`). It passed `accessibilityTrusted:true` and
`postEventTrusted:true`, moved the native pointer onto the instrumented
subtitle unit, opened the normal transparent Electron popup, captured the
combined desktop at `2940x1912`, delivered a native popup click, preserved
a user-owned pause on the default run, and dismissed the popup with native
Escape while keeping mpv alive. A companion run with
`IINATAN_E2E_START_PAUSED=0` also passed and verified release of the
plugin-owned pause. The popup content is deterministic demo-dictionary data
and the geometry source is opt-in instrumented libass; this is Phase A
window/input evidence, not final stock-mpv glyph-equivalence or production
dictionary evidence. Structured evidence was preserved under
`/tmp/iinatan-e2e-evidence-gui6/`.

The live-dictionary GUI replay also passed on 2026-09-06 using the supplied
MARRIAGETOXIN MKV, external Japanese subtitle track `15` from the adjacent
sidecar, Jitendex downloaded through `DictionaryCatalog`, and the real Hoshi
worker. The app status reported one enabled managed dictionary and the native
replay again passed exact AppKit content (`640x360`), both input permissions,
combined capture (`2940x1912`), native click, Escape dismissal, and mpv
survival. The default paused run preserved the user pause; an unpaused
companion run released no plugin-owned pause after dismissal. Evidence is in
`/tmp/iinatan-e2e-evidence-live-jitendex/` and
`/tmp/iinatan-e2e-evidence-live-jitendex-unpaused/`. Geometry remains
instrumented libass evidence until the independent unmodified-stock-mpv glyph
oracle covers the same subtitle/rendering cases.

The signed GUI-launched fullscreen live replay also passed on 2026-09-06. It
used the supplied MARRIAGETOXIN MKV, external Japanese subtitle track `15`,
the downloaded Jitendex catalog, and the real Hoshi worker. The sidecar
reported exact AppKit content bounds (`1470x923`); the popup assertion observed
the renderer-measured DOM size and a changed-pixel diff over the requested
desktop region. The initial native interaction plus four additional grapheme
probes (`の`, `も`, `ッ`, and `に`) all resolved to the expected subtitle units,
closed with native Escape, preserved pause ownership, and left mpv alive.
Evidence is in
`/tmp/iinatan-e2e-evidence-gui-fullscreen-final7/run-32845-1788719875051/`.
This promotes the real stock-mpv/native-window/input/compositor slice only;
it does not promote stock-mpv glyph equivalence for advanced ASS rendering.

A subsequent windowed live replay with `IINATAN_E2E_SMOOTH_POPUP_APPROACH=1`
passed the same cursor-transit check against the supplied MARRIAGETOXIN media,
external Japanese subtitle track `15`, and the downloaded Jitendex/Hoshi
backend. All 12 transit samples retained popup focus; native selection captured
`００人の人が昨年コレラで死んだ。`, scrolling reached offset `480`, outside-panel
dismissal consumed its click, and mpv remained alive. Evidence is in
`/tmp/iinatan-e2e-evidence-live-smooth-fixed/run-72615-1788729797385/`.

The desktop helper also exposes opt-in `--drag` and `--scroll` operations for
the native popup interaction matrix. `IINATAN_E2E_NATIVE_INTERACTION=1` uses
those operations against renderer-published popup regions, records the open
popup window and panel bounds, and fails closed if a native target falls
outside them. It requires a real selection string; a positive native scroll
offset is required when the measured popup content is scrollable, while a
non-scrollable fixture records an explicit skip. Content-region telemetry is
clipped to the visible panel/header viewport; the full scrollable DOM height
is never used as a native target. The signed GUI-launched run against the
supplied MARRIAGETOXIN MKV, external Japanese track `15`, downloaded Jitendex,
and Hoshi backend passed with selection text `unter`, scroll offset `480`,
`accessibilityTrusted:true`, `postEventTrusted:true`, combined capture at
`2940x1912`, pause preservation, native Escape dismissal, and a live mpv
process. It also reopened the popup and consumed an outside-panel click without
toggling mpv. Evidence is in
`/tmp/iinatan-e2e-evidence-native-interaction-live5/run-40186-1788722388725/`.
The deterministic macOS dictionary fixture includes cross-reference text so
the browser surface verifies nested child lookup and the native surface still
verifies safe structured rendering. The native interaction matrix does not
inject a nested child result; the real Electron document smoke is the current
automated nested-navigation evidence.
Set `IINATAN_E2E_RESIZE_TRANSITION=1` alongside the native interaction matrix
to exercise a live stock-mpv `window-scale` transition. The signed macOS run
changed the player content from exact `640x360` to `480x270`, followed the
native sidecar geometry and Electron geometry generation, restored `640x360`,
and kept the popup surface dismissed throughout. Evidence is under
`/tmp/iinatan-e2e-macos-resize-current-20260908d/run-36848-1788869186590/`.
This covers runtime resize/recovery; mpv's initial `--geometry` remains a
launch-time placement option rather than a runtime movement API.
Set `IINATAN_E2E_NATIVE_LIFECYCLE_CYCLES=N` alongside
`IINATAN_E2E_NATIVE_INTERACTION=1` to repeat the signed macOS hover/popup/
Escape path for a bounded number of cycles (maximum 24). Each cycle verifies
foreground ownership, `accessibilityTrusted:true`, `postEventTrusted:true`,
popup dismissal, pause preservation, and mpv liveness. The harness moves to a
measured subtitle-free point and waits for the hit to clear before the next
cycle, so repeated passes exercise a real leave-and-re-enter transition rather
than repeatedly targeting an unchanged cursor location. The 2026-09-08
deterministic 24-cycle replay passed after reacquiring the current exact
geometry/unit target on every cycle and requiring a non-empty dictionary
headword; evidence is in
`/tmp/iinatan-e2e-macos-lifecycle-current-20260908-headword24/run-39844-1788869843224/`. This remains a
bounded native lifecycle check, not scanout-latency measurement or long-run
compositor stress.
The macOS six-language routing matrix is:

```sh
npm run test:native:languages
```

It runs the real stock-mpv/Electron/native-input replay separately for `ja`,
`en`, `de`, `fr`, `ko`, and `zh`, with a deterministic subtitle fixture and
the demo dictionary. The 2026-09-08 run passed every route with
`accessibilityTrusted:true` and `postEventTrusted:true`; aggregate evidence is
under `/tmp/iinatan-e2e-macos-languages/`. This is native routing and popup
evidence, not a claim that six live dictionary corpora were downloaded or
validated.

A later rerun on the same date reached the Korean route with the native mpv
window and the Korean fixture visible, but the still-open macOS TCC dialog for
ChatGPT was in front of the desktop. The native move call returned trusted
input, yet the popup did not open; the run therefore terminated at the pointer
probe rather than identifying a Korean lookup regression. Its retained desktop
evidence is `/tmp/iinatan-e2e-macos-languages/ko/run-91734-1788843825729/`.
The earlier complete matrix remains the authoritative six-route result until
the external dialog is dismissed and the rerun can be repeated cleanly.
The live variant is:

```sh
npm run test:native:languages:live
```

It uses the plugin's own recommended-dictionary download/import path for
Jitendex, wty-en-en, wty-de-en, wty-fr-en, wty-ko-en, and CC-CEDICT, then repeats
the native popup, selection, scroll, focus, dismissal, pause, and liveness
checks. The 2026-09-08 run passed all six languages with trusted native input;
aggregate evidence is under
`/tmp/iinatan-e2e-macos-languages-live-current-20260908/`. The run reported
`accessibilityTrusted:true` and `postEventTrusted:true` for every route and
retained each language's dictionary metadata, popup selection, and latency
report. This proves one recommended dictionary per language, not every
available dictionary or every corpus entry.
On macOS, the desktop capture helper selects the display containing the
player-window center and returns that display's pixel origin and scale, keeping
the geometry oracle correct for a player opened away from the main display.
The current single-display replay reported Retina `desktopScale:2`, a
`640x360` logical AppKit content area, and a `2940x1912` physical capture for
each language route.
Set `IINATAN_E2E_RECORD_SCREEN=1` to record the same native interaction phase
as a macOS `.mov` with the cursor and click indicators. The artifact is copied
to the evidence directory as `desktop-interaction.mov`, alongside the still
captures and structured result, so a reviewer can see the popup open before
the drag and distinguish Escape dismissal from the separate outside-panel
click. The default bounded duration is 20 seconds and can be changed with
`IINATAN_E2E_RECORD_SECONDS=N`; Screen Recording permission is required for
the process that launches the harness.

A screen-recording attempt on 2026-09-07 did not reach native interaction:
macOS `screencapture` changed foreground verification during recorder startup,
so it adds no recording or popup-input evidence. That was an environment-level
failed attempt, not a product-failure claim. A fresh single-display signed
windowed replay on 2026-09-08 completed the same recording phase successfully:
the `.mov` was `18,557,748` bytes, the four lifecycle cycles opened the real
`careful` headword, both trust checks stayed true, and the combined before/after
captures contained the popup. Evidence is under
`/tmp/iinatan-e2e-macos-single-display-recording-20260908/run-42106-1788870901542/`.
Screen Recording remains an optional diagnostic and is separate from the
functional acceptance gates.

After the signed arm64 directory package was rebuilt with the current menu
contract, `validate:package` and `validate:release` passed, and the native
Settings smoke verified the packaged Open Media `Cmd+O` and Settings `Cmd+,`
metadata, trusted native input, profile editing, and disposable backup/restore
panels. The final supplied-media windowed replay passed the same native popup,
selection, dismissal, pause, liveness, and Screen Recording gates; its evidence
is under
`/tmp/iinatan-e2e-macos-final-20260908/run-55885-1788872949696/`.

The final single-display supplied-media native-fullscreen replay also passed
with AppKit content `1470x923`, popup replacement, native selection, keyboard
focus, non-activating popup foreground preservation, dismissal, pause
preservation, liveness, and combined capture. Evidence is under
`/tmp/iinatan-e2e-macos-fullscreen-final-20260908/run-56520-1788873129178/`.
The separate idle/no-media window-probe smoke still exposes the known boundary
where mpv reports `fullscreen=true` while the AppKit style mask remains
non-fullscreen and the idle content remains `480x270`; it is not used to
contradict the supplied-media fullscreen result.

A fullscreen replay on 2026-09-08 reached the real stock-mpv fullscreen process,
the signed Electron companion, the live Hoshi worker, and the recording phase,
but macOS `screencapture -V20` remained in its ScreenCaptureKit/AppKit wait loop
without creating a movie. The run was stopped after that capture-only hang; it
adds no product-failure claim. The recorder now uses a detached process group
and a duration-plus-10-second teardown bound, so the same permission/API state
will produce a bounded diagnostic instead of hanging the E2E run. The bounded
process sample is in `/tmp/iinatan-screencapture-sample.txt` and the harness log
is `/tmp/iinatan-e2e-fullscreen-current2.log`.

A subsequent signed windowed replay on 2026-09-07 used the same supplied media
and track with the current helper, live Jitendex/Hoshi lookup, and four native
pointer probes. It passed with `accessibilityTrusted:true`,
`postEventTrusted:true`, native selection text `人`, popup scroll offset `480`,
all 12 smooth-approach samples keeping the popup visible and focused, exact
AppKit content bounds, outside-panel dismissal, Escape dismissal, pause
preservation, and mpv survival. Its combined `2940x1912` capture reported a
popup visual-change fraction of `0.9819818833`. The harness now ends the drag at
80% of the measured one-glyph headword region so the native selection crosses
the caret midpoint; this is test targeting, not widened product hit geometry.
Evidence is in
`/tmp/iinatan-e2e-evidence-macos-feature-parity-r3/run-50056-1788773343949/`.
`IINATAN_E2E_SMOOTH_POPUP_APPROACH=1` adds a 12-sample native cursor transit
from the subtitle target into the measured popup content before selection. A
diagnostic run initially exposed a false `geometry-invalidated` dismissal:
volatile native timing/counter diagnostics were being compared as geometry.
Those diagnostics are now excluded from the geometry-change predicate, with a
regression test, and the fixed run kept the popup visible/focused at every
transit sample before completing selection, Escape, and outside-panel dismissal.
Evidence is preserved under
`/tmp/iinatan-e2e-evidence-smooth-fixed/run-71669-1788729618818/`.
Rebuilding the
helper still requires signing and re-adding that exact bundle to macOS
Accessibility before another TCC acceptance run.

The latest signed windowed live replay on 2026-09-07 used the current helper,
the supplied MARRIAGETOXIN MKV, external Japanese subtitle track `15`, live
Jitendex/Hoshi lookup, smooth popup approach, and four additional pointer
probes. It passed with `accessibilityTrusted:true`, `postEventTrusted:true`,
exact AppKit content bounds, native selection text `人`, popup scroll offset
`480`, all 12 transit samples keeping the popup visible and focused,
outside-panel dismissal, Escape dismissal, pause preservation, and mpv
survival. Its combined `2940x1912` capture changed `98.200745%` of the
requested popup region; pointer-to-popup was `31.523 ms`, and the combined
capture upper-bound was `604.658 ms`. Screen recording was disabled for this
acceptance run. Evidence is in
`/tmp/iinatan-e2e-evidence-macos-feature-parity-r8/run-72519-1788777032571/`.

The current-helper feature-parity replay then used the same live Jitendex
dictionary and external Japanese subtitle track with selector-based custom CSS,
native audio and Anki actions, smooth native popup approach, native selection,
scroll, focus, Escape, outside-panel dismissal, and a 12-second desktop
recording. It returned five audio candidates and one successful mock `addNote`;
the recording was `11,400,923` bytes and both native trust checks were true.
Evidence is in
`/tmp/iinatan-e2e-macos-feature-parity-current-live/run-40085-1788798176485/`.

The latest signed windowed replay on 2026-09-07 used the required
MARRIAGETOXIN file's native English ASS track `1` and the application's own
managed `wty-en-en` download/import path. With the current selectable-text
region telemetry, the native drag selected `wit` from the measured popup text
range; the 12 smooth-approach samples retained popup visibility and focus,
the native wheel reached offset `480`, and four additional native probes each
resolved the expected source unit (`i`, `n`, `u`, and `e`). Trusted
Accessibility and post-event access, exact AppKit content bounds, combined
`2940x1912` capture, outside-panel dismissal, Escape dismissal, pause
preservation, and mpv survival all passed. Pointer-to-popup was `213.246 ms`,
combined-capture upper-bound `1179.587 ms`, native selection `217.546 ms`, and
native scroll `112.845 ms`; the capture changed `98.714844%` of the requested
popup region. Evidence is in
`/tmp/iinatan-e2e-macos-current/`.

The current signed fullscreen replay then repeated the same required-media
English ASS path with live managed `wty-en-en`, smooth popup transit, native
selection (`wit`), native scroll to `480`, two additional source-unit probes,
outside-panel dismissal, Escape dismissal, pause preservation, and mpv
survival. AppKit reported `fullscreenObserved:true` with exact content bounds
`1470x923`; trusted Accessibility and post-event access remained true, and
the combined `2940x1912` capture changed `99.896267%` of the requested popup
region. Pointer-to-popup was `188.170 ms`, combined-capture upper-bound
`724.433 ms`, native selection `221.819 ms`, and native scroll `112.160 ms`.
Evidence is in `/tmp/iinatan-e2e-macos-fullscreen-current/`.

The current signed windowed Japanese replay on 2026-09-07 used stock mpv
`0.41.0`, the supplied MARRIAGETOXIN file, external subtitle track `15`, and a
fresh managed Jitendex import. The popup selected `Jitendex.o`, reached native
scroll offset `1283.5`, and passed Tab/Shift-Tab focus transitions, Escape and
outside-panel dismissal, pause preservation, exact `640x360` AppKit content
bounds, and combined `2940x1912` capture. Accessibility and post-event access
were both true. Pointer-to-popup was `200.595 ms`, combined-capture upper-bound
`756.381 ms`, native selection `221.508 ms`, native scroll `39.669 ms`, and the
popup-region changed fraction was `0.982002`. The app's native focus result and
the follow-up window readback both reported verified mpv foreground ownership
after dismissal.

The macOS feature-parity extension used the same signed helper, live Jitendex/
Hoshi lookup, and the supplied Japanese subtitle track. With
`IINATAN_E2E_FEATURE_PARITY=1`, the harness clicked measured native action
rectangles for audio and Anki before the selection/scroll phase. Audio opened
the popup's `audio-menu-active` state and returned five bounded candidates; the
Anki path used an ephemeral loopback mock, recorded `findNotes` followed by one
`addNote`, and never contacted the user's collection. The replay then completed
native selection (`Jitendex.o`), smooth transit, scroll to `1675`, Tab/
Shift-Tab focus, Escape/outside dismissal, pause preservation, exact `640x360`
AppKit content bounds, and combined capture. Accessibility and post-event access
were both true; pointer-to-popup was `195.519 ms`, combined-capture upper-bound
`782.651 ms`, native selection `223.417 ms`, native scroll `33.228 ms`, and the
popup capture changed `98.250603%` of the requested region. Evidence is in
`/tmp/iinatan-e2e-macos-feature-parity-anki/run-25195-1788789373468/`.

The current macOS replay also records the popup-activation edge case that the
earlier run exposed: a transparent companion window can report Electron focus
while macOS still routes the keyboard to the frontmost mpv application. The
macOS host therefore registers `Escape` only while an interactive popup is
visible, routes it through the same validated popup-action contract, and
unregisters it on dismissal. The signed recorded rerun passed the complete
feature-parity path, including native selection, scroll, Tab/Shift-Tab focus,
audio candidates, loopback Anki `findNotes`/`addNote`, Escape dismissal,
outside-click dismissal, pause preservation, and mpv liveness. Both native
trust checks were true. Evidence, including the desktop recording, is in
`/tmp/iinatan-e2e-macos-feature-parity-controller-escape/run-30597-1788793002895/`.

The follow-up signed macOS feature-parity replay also configured a disposable
profile with selector-based custom CSS before launching Electron. The native
popup reported `customCssApplied:true`, the reference popup's computed
background `rgb(236, 253, 245)`, border color `rgb(13, 148, 136)`, and border
width `6px`; the same run retained the audio, Anki, selection, scroll, focus,
dismissal, pause, and mpv-liveness results. Its 12-second desktop recording
and structured result are in
`/tmp/iinatan-e2e-macos-feature-parity-custom-css/run-33108-1788794999843/`.
This is native macOS CSS/application-surface evidence, not a claim that every
arbitrary stylesheet or every advanced stock-mpv glyph-rendering mode is exact.

The signed native-HID semantic controller replay on 2026-09-07 used the live
worker state contract, stock mpv `0.41.0`, exact AppKit content geometry, and a
fresh managed Jitendex Japanese download. With the cursor moved away before
controller input, Cross opened the lookup without a mouse hit; right-stick
navigation moved to the next subtitle unit; Cross selected the most visible
dictionary entry; D-pad right selected the next entry; a proportional left-
stick sample scrolled the popup from `0` to `1086`; Triangle held long enough
to open the audio menu; Circle/back closed the audio menu and root popup. The
replay also verified pause preservation, no mpv input leak, and outside-panel
dismissal without toggling pause. Accessibility and post-event access were
both true. Evidence is in
`/tmp/iinatan-controller-evidence-current3/run-11229-1788817381943/`.
The input is synthetic at the native-HID state-file boundary, so physical
button actuation, controller-session focus, hotplug, and device compatibility
remain separate acceptance gates.

A physical-mode replay was attempted on 2026-09-08 with the USB DualSense
connected. The live worker reported `source:native-hid`,
`connected:true`, and `id:"DualSense Wireless Controller"`, but no Cross
press arrived before the bounded first-action timeout. It therefore proves
controller discovery and the signed native transport on this host, but adds no
physical-actuation claim. The captured failure evidence is in
`/tmp/iinatan-controller-physical-20260908b/run-17696-1788822137692/`.

A corrected physical-mode replay was then run with the Japanese demo subtitle,
the live Jitendex dictionary, and a 120-second desktop recording. It reached
the intended prompt with the popup-ready Japanese lookup visible, confirmed
the mpv foreground identity, and reported both native input trust values as
true. It still timed out without observing a primary/Cross transition. The
USB device was independently visible to macOS as a Sony DualSense Wireless
Controller (`VendorID 0x054c`, `ProductID 0x0ce6`), so this run narrows the
remaining gate to physical button actuation/session observation rather than
dictionary setup, popup focus, or controller discovery. Evidence, including
the recording, is in
`/tmp/iinatan-controller-physical-current2/run-97032-1788828381645/`.

A third bounded physical replay was run after the controller-threshold parity
change with the same supplied media, live Jitendex download, and a fresh
recording. It again reached exact instrumented geometry with the stock mpv
foreground verified, `accessibilityTrusted:true`, `postEventTrusted:true`, and
the native worker reporting a connected released DualSense; it timed out before
observing a Cross transition. This confirms the remaining failure is still
physical button-actuation observation, not popup setup, focus, permissions, or
native-device discovery. Evidence is in
`/tmp/iinatan-controller-physical-current3/run-36565-1788834000445/`.

A fourth bounded physical replay was run after refreshing the signed macOS
arm64 package. It again reached the live supplied-media/Jitendex session with
foreground ownership, exact instrumented content bounds, and both native input
trust checks valid, but the worker remained at a connected neutral DualSense
until the first-action timeout. This is additional discovery/transport
evidence only; it does not promote physical button actuation or controller
session focus to supported status. Evidence is in
`/tmp/iinatan-controller-physical-current4/run-46728-1788835997364/`.

A later signed combined replay exercised the feature-parity profile and the
native-HID controller path together. It completed cursor-free lookup, right-
stick targeting, entry navigation, proportional scrolling, Triangle/audio
hold, and Circle/back dismissal, then selected row 1 / column 1 of a 13-source
audio menu and reported the expected Anki-capable source URL. The controller
close/reopen sequence also passed the follow-up native outside-panel dismissal
after reasserting the popup's interactive hit-testing state. The run was later
blocked by the separate Finder-to-mpv foreground-recovery gate, so it is not
claimed as a complete combined feature-parity pass. Evidence is in
`/tmp/iinatan-controller-feature-parity-current13/run-40260-1788824429040/`.

A subsequent signed replay closed that remaining harness gate on 2026-09-08.
After Finder took the foreground, the test used a trusted native click at the
measured mpv content origin to model the user's foreground-restoration action;
the AppKit readback then reported `isForeground:true`, preserved the user's
paused state, reopened the lookup, and passed Escape dismissal. The same run
passed the complete controller feature-parity path, including custom CSS,
cursor-free Cross lookup, right-stick targeting, proportional popup scrolling,
audio-source selection, Anki add, controller close/reopen, outside-panel
dismissal, and mpv survival. Its native input probes reported both
`accessibilityTrusted:true` and `postEventTrusted:true`. This is the current
combined macOS replay evidence; it still injects the native-HID state contract,
so physical button actuation, physical-session focus, hotplug/device coverage,
and exact stock-mpv decorative glyph equivalence remain open. Evidence,
including the desktop recording and structured result, is in
`/tmp/iinatan-controller-feature-parity-current21/run-74606-1788826822125/`.

The settings document now has a first-class controller editor backed by the
runtime's `BUTTONS`, `ACTIONS`, and `DEFAULTS` metadata. The Electron settings
integration rendered all 36 control rows across the no-popup, popup, and audio
contexts, changed and persisted a popup binding, and reset the audio context to
its defaults. The signed native settings-window replay remained green after
the layout change, including profile editing and native Save/Open backup
panels. This closes the settings-UI gap but does not add physical-controller
actuation evidence.

After that settings/package change, a fresh signed combined replay repeated the
same stock-mpv/live-Jitendex path and passed native pointer selection, hover
replacement, keyboard focus, synthetic native-HID lookup/targeting/scroll/audio
controls, Anki action, outside dismissal, Finder recovery, pause preservation,
and combined desktop capture. Evidence is in
`/tmp/iinatan-controller-feature-parity-current22/run-93312-1788828077272/`.

A fresh replay against the current signed helper and current source then passed
the complete semantic controller matrix independently of the combined feature
parity sequence: cursor-free Cross lookup, right-stick target movement, popup
entry selection/navigation, proportional left-stick scrolling, Triangle/audio
hold, audio-menu dismissal, and Circle/back. The live worker reported the
connected DualSense through the native-HID contract, and the run recorded
`accessibilityTrusted:true` and `postEventTrusted:true`. This is stronger
current-source evidence for the iinatan-equivalent controller behavior, but it
still injects state at the native-HID boundary rather than proving a physical
button transition. Evidence is in
`/tmp/iinatan-e2e-current-helper-controller-focused-20260908/run-85921-1788841808161/`.

A separate physical-mode replay reached its manual Cross-press prompt with
the same signed helper, exact supplied-media geometry, live Jitendex lookup,
and a 45-second desktop recording, but no Cross transition was observed before
the bounded timeout. The native controller contract smoke independently still
reports the USB DualSense as connected. This leaves physical actuation/session
focus and hotplug/device coverage open rather than misclassifying a missing
manual transition as an implementation failure; evidence is in
`/tmp/iinatan-e2e-controller-physical-current-20260908/run-86264-1788841885571/`.

The latest combined replay reached the live popup and hover-replacement stages
but stopped at the native audio-menu click because macOS's TCC dialog asking
the ChatGPT desktop application for cross-application data/access was visibly
in front of the composition and intercepted the click. Its screenshot is
retained at
`/tmp/iinatan-e2e-current-helper-feature-parity-clean2-20260908/run-87932-1788842375432/desktop-after.png`;
this is an external automation/access-control gate, not product evidence for
an audio or controller regression. A direct `screencapture` probe now succeeds
on this session, so Screen Recording itself is available; a clean combined
replay was still pending at that point.

A fresh signed packaged replay then closed that external gate on 2026-09-08.
It used the supplied MARRIAGETOXIN English ASS track with a live managed
`wty-en-en` import and a disposable local audio-source provider. The run
passed hover replacement, native text selection, proportional scrolling,
custom CSS, five audio candidates, loopback Anki `findNotes`/`addNote`,
cursor-free native-HID lookup and right-stick targeting, Triangle/audio hold,
audio-source selection, Circle/back dismissal, Finder background recovery,
pause preservation, exact AppKit content bounds, combined capture, and an
8-second desktop recording. Accessibility and post-event trust were both
true. Evidence, including the recording, is in
`/tmp/iinatan-e2e-macos-feature-parity-current-20260908-en-audio-mock/run-6373-1788865331440/`.

The focused controller-only replay was repeated against the same signed
package and local audio provider; it independently passed cursor-free Cross
lookup, right-stick movement, popup selection, proportional left-stick
scrolling, Triangle/audio hold with five candidates, audio-menu dismissal,
Circle/back popup close, pause preservation, and mpv liveness. Evidence is in
`/tmp/iinatan-e2e-macos-controller-current-20260908-audio-mock/run-7084-1788865457543/`.

The current signed package was rebuilt after the macOS window-sidecar and
surface-recovery changes. Its retained pointer/feature-parity replay passed
live `wty-en-en` import, native hover replacement, whole-word highlight and
selection, scroll, custom CSS, five loopback audio candidates, Anki mock
interaction, focus recovery, exact `640x360` AppKit content geometry, combined
capture, pause ownership, and mpv liveness. Evidence is in
`/tmp/iinatan-e2e-macos-feature-parity-current-20260908-pointer-only/run-20010-1788867058362/`.
The same package's isolated synthetic-controller replay passed native-HID
Cross lookup, right-stick targeting, popup entry selection/navigation,
proportional left-stick scrolling, Triangle/audio hold, audio-menu dismissal,
Circle/back close, no-popup shoulder subtitle stepping, no-popup D-pad seeking,
pause ownership, and mpv liveness. Evidence is in
`/tmp/iinatan-e2e-macos-controller-current-20260908-final-package/run-20216-1788867114028/`.

The controller replays inject the native-HID state contract rather than
physically actuating the connected DualSense. Physical button actuation,
physical-session focus, hotplug, and device-compatibility coverage remain
deferred by scope.

Finally, the full combined replay was repeated against the final rebuilt
package with Screen Recording enabled. It passed the same live dictionary,
audio/Anki, native pointer, popup-focus, selection, dismissal, controller, and
no-popup navigation gates; the 8-second recording completed with exit code 0.
Evidence, including `result.json` and `desktop-interaction.mov`, is in
`/tmp/iinatan-e2e-macos-feature-parity-current-20260908-final-combined/run-30723-1788867582870/`.

An independent 30-second native-HID monitor was then run against the same
signed Hoshi worker and the managed Jitendex dictionary, without mpv or the
Electron surfaces. macOS kept the USB DualSense connected and identified as
`"DualSense Wireless Controller"`; the worker published healthy neutral
states throughout, but no button or stick transition was delivered during the
window. This corroborates that the remaining physical-controller gate is
actuation/observation in the current session, while the signed transport,
device discovery, and semantic controller router remain healthy.

The signed macOS native-focus extension was also exercised in a deterministic
demo replay on 2026-09-07. After the native text drag selected `samp`, the
helper sent Tab and Shift-Tab while the popup remained open: focus changed from
`popup-panel` to `button:close-popup`, then to `button:audio-source`. The run
preserved pause ownership, passed Escape and outside-panel dismissal, and left
mpv alive. Its desktop recording is
`/tmp/iinatan-e2e-macos-keyboard-recorded-demo/run-20512-1788787004223/desktop-interaction.mov`;
the structured result and still captures are in the same directory. This is
macOS native keyboard/focus evidence. Windows popup keyboard/focus coverage
remains unverified; its native pointer, selection, stacking, and foreground
ownership boundaries are covered by the Windows desktop runs above.

The geometry comparison utility is intentionally independent of the subtitle
provider:

```sh
node scripts/geometry-oracle.js path/to/stock-mpv-observation.json
```

Its input contains predicted and observed unit rectangles for each fixture
case. It reports per-unit IoU and fails on a missing unit, a count mismatch, or
an IoU below the fixture threshold. A passing instrumented helper still needs
to pass this comparison against unmodified stock mpv before exact support can
be claimed.

The public stock-mpv layout-interface probe is:

```sh
IINATAN_PUBLIC_LAYOUT_REQUIRED=1 npm run test:mpv:layout-interface
```

The 2026-09-08 macOS arm64 run used Homebrew mpv `0.41.0` and its supported
in-process `mp.create_osd_overlay("ass-events")` plus `compute_bounds` path. It
returned one aggregate rectangle for the synthetic `Careful` overlay and one
aggregate rectangle for each separately submitted character. Because those
submissions are independent OSD overlays, this API does not expose the
built-in subtitle event's per-glyph layout, style selection, collision history,
or unit identity. The probe therefore records the supported public boundary;
it is not a runtime screenshot/bitmap transport and does not promote synthetic
overlay bounds to exact stock-subtitle geometry.

The explicit per-glyph boundary diagnostic is:

```sh
npm run test:stock-glyph-diagnostic
```

It renders a seven-character ASS fixture in unmodified stock mpv and, for
each character, creates a temporary alpha-isolated variant that preserves the
original ASS layout while hiding the other characters. It compares the
isolated stock-pixel bound with the helper's annotated unit rectangle using
the same eight-level RGB difference threshold as the selected pixel oracle.
The 2026-09-08 macOS arm64 run passed all seven isolated characters with IoU
`1` and edge error `0`. The earlier color-composite probe reported a three-
pixel `r` edge and two-pixel `l` edge because antialiased pixels from adjacent
colored glyphs cannot be uniquely assigned by chroma; that probe is retained
only as historical diagnostic context, not as a geometry failure.
This validates the selected per-glyph visible-fill fixture, while universal
stock-mpv equivalence for arbitrary fonts, advanced ASS effects, and
decorative outline/shadow ownership remains open.

The selected-fixture pixel oracle is:

```sh
IINATAN_STOCK_PIXEL_ORACLE_REQUIRED=1 npm run test:stock-pixels
```

For the supplied media, the independent SubRip pixel oracle is:

```sh
IINATAN_STOCK_PIXEL_REAL_REQUIRED=1 \
IINATAN_STOCK_PIXEL_MEDIA_PATH="/absolute/path/to/MARRIAGETOXIN.mkv" \
IINATAN_STOCK_PIXEL_SUBTITLE_ID=15 \
npm run test:stock-pixels:media
```

The 2026-09-08 rerun used stock mpv `0.41.0`, the supplied file, and the
adjacent Japanese `ja.hi.srt` track. At `1920x1080`, stock pixels and predicted
geometry reached IoU `0.9359332340531149`, with nonzero changed-pixel coverage
for every predicted Japanese grapheme; the additive visible-envelope IoU was
`1.0`. This validates the supported ordinary SubRip path against this real
media case; that SubRip-only run does not exercise ASS transforms, clipping, or
karaoke, and broader stock-mpv equivalence remains explicitly unverified.

For the embedded ASS stream and its attached fonts, run the bounded attachment
smoke:

```sh
IINATAN_STOCK_PIXEL_ASS_REQUIRED=1 \
IINATAN_STOCK_PIXEL_MEDIA_PATH="/absolute/path/to/MARRIAGETOXIN.mkv" \
IINATAN_STOCK_PIXEL_ASS_FF_INDEX=2 \
IINATAN_STOCK_PIXEL_ASS_ID=1 \
npm run test:stock-pixels:media:ass
```

The 2026-09-08 rerun used stock Homebrew mpv `0.41.0`, FFmpeg `9.0.1`,
HarfBuzz `14.4.0`, libass `0.17.5`, the supplied 1920x1080 MKV, and its
English ASS stream. The native helper demuxed 24
embedded font attachments and returned nonzero changed-pixel coverage for all
30 visible-grapheme requests and seven requested word units in the
`18.170–20.580` second cue. The predicted versus observed visible-envelope
IoU was `1.0`, and the primary-colour fill IoU was `0.9990138067061144`; this
records real attachment handling, whole-subtitle envelope alignment, and
character-plane registration. The selected alpha-isolated per-glyph fixture
also passed all seven visible-fill comparisons, while arbitrary ASS renderer
equivalence and decorative outline/shadow ownership remain open.

The packaged macOS companion selects the patched native client by default;
source-development launches can opt in explicitly while stock-mpv equivalence
remains open. Disable the packaged default with
`--disable-patched-native-geometry` or `IINATAN_DISABLE_NATIVE_GEOMETRY=1`:

The current host now uses libass `0.17.5` in both stock mpv `0.41.0_9` and the
bundled geometry helper. The helper is statically built with private unit-ID
and additive visible-envelope patches and a different dependency/configuration/
font environment. The
independent pixel results above are therefore bounded evidence for the measured
cases, not a universal exactness claim. A release gate still requires a
geometry adapter built against the exact stock renderer stack or a supported
live layout source from the player process.

```sh
npm run start -- --enable-patched-native-geometry
```

It can also be exercised with a separately built helper:

```sh
npm run start -- \
  --native-geometry-executable=/path/to/iinatan-backend \
  --native-geometry-root=/path/to/private-request-directory
```

This validates the application protocol boundary only. It does not replace
the combined desktop capture or the unmodified stock-mpv oracle described
below.

Exact geometry acceptance remains a separate oracle gate: predicted unit
rectangles must be compared with subtitle pixels from unmodified stock mpv on
deterministic SRT/ASS fixtures, with primary and secondary tracks checked
independently. An instrumented helper may diagnose divergence but cannot be the
only release oracle.
