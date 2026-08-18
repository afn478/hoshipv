$ErrorActionPreference = "Stop"
$ArchiveRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$MpvHome = if ($env:MPV_HOME) { $env:MPV_HOME } else { Join-Path $env:APPDATA "mpv" }
$InstallRoot = Join-Path $MpvHome "scripts\iinatan"
$ConfigRoot = Join-Path $MpvHome "iinatan"
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "bin"), (Join-Path $InstallRoot "fonts"), $ConfigRoot | Out-Null
Copy-Item (Join-Path $ArchiveRoot "scripts\iinatan.js") (Join-Path $InstallRoot "iinatan.js") -Force
Copy-Item (Join-Path $ArchiveRoot "bin\iinatan-backend.exe") (Join-Path $InstallRoot "bin\iinatan-backend.exe") -Force
Copy-Item (Join-Path $ArchiveRoot "bin\ffmpeg.exe") (Join-Path $InstallRoot "bin\ffmpeg.exe") -Force
Copy-Item (Join-Path $ArchiveRoot "fonts\NotoSansCJKjp-Regular.otf") (Join-Path $InstallRoot "fonts\NotoSansCJKjp-Regular.otf") -Force
$ConfigPath = Join-Path $ConfigRoot "config.json"
if (-not (Test-Path $ConfigPath)) {
  Copy-Item (Join-Path $ArchiveRoot "config\config.example.json") $ConfigPath
}
Write-Host "Installed iinatan in $InstallRoot"
