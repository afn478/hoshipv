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

The initial commands are:

```sh
npm test
cmake --preset release
cmake --build --preset release
npm run validate:release
npm audit --audit-level=moderate
npm outdated --json
```

On the 2026-09-07 dependency/security review, `npm outdated --json` returned
`{}`, both regular and production-only `npm audit` runs reported zero
vulnerabilities, and `validate:release` reported 34 feature-matrix rows and 48
runtime files. The native refresh kept libass `0.17.5` and the current
HoshiDicts `main` revision while updating FFmpeg `9.0.1`, HarfBuzz `14.4.0`,
FreeType `2.14.3`, FriBidi `1.0.16`, libunibreak `7.0`, zlib `1.3.2`, and
pkgconf `3.0.7`; the refreshed helper was rebuilt before validation. That
release gate also checks the sandbox/context-isolation and web-security
settings, restrictive CSP directives, redirect/navigation/new-window blocking,
protocol-host validation, and the reviewed native checksums.

The rebuilt macOS helper applies two hash-locked libass `0.17.5` patches: the
unit-ID patch used for fill rectangles and an additive visible-envelope patch.
The latter is exposed as `envelopeRects` for independent stock-pixel comparison;
it does not widen the fill rectangles used by runtime hit testing.

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
large structured dictionary entry, nested lookup, selection reporting, audio
source menus, controller commands, keyboard/wheel/outside-pointer messages,
highlight rendering, accessibility semantics, stale-generation rejection,
right-click/context-menu pass-through, focus retention, content security policy,
and unsafe custom-CSS rejection. It is intentionally separate from native
desktop evidence: synthetic DOM events and hidden browser windows cannot prove
OS focus, compositor stacking, click-through, or native input. It also delivers
the typed `capabilities` event to both surfaces and asserts the
passive-forwarded versus interactive-native input modes and the layout-only
popup reflow path in the real Chromium document.

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

The latest rerun on macOS 25.6.0 arm64, Apple M4, Node v24.16.0, with
Electron 44.2.0 pinned and a 480-unit/two-track fixture, measured coordinate
round trip p95 `0.000381 ms/op`, hit testing p95 `0.027995 ms/op`, popup
placement p95 `0.000933 ms/op`, plain subtitle geometry p95 `0.010527 ms/op`,
and structured dictionary normalization p95 `0.661510 ms/op`. These values are
reproducible microbenchmark observations, not display-latency guarantees;
rerunning the benchmark may produce small changes from normal host scheduling
variance.

The native desktop harness separately emits `latency` distributions for
pointer-to-popup, combined-capture popup visibility, native selection, popup
scroll, additional pointer probes, and Escape dismissal when those phases are
enabled. `combinedCapturePopupMs` starts at the native pointer injection and
ends at the first successful changed-pixel result in a desktop capture that
contains both mpv and Electron. It is a compositor-visible upper-bound rather
than a scanout timestamp; the other values also include helper startup, status
polling, and Electron/IPC scheduling.

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

It launches the shipped `--settings` path in a disposable Electron user-data
directory, checks the real application-menu Settings item, compares the
CoreGraphics window-probe frame with Electron's window bounds, and verifies
native activation plus foreground ownership. It does not synthesize a native
menu keystroke, so menu invocation remains a separate unverified boundary.

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
`mpv/iinatan-session.lua`, verifies the descriptor PID/session/IPC identity,
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

The packaged launcher also accepts an explicit media path without requiring an
application window or terminal:

```sh
iinatan\ for\ mpv --open-media=/absolute/path/to/video.mkv
```

The application resolves that path, starts the user's existing mpv through the
same private session/IPC contract, and relies on ordinary descriptor discovery
for attachment. This is a cross-platform bootstrap path; it is not evidence of
native window placement or input behavior.

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

The latest macOS activation-only retry on this host was denied before native
input: the helper reported `activated:false`, `requestAccepted:false`,
`foregroundVerified:false`, `displayAsleep:true`, and foreground PID `408`
(`loginwindow`). This is host-state evidence for the blocked run, not a claim
that AppKit activation is universally unavailable.

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
worker from the managed path, and performs a real `猫を見る` lookup. On
2026-09-06 it downloaded 36.9 MiB, installed one enabled dictionary, and
returned two lookup results (`猫` and `見る`) in 2.64 seconds for download and
import, 20 ms for worker readiness, and 14 ms for lookup. It is opt-in because
it requires network access and an upstream archive; it does not modify the
user's settings or dictionary directory.

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
diagnostics. This proves the packaged macOS helper and JavaScript protocol
interoperate. It does not compare those rectangles with pixels from ordinary
stock mpv, so it cannot promote exact stock-mpv lookup support.

The independent stock-mpv pixel oracle is:

```sh
npm run test:stock-pixels
```

It renders deterministic bottom, Unicode, mixed-language, missing-font
fallback, simple external SubRip, color-separated, single-event inline-color,
unique-color unit-identity, top,
style-level positioned, explicit-position, explicit-movement, static-tag,
bounded-transform, and
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
coverage for its requested phrase region. Across the seventeen cases, all
fifty-two requested per-case unit observations had nonzero bounds coverage.
This is a bounds-and-unit coverage oracle with independently annotated unit
identity evidence, not proof that arbitrary stock-mpv glyph layout has been
exposed. The same run also records additive visible-envelope IoUs; those are
validation evidence only and do not change the fill-based runtime contract.
Across the seventeen cases, visible-envelope IoU ranged from
`0.8845315904139434` to `1.0`.

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
explicit-movement, static-tag, and bounded-transform fixtures are the bounded
exceptions: valid
`\\pos(x,y)`, `\\move(x1,y1,x2,y2[,t1,t2])`, and the validated static renderer
tags (including `\\an`, `\\fn`, `\\fs`, `\\fsp`, `\\bord`, `\\shad`, `\\frz`,
rectangular `\\clip`, and bounded `\\k` karaoke), plus bounded `\\t(...)` forms
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
character-plane registration and whole-subtitle envelope alignment while
keeping the full per-glyph stock-mpv equivalence gate open for decorative
outline/shadow assignment.

`native-ass-geometry-unsupported-modes-smoke.ass` exercises vector clipping,
drawing mode, and unknown tags.
The native request builder rejects each case, and the controller exposes the
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
Set `IINATAN_E2E_RECORD_SCREEN=1` to record the same native interaction phase
as a macOS `.mov` with the cursor and click indicators. The artifact is copied
to the evidence directory as `desktop-interaction.mov`, alongside the still
captures and structured result, so a reviewer can see the popup open before
the drag and distinguish Escape dismissal from the separate outside-panel
click. The default bounded duration is 20 seconds and can be changed with
`IINATAN_E2E_RECORD_SECONDS=N`; Screen Recording permission is required for
the process that launches the harness.
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

The 2026-09-07 run used stock mpv `0.41.0`, the supplied file, and the
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

The 2026-09-07 run used stock Homebrew mpv `0.41.0_9`, FFmpeg `9.0.1_1`,
HarfBuzz `14.4.0`, libass `0.17.5`, the supplied 1920x1080 MKV, and its
English ASS stream. The native helper demuxed 24
embedded font attachments and returned nonzero changed-pixel coverage for all
30 visible-grapheme requests and seven requested word units in the
`18.170–20.580` second cue. The predicted versus observed visible-envelope
IoU was `1.0`, and the primary-colour fill IoU was `0.9990138067061144`; this
records real attachment handling, whole-subtitle envelope alignment, and
character-plane registration while keeping exact per-glyph stock-mpv ASS
equivalence open.

The patched native client is opt-in while stock-mpv equivalence remains open:

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
