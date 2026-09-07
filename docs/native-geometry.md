# Optional native subtitle geometry

The normal runtime starts with a deterministic, explicitly approximate
subtitle geometry provider. It refuses ordinary lookup when `source.exact` is
false. The macOS package contains a validated HoshiDicts helper and an
optional stock-mpv content-boundary C-plugin; the patched ASS backend remains
disabled for ordinary stock attachment until the stock-mpv equivalence oracle
closes. Explicitly opt into that separate backend path with:

```sh
npm run start -- --enable-patched-native-geometry
```

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
subtitle-geometry helper. The geometry executable remains an explicit separate
capability and is never inferred from the dictionary worker.

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

The current host now uses libass 0.17.5 in both stock mpv `0.41.0_9` and the
bundled geometry helper. The helper uses private unit-ID and additive
visible-envelope patches and a different static dependency/configuration/font
environment, so matching the version alone does not prove raster equivalence.
The pixel oracle therefore remains an independent bounded comparison and does
not promote the helper to universal exact stock-mpv geometry. Fill rectangles
remain the runtime hit/highlight target; envelope rectangles are reported only
to compare visible outline/shadow bounds. Closing that gate requires either a
geometry adapter built against the exact stock renderer stack or a supported
live layout source from the player process.

Simple supplementary code points, combining marks, ASS line breaks, and
explicit `\\pos(x,y)` placement are covered by the native adapter and the
independent stock-mpv oracle. Unsupported ASS tags and advanced renderer modes
are rejected by the native adapter rather than assigned guessed rectangles.
This is intentional until each additional native mode has matching stock-mpv
evidence.

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
requested phrase region. Across the seventeen cases, all fifty-two requested
regions had nonzero bounds coverage. This is a
bounds-and-unit-coverage comparison with independently annotated unit
identity evidence, not proof of arbitrary stock-mpv glyph layout. The
default-strip case uses observation-only
reconstruction of centered-top plain ASS styling from the observed default
renderer options; these independent fixtures do not promote arbitrary custom
alignments, fonts, colors, scale options, or advanced ASS features to native
adapter support. The explicit-position, explicit-movement, static-tag, and
transform fixtures are accepted only for the validated `\\pos(x,y)`,
`\\move(x1,y1,x2,y2[,t1,t2])`, bounded static renderer tags (including
`\\an`, `\\fn`, `\\fs`, `\\fsp`, `\\bord`, `\\shad`, `\\frz`, rectangular
`\\clip`, and bounded `\\k` karaoke), and bounded `\\t(...)` forms with
numeric timing and already-supported nested modifiers. Nested transforms,
vector clipping, and other advanced tags remain fail-closed. Platform scaling and
combined desktop capture still require separate evidence.

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
registration and whole-subtitle envelope are therefore strong, but the result
does not promote exact per-glyph ASS raster equivalence because decorative
outline/shadow pixels are not assigned to adjacent units. Unsupported renderer
modes remain fail-closed.

The shipped runtime contract remains fill-based. The new envelope field is
deliberately additive and does not widen per-unit hit rectangles; it is used
only by the independent stock-pixel oracle.

The `native-ass-geometry-unsupported-modes-smoke.ass` fixture and core
regression reject vector clipping, drawing mode, unknown tags, and other
unsupported forms. These cases remain visible as bounded
native-geometry diagnostics and never receive guessed rectangles.

The boundary follows Electron's security guidance for context isolation and
sandboxing and mpv's documented JSON IPC/property model:
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation),
[Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), and
[mpv input/JSON IPC](https://github.com/mpv-player/mpv/blob/master/DOCS/man/input.rst).
