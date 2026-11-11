param(
    [Parameter(Mandatory)]
    [string]$BwapiRoot,
    [string]$ScratchDirectory = ".claude-scratch",
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$bwapiRootPath = (Resolve-Path $BwapiRoot).Path
$scratchPath = Join-Path $repositoryRoot $ScratchDirectory
$cppFixture = Join-Path $PSScriptRoot "bwapi_4_4_abi_fixture.cpp"
$rustFixture = Join-Path $PSScriptRoot "bwapi_4_4_abi_fixture.rs"
$verifier = Join-Path $PSScriptRoot "verify-wire.py"
$includeDirectory = Join-Path $bwapiRootPath "bwapi\\include"
$vswhere = "${env:ProgramFiles(x86)}\\Microsoft Visual Studio\\Installer\\vswhere.exe"

if (-not (Test-Path $includeDirectory)) {
    throw "BWAPI include directory was not found: $includeDirectory"
}
if (-not (Test-Path $vswhere)) {
    throw "Visual Studio Installer discovery tool was not found: $vswhere"
}

$installationPath = & $vswhere -latest -products * -version "[17.0,18.0)" -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $installationPath) {
    throw "Visual Studio 2022 C++ x86/x64 tools were not found"
}
$vcVarsAll = Join-Path $installationPath "VC\\Auxiliary\\Build\\vcvarsall.bat"
if (-not (Test-Path $vcVarsAll)) {
    throw "Visual Studio architecture setup script was not found: $vcVarsAll"
}

New-Item -ItemType Directory -Force -Path $scratchPath | Out-Null

function Invoke-VisualStudioCommand([ValidateSet("x86", "x64")] [string]$Architecture, [string]$Command) {
    $commandLine = "set `"PATH=$(Split-Path $vswhere);%PATH%`" && call `"$vcVarsAll`" $Architecture >nul && $Command"
    & cmd.exe /d /s /c $commandLine
    if ($LASTEXITCODE -ne 0) {
        throw "Visual Studio $Architecture command failed: $Command"
    }
}

foreach ($architecture in "x64", "x86") {
    $cppExe = Join-Path $scratchPath "bwapi-abi-$architecture.exe"
    $cppObject = Join-Path $scratchPath "bwapi-abi-$architecture.obj"
    $cppJson = Join-Path $scratchPath "bwapi-abi-$architecture.json"
    Invoke-VisualStudioCommand $architecture "cl.exe /nologo /EHsc /std:c++17 /I `"$includeDirectory`" /Fo`"$cppObject`" /Fe:`"$cppExe`" `"$cppFixture`""
    & $cppExe | Set-Content -NoNewline -Encoding ascii $cppJson
    if ($LASTEXITCODE -ne 0) {
        throw "C++ $architecture ABI fixture failed"
    }

    $rustExe = Join-Path $scratchPath "bwapi-rust-abi-$architecture.exe"
    $rustJson = Join-Path $scratchPath "bwapi-rust-abi-$architecture.json"
    $rustTarget = if ($architecture -eq "x86") { "i686-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
    Invoke-VisualStudioCommand $architecture "rustc `"$rustFixture`" --target $rustTarget -o `"$rustExe`""
    & $rustExe | Set-Content -NoNewline -Encoding ascii $rustJson
    if ($LASTEXITCODE -ne 0) {
        throw "Rust $architecture ABI fixture failed"
    }
}

& $Python $verifier --bwapi-root $bwapiRootPath --cpp-x64 (Join-Path $scratchPath "bwapi-abi-x64.json") --cpp-x86 (Join-Path $scratchPath "bwapi-abi-x86.json") --rust-x64 (Join-Path $scratchPath "bwapi-rust-abi-x64.json") --rust-x86 (Join-Path $scratchPath "bwapi-rust-abi-x86.json")
if ($LASTEXITCODE -ne 0) {
    throw "BWAPI ABI verification failed"
}
