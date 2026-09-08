# Optional native subtitle geometry

The runtime starts with a deterministic, explicitly approximate subtitle
geometry provider and refuses ordinary lookup when `source.exact` is false.
The packaged macOS companion enables the validated HoshiDicts ASS backend by
default, together with the optional stock-mpv content-boundary C-plugin. The
backend remains tuple-gated and fail-closed; source development launches can
explicitly opt in with:

```sh
npm run start -- --enable-patched-native-geometry
```

Pass `--disable-patched-native-geometry` or set
`IINATAN_DISABLE_NATIVE_GEOMETRY=1` to disable the packaged macOS default.

Other platforms or a replacement geometry helper can use:

```sh
npm run start -- \
  --native-geometry-executable=/path/to/iinatan-backend \
  --native-geometry-root=/path/to/private-request-directory
```

The request directory is created with owner-only permissions and each request
is written atomically and removed after the helper exits. An explicitly
configured executable is not downloaded, started through a shell, or inferred
from the reference IINA repository. Windows/Linux packages now include the
portable dictionary worker, but they do not yet include an equivalent exact
subtitle-geometry helper. The geometry executable remains a separate capability
on non-macOS platforms; the packaged macOS artifact intentionally bundles and
selects its validated helper without changing the user's mpv executable or
renderer.

## Data flow

1. `PlayerBridge` observes the selected subtitle tracks, active ASS text,
   extradata, cue timing, OSD dimensions, source identity, and relevant mpv
   subtitle renderer settings.
2. `SubtitleGeometryProvider` creates the immutable browser-facing snapshot
   and keeps primary/secondary events and grapheme/UTF-16 ranges separate.
3. `NativeSubtitleGeometryService` translates ASS control sequences to the
   decoded display text while preserving UTF-16 boundaries around browser
   graphemes, then submits one request per selected track.
4. `SubtitleGeometryProvider.applyNativeResponse()` accepts a response only if
   its protocol, renderer dimensions, required unit positions, and rectangles
   validate. It marks the snapshot exact only when the response carries
   validation evidence and the window adapter marked player content bounds as
   authoritative. On macOS that authority comes from the explicitly loaded,
   identity-checked AppKit content sidecar; a frame-only probe remains
   inexact. Whitespace and drawing-only units remain non-lookupable.
5. The controller publishes the upgraded snapshot only if the session and
   refresh serial are still current. Any helper error or mismatch leaves the
   approximation in place, so normal mpv attachment does not silently claim
   exactness.

The bridge forwards the live renderer controls that directly affect libass
placement or shaping, including `sub-ass-force-margins`, `sub-hinting`,
`sub-shaper`, and `embeddedfonts`. They are observed before the initial
geometry snapshot and invalidate it when changed; the helper applies the same
values through its libass renderer API. This prevents a changed mpv renderer
setting from being silently rendered with stale helper defaults. The helper
currently rejects
non-default `sub-ass`, `sub-ass-scale-with-window`, `sub-ass-justify`,
`sub-justify`, and `sub-font-provider` values explicitly, so the bridge rejects
those modes before sending a native request. It also fails closed for
non-default subtitle timing (`sub-fix-timing*`, `sub-fps`, and
`sub-stretch-durations`), cue-cache/end-of-video (`sub-clear-on-seek` and
`sub-past-video-end`), and text-filter list controls (`sub-filter-regex`,
`sub-filter-jsre`, and `sub-filter-sdh-enclosures`). The selected mpv build
documents `sub-ass-scale-with-window` as an ASS-only scaling control with a
default of `no`; the helper has no equivalent ASS-specific control, so
accepting `yes` would risk a false exact result. These gates are conservative:
they preserve the native exact path at the documented defaults and withdraw it
when a setting is not represented by the helper, rather than returning a false
exact-geometry result.

