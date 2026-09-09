# IINA popup parity record

The popup presentation was imported from the IINA reference overlay in commit
`4db4ddcc766fa5f5056a4e4633a9d11978251a6a` (`Port the IINA popup UI into the
mpv host`). That commit is the reproducible source snapshot recorded in this
repository. The original reference checkout remains outside this repository and
is not modified by the mpv port.

The copied presentation files are `app/overlay.html`, `app/overlay.css`, and
`app/iina-popup-renderer.js`. They retain the reference DOM, dictionary
formatting, typography, spacing, nested result structure, audio and Anki
controls, state classes, and custom-CSS surface. Their current hashes are
recorded in `docs/iina-popup-parity.json`; run `npm run validate:popup-parity`
after changing any of them.

The host boundary is kept in `app/host-overlay-adapter.js`,
`app/mpv-popup-integration.js`, `app/preload.js`, `src/platform/browser-host.js`,
and the relevant controller code. It translates mpv session events, measured
popup geometry, input, and lifecycle messages into the reference popup. Text in
cross-reference elements remains ordinary popup text and can be selected by
the same nested lookup path as other dictionary content; the mpv host does not
add a separate hyperlink resolver.

`app/highlight-renderer.js` remains the mpv subtitle and passive-highlight
surface. The popup port does not replace native mpv subtitle rendering with the
IINA subtitle-display implementation.

Parity checks use the same dictionary payload and popup configuration through
`npm run test:browser`, then use the native packaged replay with matched scale
and measured dimensions. The Windows replay also checks native selection,
scrolling, nested text, audio and Anki actions, CSS, dismissal, and popup
capture. Platform window activation and coordinate conversion remain host
integration behavior and are reported separately from dictionary presentation.
