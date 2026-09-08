# Stock mpv compatibility contract

This project attaches to the user’s existing mpv process. It does not replace
the executable, embed libmpv, or require a second player installation.

## Validated build

The current native evidence was collected against:

- mpv `0.41.0` from `/opt/homebrew/bin/mpv`;
- macOS arm64 on Apple M4;
- JSON IPC enabled with `--input-ipc-server`;
- `mpv/iinatan-session.lua` loaded as a normal mpv script;
- the optional macOS content shim loaded as a normal C plugin.

This is a validated build record, not a promise that every later or vendor-
patched mpv build behaves identically. Other builds remain compatible only to
the extent that they preserve the documented Lua/JSON-IPC properties used by
the session script and bridge.

## Capability levels

| mpv capability | Result |
| --- | --- |
| Lua scripts, `--input-ipc-server`, and the session properties used by the bridge | Required for ordinary session discovery and IPC attachment |
| `sub-text/ass-full`, renderer dimensions, and selected-track properties | Used when available; missing properties reduce subtitle evidence and never become guessed exact geometry |
| C-plugin loading for the selected build | Required for the optional macOS AppKit content sidecar |

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
  --script=/absolute/path/to/mpv/iinatan-session.lua \
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

The bundled session script can be loaded directly by an otherwise ordinary
macOS mpv launch:

```sh
mpv --script=/absolute/path/to/iinatan-session.lua /absolute/path/to/video.mkv
```

When neither a session directory nor an IPC endpoint is supplied, the script
creates a per-user descriptor directory under
`~/Library/Application Support/iinatan for mpv/sessions`, assigns a private
Unix socket for that process, and starts the installed `iinatan for mpv`
menu-bar companion with `open -g -a`. This does not edit `mpv.conf`,
`input.conf`, or the user's mpv script directory. Set
`IINATAN_AUTO_START_COMPANION=0` (or the equivalent script option) to keep a
direct launch from starting the companion. This macOS auto-start path is
implemented and its acceptance smoke requires the fresh companion to report
the exact mpv session identity after LaunchServices starts it; Linux and
Windows retain the same descriptor/IPC defaults but
do not yet claim an equivalent application-launch integration.
The packaged macOS companion also selects the bounded native geometry helper
by default when its validated player tuple and the AppKit content shim are
available; unsupported tuples or modes remain fail-closed.

## Application bootstrap

The application menu's `Open media in mpv…` command is a convenience bootstrap
for the same ordinary-player contract. It uses the native file picker and
starts the configured `mpv` executable without a shell. The only additional
launch arguments are the bundled `iinatan-session.lua` script and a unique
`--input-ipc-server` endpoint; the session directory and optional macOS content
shim are passed through environment variables. It does not write `mpv.conf`,
`input.conf`, the user's script directory, or any unrelated plugin state.

The command can use `IINATAN_MPV` or `--mpv-executable=/absolute/path` when the
player is not on `PATH`. The endpoint is a filesystem Unix socket on macOS and
Linux and a named pipe on Windows. mpv documents both the launch-time
`--script` option and the platform-specific behavior of
`--input-ipc-server` in its [options manual](https://mpv.io/manual/stable/#options-input-ipc-server).
The companion does not terminate a launched player when its own process exits.

Windows and Linux currently have source-level window probes but no equivalent
validated exact-content shim or native desktop acceptance run in this
repository. Linux Wayland remains a separate compositor capability gate.