The current protocol is compatible with the validated backend's
`ass-geometry` response shape. Passing that protocol check is not release
evidence that its patched libass coordinates match ordinary stock mpv; exact
release support still requires an unmodified stock-mpv comparison oracle for ASS/SRT,
primary/secondary tracks, fonts, timing, and platform scaling.

## Stock-mpv interface investigation

The selected unmodified Homebrew build on this host is mpv `0.41.0_9` (the
reported mpv application version remains `0.41.0`). Its
documented JSON-IPC properties expose subtitle text, renderer dimensions, and
window/player state, but do not expose a public live libass glyph-layout API.
The external window probe can identify the real CoreGraphics window by process
identity and report its scalar frame, but it cannot prove that frame is the
drawable content area. The separately loaded macOS C-plugin sidecar now
provides a tested AppKit content-view rectangle for that boundary; it does not
provide per-glyph layout.

The installed `/opt/homebrew/lib/libmpv.dylib` is the separate libmpv embedding
library. Loading it in the companion would create an embedded-player path, not
an attachment to the user’s already-running stock mpv. mpv’s documented C
plugin mechanism runs code inside the mpv process and can use the client API,
but it must be loaded by mpv and still does not document a public per-glyph
layout API. This project uses that mechanism only for the narrow AppKit
content-boundary sidecar and does not turn `window-id`, a second libass
instance, or a CoreGraphics frame into exact subtitle geometry. See mpv’s [libmpv and C plugin
documentation](https://github.com/mpv-player/mpv/blob/master/DOCS/man/libmpv.rst)
and [property/input documentation](https://github.com/mpv-player/mpv/blob/master/DOCS/man/input.rst).

The reproducible public-interface probe
(`IINATAN_PUBLIC_LAYOUT_REQUIRED=1 npm run test:mpv:layout-interface`) exercises
mpv 0.41.0's supported in-process `mp.create_osd_overlay("ass-events")` and
`compute_bounds` path. It returns one aggregate rectangle for the submitted
synthetic ASS overlay, including when the probe submits one glyph at a time.
Those are independent overlays using mpv's OSD styles; the API cannot attach to
the built-in subtitle event, return its per-glyph boxes, or preserve that
event's live style/collision history. It is therefore useful evidence about the
supported public boundary, but not a runtime source for exact subtitle-unit
geometry. mpv documents `compute_bounds` as a full-overlay render/bounds
operation whose result depends on the current VO size and libass version.

The current host now uses libass 0.17.5 in both stock mpv `0.41.0_9` and the
bundled geometry helper. The helper uses private unit-ID and additive
visible-envelope patches and a different static dependency/configuration/font
environment, so matching the version alone does not prove raster equivalence.
The pixel oracle therefore remains an independent bounded comparison and does
not promote the helper to universal exact stock-mpv geometry. Fill rectangles
remain the runtime hit-test target; validated envelope rectangles are used
additively for the visible highlight and popup anchor so outline/shadow-visible
glyphs are not clipped. The envelope does not widen per-unit hit testing or
assign decorative pixels to adjacent units. Closing the remaining exactness
gate requires either a geometry adapter built against the exact stock renderer
stack or a supported live layout source from the player process.

The selected per-glyph diagnostic is now alpha-isolated rather than based on
chroma classification. `npm run test:stock-glyph-diagnostic` adds a
seven-character ASS fixture, renders one character at a time in unmodified
stock mpv while preserving the original layout, and compares each bound with
the helper's unit rectangle. The 2026-09-08 macOS arm64 run passed all seven
characters with IoU `1` and edge error `0`. The older color-composite probe
showed three- and two-pixel edge differences for `r` and `l`; those were
antialiasing overlap in the color classifier, not isolated glyph geometry.
This closes the selected visible-fill fixture while universal exact ASS
equivalence for arbitrary fonts, advanced effects, and decorative
outline/shadow ownership remains open.

Simple supplementary code points, combining marks, ASS line breaks, and
explicit `\\pos(x,y)` placement are covered by the native adapter and the
independent stock-mpv oracle. Unsupported ASS tags, drawing-only modes, and
malformed renderer forms are rejected by the native adapter rather than
assigned guessed rectangles. The bounded non-drawing advanced tags covered by
the oracle are passed through only after both the JavaScript and native
allowlists accept their exact syntax.

External `.srt` and `.subrip` tracks have a bounded observation path for simple
text cues. Stock mpv converts text subtitles to ASS internally; when the bridge
has no codec-private extradata, the request builder mirrors that conversion's
fixed `PlayResY: 288`, aspect-adjusted `PlayResX`, and observed text-renderer
options in an observation-only ASS source. This path accepts ordinary text,
line breaks, and supported inline italic and color/alpha tags. The native ASS
path additionally accepts validated `\\pos(x,y)`/`\\move(x1,y1,x2,y2[,t1,t2])`
placement tags. Unsupported ASS tags,
custom SRT extensions, non-default border styles, malformed renderer values,
and other subtitle formats still fail closed. The conversion behavior follows
mpv's [text subtitle renderer](https://raw.githubusercontent.com/mpv-player/mpv/master/sub/sd_ass.c)
and [style setup](https://raw.githubusercontent.com/mpv-player/mpv/master/sub/ass_mp.c);
the synthesized source is not a claim that the helper has access to mpv's live
private renderer state.

The independent stock-mpv pixel fixtures now pass for simple bottom and top
selected-track ASS cases, a simple external SubRip case, a
supplementary/combining-mark/newline case, a
mixed Japanese/English/German/French/Korean/Chinese case, a missing-font
fallback case, a top-left positioned style using italic text, spacing, outline,
shadow, and margins, a single-track
multiple-event/multiline case, and for simultaneous
primary/secondary renders with both explicit
`secondary-sub-ass-override=no` and stock's default `strip` mode. The macOS
arm64 run against mpv 0.41.0 produced IoU `1.0` for the simple bottom, top,
and explicit simultaneous cases, `0.9883720930232558` for the Unicode case,
and `0.9985119047619048` for the bounded default-strip case; the positioned
style case produced IoU `0.8124381065557537` with nonzero coverage for both
requested units, the mixed-language case produced IoU `0.8630438324914453`
with nonzero coverage for all six requested units, and the multiple-event/
multiline case produced IoU `0.92` with nonzero coverage for all five
requested units. The color-separated unit-identity case produced IoU
`0.8612880870945387` and nonzero color-matched pixels for all four requested
word regions. The missing-font fallback case produced IoU `0.875` with
nonzero coverage for both requested word regions. The simple external SubRip
case produced IoU `0.9036334913112164` with nonzero coverage for both
requested word regions. The unique-color identity fixture produced IoU
`0.8628113879003558`, with independent per-unit color-region IoUs from
`0.9457755359394704` to `0.9615384615384616` and a maximum annotated edge
error of one physical pixel. The single-event inline-color fixture
produced IoU `0.9229957805907173`, with nonzero color-matched pixels for all
four word regions and a maximum annotated edge error of one physical pixel.
The explicit-position fixture produced IoU `0.8614864864864865` with nonzero
coverage for its requested phrase region. The explicit-movement fixture
produced IoU `0.8862068965517241` with nonzero coverage for its requested
phrase region. The static-tag fixture produced IoU `0.9422287390029326` with
nonzero coverage for its requested phrase region. The bounded-transform
fixture produced IoU `0.8994301994301994` with nonzero coverage for its
requested phrase region. The vector-clip fixture produced IoU
`0.8388552093613422`, with visible-envelope IoU `0.9971181556195965`. The
advanced non-drawing-tag fixture produced IoU `0.9065478657273104`, with
visible-envelope IoU `1.0`. The dedicated multi-syllable karaoke fixture
produced IoU `0.8325508607198748`, with visible-envelope IoU
`0.9953271028037384` and nonzero coverage for all four requested
syllable/word regions. Across the twenty cases, all fifty-eight requested
regions had nonzero bounds coverage. This is a
bounds-and-unit-coverage comparison with independently annotated unit
identity evidence, not proof of arbitrary stock-mpv glyph layout. The
default-strip case uses observation-only
reconstruction of centered-top plain ASS styling from the observed default
renderer options; these independent fixtures do not promote arbitrary custom
alignments, fonts, colors, scale options, or advanced ASS features to native
adapter support. The explicit-position, explicit-movement, static-tag,
vector-clip, advanced-tag, and transform fixtures are accepted only for the
validated `\\pos(x,y)`, `\\move(x1,y1,x2,y2[,t1,t2])`, bounded static renderer
tags (including `\\an`, `\\fn`, `\\fs`, `\\fsp`, `\\bord`, `\\shad`, `\\frz`,
rectangular `\\clip` including bounded vector paths, and bounded `\\k`
karaoke), the non-drawing `\\fad`, `\\fade`, `\\org`, legacy alignment,
underline/strikeout, `\\p0`, and axis-border forms, and bounded `\\t(...)`
forms with numeric timing and already-supported nested modifiers. Nested
transforms, drawing mode, unknown tags, and other unvalidated advanced forms
remain fail-closed. Platform scaling and combined desktop capture still
require separate evidence.

The supplied-media ASS attachment smoke exercises the direct source path
without observation-only reconstruction:

```sh
IINATAN_STOCK_PIXEL_ASS_REQUIRED=1 \
IINATAN_STOCK_PIXEL_MEDIA_PATH="/absolute/path/to/MARRIAGETOXIN.mkv" \
IINATAN_STOCK_PIXEL_ASS_FF_INDEX=2 \
IINATAN_STOCK_PIXEL_ASS_ID=1 \
npm run test:stock-pixels:media:ass
```

It demuxes the selected ASS stream and its Matroska font attachments directly,
then compares stock-mpv pixels with native visible-grapheme rectangles while
also reporting word coverage. The current supplied-media run found 24
attachments, requested 30 visible graphemes, and reported nonzero coverage for
all seven words; its visible-envelope IoU was `1.0`, while the style
primary-colour fill IoU was `0.9990138067061144`. The character-plane
registration and whole-subtitle envelope are therefore strong. The selected
alpha-isolated per-glyph fixture also passed all seven visible-fill
comparisons, but decorative outline/shadow pixels are not assigned to
adjacent units, so arbitrary exact ASS raster equivalence remains open.
Unsupported renderer modes remain fail-closed.

The shipped runtime contract keeps fill rectangles for hit testing. The new
envelope field is deliberately additive: the runtime uses it for visual
highlight/popup anchoring, while the independent stock-pixel oracle uses it for
visible-envelope comparison. It does not widen per-unit hit rectangles.

The `native-ass-geometry-vector-clip-smoke.ass` fixture covers a bounded vector
clip around lookupable text and is included in the independent stock-mpv pixel
oracle. The `native-ass-geometry-unsupported-modes-smoke.ass` fixture and core
regression still reject drawing mode, unknown tags, and other unsupported forms.
These cases remain visible as bounded
native-geometry diagnostics and never receive guessed rectangles.

The `native-ass-geometry-advanced-tags-smoke.ass` fixture covers non-drawing
`\\fad`, `\\fade`, `\\org`, legacy alignment, axis-border, underline/strikeout,
font-encoding, and explicit text-mode tags. Its stock-mpv fill IoU was
`0.9065478657273104` and its visible-envelope IoU was `1.0`; the helper and
stock renderer both reject drawing-mode `\\p1` and malformed forms.

The boundary follows Electron's security guidance for context isolation and
sandboxing and mpv's documented JSON IPC/property model:
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation),
[Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), and
[mpv input/JSON IPC](https://github.com/mpv-player/mpv/blob/master/DOCS/man/input.rst).
