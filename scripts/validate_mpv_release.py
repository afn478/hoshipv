#!/usr/bin/env python3
"""Validate an iinatan release archive without trusting its file names."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

TARGETS = {
    "macos-aarch64",
    "macos-x86_64",
    "linux-x86_64",
    "linux-aarch64",
    "windows-x86_64",
}


def safe_members(names: list[str]) -> None:
    for name in names:
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name:
            raise SystemExit(f"unsafe archive member: {name}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--target", required=True, choices=sorted(TARGETS))
    parser.add_argument("--execute", action="store_true")
    options = parser.parse_args()
    if not options.archive.is_file():
        raise SystemExit(f"missing release archive: {options.archive}")
    with tempfile.TemporaryDirectory(prefix="iinatan-validate-") as temporary:
        temporary_path = Path(temporary)
        if options.archive.suffix == ".zip":
            with zipfile.ZipFile(options.archive) as archive:
                safe_members(archive.namelist())
                archive.extractall(temporary_path)
        else:
            with tarfile.open(options.archive, "r:gz") as archive:
                safe_members(archive.getnames())
                archive.extractall(temporary_path, filter="data")
        roots = [item for item in temporary_path.iterdir() if item.is_dir()]
        if len(roots) != 1:
            raise SystemExit("release must contain exactly one top-level directory")
        root = roots[0]
        checksums = root / "SHA256SUMS"
        if not checksums.is_file():
            raise SystemExit("release is missing SHA256SUMS")
        for line in checksums.read_text(encoding="utf-8").splitlines():
            digest, relative = line.split("  ", 1)
            path = root / relative
            if not path.is_file() or sha256(path) != digest:
                raise SystemExit(f"release checksum failed: {relative}")
        info = json.loads((root / "BUILD-INFO.json").read_text(encoding="utf-8"))
        if info.get("target") != options.target:
            raise SystemExit("release target metadata does not match its target")
        required = [
            "scripts/iinatan.js",
            "fonts/NotoSansCJKjp-Regular.otf",
            "config/config.example.json",
            "config/config.schema.json",
            "licenses/LICENSE",
            "licenses/THIRD_PARTY_NOTICES.md",
            "licenses/OFL.txt",
            "source/iinatan-native-source.tar.gz",
        ]
        required.extend(
            ["bin/iinatan-backend.exe", "bin/ffmpeg.exe", "install.ps1"]
            if options.target.startswith("windows-")
            else ["bin/iinatan-backend", "bin/ffmpeg", "install.sh"]
        )
        missing = [relative for relative in required if not (root / relative).is_file()]
        if missing:
            raise SystemExit("release is incomplete: " + ", ".join(missing))
        with tarfile.open(root / "source/iinatan-native-source.tar.gz", "r:gz") as source:
            source_names = source.getnames()
            if not any(name.endswith("CMakeLists.txt") for name in source_names):
                raise SystemExit("corresponding source lacks CMakeLists.txt")
            if not any("src/native/" in name for name in source_names):
                raise SystemExit("corresponding native source is missing")
        if options.execute:
            backend_name = "iinatan-backend.exe" if options.target.startswith("windows-") else "iinatan-backend"
            output = subprocess.check_output([str(root / "bin" / backend_name), "version"], text=True)
            if json.loads(output.splitlines()[-1]).get("target") != options.target:
                raise SystemExit("packaged backend did not execute as its declared target")
        print(f"validated {options.archive} ({options.target})")


if __name__ == "__main__":
    main()
