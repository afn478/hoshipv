# Coordinate and subtitle geometry contract

The runtime carries named spaces rather than anonymous `x`/`y` values:

| Space | Meaning | Owner |
| --- | --- | --- |
| source | Video/subtitle source coordinates and script units | mpv/libass oracle |
| OSD | mpv OSD/render coordinates | mpv IPC/native geometry provider |
| content | Native player content rectangle in desktop logical coordinates | `NativeWindowAdapter` |
| desktop-logical | OS window coordinates used by Electron bounds | Electron/platform adapter |
| desktop-physical | Device pixels after display scale | native capture/tooling |
| browser-CSS | CSS pixels relative to the companion surface | browser renderer |

For the current content mapping:

```text
OSD -> desktop-logical:
  x = content.x + osd.x * content.width / osd.width
  y = content.y + osd.y * content.height / osd.height

desktop-logical -> browser-CSS:
  x = (desktop.x - surfaceOrigin.x) * browserScale
  y = (desktop.y - surfaceOrigin.y) * browserScale
```

The inverse is implemented by `CoordinateMapper`; scale factors are not
recomputed in individual handlers. Rounding occurs only when passing native
window bounds to Electron or a platform API.

The Windows probe reports the Win32 client rectangle in desktop physical
coordinates under its PerMonitorV2 manifest, and the X11 probe reports X11
pixel coordinates in the same explicit space. `NativeWindowAdapter` converts
both corners through Electron's `screen.screenToDipPoint()` before publishing
the content rectangle used by BrowserWindow bounds and cursor hit testing;
the Windows probe's `desktopScale` remains available for physical-pixel
diagnostics. If that conversion capability is unavailable, the adapter fails
closed instead of treating physical pixels as logical coordinates.

`createGeometrySnapshot()` publishes immutable session, media, geometry,
track, event, source-unit, timing, transform, and generation data. Pointer hit
testing, highlight rectangles, and popup anchoring all consume the same
snapshot. A result whose session/media/geometry token no longer matches is
discarded.

## Subtitle identity

Primary and secondary tracks remain independent. Each active event has its own
stable identity and unit ranges. A unit stores source text, UTF-16 and UTF-8
ranges, grapheme text, visual order, and one or more OSD rectangles. Whitespace,
drawing-only events, clipped units, combining marks, supplementary characters,
and ligatures must not be collapsed into “one character = one glyph”.

## Current limitation

The checked-in `SubtitleGeometryProvider` can produce a deterministic plain
text/ASS-tag-stripped approximation for the Phase A demo. It sets
`source.exact=false`; normal attachment refuses lookup against it. The macOS
package also contains an opt-in `NativeSubtitleGeometryService`, but it may
replace those rectangles only after a validated response and an explicitly
supported renderer mode and an authoritative player-content rectangle. A
validated libass response cannot promote a macOS CoreGraphics window frame to
exact content geometry. When the optional in-process mpv C-plugin is loaded,
the AppKit content-view sidecar supplies that rectangle after PID/window
identity checks; without it, the macOS probe remains diagnostic. The current
independent oracle covers simple ASS
styles and simultaneous primary/secondary rendering with explicit
`secondary-sub-ass-override=no`, plus the bounded centered-top observation
path for stock mpv's default `strip` mode. Exact release support requires
preservation of libass styles, attachments, event order, timing, fallback
fonts, transforms, clipping, karaoke, and track identity. Passing the unit
tests for either the approximation or the protocol adapter is not evidence of
stock-mpv glyph agreement outside the measured modes.
