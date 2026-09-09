# Goal prompt: Native-feeling HTML dictionary overlay for stock mpv
## 1. Objective and priority order

Implement a successor to iinatan for regular desktop mpv, preserving its rich HTML/CSS dictionary interface and HoshiDicts functionality.

Primary implementation framework: **Electron, using normal transparent browser windows/surfacesâ€”not offscreen browser pixels transferred to mpv.**

Secondary future framework: **CEF**. Preserve a clean integration boundary so CEF could replace Electron later, but do not build two implementations now.

Required subtitle-geometry implementation: **ship a private, instrumented libass renderer in the companion's packages on macOS arm64, Windows x86-64, and Linux x86-64**, extending the existing macOS geometry-helper approach. Implement this as part of the goal, not merely as an investigation or optional user-installed backend. The helper reconstructs subtitle layout internally and supplies lookup geometry; the user's stock mpv remains responsible for visible subtitle rendering.

Target architectures:

- macOS: arm64.
- Windows: x86-64.
- Linux: x86-64.

â€œx86â€ is interpreted here as 64-bit Intel/AMD, not 32-bit IA-32. Explicitly record that interpretation.

The priority order is:

1. Accurate correspondence between visible subtitle text, pointer location, selected term, highlight, and popup anchor.
2. Frictionless input ownership, focus, selection, scrolling, nested lookup, and gamepad interaction.
3. Integration with the userâ€™s existing mpv installation and ordinary workflow.
4. Full dictionary, Anki, audio, settings, and customization functionality.
5. Performance, resilience, packaging, and automated validation.
6. Runtime size.

Do not sacrifice the first two priorities to achieve an impressive-looking but unreliable feature count.

The user is not a programmer and expects agents to maintain the implementation. Nevertheless, use explicit interfaces, reproducible dependencies, understandable code, and tests. Agent maintenance is not justification for undocumented hooks or unbounded complexity.

## 2. Non-negotiable constraints

- Continue using the userâ€™s ordinary mpv executable to play video and render native subtitles.
- Do not build a replacement player embedding libmpv.
- Do not reparent mpv into a new application shell and describe that as merely a plugin.
- Do not replace native subtitle rendering with HTML or reconstructed ASS to make geometry easier.
- Do not transfer browser screenshots, BGRA buffers, PNGs, or encoded UI video to mpv.
- Do not use `overlay-add` as the browser-display implementation.
- No separately installed Node, Python, browser, compiler, or development runtime for end users.
- Bundle necessary plugin/helper dependencies in platform packages.
- Explicitly authorized: build, patch, bundle, and automatically launch the companion's own libass geometry helper and its required dependencies on all three target platforms. This private renderer must not replace, inject into, or alter the libraries used by the user's mpv process. Internal subtitle rasterization for geometry and validation is permitted; it is not browser-pixel transport or replacement of the visible subtitle surface.
- Optional Anki integration may require the userâ€™s existing Anki/AnkiConnect installation; that is distinct from renderer installation.
- During ordinary playback and lookup, show no dashboard, terminal, browser chrome, or independently managed application window.
- Explicitly requested settings, import dialogs, and external source links may open appropriate windows.
- Preserve real custom CSS support, subject to clearly documented security boundaries.
- The active popup owns interaction. Clicking or scrolling it must not also operate mpv.
- Preserve user configuration, dictionaries, Anki data, and unrelated mpv plugins.
- Do not silently relax requirements when implementation becomes difficult.

### Important interpretation to resolve

A program-managed transparent companion surface can look like part of mpv while remaining a separate OS window.

That is the primary Electron candidate, **not an assertion that Electron becomes an IINA-style child view inside mpv**.

Document this distinction before implementation. If the user requires literally the same native window/view hierarchy, obtain direction before committing to a companion-window architecture.

Normal browser/OS GPU composition is permitted. This does not authorize an explicit offscreen texture-sharing alternative, graphics injection, or bitmap-transfer fallback without further discussion.

## 3. Initial repository investigation

Reference implementation:

`https://github.com/afn478/iinatan`

The historical local reference checkout is:

`the historical macOS reference checkout`

Existing mpv attempt:

`the historical mpv checkout`

The current successor workspace is `the current successor workspace`. Continue from its existing implementation and current branch. The historical macOS paths are references, not prerequisites on Windows/Linux; locate available checkouts or consult the upstream source without restarting completed migration work.

Before editing:

1. Read applicable `AGENTS.md` and override instructions in both repositories.
2. Check branch/worktree status.
3. Inspect the existing mpv project rather than overwriting it.
4. Propose the implementation location and migration boundary.
5. Keep the working IINA implementation intact unless a narrowly scoped shared change is necessary and authorized.
6. Do not commit or push unless requested.

Read these reference areas:

- `src/overlay/overlay.js`
- `src/overlay/overlay.css`
- `src/overlay/native_subtitle_hit_layer.js`
- `src/main/10_subtitle_text_style.js`
- `src/main/12_native_subtitle_hit_layer.js`
- `src/main/15_profile_settings.js`
- `src/dictionary-manager/dictionary-manager.html`
- Dictionary-manager scripts and host-message handlers.
- `src/native/ass_geometry.cpp`
- `src/native/ass_geometry.hpp`
- Native worker protocol, media demuxing, font resolution, controller and OCR implementations.
- `patches/libass-0.17.2-iinatan-unit-ids.patch`
- `native-dependencies.lock.json`
- Existing geometry, overlay, settings, controller, Anki, release, and lifecycle tests.

