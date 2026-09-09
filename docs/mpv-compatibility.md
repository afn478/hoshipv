# Stock mpv compatibility contract

This project attaches to the user’s existing mpv process. It does not replace
the executable, embed libmpv, or require a second player installation.

## Validated build

The current native evidence was collected against:

- mpv `0.41.0` from `/opt/homebrew/bin/mpv`;
- macOS arm64 on Apple M4;
- JSON IPC enabled with `--input-ipc-server`;
- `mpv/iinatan.lua` loaded as a normal mpv script;
- the optional macOS content shim loaded as a normal C plugin.

This is a validated build record, not a promise that every later or vendor-
patched mpv build behaves identically. Other builds remain compatible only to
the extent that they preserve the documented Lua/JSON-IPC properties used by
the session script and bridge.

## Capability levels

| mpv capability                                                                   | Result                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Lua scripts, `--input-ipc-server`, and the session properties used by the bridge | Required for ordinary session discovery and IPC attachment                                               |
| `sub-text/ass-full`, renderer dimensions, and selected-track properties          | Used when available; missing properties reduce subtitle evidence and never become guessed exact geometry |
| C-plugin loading for the selected build                                          | Required for the optional macOS AppKit content sidecar                                                   |

The C-plugin loader is not assumed merely because mpv starts. When a shim is
requested, the native smoke requires the shim to publish a PID/window-matched
sidecar within its bounded startup window. If it does not, the shim path fails
with a diagnostic; the external window probe can still report a frame, but the
host keeps that result content-inexact and does not silently promote it to
exact lookup geometry. `mpv --version` does not consistently print a portable
feature flag for this capability, so successful in-process loading is the
authoritative check.

Inspect a local build with:

```sh
mpv --version
```

The exact-content boundary remains fail-closed, but a macOS session can load the
bundled shim automatically when it is installed beside the session script or in
one of the standard per-user mpv script locations. The search covers the
session-script directory, its adjacent `bin/` and `build/native/` directories,
`~/.config/mpv/scripts`, and
`~/Library/Application Support/mpv/scripts`. An explicit
`iinatan-native-shim` script option or `IINATAN_NATIVE_SHIM` environment value
still takes precedence. If no candidate exists, the session continues without
the shim and the host keeps window-frame geometry content-inexact.

An explicit exact-content setup remains available:

```sh
IINATAN_NATIVE_SHIM=/absolute/path/to/iinatan-mpv-window-shim.so \
mpv \
  --script=/absolute/path/to/mpv/iinatan.lua \
  --input-ipc-server=/tmp/iinatan-mpv.sock
```

The session script can also load the shim through its
`iinatan-native-shim` script option or `IINATAN_NATIVE_SHIM` environment
variable. Do not pass both mechanisms for the same process.

The stock-mpv regression for automatic discovery is:

```sh
IINATAN_NATIVE_WINDOW=1 \
IINATAN_NATIVE_SHIM_AUTO_REQUIRED=1 \
npm run test:mpv:window
```

On the validated macOS arm64 host this passed on 2026-09-08 against stock mpv
`0.41.0`, reporting AppKit content bounds `480x270`,
`contentSource:"appkit-content-view"`, and `contentExact:true` without an
explicit shim path. This proves the content sidecar was loaded through the
ordinary session script; it does not close the separate stock-mpv subtitle
glyph-equivalence question.

## Direct mpv bootstrap

The bundled session script can be loaded directly by an otherwise ordinary mpv
launch on macOS, Windows, or Linux:

```sh
mpv --script=/absolute/path/to/iinatan.lua /absolute/path/to/video.mkv
```

When neither a session directory nor an IPC endpoint is supplied, the script
creates a descriptor under `~~home/iinatan/cache/sessions`, assigns a private
platform-appropriate IPC endpoint, and starts the companion from the exact
filename beside the `scripts` directory. The Windows preview bundle is
assembled with `npm run package:plugin:windows` and contains exactly
`iinatan.lua` plus `iinatan-companion.exe`; copy the Lua file into
`%APPDATA%\mpv\scripts` and the executable into `%APPDATA%\mpv`. The Linux
bundle uses the same layout with `iinatan-companion`. This does not edit
`mpv.conf` or `input.conf`. Set
`IINATAN_AUTO_START_COMPANION=0` or
`--script-opts=iinatan-auto-start=no` to disable the bootstrap. An
alternate install location can use an absolute `IINATAN_COMPANION_APP` or the
`companion-app` value in `script-opts/iinatan.conf`.

