# Recommended dictionary sources

Recommended dictionaries are optional downloads. They are not bundled with the
application, are not required to run the Electron host, and are installed only
after the user presses Download or Update in the settings window.

The catalog currently covers the six configured lookup languages:

- Japanese: Jitendex, JMnedict, BCCWJ SUW/LUW, JPDB, and Jiten Global.
- English, German, French, and Korean: the corresponding Wiktionary-to-Yomitan
  `wty` releases.
- Chinese: CC-CEDICT and the Wiktionary-to-Yomitan `wty` release.

The catalog records upstream homepages and HTTPS download URLs in
`src/services/recommended-dictionaries.js`. Jitendex documents its Yomitan
format and current download on its own installation page; the JMdict project
documents its latest-release links and update cadence in its repository. The
catalog is metadata, not a license grant: each downloaded dictionary remains
subject to its upstream license and attribution requirements.

Downloads run in the main process, follow only bounded HTTPS redirects, stream
to an owner-only temporary file, enforce a maximum archive size, validate the
ZIP before import, and stage replacements before swapping the managed
directory. Renderer code receives catalog metadata and typed actions, never a
general network or filesystem primitive.

The URLs are external release endpoints and can change. A failed or changed
endpoint is reported to the settings window; it is not silently replaced with
demo data or an arbitrary mirror.

## Dictionary-scoped presentation

Normalized glossary data records a bounded source kind (`generic`, `jitendex`,
`kaikki`, `wiktionary`, or `wiktionary-style`) without retaining raw HTML. The
renderer uses that classification only for presentation rules that existed in
the reference overlay: Etymology sections follow the global collapse setting,
the Wiktionary/Kaikki override takes precedence unless it is set to `inherit`,
Grammar details become labeled rows, and tagged non-lemma payloads become
bounded Form-of/Inflection rows. Structured details remain native safe DOM
elements, and long popup content is constrained by the popup max-height so it
scrolls inside the popup.

Grammar and other dictionary content remains structured data rather than an
HTML compatibility layer; unsupported tags are discarded at normalization.
Dictionary links that do not resolve to an allowed external HTTPS destination
are rendered as their visible text. They therefore use the same nested lookup
path as surrounding popup text, while external HTTPS links remain ordinary
external-link actions.
