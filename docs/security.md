# Security model

The browser loads only packaged local content through the `iinatan:` protocol.
Document content has no Node integration, context isolation is enabled, the
renderer is sandboxed, web security remains explicitly enabled, navigation and
redirects and new windows are denied, and the document has a restrictive
content-security policy. The release validator checks these invariants and
rejects remote-debugging switches and web-security bypasses in the shipped
Electron boundary.

The preload exposes only `send(type, payload)` for an allowlist of typed
messages plus event subscription. The main process validates the protocol,
session context, request ids, player commands, and external URLs. Dictionary
results are converted to bounded, allowlisted text/element nodes; Hoshi/Yomitan
structured content is rebuilt with safe tags, styles, data attributes, HTTPS
links, and data images rather than inserted as raw HTML. Custom CSS preserves
selector-based styles (including the reference `#popup` selector) but rejects
`@import`, `url()`, script-like expressions, binding rules, and behavior rules.
This supports local customization without granting arbitrary file/network/script
access.

Dictionary-source classification is a small allowlisted enum used only to
choose Etymology collapse behavior. It is derived from bounded dictionary names
and content markers; it never exposes the raw source payload to the renderer.

The settings window is also a normal sandboxed BrowserWindow. Its preload
exposes only named settings requests (`get-state`, profile updates, dictionary
operations, and Anki inspection); renderer input never supplies a subprocess
command, filesystem path, or note body. Dictionary import obtains the archive
path from a native open-file dialog in the main process, then applies the
catalog's archive and managed-root checks.

Dictionary ZIP import and backup restore use a host path validator with archive
entry limits, traversal checks, encryption/duplicate/special-entry rejection,
invalid-offset checks, and an uncompressed-size budget; the configured HoshiDicts
importer remains responsible for the actual extraction transaction. Remote audio and
source links use an explicit HTTPS/loopback policy, disabled redirects,
response-size bounds, and timeouts. Streaming responses are bounded while
they are read; legacy response shims without a declared length are rejected
before an unbounded text read. AnkiConnect is optional and remains local-
policy controlled (HTTPS is also accepted for explicitly configured remote
deployments), with the same bounded-response rule and no unbounded JSON-only
compatibility path.

Recommended dictionary downloads are a separate host-only path: the catalog
contains fixed HTTPS metadata, redirects are limited and must remain HTTPS,
archives stream to owner-only temporary files, ZIP limits are checked before
the HoshiDicts importer runs, and updates are staged before replacing a managed
dictionary directory. The renderer cannot supply a download URL or destination.

The local mpv JSON-IPC reader also caps each newline-delimited response at 8 MiB
and closes the session on an oversized or unterminated message, preventing a
malformed endpoint from growing an unbounded host buffer.

Settings, session descriptors, and Hoshi worker state/response files are read
through bounded owner-side file helpers; oversized or non-regular files are
rejected before JSON parsing.

The optional native subtitle geometry helper is an explicitly configured
executable invoked with `execFile`, never a shell. Requests are written to an
owner-only temporary directory with owner-only files and removed after each
response. The helper receives only the validated geometry request; it is not a
renderer-facing arbitrary command bridge.

Optional Anki sentence-audio capture follows the same boundary: the current
mpv media source, subtitle time window, format, and bitrate are converted into
an argument vector for a configured ffmpeg executable. Shell interpretation is
never used; the window is capped at 35 seconds, output is capped at 8 MiB, and
the temporary output is removed after it is stored or rejected.

The optional macOS mpv content shim writes its PID-scoped geometry sidecar with
an owner-only temporary file, `fsync`, and atomic rename. The host bounds the
read to 64 KiB, requires protocol 1, a positive numeric PID, a concrete native
window id, `contentSource: appkit-content-view`, and matching session identity
before treating the content rectangle as exact. The sidecar contains scalar
geometry only; it is not a browser or command input channel.

Do not enable remote debugging, disable web security, request broad desktop
permissions speculatively, or expose arbitrary IPC/child-process commands to a
renderer.
