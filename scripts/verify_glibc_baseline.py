#!/usr/bin/env python3
import re
import subprocess
import sys

binary, maximum = sys.argv[1:]
maximum_tuple = tuple(map(int, maximum.split(".")))
output = subprocess.check_output(["readelf", "--version-info", binary], text=True)
versions = {
    tuple(map(int, match.split(".")))
    for match in re.findall(r"GLIBC_(\d+\.\d+)", output)
}
if versions and max(versions) > maximum_tuple:
    raise SystemExit(f"{binary} needs GLIBC_{'.'.join(map(str, max(versions)))} > {maximum}")
print(f"glibc baseline ok: highest GLIBC_{'.'.join(map(str, max(versions, default=(0, 0))))}")
