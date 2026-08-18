# Theme migration

Version 3 does not execute arbitrary popup CSS because the interface is rendered as ASS, not HTML. Legacy CSS is retained verbatim as inert migration data at `migration.archivedCustomCss` so it can be recovered manually, but it is never parsed or interpreted.

Use the Settings theme preset and validated `background`, `foreground`, `accent`, `muted`, and `border` hexadecimal tokens in `config.json`. Invalid tokens are rejected during normalization and config commit.
