# iinatan

iinatan is a native popup dictionary for mpv 0.41+. It turns visible text and ASS subtitles into selectable lookup targets and renders compact, structured dictionary results directly in mpv's ASS OSD. It supports Japanese, English, German, French, Korean, and Chinese Yomitan dictionaries through HoshiDicts.

The application has no browser, HTML, local socket, or companion GUI. Its controller and complete interface run in mpv's JavaScript runtime; one portable native backend owns dictionary work, text shaping, safe file operations, HTTP, and audio preview. Apple Vision OCR is available on macOS. Linux and Windows report bitmap OCR as unavailable while retaining full text/ASS lookup.

## Install

Download the archive matching the computer:

- `macos-aarch64` for Apple Silicon
- `macos-x86_64` for Intel Macs
- `linux-x86_64`
- `linux-aarch64`
- `windows-x86_64`

Extract it, then run `./install.sh` on macOS/Linux or `./install.ps1` in PowerShell on Windows. Existing `config.json` files are never replaced.

Manual installation uses this layout under mpv's config directory (`~/.config/mpv` on macOS/Linux, `%APPDATA%\mpv` on Windows):

```text
scripts/iinatan.js
scripts/iinatan/bin/iinatan-backend[.exe]
scripts/iinatan/bin/ffmpeg[.exe]
scripts/iinatan/fonts/NotoSansCJKjp-Regular.otf
iinatan/config.json
```

The release supports macOS 11+, Linux with glibc 2.35+, and 64-bit Windows. mpv 0.41 or newer is required.

If mpv is started with `--no-config`, pass absolute bootstrap paths with `--script` and `--script-opts=iinatan-config=/absolute/config.json`; relative or unavailable config paths are rejected with an actionable OSD error.

## First use

1. Start a video in mpv and press `Ctrl+d` to open Settings.
2. Import an absolute Yomitan dictionary ZIP path, or choose the recommended Jitendex download.
3. Select a profile and lookup language, then enable and order its dictionaries.
4. Pause over a subtitle and move the pointer over the desired word. Shift-hover is available as a profile mode.

`Ctrl+Shift+d` toggles lookup. Escape closes the deepest nested popup, then the root popup, then Settings. Click, wheel, selection dragging, expandable sections, source links, audio, and Anki actions are handled inside the OSD. iinatan installs forced mouse bindings only while the pointer is over one of its interactive regions, leaving mpv and its OSC untouched elsewhere.

mpv continues to render the subtitle itself. iinatan shapes the same visible text into an invisible per-grapheme hit map in OSD coordinates; it does not replace or cover the subtitle. When the pointer enters a mapped grapheme, iinatan looks up that UTF-16 text position and renders the resulting popup through a separate ASS OSD overlay. No iinatan overlay is visible before a successful lookup unless Settings is open.

Available script messages are:

```text
script-message iinatan-settings
script-message iinatan-import /absolute/dictionary.zip
script-message iinatan-lookup "text" 0
script-message iinatan-add-anyway
script-message iinatan-open-last-note
```

## Settings and files

`~~home/iinatan/config.json` is authoritative and conforms to `config/config.schema.json`. Settings supports profile create/rename/delete/switch, lookup language, dictionary import/order/enable/remove, recommended downloads, subtitle and pause behavior, popup scale/theme, audio sources, Anki deck/model/preset, validation, reload, backup restore, and display of the advanced JSON path.

Mutable dictionaries and worker state live under `~~state/iinatan`; downloads and temporary files live under `~~cache/iinatan`. Config writes are staged, validated, atomically committed, read back, and backed up. Corrupt inputs are preserved with a timestamp. Version-1 settings are migrated non-destructively; custom CSS is archived under `migration.archivedCustomCss` and is never parsed or executed. Appearance is controlled only by validated theme tokens.

## Dictionaries, audio, and Anki

Dictionary order is profile-specific. Every result retains its full entry headword, source order, readings, tags, frequency, pitch, structured examples/notes/tables, sanitized attribution links, and dictionary-scoped Wiktionary cleanup. Long sections scroll or collapse; nested lookup and selected glossary text remain available.

Word audio is resolved with bounded HTTPS requests and previewed by the included backend using FFmpeg decoding and miniaudio output, including while mpv is paused. A new preview cancels the previous one. Sentence audio prefers mpv's cache dump and falls back to the selected audio source, with bounded MP3/Opus encoding and content-addressed media names.

For Anki, install AnkiConnect, keep Anki open, then configure the active profile. iinatan supports discovery, field templates, structured glossary HTML, deck/collection duplicate scopes, prevent/allow/add-anyway behavior, note opening, screenshots, sentence audio, and selected word audio.

## Troubleshooting

- Run `iinatan-backend version` from the installed `scripts/iinatan/bin` directory to inspect target, dependency versions, and capabilities.
- Check `~~state/iinatan/iinatan.log` when a lookup or import fails.
- Confirm the active profile's language and dictionary enablement if there are no results.
- On Linux/Windows, bitmap OCR being unavailable is expected. Text and ASS subtitles still work.
- Use Settings → Validate or Restore backup for configuration errors.

Development and release instructions are in [CONTRIBUTING.md](CONTRIBUTING.md); subsystem boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md).

## License and acknowledgements

iinatan is GPL-3.0-only. Release archives include licenses, checksums, and corresponding native source. HoshiDicts provides the dictionary engine; Yomitan, Yomipv, Chimahon, Hoshi Reader, and Rougo informed the reading experience.
