# CodeAtlas Windows build script
#
# Why this script exists: the Rust MSVC toolchain needs link.exe plus the Windows SDK
# include/lib paths. A plain PowerShell session has neither, so a bare `cargo build`
# fails with: linker `link.exe` not found.
#
# Why not Enter-VsDevShell: that cmdlet aborts with
# "Dictionary already contains key 'Path' / 'PATH'" in sessions whose environment
# carries both casings (common under agent shells). Injecting the variables directly
# is equivalent for building Rust, and works in CI too.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build-exe.ps1             # exe + NSIS installer
#   powershell -ExecutionPolicy Bypass -File scripts/build-exe.ps1 -NoBundle   # portable exe only (faster)
#
# Requirements: Rust (MSVC toolchain) + Visual Studio 2022 with "Desktop development with C++".

param(
    [switch]$NoBundle,
    [string]$VsPath = "",
    [string]$SdkRoot = "C:\Program Files (x86)\Windows Kits\10"
)

$ErrorActionPreference = 'Stop'

# ---------- 1. locate Visual Studio ----------
if (-not $VsPath) {
    $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $VsPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
    }
    if (-not $VsPath) {
        foreach ($candidate in @(
            "C:\Program Files\Microsoft Visual Studio\2022\Community",
            "C:\Program Files\Microsoft Visual Studio\2022\Professional",
            "C:\Program Files\Microsoft Visual Studio\2022\Enterprise",
            "C:\Program Files\Microsoft Visual Studio\2022\BuildTools",
            "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
        )) {
            if (Test-Path (Join-Path $candidate 'VC\Tools\MSVC')) { $VsPath = $candidate; break }
        }
    }
}
if (-not $VsPath -or -not (Test-Path (Join-Path $VsPath 'VC\Tools\MSVC'))) {
    throw "MSVC toolchain not found. Install Visual Studio 2022 with 'Desktop development with C++'."
}
Write-Host "[build] Visual Studio: $VsPath"

# ---------- 2. pick MSVC + Windows SDK versions (auto-detect, survives upgrades) ----------
$msvcVer = Get-ChildItem (Join-Path $VsPath 'VC\Tools\MSVC') -Directory |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $msvcVer) { throw "No MSVC toolset under $VsPath\VC\Tools\MSVC" }

$sdkIncludeRoot = Join-Path $SdkRoot 'Include'
$sdkVer = $null
if (Test-Path $sdkIncludeRoot) {
    $sdkVer = Get-ChildItem $sdkIncludeRoot -Directory |
        Where-Object { $_.Name -match '^10\.' } |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
}
if (-not $sdkVer) { throw "Windows SDK not found under $SdkRoot. Install the Windows 10/11 SDK component." }

$msvcBase = $msvcVer.FullName
$sdkBase = Join-Path $SdkRoot ('Include\' + $sdkVer.Name)
$sdkLibBase = Join-Path $SdkRoot ('Lib\' + $sdkVer.Name)
Write-Host "[build] MSVC $($msvcVer.Name) / Windows SDK $($sdkVer.Name)"

# ---------- 3. inject environment (equivalent to vcvars64.bat for x64) ----------
$hostBin = Join-Path $msvcBase 'bin\Hostx64\x64'
$env:PATH = @(
    $hostBin,
    (Join-Path $SdkRoot ('bin\' + $sdkVer.Name + '\x64')),
    $env:PATH
) -join ';'

$env:INCLUDE = @(
    (Join-Path $msvcBase 'include'),
    (Join-Path $sdkBase 'ucrt'),
    (Join-Path $sdkBase 'shared'),
    (Join-Path $sdkBase 'um'),
    (Join-Path $sdkBase 'winrt'),
    (Join-Path $sdkBase 'cppwinrt')
) -join ';'

$env:LIB = @(
    (Join-Path $msvcBase 'lib\x64'),
    (Join-Path $sdkLibBase 'ucrt\x64'),
    (Join-Path $sdkLibBase 'um\x64')
) -join ';'

if (-not (Test-Path (Join-Path $hostBin 'link.exe'))) {
    throw "link.exe not found in $hostBin"
}
Write-Host "[build] link.exe ready"

# ---------- 4. make sure cargo is on PATH ----------
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo not found. Install Rust from https://rustup.rs (choose the MSVC toolchain)."
}
Write-Host "[build] $((& cargo --version))"

# ---------- 5. resolve npm ----------
$npm = $null
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCmd) { $npm = $npmCmd.Source }
if (-not $npm) {
    $fallback = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions\22.22.2-3\npm.cmd'
    if (Test-Path $fallback) { $npm = $fallback } else { throw "npm not found. Install Node.js first." }
}

# ---------- 6. build ----------
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
if ($NoBundle) {
    Write-Host "[build] tauri build --no-bundle (portable exe only)"
    & $npm run tauri build -- --no-bundle
} else {
    Write-Host "[build] tauri build (exe + NSIS installer)"
    & $npm run tauri build
}
if ($LASTEXITCODE -ne 0) { throw "build failed with exit code $LASTEXITCODE" }

# ---------- 7. copy artifacts to project root ----------
# Cargo writes to src-tauri/target/release, which is a cache directory: it is
# gitignored and can be wiped at any time. The two files a user actually wants
# (portable exe + installer) are therefore copied to the repo root so they can
# be double-clicked without hunting through target/.
$root = (Get-Location).Path
$exe = Get-ChildItem 'src-tauri\target\release\*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
$nsis = Get-ChildItem 'src-tauri\target\release\bundle\nsis\*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1

$copied = @()
if ($exe) {
    $dest = Join-Path $root 'CodeAtlas.exe'
    Copy-Item $exe.FullName $dest -Force
    $copied += $dest
}
if ($nsis) {
    # Keep the version in the installer name, it is what users share around.
    $dest = Join-Path $root $nsis.Name
    Copy-Item $nsis.FullName $dest -Force
    $copied += $dest
}

# ---------- 8. report ----------
Write-Host ""
Write-Host "[build] artifacts (copied to project root):" -ForegroundColor Green
foreach ($f in $copied) {
    Write-Host ("  {0}  ({1:N1} MB)" -f (Split-Path $f -Leaf), ((Get-Item $f).Length / 1MB))
}
if ($copied.Count -eq 0) { Write-Host "  none found - check the build log" -ForegroundColor Yellow }
