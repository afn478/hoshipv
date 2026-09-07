# Settings migration

The profile inventory in `src/settings/defaults.js` keeps the reference profile
keys so existing exports can be loaded without silently dropping user choices.
Values are normalized at the host boundary before they reach a controller or
worker. The settings window presents the active runtime controls directly and
keeps the complete JSON editor for less common migrated values.

The settings window's Diagnostics card is a read-only host snapshot. It reports
the detected platform/session, Electron runtime, player and dictionary backend,
window capability, active-session geometry state, and the evidence boundary for
native subtitle geometry. When a native geometry request fails, it also shows
a bounded path-redacted failure code/message. It intentionally omits filesystem paths and never
labels settings-window rendering as proof of stock-mpv compositor placement or
native input.

## Runtime-bound settings

- Lookup language, scan length, entry/glossary limits, lookup timeout, hover
  request timeout, subtitle refresh interval, and flattening of subtitle line
  breaks affect the live controller.
- Popup minimum/maximum width, height, gap, scale, font scale, theme, nested
  lookup, section-collapse settings, audio sources, and custom CSS affect the
  browser surface.
- Backend timeout, direct worker polling, and worker idle sleep affect mpv IPC
  and the HoshiDicts queue. Changing worker idle sleep restarts the configured
  worker transactionally; a changed lookup timeout applies to subsequent
  requests.
- Anki and sentence-audio values remain host-mediated and bounded; they never
  become renderer-side network or process capabilities.

## Preserved compatibility values

Some IINA controls cannot be applied without changing the stock-mpv/Electron
architecture and are therefore retained for migration but are not advertised
as equivalent behavior:

- `hideNativeSubtitles` is not applied. This implementation does not draw a
  replacement subtitle text layer, so native mpv subtitles remain visible.
- Bitmap/OCR and experimental native-hit-layer flags remain preserved but are
  explicitly unsupported until a platform-specific implementation and evidence
  exist. They are not used as a substitute for native ASS/SRT geometry.
- `enabledByDefault` is retained for profile compatibility; the current host
  discovers live session descriptors rather than exposing an IINA-style per-
  window enable toggle.
- `directWorkerIpc` and `fallbackToClientExec` describe the migrated backend
  inventory. The current host always uses its bounded local worker queue for
  lookup and a host subprocess boundary for dictionary import.
- `debugLogEnabled` and `debugLogVerbose` remain available in the advanced JSON
  inventory; structured E2E status and native/backend diagnostics are emitted by
  the validation harness rather than enabling unrestricted renderer logging.

This distinction is intentional: preserving a key in a profile is not a claim
that an IINA-only capability exists on every supported desktop platform.
