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

    $hash = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $manifestPath -Value "$hash  atomcli-windows-x64.exe"
    if (-not (Test-ReleaseChecksum -BinaryPath $binaryPath -ManifestPath $manifestPath -AssetName "atomcli-windows-x64.exe")) {
        throw "valid installer fixture failed checksum verification"
    }

    Set-Content -LiteralPath $manifestPath -Value "$('0' * 64)  atomcli-windows-x64.exe"
    if (Test-ReleaseChecksum -BinaryPath $binaryPath -ManifestPath $manifestPath -AssetName "atomcli-windows-x64.exe") {
        throw "tampered installer fixture unexpectedly passed checksum verification"
    }
} finally {
    Remove-Item Env:ATOMCLI_INSTALLER_LIBRARY_ONLY -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $fixtureDir -Recurse -Force -ErrorAction SilentlyContinue
}
