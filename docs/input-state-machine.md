# Input and focus state machine

`InteractionController` owns input rather than relying on independent DOM
handlers. Its states are:

- `inactive`
- `player-interaction`
- `subtitle-hover-candidate`
- `lookup-pending`
- `popup-active`
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
reports an outside click to the host and is consumed before the surface is
hidden. A canceled or focus-interrupted outside pointer sequence is treated as
a dismissal too, so native pointer capture cannot leave a stale popup-owned
gesture behind.
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
On macOS the popup is a non-activating `panel` window. Showing it, clicking in
it, selecting text, scrolling, and using keyboard controls therefore do not
activate the companion application or leave a native mpv fullscreen Space; the
explicit dismissal transition may restore focus to mpv.
The native desktop harness records this as `popupForegroundSamples` and fails
closed if any active-popup sample no longer reports mpv as frontmost.
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

Nested lookup stays inside the existing popup state rather than creating a new
gamepad context. The setting is `off`, `click`, `hover`, or `shift-hover`, with
a bounded maximum depth (1–8, default 3). Cross-references and text inside the
popup can start a child lookup; a child request carries the popup session,
depth, UTF-16 source offset, and a request ID. Replacing a child, closing the
root popup, or changing sessions cancels pending child work, and Escape closes
the deepest child before it reaches the root popup. The generic browser Gamepad API is
polled by the passive surface and also publishes browser hotplug events when
available, then translated through the configured no-popup/popup/audio
binding maps. Repeat timing and edge detection live in
`src/interaction/controller-runtime.js`; a changed gamepad id/index and every
disconnect reset edge/repeat state, and all input remains suppressed until the
replacement device reports a neutral sample, so a held-button action cannot
leak across a device or focus transition. Browser analog-button values use the
same `0.65` pressed threshold as iinatan; native HID snapshots publish
already-debounced boolean button state. On macOS, enabling the controller
preference also asks the capable HoshiDicts helper to publish its native HID
state; the main process polls that bounded state file at a display-frame
cadence, routes it through the same controller router, and suppresses browser
polling when the native source is available. A stale, malformed, or temporarily
missing native snapshot produces one neutral disconnected state while polling
remains alive, so a later device reconnect is observable without restarting the
dictionary worker. The router applies a dead-zoned, proportional left-stick
scroll sample in popup/audio contexts, while the right stick moves the
cursor-free subtitle target or dictionary entry. The audio menu exposes
row/column focus, including the per-source Anki selection action when
configured. The native HID contract, stale/disconnect recovery,
replacement-device edge handling, and the macOS semantic path through subtitle
targeting, popup entry selection, proportional popup scrolling, audio-menu hold,
and dismissal are covered by tests and a signed native desktop replay.
Changing between no-popup, popup, and audio contexts clears pending repeat
deadlines while retaining the held-button record needed to release a hold
cleanly, so an input begun in one context cannot repeat as another context's
action.
The browser fallback also publishes a forced neutral snapshot when its document
blurs, becomes hidden, or is torn down, and stops its poller on page teardown;
this closes the renderer-lifecycle edge without changing the native-HID source
arbitration rule. That replay injects state through the live native-HID worker
contract; physical button actuation, focus behavior during a real controller
session, hotplug, and device compatibility still require platform testing
before being called supported.

Controller selection has an explicit input-modality rule: after a controller
selects a subtitle target, passive mouse motion through empty space or back over
that same target does not clear the controller target or its highlight. An
actual mouse hit on a different subtitle unit is the hand-off point back to
pointer ownership. The integration test named
`mouse motion through empty space does not steal a controller-selected target`
enforces the first two cases; the native desktop matrix separately exercises
the different-unit hand-off.
