#!/bin/sh
set -eu

archive_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "${XDG_CONFIG_HOME:-}" ]; then
  mpv_home="$XDG_CONFIG_HOME/mpv"
elif [ "$(uname -s)" = "Darwin" ]; then
  mpv_home="$HOME/.config/mpv"
else
  mpv_home="$HOME/.config/mpv"
fi
install_root="$mpv_home/scripts/iinatan"
mkdir -p "$install_root/bin" "$install_root/fonts" "$mpv_home/iinatan"
cp "$archive_root/scripts/iinatan.js" "$install_root/iinatan.js"
cp "$archive_root/bin/iinatan-backend" "$install_root/bin/iinatan-backend"
cp "$archive_root/bin/ffmpeg" "$install_root/bin/ffmpeg"
cp "$archive_root/fonts/NotoSansCJKjp-Regular.otf" "$install_root/fonts/NotoSansCJKjp-Regular.otf"
chmod 755 "$install_root/bin/iinatan-backend" "$install_root/bin/ffmpeg"
if [ ! -e "$mpv_home/iinatan/config.json" ]; then
  cp "$archive_root/config/config.example.json" "$mpv_home/iinatan/config.json"
fi
printf 'Installed iinatan in %s\n' "$install_root"
