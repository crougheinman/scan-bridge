# Builds the distributable scan-bridge package (a .zip a store PC unzips to
# C:\scan-bridge). Ships source + launchers only — node_modules is NOT bundled;
# the .bat launchers run `npm install` on first run. Excludes .env and .git.
#
#   Windows:  powershell -ExecutionPolicy Bypass -File build-package.ps1
#   (Linux/VPS equivalent: see README — `zip -r` the same file list.)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$include = @(
    'index.js',
    'lib',
    'package.json',
    'package-lock.json',
    '.env.example',
    'README.md',
    'start-scan-bridge.bat',
    'probe-scanner.bat',
    'install-bridge-task.bat'
)

$staging = Join-Path $env:TEMP 'scan-bridge-pkg'
$pkgRoot = Join-Path $staging 'scan-bridge'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $pkgRoot -Force | Out-Null

foreach ($item in $include) {
    $src = Join-Path $root $item
    if (-not (Test-Path $src)) { throw "Missing expected file: $item" }
    Copy-Item $src -Destination $pkgRoot -Recurse -Force
}

$distDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
$zip = Join-Path $distDir 'scan-bridge.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path $pkgRoot -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force

Write-Output "Built $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)"
