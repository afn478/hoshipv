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

The exact-content setup is opt-in:

```sh
IINATAN_NATIVE_SHIM=/absolute/path/to/iinatan-mpv-window-shim.so \
mpv \
  --script=/absolute/path/to/mpv/iinatan-session.lua \
  --input-ipc-server=/tmp/iinatan-mpv.sock
```

The session script can also load the shim through its
`iinatan-native-shim` script option or `IINATAN_NATIVE_SHIM` environment
variable. Do not pass both mechanisms for the same process.

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
