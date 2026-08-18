#!/usr/bin/env python3
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
tag = sys.argv[2]
if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
    raise SystemExit("release tag must be vMAJOR.MINOR.PATCH")
version = tag[1:]
expected = {
    f"iinatan-{version}-macos-aarch64.tar.gz",
    f"iinatan-{version}-macos-x86_64.tar.gz",
    f"iinatan-{version}-linux-x86_64.tar.gz",
    f"iinatan-{version}-linux-aarch64.tar.gz",
    f"iinatan-{version}-windows-x86_64.zip",
}
present = {path.name for path in root.iterdir() if path.is_file()}
missing = expected - present
if missing:
    raise SystemExit("release set is incomplete: " + ", ".join(sorted(missing)))
print("complete five-platform release set")
