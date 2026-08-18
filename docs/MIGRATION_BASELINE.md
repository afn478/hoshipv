# Native mpv migration baseline

The IINA implementation was archived locally at branch `archive/iina-v2.1.4`
after commit `c9c43e0`. That point includes the user-owned external-process queue
fix present when the migration began.

## Verified starting architecture

- IINA owns lifecycle, preferences, WebKit overlays, standalone settings, and
  the local WebSocket bridge.
- `src/main/30_backend_import_worker_lookup.js` publishes complete request
  bodies as `<id>.request`, then `<id>.json` commit markers, and reads
  `responses/<id>.json` from one persistent HoshiDicts worker.
- Lookup fields are `requestId`, `text`, `scanLength`, `maxResults`,
  `maxGlossaries`, and `mode`; supported modes are `yomitan-japanese`, `exact`,
  and `prefix`. Golden request and response documents live in
  `tests/fixtures/protocol/`.
- The six language modules normalize pointer positions into Japanese,
  English, German, French, Korean, and Chinese backend requests.
- Authored ASS geometry is already produced by patched libass/HarfBuzz and the
  persistent worker. Bitmap subtitle OCR uses Apple Vision.
- Profiles and manifest transactions live in `src/main/15_profile_settings.js`,
  `20_dictionary_manifest.js`, `22_profile_backup.js`, and
  `25_import_validation.js`.
- The original Anki subsystem is split into transport, card context, templates,
  duplicate detection, media names, note actions, and orchestration modules.
- The IINA build generated `main.js`, `global.js`, three HTML entrypoints, and
  `.iinaplgz` archives. The native build replaces these with one transpiled
  ES5 script and platform archives.

## Modern JavaScript baseline

The shared source uses block declarations, classes, arrows, destructuring,
default/rest parameters, template literals, async functions, and ES2015+
built-ins. `scripts/build_mpv.js` transpiles syntax for MuJS and the runtime
provides narrow shims for the few non-ES5 built-ins used by shared language
code. Generated `scripts/iinatan.js` is tested in the real mpv 0.41 runtime.
