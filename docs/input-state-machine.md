# Input and focus state machine

`InteractionController` owns input rather than relying on independent DOM
handlers. Its states are:

- `inactive`
- `player-interaction`
- `subtitle-hover-candidate`
- `lookup-pending`
- `popup-active`
- `nested-popup-active`
- `text-selection-drag-capture`
- `audio-menu-active`
- `settings-dialog`
- `suspended`

The controller emits effects such as `set-passive-input`,
`set-interactive-input`, `consume-input`, `capture-pointer`, `release-pointer`,
`focus-popup`, and `focus-player`. A popup action never goes through both the
browser and a synthetic mpv event. An outside click is dismissed and consumed.
Escape closes the deepest transient UI first; it is not forwarded to mpv in the
same event.

The popup surface is full content-area size while active. Its DOM popup panel
receives normal native selection, links, buttons, keyboard focus, wheel, and
drag events; a primary-button drag that begins on text enters
`text-selection-drag-capture`, uses DOM pointer capture, and returns to the
prior popup depth on release or cancellation. The transparent surrounding area
reports an outside click to the host and is consumed before the surface is hidden.
Stale passive-surface subtitle targets are ignored while any popup-owned state is
active, so crossing nearby subtitle words cannot reclaim lookup ownership.
Focus loss also cancels the active selection capture, so a renderer crash,
window deactivation, or interrupted drag cannot leave a pointer-owned state
behind. Host-driven popup dismissal cancels it as well before the panel is
hidden, ensuring DOM pointer capture is released during geometry invalidation,
backgrounding, and shutdown.
The host keeps that full window hidden until the popup document has sent its
`ready` message, so renderer startup and surface recovery cannot expose a blank
transparent input region.
The popup renderer publishes bounded `panel`, `headword`, and visible `content`
regions plus a separate scroll-state telemetry message for diagnostics and
native acceptance tests. The content region is intersected with the visible
panel/header viewport, rather than exposing the full offscreen scrollable DOM
height. Wheel scrolling remains owned by the browser surface; the scroll
message is state telemetry, not a synthetic player command.
After the popup document measures its rendered panel, the host may send a
layout-only `popup-layout` update. The renderer changes only position, width,
and max-height, then measures again; it does not rebuild the dictionary DOM or
steal focus during dynamic content, font, audio-menu, or custom-CSS reflow.
The passive highlight surface
uses whole-window ignore/forward behavior and is never an invisible full-window
click target. BrowserHost applies a temporary floating z-order only while the
player is the owning foreground session or the popup itself has session focus;
it releases that z-order when the player is backgrounded. This is ownership
tracking, not a permanent global always-on-top window. The behavior uses
Electron's documented [`setAlwaysOnTop`](https://www.electronjs.org/docs/latest/api/browser-window#setalwaysontopflag-level-relativelevel)
and [`showInactive`](https://www.electronjs.org/docs/latest/api/browser-window#winshowinactive) boundaries.
The drag behavior follows the browser pointer-capture contract: captured events
remain targeted at the popup until release or `pointerup`/`pointercancel`; see
the [MDN `setPointerCapture()` reference](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture).

The lookup preference is `hover` or the migrated reference-compatible
`shift-hover` mode. The passive surface forwards modifier state through the
typed `pointer-move` message; the host gates approximate/exact hit testing and
lookup on Shift without making the passive surface interactive.

`PauseOwnership` records whether the plugin caused a pause. It resumes only its
own pause, not a pause that existed before lookup or a later user pause. Media,
geometry, cancellation, and shutdown invalidate the ownership generation.

Nested dictionary references are host-owned: the popup sends only a bounded
term, the host performs the lookup, and the parent result remains on a stack
until the deepest popup is dismissed. The generic browser Gamepad API is
polled by the passive surface and also publishes browser hotplug events when
available, then translated through the configured no-popup/popup/audio
binding maps. Repeat timing and edge detection live in
`src/interaction/controller-runtime.js`; a changed gamepad id/index and every
disconnect reset edge/repeat state so a replacement device cannot inherit a
held-button action. On macOS, enabling the controller preference also asks the
capable HoshiDicts helper to publish its native HID state; the main process
polls that bounded state file, routes it through the same controller router,
and suppresses browser polling when the native source is available. A stale,
malformed, or temporarily missing native snapshot produces one neutral
disconnected state while polling remains alive, so a later device reconnect is
observable without restarting the dictionary worker. The native HID contract,
stale/disconnect recovery, and replacement-device edge handling are
unit-tested, but physical focus, hotplug, and device compatibility still
require platform testing before being called supported.
