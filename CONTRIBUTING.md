# Contributing

Clone recursively so `vendor/hoshidicts` is present. The supported toolchain is Node 24, Python 3, CMake 3.22+, a C++23 compiler, FFmpeg development libraries/executable, libcurl, and the dependency-build prerequisites listed in the native workflow.

```sh
git submodule update --init --recursive
npm ci
bash scripts/build_native_geometry_dependencies.sh
npm run build
```

`npm run build` regenerates `scripts/iinatan.js` and builds `build/native/release/iinatan-backend`. Do not hand-edit the generated bundle. JavaScript must stay MuJS/ES5-compatible after Babel. Native dependencies and checksums are pinned in `native-dependencies.lock.json`.

Before any change, inspect `git status --short --branch` and preserve unrelated work. Keep shared language/normalization logic independent of mpv, and keep dictionary documents independent of ASS and Anki renderers. Visual fixes should stay in the document/layout layer unless lookup correctness actually requires a pipeline change. Preserve all six languages and scope Wiktionary/Kaikki special cases to their source dictionaries.

Format and validate with:

```sh
npm run format:js
node scripts/build_mpv.js
node scripts/build_mpv.js --check
npm test
node tests/mpv_041_runtime.test.js
```

Native tests expect `build/native/release/iinatan-backend`; some also require `ffmpeg` and mpv 0.41+ on `PATH`. Use focused groups with `npm run test:group -- mpv-ui`, `native`, or another group listed by `node scripts/run_tests.js --list`.

For release work, create the local target archive and execute its validator:

```sh
python3 scripts/package_mpv.py
python3 scripts/validate_mpv_release.py dist/iinatan-3.0.0-<target>.tar.gz --target <target> --execute
```

Windows produces a ZIP. The five-platform GitHub workflow builds on each target, runs version/import/lookup/layout/HTTP/audio/config/worker gates, performs a clean installer test, uploads the artifact, and validates the complete set on release tags. Linux is based on glibc 2.35; macOS targets deployment version 11; Windows uses MSVC 2022 with the static CRT. A target compile without executing its backend is not an acceptable release gate.

Release archives must include matching executables, config files, Noto OFL assets, all notices, checksums, `BUILD-INFO.json`, changelog/docs, and corresponding source. `scripts/validate_mpv_release.py` must reject missing, unsafe, checksum-mismatched, stale-version, wrong-target, incompatible, or unexpectedly dynamic artifacts. Release notes are extracted from the matching `CHANGELOG.md` version and missing sections fail.

Use explicit staging paths and focused commits. Generated `scripts/iinatan.js` belongs in the same commit as its source. Never commit binaries from `build`, `bin`, or `dist`; release automation creates them. Do not push unless explicitly requested.
