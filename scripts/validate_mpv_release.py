#!/usr/bin/env python3
"""Validate an iinatan release archive without trusting its file names."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]

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


def detect_target() -> str:
    operating_system = {
        "Darwin": "macos",
        "Linux": "linux",
        "Windows": "windows",
    }.get(platform.system())
    machine = platform.machine().lower()
    architecture = (
        "aarch64"
        if machine in ("arm64", "aarch64")
        else "x86_64"
        if machine in ("x86_64", "amd64")
        else None
    )
    if not operating_system or not architecture:
        raise SystemExit("cannot infer release target")
    return f"{operating_system}-{architecture}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path, nargs="?")
    parser.add_argument("--target", choices=sorted(TARGETS))
    parser.add_argument("--execute", action="store_true")
    options = parser.parse_args()
    options.target = options.target or detect_target()
    if options.archive is None:
        extension = ".zip" if options.target.startswith("windows-") else ".tar.gz"
        options.archive = ROOT / "dist" / f"iinatan-{VERSION}-{options.target}{extension}"
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
                archive.extractall(temporary_path)
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
        if info.get("wrapperVersion") != VERSION:
            raise SystemExit("release wrapper version is stale")
        required = [
            "scripts/iinatan.js",
            "fonts/NotoSansCJKjp-Regular.otf",
            "config/config.example.json",
            "config/config.schema.json",
            "licenses/LICENSE",
            "licenses/THIRD_PARTY_NOTICES.md",
            "licenses/OFL.txt",
            "source/iinatan-native-source.tar.gz",
            "docs/README.md",
            "docs/ARCHITECTURE.md",
            "docs/CHANGELOG.md",
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
            if not any("vendor/hoshidicts/" in name for name in source_names):
                raise SystemExit("corresponding HoshiDicts source is missing")
            if not any(name.endswith("upstream/ffmpeg-7.0.1.tar.xz") for name in source_names):
                raise SystemExit("corresponding FFmpeg source is missing")
            if not any(name.endswith("upstream/0.11.22.tar.gz") for name in source_names):
                raise SystemExit("corresponding miniaudio source is missing")
        if options.execute:
            backend_name = "iinatan-backend.exe" if options.target.startswith("windows-") else "iinatan-backend"
            output = subprocess.check_output([str(root / "bin" / backend_name), "version"], text=True)
            if json.loads(output.splitlines()[-1]).get("target") != options.target:
                raise SystemExit("packaged backend did not execute as its declared target")
        print(f"validated {options.archive} ({options.target})")


if __name__ == "__main__":
    main()
