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