Treat the actual settings layout and runtime defaults as a quasi-function list.

The inspected reference contained 59 profile preferences and two global import preferences. Recalculate from the current source; do not freeze this count or trust older audit documents over code.

The existing ASS-based mpv port contains potentially reusable backend, packaging, configuration, and media-export work. Reuse only after validating its behavior. Its README claims are not proof that interaction or alignment requirements have been met.

## 4. Verified research findings and their implications

### IINAâ€™s integration model

The relevant implementation is an owned native view hierarchy plus a browser-message bridge, not an external overlay-following mechanism.

Inspect:

- [PluginOverlayView.swift](https://github.com/iina/iina/blob/55cff8e62f79d601c08c1b8ca4db4f9ae20ccc71/iina/PluginOverlayView.swift)
- [MainWindowController.swift](https://github.com/iina/iina/blob/55cff8e62f79d601c08c1b8ca4db4f9ae20ccc71/iina/MainWindowController.swift)
- [JavascriptAPIOverlay.swift](https://github.com/iina/iina/blob/55cff8e62f79d601c08c1b8ca4db4f9ae20ccc71/iina/JavascriptAPIOverlay.swift)
- [JavascriptMessageHub.swift](https://github.com/iina/iina/blob/55cff8e62f79d601c08c1b8ca4db4f9ae20ccc71/iina/JavascriptMessageHub.swift)

Reproduce the useful contracts:

- Load/show/hide lifecycle.
- Structured messages between trusted host and UI.
- Interactive versus pass-through areas.
- Player-relative coordinates.
- Explicit input priority.
- Cleanup when the player closes.

Do not reproduce the entire IINA plugin ecosystem. Do not copy its synchronous JavaScript hit-test wait or string-interpolated bridge implementation as architectural requirements.

### mpv extension limits

mpv supports native C plugins using its client API. That makes a small native integration shim a legitimate investigation, not a replacement player. However, the client API is not a public API for attaching arbitrary browser views or retrieving libassâ€™s live glyph layout. [mpv C-plugin documentation](https://github.com/mpv-player/mpv/blob/f5bcfb195412e0ca733eac2e850879cd3b1ded18/DOCS/man/libmpv.rst)

A small shim may be useful for native window notifications and input/lifecycle coordination.

Do not assume:

- Every distributed mpv build enables the required plugin support.
- A window ID has identical semantics on every platform.
- An object pointer obtained inside mpv is dereferenceable in the helper.
- Loading a second libass gives access to mpvâ€™s renderer state.

The inspected macOS implementation returns an `NSWindow` pointer for `window-id`. Such a pointer is meaningful inside that process, not as a portable cross-process native-window handle. [mpv macOS window implementation](https://github.com/mpv-player/mpv/blob/f5bcfb195412e0ca733eac2e850879cd3b1ded18/video/out/mac/common.swift)

### Electron versus CEF

Use normal Electron transparent surfaces for the primary investigation. Transparency alone does not implement OS-level click-through, and documented transparent-window resizing limitations must be tested against the chosen release.

CEF remains a future host option, but its documented windowed transparency behavior is not equivalent to WKWebView. Do not switch to CEF merely because an Electron platform problem exists; establish that CEF actually solves that problem.

Any CEF proposal involving offscreen GPU textures and a custom compositor is a distinct architecture requiring explicit review.

### Wayland is a separate feasibility gate

Do not equate â€œLinux supportâ€ with â€œtested under X11.â€

Generic Wayland does not provide an arbitrary application with unrestricted positioning and attachment to another applicationâ€™s window. `xdg-foreign` involves cooperation from the exporting client and is not a universal exact-overlay placement mechanism. [Protocol definition](https://github.com/wayland-mirror/wayland-protocols/blob/main/unstable/xdg-foreign/xdg-foreign-unstable-v2.xml)

Investigate separately:

- X11.
- XWayland, including whether both applications actually use X11.
- KDE Plasma Wayland.
- GNOME Wayland.
- Other compositors only when supported by a concrete mechanism.

JitenMPV has compositor-specific integration worth studying, especially its KWin geometry and Plasma surface backends. Its macOS and Windows popups deliberately avoid activation, which differs from this projectâ€™s focused-popup requirement. Borrow mechanisms, not its interaction policy. [JitenMPV platform code](https://github.com/Sirush/JitenMPV/tree/master/src/JitenMPV.App/Platform)

Do not automatically install a compositor extension, force an mpv backend, or describe an XWayland-only result as native Wayland support.

## 5. Phase A: prove the integration before migrating the application

Create a minimal vertical slice containing:

- Stock mpv playing a deterministic test video.
- Native bottom and top subtitle tracks.
- A transparent overlay with one highlight and one small HTML popup.
- Real hover, click, wheel, keyboard, and selection behavior.
- Window movement, resizing, fullscreen, focus transitions, and shutdown.
- Instrumented geometry and input logs.

Do not spend the first phase porting the settings UI or all dictionary features.

For every target platform, record:

- Exact mpv build/version and relevant capabilities.
- Electron version.
- OS version, display backend, scale, and GPU.
- How the player is identified.
- How content geometry is obtained.
- How surfaces are positioned and stacked.
- How input is captured or passed through.
- What permissions are required.
- Whether the arrangement is same-window, owned-window, or independently tracked.
- What remains unverified.

A valid output of this phase can be a demonstrated blocker. It cannot be â€œassumed working.â€

If an essential constraint cannot be achieved through supported mechanisms, stop the affected implementation path and present evidence and options. Do not quietly replace the requirement with a weaker one.

## 6. Platform integration requirements

### Shared requirements

Identify the player using an explicit session relationship, process identity, and native window identityâ€”not title matching alone.

Support:

- Multiple mpv instances without cross-talk.
- Window destruction/recreation.
- Video changes and playlist transitions.
- Minimize/restore.
- Player focus loss.
- Other applications covering the player.
- Fullscreen entry/exit.
- Monitor changes and negative desktop coordinates.
- Display sleep/wake and renderer recovery.

The overlay must not remain above unrelated applications after mpv loses its relevant foreground/visibility state.

Avoid permanent global â€œalways on topâ€ behavior as a substitute for correct ownership.

### macOS arm64

Investigate a minimal in-process native shim for obtaining authoritative player-window/content geometry and notifications using public AppKit APIs.

If used:

- Validate the actual supported mpv builds.
- Perform AppKit operations on the main thread.
- Avoid altering mpvâ€™s application delegate, global activation policy, or view hierarchy indiscriminately.
- Export scalar geometry/state, not raw pointers for use in another process.
- Clean up all observers safely.

For the Electron helper, validate accessory/no-Dock behavior, popup activation, native fullscreen Spaces, and return of focus to mpv.

Do not assume `addChildWindow` can directly attach an `NSWindow` object belonging to another process.

Screen Recording or Accessibility permission must not be requested speculatively. Explain and test any genuinely necessary permission. Prefer mechanisms that do not require desktop-wide observation.

### Windows x86-64

Investigate owned popup/tool windows and precise client-area tracking.

Prefer explicit ownership over cross-process `SetParent` unless the latter has a demonstrated advantage. Reparenting has documented DPI-awareness consequences. [Microsoft SetParent documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)

Validate:

- Per-monitor DPI.
- Client versus frame bounds.
- Borderless fullscreen.
- Activation and foreground restrictions.
- No separate taskbar entry.
- Correct behavior when another application overlaps mpv.
- No click leakage caused by incorrect assumptions about transparent window styles.

Do not depend on administrator privileges or a global input hook for ordinary operation.

### Linux x86-64

Implement explicit backend capability detection.

For X11, investigate window geometry/configure notifications, transient ownership, focus behavior, stacking, and native input regions.

For Wayland, require an identified protocol/compositor integration and test its actual guarantees.

Do not treat `setPosition()` succeeding at the application API level as evidence that the compositor placed the window there.

If native Wayland cannot satisfy the requirements, report that as an unresolved support requirement. Offer X11/XWayland as an explicit option, not a silent downgrade.

## 7. Native-subtitle geometry: the central correctness project

Keep browser presentation, player-window geometry, and subtitle geometry as separate components.

A browser knows the layout of its own text. It does not know the positions of text already rendered by mpv.

Stock mpv exposes subtitle text and some ASS metadata. The inspected API includes `sub-text/ass-full` and `sub-ass-extradata`, but availability must be checked against the selected release. These are inputs to reconstruction, not a public per-character layout API. [mpv subtitle properties](https://github.com/mpv-player/mpv/blob/f5bcfb195412e0ca733eac2e850879cd3b1ded18/DOCS/man/input.rst)

### Geometry investigation order

1. Inspect the existing macOS helper, bundled corresponding-source archive, libass patches, dependency lock, native service protocol, and stock-mpv comparison tests. Reuse these components where their behavior is verified.
2. Check the selected mpv release's public inputs and any supported authoritative geometry interface, but do not leave the already-authorized portable helper work waiting for a hypothetical upstream API.
3. Build and package the instrumented libass geometry backend for Windows x86-64 and Linux x86-64, while preserving and regression-testing macOS arm64 support.
4. Integrate automatic packaged-helper discovery and startup, then compare reconstructed geometry against actual unmodified stock-mpv output on each target platform.
5. Record validated configurations and specific unsupported cases. Continue closing ordinary subtitle coverage gaps; do not treat an incomplete allowlist as completion of the goal.
6. If an unresolved case requires modifying the user's mpv, replacing its libraries, or intercepting private renderer internals, present evidence and request that separate scope decision. This does not block independent portable-helper implementation and validation already authorized here.

### Authorized portable libass deliverable

Use one maintained C/C++ geometry core and a versioned worker protocol across platforms. Reuse the existing `NativeSubtitleGeometryService` / `SubtitleGeometryProvider` boundary and repository naming conventions. Keep font-provider integration, process launching, and native window coordinates behind narrow platform adapters. Do not create three divergent subtitle-layout implementations.

The relevant iinatan ASS helper creates its own `ASS_Renderer` and calls `ass_render_frame`; it does not obtain geometry from IINA's live renderer. Its original-versus-instrumented comparison validates the helper's own rendering. Preserve this distinction in implementation comments, diagnostics, and release claims. Reference [iinatan's geometry implementation](https://github.com/afn478/iinatan/blob/main/src/native/ass_geometry.cpp), [libass's API](https://github.com/libass/libass/blob/master/libass/ass.h), and [mpv's subtitle-rendering path](https://github.com/mpv-player/mpv/blob/master/sub/sd_ass.c); record the exact revisions used during implementation.

Required work:

- Extract or reuse the existing geometry core, media demuxing, lookup-unit instrumentation, and visible-envelope support from maintained source. Separate Apple-only OCR/controller dependencies so they do not prevent building geometry on Windows/Linux.
- Pin libass, its instrumentation patches, and required FreeType, HarfBuzz, FriBidi, FFmpeg, and other enabled dependencies. Record versions, build options, checksums, licenses, source/patch provenance, and reproducible build commands. Dependency names here do not mandate enabling components the backend does not use.
- Bundle the renderer and all non-system runtime dependencies privately, using static linking or scoped runtime loading as appropriate. Do not discover or load an arbitrary libass from PATH, or require end users to compile or install it.
- Select the packaged geometry helper automatically on supported configurations. A manually supplied executable or developer opt-in flag is not the production installation experience. Keep explicit diagnostic overrides available.
- Negotiate helper protocol and capabilities at startup. Report geometry capability independently from dictionary, OCR, and controller capability; a working dictionary-only worker does not satisfy this deliverable.
- Replace estimated fixed character widths in the production geometry path. Keep approximation only as an explicitly identified diagnostic/demo mode, not an automatic substitute advertised as accurate lookup.
- Maintain reusable renderer/font caches where appropriate, bounded memory and work queues, request cancellation, timeouts, crash recovery, and stale-generation rejection. Do not share mutable track/event state between mpv sessions.
- Handle primary and secondary subtitle surfaces independently, including their effective override modes, scaling, delay, and concurrent events.
- Support packaged execution with paths containing spaces and Unicode, no terminal flashes, no separate runtime installation, and cleanup after mpv closes.

### Match the renderer inputs, not just its name or version

Use the full observed subtitle events and codec/style metadata where available. Preserve attachments, selected track identity, layers, margins, collision-relevant event history, and the effective subtitle render time. For converted formats such as SRT, reproduce the selected mpv release's conversion and effective styling rather than treating stripped text as a complete ASS source.

Match the effective font files, faces/collection indices, fallback runs, bold/italic synthesis, shaping settings, embedded-font policy, and font-provider behavior. CoreText on macOS, DirectWrite on Windows, and Fontconfig on Linux are candidate providers supported by libass; verify the provider used by each supported mpv build instead of assuming it from the OS. Bundle required libraries, not arbitrary user fonts. Respect redistribution rights for any test or shipped fonts.

Observe all supported geometry-affecting player options and invalidate the layout when they change. Reproduce frame/storage dimensions, pixel aspect ratio, video margins, subtitle scaling and position, style overrides, timing, and secondary-track behavior. Detect missing or unsupported inputs explicitly. Matching library version strings alone must not promote a configuration to verified geometry.

Return source ranges and shaped-cluster mappings together with fill rectangles and, where available, separate visible outline/shadow envelopes. Do not infer text ownership by splitting a line or bitmap into equal-width character boxes. Preserve the distinction between graphemes and shaped clusters described in the [HarfBuzz documentation](https://harfbuzz.github.io/clusters.html).

### Portable-helper acceptance and evidence

Validate the helper against unmodified stock mpv independently on macOS, Windows, and Linux. A macOS pass does not validate Windows font selection or Linux layout, and an X11 geometry pass does not resolve Wayland companion placement.

Use two separate checks:

1. Original-versus-instrumented helper renders establish that instrumentation preserves layout and pixels.
2. Stock-mpv captures, independently annotated source-unit fixtures, and native pointer probes establish alignment and correct lookup against the actual player.

Apply the existing one-physical-pixel static registration target and correct track/event/unit requirement to supported deterministic fixtures. Cover ordinary ASS/SRT, actual media, fallback and embedded fonts, mixed scripts, overlapping primary/secondary events, fractional DPI, fullscreen, monitor changes, and the advanced cases listed below. Measure resize/seek recovery and animated-subtitle synchronization separately from static correctness.

Record support by actual mpv build, renderer dependencies/provider, effective options, OS/display backend, and tested subtitle cases. Do not hardcode the old macOS version tuple as the only possible supported configuration. Expand support through evidence, with explicit diagnostics when an unvalidated or unsupported configuration cannot be accepted safely.

Failures must identify actionable causes such as missing attachment/font, unsupported option, incompatible helper protocol, or stale dimensions. Preserve normal native subtitle playback if geometry is unavailable. A wide set of disabled ordinary cues, permanent developer flags, or a helper that merely builds does not meet the deliverable. Neither bounded successful fixtures nor helper self-validation justify a claim of universal equivalence to every arbitrary mpv installation.

Do not assume reconstruction is exact simply because both sides use a library called libass.

Potential sources of divergence include:

- Library versions and build options.
- Font providers and fallback.
- Embedded fonts and font collections.
- Shaping-library versions.
- Subtitle options and style overrides.
- Render dimensions, margins, and pixel aspect ratio.
- Event history, collision resolution, and animation time.
- Secondary-track-specific behavior.

The existing helperâ€™s â€œoriginal versus instrumentedâ€ comparison establishes that its instrumentation preserves its own rendering. It does **not** independently prove agreement with the mpv executable.

### Track and event model

Represent primary and secondary subtitle tracks independently.

Do not concatenate top and bottom text into one logical line or infer track identity from vertical position.

Maintain stable identities for:

- Player session.
- Media.
- Track and selection role.
- Subtitle event.
- Source text.
- Lookup unit/grapheme cluster.
- Geometry generation.

Handle multiple simultaneous events within either track.

Correctly handle repeated identical text, overlapping timings, different delays, and track switching.

For ASS, preserve event metadata, styles, attachments, order, layers, and timing. Do not base general reconstruction solely on stripped subtitle text.

### Required subtitle test cases

Include:

- SRT and ASS.
- Primary bottom plus secondary top, visible simultaneously.
- ASS events at different alignments and explicit positions.
- Multiple simultaneous events.
- Multiline wrapping and explicit line breaks.
- Italics, font changes, sizing, spacing, borders, and shadows.
- Embedded fonts and missing-font fallback.
- Japanese, English, German, French, Korean, and Chinese.
- Combining marks, supplementary characters, ligatures, and mixed scripts.
- ASS movement/transforms, clipping, rotation, and karaoke.
- Drawing-only ASS events, which must not become fake word targets.
- Subtitle delay/speed changes and seeking.
- Letterboxing, pillarboxing, zoom, pan, rotation, and non-square pixels where supported.
- Changes to subtitle styling while a popup is open.

Unsupported cases must fail safely and visibly in diagnostics. Disabling lookup is preferable to confidently selecting the wrong word, but widespread unsupported cases do not satisfy the overall goal.

### Coordinate contract

Define explicit types for:

- Video/source coordinates.
- mpv OSD/render coordinates.
- Native content-area coordinates.
- Desktop logical coordinates.
- Desktop physical pixels.
- Browser CSS pixels.

Use one documented transform chain and its inverse.

Do not scatter scale factors, guessed title-bar offsets, or `devicePixelRatio` multiplications through the application.

Round only at native API boundaries.

Publish immutable geometry snapshots containing dimensions, transforms, track/event identities, timing, and a generation number.

Use the same snapshot for:

- Pointer hit testing.
- Highlight placement.
- Popup anchoring.
- Collision avoidance.

Discard stale results after resize, seek, track change, profile change, or player replacement.

### Lookup units

Preserve the mapping between source text, UTF-8 bytes, UTF-16 offsets, grapheme clusters, and shaped visual clusters.

Do not assume one character equals one glyph or one rectangle.

Define behavior for:

- Ligatures.
- Combining characters.
- Whitespace.
- Bidirectional visual order.
- Words spanning multiple lines.
- Partially clipped text.
- Overlapping events.

Use shared geometry for deciding the target and drawing its highlight. Do not widen hit boxes so far that an adjacent word becomes selectable.

## 8. Popup positioning and stability

Anchor the popup to the selected termâ€™s visual geometryâ€”not an unrelated approximate subtitle box.

The placement engine must account for:

- All active subtitle regions, including both tracks.
- Player content bounds.
- Existing nested popups.
- The cursor and its path toward the popup.
- User scale, width, maximum-height, and gap settings.
- Dynamic dictionary content and font loading.
- Audio menus and expanded sections.
- Custom CSS changing layout.

Evaluate candidate positions deterministically. Prefer continuity over constantly switching sides.

Use hysteresis so small pointer movements or tiny layout changes do not make the popup jump.

Provide a safe travel corridor or equivalent interaction rule between the source term and popup. Test diagonal movement and crossings over nearby subtitle words.

Do not move a popup away from the pointer while the user is trying to click it.

During resize/fullscreen transitions, temporarily suppress invalid hit testing if necessary. Do not display a stale clickable highlight. Persistent disappearance during ordinary movement is not an acceptable final substitute for synchronization.

## 9. Input and focus: explicit state machine

Implement a testable state machine rather than independent mouse handlers.

Suggested states:

- Inactive.
- Player interaction.
- Subtitle hover candidate.
- Lookup pending.
- Popup active.
- Nested popup active.
- Text selection/drag capture.
- Audio menu active.
- Explicit settings/dialog interaction.
- Suspended because the player is unavailable or backgrounded.

Specify entry, exit, cancellation, and ownership rules.

### Before a popup opens

- Ordinary player input remains unchanged outside actual lookup targets.
- No invisible full-window surface may swallow controls.
- Honor hover versus modifier-hover settings.
- Mere pointer motion over unrelated content must not activate another application.
- Preserve OSC and user-script behavior.

### While a popup is active

The popup owns keyboard interaction and its mouse interaction.

- Pointer motion must not remove keyboard focus.
- Scrolling over it affects only its content.
- Clicking buttons must not toggle pause, seek, or drag mpv.
- Browser selection, links, controls, and nested lookup receive normal native browser events wherever possible.
- Do not duplicate events through both native delivery and synthetic delivery.
- Keep focus during asynchronous result updates.
- Do not dismiss solely because mpvâ€™s own window becomes unfocused when its overlay receives focus.
- Treat the player and its overlay as one interaction session.

Recommended outside-click behavior: dismiss the popup and consume that click, preventing an accidental playback action. Make this explicit and compare it with the reference behavior.

Escape should close the deepest transient UI first, then nested/root lookup as appropriate, without also triggering mpvâ€™s fullscreen/quit bindings on the same key event.

### Input regions

Browser CSS `pointer-events` does not by itself implement click-through to another OS window.

Use an explicit native input-region strategy.

Electronâ€™s `setIgnoreMouseEvents` is whole-window behavior; its motion-forwarding option is platform-specific. `setShape` also affects drawing, so it must not be confused with an independent input mask. [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)

Prefer a single coherent interactive surface where possible. A separate passive highlight surface is acceptable if needed, but it must use the same geometry generation.

Do not copy IINAâ€™s synchronous native-to-JavaScript hit-test wait. Publish current interactive regions from the DOM and maintain a local native cache.

Handle stale-region races, CSS changes, scrolling, and nested menus. Interaction must not briefly pass through while a popup is becoming active.

### Mouse and keyboard coverage

Test:

- Enter/leave.
- Rapid crossings.
- Button down/up ordering.
- Dragging outside the original element.
- Release outside the popup.
- Double-click selection.
- Right-click/context menus.
- Trackpad scrolling and momentum.
- Modifier changes while hovering.
- Tab/Shift-Tab and visible focus.
- Copy/paste and text fields.
- IME composition where text entry is supported.
- Keyboard-layout differences.
- Focus restoration.
- Cursor visibility during paused playback.

Never leave a stuck pressed button or captured pointer after dismissal, crash, or focus loss.

Do not emulate all mpv keyboard bindings inside Electron. Forward only intentionally supported player actions through a narrow command interface.

### Pause ownership

Pause/resume must be transactional.

- Record whether the plugin caused the pause.
- Do not resume video that was already paused by the user.
- Respect explicit pause changes during lookup.
- Do not resume on stale popup-close messages.
- Handle nested popups without repeated pause/resume transitions.
- Cancel ownership appropriately on seek, media change, shutdown, or session replacement.

### Gamepad

Preserve configurable actions in the existing no-popup, popup, and audio-menu contexts.

Use a bundled controller backend if browser gamepad delivery cannot be shown reliable with the focus model.

Test hotplug, disconnection, held buttons, repeat, deadzones, device differences, context changes, and duplicate delivery.

Controller input should not simultaneously operate the popup and mpv.

Physical mouse motion should not unexpectedly destroy controller selection. Define how switching input modality occurs.

## 10. Functionality preservation checklist

Create a machine-readable feature matrix mapping source behavior to implementation and tests.

At minimum include:

### Dictionaries and languages

- All six current lookup languages.
- User-provided dictionary imports.
- Recommended downloads and updates.
- Dictionary enablement, ordering, removal, and profiles.
- HoshiDicts lookup correctness and deinflection.
- No-result termination.
- Lookup cancellation, timeouts, and stale-response suppression.
- Full entry headwords, readings, tags, frequency, pitch, notes, examples, tables, attribution, and links.
- Existing dictionary-scoped formatting rules.
- Long-section collapse and scrolling.
- Nested lookup modes and depth limits.

### Anki

- Connection settings and bounded timeouts.
- Deck/model discovery.
- Field templates and marker insertion.
- Existing preset/autofill behavior.
- Tags.
- Duplicate enablement, modes, scope, and add-anyway behavior.
- Opening existing notes where supported.
- Selected definitions/text.
- Screenshot quality.
- Sentence audio, padding, formats, and bitrate.
- Word audio.
- Immutable export context when playback or lookup changes.
- Clear pending/success/failure states.
- Protection against duplicate submissions.

Use a mock AnkiConnect service for automation. Do not create or delete notes in the userâ€™s real collection during tests.

### Audio

- Configurable sources.
- Autoplay settings.
- Source selection.
- Cancellation of previous playback.
- Playback while mpv is paused.
- Codec/error handling.
- Offline and unavailable-source behavior.

### Settings and profiles

- Create, rename, switch, and delete profiles.
- Per-profile versus global values.
- Theme inheritance and explicit theme.
- Popup font/scale/width/height/gap settings.
- Hover and nested-lookup settings.
- Section-collapse options.
- Custom CSS.
- Worker and timeout settings.
- Diagnostics.
- Controller bindings.
- Backup/restore and migration.
- Preservation of dictionary files and references.

Audit advanced settings for host-specific options. Do not blindly expose IINA-only controls or silently remove them; document migrations.

### OCR

Preserve existing capability honestly.

macOS-specific OCR does not imply Windows/Linux parity. Record platform availability and any proposed replacement separately.

OCR must not be advertised as an exact substitute for ASS/SRT glyph geometry.

## 11. Architecture and future CEF boundary

Use clear modules such as:

- `PlayerSession`
- `PlayerBridge`
- `NativeWindowAdapter`
- `SubtitleGeometryProvider`
- `CoordinateMapper`
- `InteractionController`
- `PopupPlacement`
- `BrowserHost`
- `DictionaryService`
- `AnkiService`
- `AudioService`
- `SettingsStore`

The names are illustrative; preserve repository conventions.

The HTML UI should not import Electron directly.

Expose a small, typed, versioned host bridge for messages and necessary capabilities. Include:

- Request IDs.
- Session and geometry generations.
- Cancellation.
- Errors.
- Readiness and lifecycle.
- Capability negotiation.

Keep Electron-specific window management outside dictionary/rendering logic.

The future CEF host should be able to reuse the document UI, protocol, settings, services, and placement rules. Native attachment mechanisms may still differ; do not promise a drop-in swap.

Do not build a generic plugin marketplace or broad IINA compatibility layer.

Keep any in-process mpv shim small. Prefer isolating browser crashes from the player.

## 12. Security model

Local content reduces exposure, but does not eliminate it.

Relevant untrusted inputs include:

- Imported dictionary HTML/structured content.
- Images, fonts, archives, and media.
- Remote audio and redirects.
- Configurable URLs.
- Source links.
- Backup files.
- CSS network references.
- Messages crossing the renderer/host boundary.

For Electron:

- Disable Node integration in document content.
- Enable context isolation and renderer sandboxing where supported.
- Expose narrow capabilities through preload.
- Validate message schema, sender, session, paths, and allowed operations.
- Block unexpected navigation and new windows.
- Open approved external links in the system browser.
- Use a restrictive content security policy.
- Do not disable web security to bypass integration problems.
- Do not ship remote debugging enabled.

Follow the official [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

Host-mediated file access should validate paths and prevent traversal. Archive extraction needs limits and protection against unsafe entries and decompression bombs.

Allow configured audio services, including intentional loopback services, through an explicit policy. Bound redirects, response sizes, and timeouts.

Custom CSS remains supported, but does not imply unrestricted remote `@import`, arbitrary file access, or script execution.

Use local IPC with appropriately restricted access. If a TCP endpoint is necessary, bind locally, authenticate sessions, and do not expose unrestricted player or filesystem commands.

Package a supported browser version and establish an update policy. Include dependency/license inventory and checksums.

Do not recommend disabling macOS protections, Chromium sandboxing, or operating-system security features as a normal installation step.

## 13. Reliable self-validation

Testing must validate the actual user-visible composition and input pathâ€”not just DOM screenshots and mocked geometry.

### A. Pure/unit tests

Cover:

- Coordinate transforms and inverses.
- Fractional scale and negative coordinates.
- Track/event identity.
- Unicode/index mapping.
- Stale-response rejection.
- Placement and hysteresis.
- Input ownership.
- Pause ownership.
- Controller state transitions.
- Settings migration.
- IPC validation.
- Backend error handling.

Use property-based tests for transforms and event-sequence invariants where useful.

### B. Browser integration tests

Run the real HTML under the selected engine.

Test representative large entries, nested popups, custom CSS, selection, audio menus, async updates, keyboard navigation, and accessibility semantics.

Use Playwright/Electron automation where appropriate, but do not treat synthetic DOM events as proof of OS-level focus or click-through behavior.

### C. Real desktop end-to-end tests

Run real mpv and the installed helper in a graphical session.

Inject native pointer/keyboard input using platform test tooling in isolated environments.

Verify both:

1. The intended UI action happened.
2. No unintended mpv action happened.

Record player state before and after clicks, scrolling, selection, and dismissal.

Use test bindings to detect leaked events without altering normal user configuration.

### D. Independent geometry oracle

Do not use the same geometry implementation to generate both expected and actual results.

For deterministic fixtures:

- Render native subtitles in stock mpv.
- Capture the actual player output.
- Isolate subtitle pixels using controlled backgrounds or matched captures.
- Compare predicted bounds/highlights against those pixels.
- Validate source-unit identity independently with annotated fixtures and pointer probes.
- Verify primary and secondary tracks separately and simultaneously.

Whole-subtitle image similarity alone does not prove that individual word identities are correct.

An instrumented test build of mpv may help obtain diagnostic ground truth, but passing against it is not proof that the released plugin works with ordinary mpv. Repeat release acceptance against unmodified distributed builds.

Screenshots are permitted as test artifacts; the prohibition concerns using screenshots/bitmaps as the runtime UI transport.

### E. Capture the actual combined result

mpvâ€™s own screenshot may not include a separate native overlay. A browser screenshot excludes mpv.

Therefore, the full interaction test needs a desktop/compositor capture containing both, or an independently synchronized equivalent.

Document capture permissions and limitations. Never compare two isolated screenshots and claim their on-screen alignment was verified.

### F. Proposed quality gates

These are acceptance targets, not claims of current performance:

- Static coordinate-registration error no greater than one physical pixel in deterministic supported fixtures.
- Every tested pointer target resolves to the correct track/event/unit.
- No wrong-generation highlight or lookup after resize/seek/track switch.
- Zero unintended mpv actions during popup interaction tests.
- No lost releases or stuck capture.
- No repeated popup oscillation at placement boundaries.
- No focus loss caused merely by moving the pointer.
- No visible detached overlay after player deactivation or closure.
- No sustained busy loop while idle.
- No steadily growing memory/process count over repeated lifecycle tests.

Define and measure latency separately for:

- Pointer to highlight presentation.
- Pointer to lookup request.
- Cached lookup to popup presentation.
- Cold lookup.
- Window geometry change to aligned overlay.
- Popup dismissal to restored input ownership.

For local cached interaction, aim for presentation within roughly one to two display frames after the relevant work is ready. Measure actual distributions and hardware; do not substitute JavaScript handler duration for screen presentation latency.

Do not relax thresholds merely to make CI pass. Explain any proposed tolerance change.

### G. Platform matrix

Run at least:

- macOS arm64, windowed and native fullscreen, standard and Retina scaling.
- Windows x86-64, multiple DPI settings, windowed and borderless fullscreen.
- Linux x86-64 X11.
- Each claimed Wayland compositor/backend separately.

Include mixed-DPI monitor movement where the test environment supports it.

Hosted CI compilation is not equivalent to a real GUI test. Report unavailable runners, missing permissions, and skipped tests explicitly.

â€œBuild passes,â€ â€œheadless tests pass,â€ and â€œnative interaction verifiedâ€ are different statuses.

### H. Stress and failure testing

Exercise:

- Repeated open/close and nested lookups.
- Rapid track switching and seeking.
- Continuous window resize/movement.
- Player/helper/backend crashes.
- Renderer reload.
- Slow dictionary results.
- Anki unavailable.
- Audio unavailable.
- Controller disconnect.
- Invalid custom CSS.
- Corrupt settings.
- Huge/malformed dictionary entries.
- Multiple mpv sessions.
- Suspend/resume.

Confirm safe cleanup and preservation of native subtitles and ordinary player operation.

## 14. Packaging and installation

Produce platform-specific packages containing the helper, native dependencies, UI, backend, and bootstrap.

Requirements:

- No development toolchain required on the userâ€™s machine.
- Clear supported mpv versions/build capabilities.
- No replacement of the mpv executable.
- Preserve existing configuration.
- Non-destructive migrations.
- Recoverable uninstall that does not remove dictionaries by default.
- No terminal flashes on Windows.
- No persistent Dock/taskbar application during normal playback.
- Signed/notarized macOS distribution when credentials are available; never claim signing was completed otherwise.
- Defined Linux runtime baseline.
- Pinned dependencies and reproducible build instructions.
- A working, automatically selected private libass geometry helper in each target package, including required runtime dependencies and corresponding source/patch artifacts as required by their licenses. Verify geometry from the installed package in an environment without development toolchains; source-tree execution alone is insufficient.
- Licenses and notices.
- Crash-safe process and temporary-file cleanup.

Avoid hardcoded user paths in shipped code.

## 15. Work sequence and stopping rules

Proceed in this order:

Resume from the current repository state and retain completed work. The portable libass helper is an explicit expansion of the existing geometry phase: implement and validate the missing Windows/Linux backends, protect macOS behavior, and update packaging and support evidence. Do not restart the project or postpone this deliverable behind unrelated feature polishing.

1. Repository audit and feature inventory.
2. Framework/platform capability report.
3. Minimal real-window/input vertical slice.
4. Portable instrumented libass helper implementation, integration, and independent stock-mpv subtitle-geometry validation on each target platform.
5. Explicit go/no-go assessment of the core requirements.
6. Port HTML UI and host bridge.
7. Restore backend, Anki, audio, profiles, and settings.
8. Full native interaction automation.
9. Packaging and installation tests.
10. Final support/limitations report.

Do not defer the hardest geometry and focus problems until after the feature port.

Do not continue indefinitely polishing a platform that cannot meet the core requirements.

If progress requires a patched mpv, compositor extension, graphics interception, bitmap transport, replacement subtitle rendering, or a reduced platform promise, explain the evidence and request a decision.

Patching and shipping the companion's private libass renderer for geometry is already authorized by this goal and is not a patched-mpv or replacement-subtitle-rendering decision. Do not ask for that authorization again. Internal rasterization and test captures are allowed; runtime transport of browser pixels or replacement of mpv's visible subtitle surface remains outside this authorization.

Do not make those changes implicitly.

## 16. Definition of done and handoff artifacts

The work is complete only when the declared supported environments have demonstrated the required behavior.

Deliver:

- Architecture decision record explaining Electron as primary and the CEF boundary.
- Feature-to-test matrix.
- Platform capability/support matrix.
- Coordinate and geometry protocol documentation.
- Reproducible private libass geometry-helper builds for macOS arm64, Windows x86-64, and Linux x86-64, with dependency/patch provenance and installed-package validation.
- Independent stock-mpv geometry evidence for each platform, including font-provider/configuration details, unit-identity checks, and unsupported-case diagnostics.
- Input/focus state-machine documentation.
- Reproducible automated tests and commands.
- Native desktop test evidence.
- Geometry comparisons and failing fixtures, if any.
- Performance measurements with environment details.
- Security/dependency review.
- Installable packages and installation/uninstallation validation.
- Changelog and migration notes.
- Explicit remaining blockers and unsupported cases.

For every important claim, distinguish:

- Implemented.
- Unit-tested.
- Integration-tested.
- Native-desktop-tested.
- Unverified.
- Blocked.

Do not describe a prototype, a mocked test suite, or a best-effort geometry approximation as satisfying the full goal.

The success criterion is simple: **the user points at a visible subtitle word, receives the correct highlight and dictionary popup exactly where expected, interacts naturally, and returns to their ordinary mpv workflow without noticing a second application.**

Use the current branch for your implementation work.

use '/Volumes/Media Files/anime/MARRIAGETOXIN/Season 01/MARRIAGETOXIN (2026) - S01E01 - The Poison Masters Search for a Bride [HDTV-1080p][AAC 2.0][x265]-DKB.mkv' for testing purposes.

When you get around to testing real dictionary entries, download the dictionaries through this plugin's own dictionary download functionality (once this is implemented).

A gamepad has been connected via usb for your testing.

