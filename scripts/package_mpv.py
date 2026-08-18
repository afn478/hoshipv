#!/usr/bin/env python3
"""Build and validate a platform-specific iinatan mpv archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import stat
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "macos-aarch64",
    "macos-x86_64",
    "linux-x86_64",
    "linux-aarch64",
    "windows-x86_64",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(*arguments: str) -> str:
    return subprocess.check_output(arguments, text=True, stderr=subprocess.STDOUT)


def executable_name(name: str, target: str) -> str:
    return name + (".exe" if target.startswith("windows-") else "")


def validate_backend(path: Path, target: str) -> dict:
    if not path.is_file():
        raise SystemExit(f"missing backend: {path}")
    try:
        data = json.loads(run(str(path), "version").splitlines()[-1])
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        raise SystemExit(f"backend did not execute: {error}") from error
    required = ("lookupProtocol", "geometryProtocol", "textLayoutProtocol", "target")
    if not data.get("ok") or any(key not in data for key in required):
        raise SystemExit("backend version output is incomplete")
    if data["target"] != target:
        raise SystemExit(f"backend target {data['target']} does not match {target}")
    for capability in ("assGeometry", "textLayout", "http", "audioPreview"):
        if not data.get(capability, {}).get("available"):
            raise SystemExit(f"backend lacks required {capability} capability")
    return data


def validate_ffmpeg(path: Path) -> None:
    if not path.is_file():
        raise SystemExit(f"missing ffmpeg: {path}")
    try:
        output = run(str(path), "-version")
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"ffmpeg did not execute: {error}") from error
    if not output.startswith("ffmpeg version"):
        raise SystemExit("unexpected ffmpeg version output")


def validate_dynamic(path: Path, target: str, allow_dynamic: bool) -> None:
    if allow_dynamic or target.startswith("windows-"):
        return
    if target.startswith("macos-"):
        output = run("otool", "-L", str(path))
        forbidden = [line for line in output.splitlines()[1:] if "/opt/homebrew/" in line or "/usr/local/" in line]
    else:
        output = run("ldd", str(path))
        allowed = ("linux-vdso", "libc.so", "libm.so", "libpthread.so", "libdl.so", "ld-linux", "libgcc_s.so")
        forbidden = [line for line in output.splitlines() if not any(name in line for name in allowed)]
    if forbidden:
        raise SystemExit(f"unexpected dynamic dependencies for {path.name}: " + "; ".join(forbidden))


def corresponding_source(destination: Path) -> None:
    members = [
        "CMakeLists.txt",
        "CMakePresets.json",
        "native-dependencies.lock.json",
        "scripts/build_native_geometry_dependencies.sh",
        "src/native",
        "vendor/HoshiDicts",
        ".gitmodules",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
    ]
    with tarfile.open(destination, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for relative in members:
            source = ROOT / relative
            if source.exists():
                archive.add(source, arcname=f"iinatan-native-source/{relative}")


def write_checksums(root: Path) -> None:
    files = sorted(path for path in root.rglob("*") if path.is_file() and path.name != "SHA256SUMS")
    (root / "SHA256SUMS").write_text(
        "".join(f"{sha256(path)}  {path.relative_to(root).as_posix()}\n" for path in files),
        encoding="utf-8",
    )


def validate_layout(root: Path, target: str) -> None:
    backend = root / "bin" / executable_name("iinatan-backend", target)
    ffmpeg = root / "bin" / executable_name("ffmpeg", target)
    required = [
        root / "scripts/iinatan.js",
        backend,
        ffmpeg,
        root / "fonts/NotoSansCJKjp-Regular.otf",
        root / "config/config.example.json",
        root / "config/config.schema.json",
        root / "licenses/LICENSE",
        root / "licenses/THIRD_PARTY_NOTICES.md",
        root / "licenses/OFL.txt",
        root / "source/iinatan-native-source.tar.gz",
        root / "SHA256SUMS",
    ]
    missing = [str(path.relative_to(root)) for path in required if not path.is_file()]
    if target.startswith("windows-"):
        if not (root / "install.ps1").is_file():
            missing.append("install.ps1")
    elif not (root / "install.sh").is_file():
        missing.append("install.sh")
    if missing:
        raise SystemExit("package is missing: " + ", ".join(missing))
    expected = {}
    for line in (root / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, relative = line.split("  ", 1)
        expected[relative] = digest
    for relative, digest in expected.items():
        if sha256(root / relative) != digest:
            raise SystemExit(f"checksum mismatch: {relative}")


def detect_target() -> str:
    os_name = {"Darwin": "macos", "Linux": "linux", "Windows": "windows"}.get(platform.system())
    machine = platform.machine().lower()
    architecture = "aarch64" if machine in ("arm64", "aarch64") else "x86_64" if machine in ("x86_64", "amd64") else None
    if not os_name or not architecture:
        raise SystemExit("cannot infer release target")
    return f"{os_name}-{architecture}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=sorted(TARGETS), default=detect_target())
    parser.add_argument("--backend", type=Path, default=ROOT / "build/native/release/iinatan-backend")
    parser.add_argument("--ffmpeg", type=Path, default=Path(shutil.which("ffmpeg") or "ffmpeg"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate-directory", type=Path)
    parser.add_argument("--allow-dynamic", action="store_true")
    options = parser.parse_args()
    if options.validate_directory:
        validate_layout(options.validate_directory.resolve(), options.target)
        print(f"validated {options.validate_directory}")
        return
    backend_info = validate_backend(options.backend.resolve(), options.target)
    validate_ffmpeg(options.ffmpeg.resolve())
    validate_dynamic(options.backend.resolve(), options.target, options.allow_dynamic)
    destination = options.output or ROOT / "dist" / (
        f"iinatan-3.0.0-{options.target}.zip" if options.target.startswith("windows-") else f"iinatan-3.0.0-{options.target}.tar.gz"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="iinatan-package-") as temporary:
        package = Path(temporary) / f"iinatan-3.0.0-{options.target}"
        for directory in ("scripts", "bin", "fonts", "config", "licenses", "source"):
            (package / directory).mkdir(parents=True)
        shutil.copy2(ROOT / "scripts/iinatan.js", package / "scripts/iinatan.js")
        shutil.copy2(options.backend, package / "bin" / executable_name("iinatan-backend", options.target))
        shutil.copy2(options.ffmpeg, package / "bin" / executable_name("ffmpeg", options.target))
        shutil.copy2(ROOT / "assets/fonts/NotoSansCJKjp-Regular.otf", package / "fonts")
        shutil.copy2(ROOT / "config/config.example.json", package / "config")
        shutil.copy2(ROOT / "config/config.schema.json", package / "config")
        shutil.copy2(ROOT / "LICENSE", package / "licenses")
        shutil.copy2(ROOT / "THIRD_PARTY_NOTICES.md", package / "licenses")
        shutil.copy2(ROOT / "assets/fonts/OFL.txt", package / "licenses")
        installer = ROOT / ("install.ps1" if options.target.startswith("windows-") else "install.sh")
        shutil.copy2(installer, package / installer.name)
        corresponding_source(package / "source/iinatan-native-source.tar.gz")
        (package / "BUILD-INFO.json").write_text(json.dumps(backend_info, indent=2) + "\n", encoding="utf-8")
        write_checksums(package)
        validate_layout(package, options.target)
        if options.target.startswith("windows-"):
            with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for path in package.rglob("*"):
                    if path.is_file():
                        archive.write(path, Path(package.name) / path.relative_to(package))
        else:
            with tarfile.open(destination, "w:gz", format=tarfile.PAX_FORMAT) as archive:
                archive.add(package, arcname=package.name)
    print(f"created {destination}")


if __name__ == "__main__":
    main()
