$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$fixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) "atomcli-installer-$PID"

try {
    New-Item -ItemType Directory -Force -Path $fixtureDir | Out-Null
    $binaryPath = Join-Path $fixtureDir "atomcli-windows-x64.exe"
    $manifestPath = Join-Path $fixtureDir "SHA256SUMS"
    [System.IO.File]::WriteAllText($binaryPath, "atomcli installer checksum fixture`n")

    $env:ATOMCLI_INSTALLER_LIBRARY_ONLY = "1"
    . (Join-Path $repositoryRoot "install.ps1")

    $release = Get-ReleaseDownloadInfo -Version "9.8.7" -Arch "arm64"
    if ($release.Version -ne "v9.8.7" -or
        $release.AssetName -ne "atomcli-windows-arm64.exe" -or
        $release.AssetUrl -ne "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/atomcli-windows-arm64.exe" -or
        $release.ChecksumUrl -ne "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/SHA256SUMS") {
        throw "PowerShell installer release mapping is incorrect"
    }

    $Version = "3.4.2'; Remove-Item C:\\*"
    try {
        Select-Version
        throw "unsafe release target unexpectedly passed validation"
    } catch {
        if ($_.Exception.Message -notlike "Invalid release version:*") { throw }
    }
    $Version = $null

    $hash = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $manifestPath -Value "$hash  atomcli-windows-x64.exe"
    if (-not (Test-ReleaseChecksum -BinaryPath $binaryPath -ManifestPath $manifestPath -AssetName "atomcli-windows-x64.exe")) {
        throw "valid installer fixture failed checksum verification"
    }

    Set-Content -LiteralPath $manifestPath -Value "$('0' * 64)  atomcli-windows-x64.exe"
    if (Test-ReleaseChecksum -BinaryPath $binaryPath -ManifestPath $manifestPath -AssetName "atomcli-windows-x64.exe") {
        throw "tampered installer fixture unexpectedly passed checksum verification"
    }

    Get-SystemInfo
    if (@("x64", "arm64") -notcontains $script:ArchType) {
        throw "installer arch detection failed: $($script:ArchType)"
    }

    $savedProcArch = $env:PROCESSOR_ARCHITECTURE
    $savedWow64Arch = $env:PROCESSOR_ARCHITEW6432
    try {
        Remove-Item Env:PROCESSOR_ARCHITEW6432 -ErrorAction SilentlyContinue
        foreach ($case in @(
            @{ Arch = "AMD64"; Expected = "x64" },
            @{ Arch = "ARM64"; Expected = "arm64" },
            @{ Arch = "x86";   Expected = $null }
        )) {
            $env:PROCESSOR_ARCHITECTURE = $case.Arch
            $resolved = Get-ProcessorEnvArch
            if ($resolved -ne $case.Expected) {
                throw "fallback arch mapping for $($case.Arch) returned '$resolved'"
            }
        }

        $env:PROCESSOR_ARCHITECTURE = "x86"
        $env:PROCESSOR_ARCHITEW6432 = "AMD64"
        if ((Get-ProcessorEnvArch) -ne "x64") {
            throw "WOW64 PROCESSOR_ARCHITEW6432 override ignored"
        }
    } finally {
        if ($null -eq $savedProcArch) { Remove-Item Env:PROCESSOR_ARCHITECTURE -ErrorAction SilentlyContinue }
        else { $env:PROCESSOR_ARCHITECTURE = $savedProcArch }
        if ($null -eq $savedWow64Arch) { Remove-Item Env:PROCESSOR_ARCHITEW6432 -ErrorAction SilentlyContinue }
        else { $env:PROCESSOR_ARCHITEW6432 = $savedWow64Arch }
    }
} finally {
    Remove-Item Env:ATOMCLI_INSTALLER_LIBRARY_ONLY -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $fixtureDir -Recurse -Force -ErrorAction SilentlyContinue
}
