# ADR-001: Electron companion surfaces for stock mpv

Status: accepted for Phase A; full product go/no-go remains open.

## Context

The product must keep the user's ordinary mpv executable and native subtitle
renderer. A browser must draw rich HTML while mapping pointer input back to
visible native subtitle units. The browser cannot observe libass glyph layout
from DOM measurements, and stock mpv does not document a cross-process browser
view attachment API.

## Decision

Use Electron as the first browser host, with ordinary transparent BrowserWindow
surfaces. Treat Electron-specific lifecycle and window APIs as an adapter behind
`BrowserHost`. Keep the document protocol, services, settings, placement, and
tests independent of Electron so a future CEF host can reuse them.

Use a local mpv session descriptor containing a session id, process id, native
window id, and IPC endpoint. A title is never an identity. Use a small bundled
native window probe for scalar geometry and foreground state. If a platform
needs authoritative content geometry from inside mpv, add a narrowly scoped
mpv-side shim and exchange scalar snapshots; do not pass raw pointers across
processes. The application creates one controller and browser-surface pair per
live descriptor, so multiple mpv instances do not share popup, pause, lookup,
or geometry state.

The macOS implementation of that boundary is an optional public C-plugin that
enumerates mpv's AppKit content view and publishes an identity-checked scalar
sidecar. It is a capability promotion, not a fallback that relabels an
external window frame as exact; absence, staleness, or identity mismatch keeps
the external result inexact.

Do not use offscreen rendering, texture sharing, screenshot transport,
`overlay-add`, `SetParent`, or an alternate player to work around window
attachment. Do not call a frame-level approximation exact.

## Geometry go/no-go assessment

Status: the macOS companion/window/input path is viable, but universal exact
subtitle registration against an arbitrary ordinary stock-mpv installation is
not yet a supported claim. This remains an explicit scope gate rather than a
silent reduction of the objective.

The current evidence is bounded and independent:

- The selected stock mpv exposes ASS event text and metadata through
  `sub-text/ass-full` and `sub-ass-extradata`, but the documented property
  contract does not expose live per-glyph rectangles. See mpv's
  [input/property documentation](https://github.com/mpv-player/mpv/blob/master/DOCS/man/input.rst).
- The bundled helper preserves its own patched-libass render and has passed
  the independent unmodified-stock-mpv oracle for the measured fixture set,
  including primary/secondary tracks, attachments, transforms, clipping,
  karaoke, and the supplied media. That is evidence for those measured cases,
  not proof of arbitrary fonts, renderer settings, event history, or
  decorative-pixel ownership.
- A live unsupported renderer option is observed through mpv IPC, causes the
  helper to withdraw `source.exact` with a diagnostic, and recovers when the
  option is restored. Unsupported cases therefore fail closed rather than
  silently receiving guessed exact geometry.

Before universal exactness can be claimed, one of these decisions is required:

1. Provide a supported live-layout interface from the user's stock mpv build
   that publishes the actual libass unit geometry, with release acceptance on
   unmodified distributed builds.
2. Explicitly authorize a maintained mpv-side integration/private-renderer
   change and define the supported mpv build and update policy. This would no
   longer be a generic attachment to arbitrary stock mpv and must be reviewed
   as a scope change.
3. Keep the current ordinary-mpv architecture and declare a bounded exact
   support matrix, with lookup disabled and diagnostics for everything outside
   it. This is a safe product policy, but it does not satisfy the original
   universal exactness requirement without the user's approval.

Replacing mpv, reconstructing subtitles as HTML, transferring screenshots or
textures, or relabeling helper self-validation as stock-mpv proof are not
acceptable ways to close this gate.

## Consequences

- Normal GPU composition is available and the popup can retain native browser
  focus, scrolling, selection, controls, and links.
- Companion surfaces use foreground-owned floating z-order while the player or
  its focused popup owns the session, then release that z-order when the player
  is backgrounded; this avoids a permanent global always-on-top surface.
- A passive surface still needs an explicit native input strategy; CSS
  `pointer-events` is not an OS click-through mask.
- The document bridge performs a readiness capability handshake. It advertises
  normal DOM transport, the absence of bitmap/offscreen transport, and the
  surface's input mode (`passive-forwarded` or `interactive-native`) without
  making Electron APIs part of the document contract.
- Generic Wayland cannot be declared supported without compositor cooperation.
- Exact subtitle registration remains an independent validation project.
- CEF is a future host option, not a second implementation in this phase.