The companion data layout is:

```text
mpv/
├── iinatan-companion[.exe]
├── scripts/iinatan.lua
├── script-opts/iinatan.conf    (optional bootstrap overrides)
└── iinatan/
    ├── config.json
    ├── dictionaries/
    ├── backups/
    ├── cache/
    └── logs/
```

The `iinatan/` directories are created on first use. `config.json` is the
authoritative settings file, dictionaries remain outside disposable cache, and
cache/log files are bounded. Migration from the previous settings and
dictionary locations preserves the originals and writes a conflict report in
`backups/`. The bootstrap file is optional and does not duplicate application
settings. With `--no-config`, pass absolute
`--script-opts=iinatan-data-root=/absolute/path/to/iinatan` and
`--script-opts=iinatan-companion=/absolute/path/to/iinatan-companion` values;
the script fails clearly if either required path is unavailable.

To make this happen for every normal mpv launch, place the session script in
mpv's per-user script directory:

```text
Windows: %APPDATA%\mpv\scripts\iinatan.lua
         %APPDATA%\mpv\iinatan-companion.exe
Linux:   ~/.config/mpv/scripts/iinatan.lua
         ~/.config/mpv/iinatan-companion
macOS:   ~/Library/Application Support/mpv/scripts/iinatan.lua
```

mpv loads scripts from that directory automatically unless it is started with
`--load-scripts=no`. The script only publishes session identity and IPC; it
does not render subtitles or replace mpv's player surface. The automatic
Windows launch path has been exercised against the two-file plugin bundle, and
the Linux assembly uses the same two-file contract. The companion executable
is passed absolute paths for its executable, mpv root, data root, and session
directory.
The packaged macOS companion also selects the bounded native geometry helper
by default when its validated player tuple and the AppKit content shim are
available; unsupported tuples or modes remain fail-closed.

### Open settings from a drop-in installation

The Windows drop-in companion normally has no main application window. Open
the settings window with the same executable and the explicit mpv-root paths:

```powershell
$mpvRoot = Join-Path $env:APPDATA "mpv"
$companion = Join-Path $mpvRoot "iinatan-companion.exe"
& $companion `
  "--settings" `
  "--iinatan-companion-executable=$companion" `
  "--iinatan-mpv-root=$mpvRoot" `
  "--iinatan-data-root=$(Join-Path $mpvRoot 'iinatan')"
```

If the companion is already running from mpv, this sends an atomic disposable
command to that existing process and opens its settings window; it does not
start a second companion. If it is not running, the command starts one using
the same data root. `Ctrl+,` also opens Settings whenever an iinatan window
currently has focus. Settings writes the authoritative `iinatan/config.json`.

## Application bootstrap

The application menu's `Open media in mpv…` command is a convenience bootstrap
for the same ordinary-player contract. It uses the native file picker and
starts the configured `mpv` executable without a shell. The only additional
launch arguments are the bundled `iinatan.lua` script and a unique
`--input-ipc-server` endpoint; the session directory and optional macOS content
shim are passed through environment variables. It does not write `mpv.conf`,
`input.conf`, the user's script directory, or any unrelated plugin state.

The command can use `IINATAN_MPV` or `--mpv-executable=/absolute/path` when the
player is not on `PATH`. The endpoint is a filesystem Unix socket on macOS and
Linux and a named pipe on Windows. mpv documents both the launch-time
`--script` option and the platform-specific behavior of
`--input-ipc-server` in its [options manual](https://mpv.io/manual/stable/#options-input-ipc-server).
The companion does not terminate a launched player when its own process exits.

Windows has validated native window/input and packaged stock-mpv acceptance
for the documented compatibility profiles. Linux currently has source-level
window probes and portable helpers but no authoritative native desktop
acceptance run in this repository. Linux Wayland remains a separate compositor
capability gate.
