# Architecture

iinatan is an mpv 0.41+ application with two runtime components:

```text
mpv properties
  → normalized media/subtitle state
  → language normalization + Unicode index map
  → native ASS/text geometry
  → spatial pointer hit
  → latest-only lookup scheduler
  → persistent HoshiDicts worker
  → DictionaryDocument
  → popup/settings reducers
  → ASS layout + hit regions
  → one ass-events OSD overlay
```

`scripts/iinatan.js` is an ES5 bundle generated from ordered modules in `src/mpv` and shared language code in `src/languages`. The source modules own the mpv adapter, config, Unicode mapping, media state, worker protocol, ASS primitives, dictionary model, popup controller, services, Anki domains, settings, and lifecycle respectively. The bundle is the only shipped UI/controller runtime.

The UI toolkit provides stable widgets with measure/layout/render/event phases: Scene, Widget, TextRun, HitRegion, stacks, Button, Toggle, Chip, Link, List, ScrollView, Scrollbar, Expandable, Table, Callout, Modal, and PopupSurface. One ASS builder supplies text and vector commands to `mp.create_osd_overlay("ass-events")`. Measurement comes from the backend; hit handling never estimates character width or launches external work. A spatial index resolves reverse paint order and smallest containing region. Scene data is only updated when it changes.

`src/native` builds one `iinatan-backend` executable. Its portable boundaries are worker protocol, HoshiDicts command orchestration, ASS geometry/text shaping, FFmpeg demux, libcurl HTTP, FFmpeg/miniaudio audio preview, safe platform I/O, Apple Vision OCR, and a non-Apple OCR stub. The tracked CMake project and presets replace generated wrappers. Platform code is selected at build time; Apple frameworks are never linked on Linux or Windows.

The persistent worker keeps dictionary objects in memory. Request publication remains `<id>.request` followed by `<id>.json`; responses use `responses/<id>.json`. It accepts one active lookup and one replaceable latest pending hover lookup. Layout uses a separate non-lookup operation, and macOS OCR has its own cancellable latest-only lane. Generation tokens, cancellation markers, acknowledgements, TTL cleanup, stop markers, owner monitoring, and a bounded shutdown grace prevent stale results and orphans.

Configuration schema v2 lives at `~~home/iinatan/config.json`. Dictionaries/mutable state use `~~state/iinatan`; temporary/download data uses `~~cache/iinatan`. The backend supplies bounded file operations because MuJS lacks portable filesystem mutation. Imports preflight ZIP paths and expansion, stage uniquely, validate HoshiDicts output and `index.json`, resolve collisions, atomically install, transactionally update config, and restart the worker. Failed operations roll back logical state.

The `DictionaryDocument` is independent of rendering and retains structured dictionary meaning. ASS popup rendering and Anki HTML glossary rendering are separate consumers. Anki is split into transport, immutable card context, templates, duplicate detection, and media/note actions. HTTP, encoding, hashing, and playback are async and cannot run inside pointer handling.

Lifecycle begins at script load and observes file, subtitle, track, pause/time, OSD/video, mouse, and subtitle-style properties. Rebuilds coalesce at zero delay. `file-loaded`, `end-file`, and `shutdown` advance generations and cancel scoped work. Popup pause ownership is explicit: playback resumes only when the last popup closes and only when iinatan initiated the pause.

Release archives are target-specific and contain the ES5 script, matching backend and FFmpeg executables, Noto fallback font, schema/example, installers, licenses, checksums, build metadata, changelog, documentation, and corresponding source. Validation verifies safe paths, checksums, target identity, capabilities, executability, and unexpected dynamic dependencies. CI runs native gates on macOS arm64/x86_64, Linux x86_64/aarch64, and Windows x86_64.
