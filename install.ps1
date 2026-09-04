# AtomCLI Installer for Windows PowerShell
# https://github.com/aToom13/AtomCLI
#
# Install:   irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex
# Update:    atomcli upgrade  (or: iwr https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 -OutFile update.ps1; .\update.ps1 -Update)
# Uninstall: iwr https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 -OutFile uninstall.ps1; .\uninstall.ps1 -Uninstall
# Source:    iwr https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 -OutFile build.ps1; .\build.ps1 -FromSource

param(
    [switch]$Uninstall,
    [switch]$Update,
    [switch]$Source,
    [switch]$Help,
    [switch]$RuntimeOnly,
    [string]$Version = $env:VERSION
)

$ErrorActionPreference = "Stop"

# Installation directories
$InstallDir = if ($env:ATOMCLI_INSTALL_DIR) { $env:ATOMCLI_INSTALL_DIR } else { "$env:LOCALAPPDATA\AtomCLI\bin" }
$ConfigDir  = if ($env:ATOMCLI_CONFIG_DIR)  { $env:ATOMCLI_CONFIG_DIR  } else { "$env:USERPROFILE\.atomcli" }
$PlaywrightVersion = "1.62.0"

# ─────────────────────────────────────────────────────────────
# Output helpers
# ─────────────────────────────────────────────────────────────
function Write-Step    { param([string]$M) Write-Host "-> $M" -ForegroundColor Blue }
function Write-Success { param([string]$M) Write-Host "v  $M" -ForegroundColor Green }
function Write-Err     { param([string]$M) Write-Host "x  $M" -ForegroundColor Red }
function Write-Warn    { param([string]$M) Write-Host "!  $M" -ForegroundColor Yellow }
function Write-Info    { param([string]$M) Write-Host "   $M" -ForegroundColor DarkGray }

function Start-InstallProgress {
    param([int]$Total)
    $script:ProgressCurrent = 0
    $script:ProgressTotal = [Math]::Max(1, $Total)
}

function Set-InstallProgress {
    param([string]$Activity)
    $script:ProgressCurrent++
    $percent = [Math]::Min(100, [Math]::Floor(($script:ProgressCurrent * 100) / $script:ProgressTotal))
    $width = 24
    $filled = [Math]::Floor(($percent * $width) / 100)
    $bar = ("=" * $filled) + ">" + (" " * [Math]::Max(0, $width - $filled))
    Write-Progress -Activity "AtomCLI setup" -Status $Activity -PercentComplete $percent
    Write-Host ("[{0}] {1,3}%  {2}" -f $bar, $percent, $Activity) -ForegroundColor Cyan
}

function Complete-InstallProgress {
    Write-Progress -Activity "AtomCLI setup" -Completed
}

function Show-Banner {
    Write-Host ""
    Write-Host "  █████╗ ████████╗ ██████╗ ███╗   ███╗   ██████╗██╗     ██╗" -ForegroundColor Cyan
    Write-Host " ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║" -ForegroundColor Cyan
    Write-Host " ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║" -ForegroundColor Cyan
    Write-Host " ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║" -ForegroundColor Cyan
    Write-Host " ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║" -ForegroundColor Cyan
    Write-Host " ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    Terminal AI Coding Assistant - by Atom13" -ForegroundColor DarkGray
    Write-Host ""
}

function Show-Help {
    Write-Host "AtomCLI Installer (Windows)" -ForegroundColor White
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor White
    Write-Host "  irm <url> | iex                        # Install (interactive)"
    Write-Host "  irm <url> | iex; Update-AtomCLI        # Update (version picker)"
    Write-Host "  .\install.ps1 -Update -Version 3.4.2  # Non-interactive update"
    Write-Host "  irm <url> | iex; Uninstall-AtomCLI     # Uninstall"
    Write-Host "  irm <url> | iex; Install-AtomCLI -FromSource  # Build from source"
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────
# Spinner
# ─────────────────────────────────────────────────────────────
function Start-Spinner {
    param([string]$Message)
    $script:SpinnerMessage = $Message
    $script:SpinnerRunning = $true
    $script:SpinnerJob = Start-Job -ScriptBlock {
        param($msg)
        $chars = @('|','/','-','\')
        $i = 0
        while ($true) {
            Write-Host "`r$($chars[$i % 4]) $msg   " -NoNewline -ForegroundColor Blue
            Start-Sleep -Milliseconds 100
            $i++
        }
    } -ArgumentList $Message
}

function Stop-Spinner {
    param([string]$DoneMessage = "")
    if ($script:SpinnerJob) {
        Stop-Job $script:SpinnerJob -ErrorAction SilentlyContinue
        Remove-Job $script:SpinnerJob -ErrorAction SilentlyContinue
        $script:SpinnerJob = $null
    }
    Write-Host "`r                                        `r" -NoNewline
    if ($DoneMessage) { Write-Success $DoneMessage }
}

# Simple inline spinner for jobs we can wait on
function Invoke-WithSpinner {
    param(
        [string]$Message,
        [scriptblock]$Action,
        [array]$ArgumentList = @()
    )
    $chars = @('|','/','-','\')
    $i = 0
    $job = Start-Job -ScriptBlock $Action -ArgumentList $ArgumentList
    while ($job.State -eq 'Running') {
        Write-Host "`r$($chars[$i % 4]) $Message   " -NoNewline -ForegroundColor Blue
        Start-Sleep -Milliseconds 120
        $i++
    }
    Write-Host "`r                                              `r" -NoNewline
    $result = Receive-Job $job -ErrorAction SilentlyContinue
    $state  = $job.State
    Remove-Job $job
    if ($state -eq 'Failed') { throw "Background job failed: $Message" }
    return $result
}

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
function Test-Command {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Test-WingetAvailable {
    Test-Command "winget"
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

# ─────────────────────────────────────────────────────────────
# Dependency checks + auto-install
# ─────────────────────────────────────────────────────────────
function Test-Dependencies {
    Write-Host ""
    Write-Host "Checking dependencies..." -ForegroundColor White
    Write-Host ""

    # ── git ──────────────────────────────────────────────────
    if (Test-Command "git") {
        $v = (git --version) -replace 'git version ',''
        Write-Success "git $v"
    } else {
        Write-Warn "git not found"
        if (Test-WingetAvailable) {
            Write-Step "Installing git via winget..."
            winget install --id Git.Git -e --source winget `
                --accept-package-agreements --accept-source-agreements `
                --silent 2>&1 | Out-Null
            Refresh-Path
            if (Test-Command "git") {
                Write-Success "git installed"
            } else {
                Write-Err "git install failed. Install manually: https://git-scm.com/download/win"
                exit 1
            }
        } else {
            Write-Err "git not found and winget unavailable. Install from: https://git-scm.com/download/win"
            exit 1
        }
    }

    # ── Bun ───────────────────────────────────────────────────
    if (Test-Command "bun") {
        Write-Success "bun $(bun --version)"
        $script:BunInstalled = $true
    } else {
        Write-Warn "bun not found (will be installed)"
        $script:BunInstalled = $false
    }

    Write-Host ""
}

function Install-Bun {
    if ($script:BunInstalled) { return }
    Write-Step "Installing Bun..."
    try {
        Invoke-WithSpinner -Message "Installing Bun..." -Action {
            powershell -c "irm https://bun.sh/install.ps1 | iex" 2>&1 | Out-Null
        }
        Refresh-Path
        $bunPath = "$env:USERPROFILE\.bun\bin"
        if (Test-Path $bunPath) { $env:Path += ";$bunPath" }

        if (Test-Command "bun") {
            Write-Success "Bun $(bun --version) installed"
            $script:BunInstalled = $true
        } else {
            Write-Warn "Bun installed but not in PATH. Please restart terminal after setup."
        }
    } catch {
        Write-Err "Failed to install Bun: $_"
        Write-Info "Install manually: https://bun.sh"
        exit 1
    }
}

# ─────────────────────────────────────────────────────────────
# GitHub releases
# ─────────────────────────────────────────────────────────────
function Get-Releases {
    param([int]$Count = 8)
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/aToom13/AtomCLI/releases?per_page=$Count" -ErrorAction Stop
        return $r
    } catch {
        return @()
    }
}

function Get-LatestRelease {
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/aToom13/AtomCLI/releases/latest" -ErrorAction Stop
        return $r.tag_name
    } catch {
        return $null
    }
}

function Test-ReleaseChecksum {
    param(
        [Parameter(Mandatory)][string]$BinaryPath,
        [Parameter(Mandatory)][string]$ManifestPath,
        [Parameter(Mandatory)][string]$AssetName
    )

    if (-not (Test-Path -LiteralPath $BinaryPath) -or -not (Test-Path -LiteralPath $ManifestPath)) {
        return $false
    }

    $expected = $null
    foreach ($line in Get-Content -LiteralPath $ManifestPath) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$' -and
            [string]::Equals($Matches[2], $AssetName, [System.StringComparison]::Ordinal)) {
            $expected = $Matches[1]
            break
        }
    }
    if (-not $expected) { return $false }

    $actual = (Get-FileHash -LiteralPath $BinaryPath -Algorithm SHA256).Hash
    return [string]::Equals($actual, $expected, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-ReleaseDownloadInfo {
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][ValidateSet("x64", "arm64")][string]$Arch
    )

    $normalizedVersion = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }
    $assetName = "atomcli-windows-$Arch.exe"
    $releaseBase = "https://github.com/aToom13/AtomCLI/releases/download/$normalizedVersion"
    [PSCustomObject]@{
        Version = $normalizedVersion
        AssetName = $assetName
        AssetUrl = "$releaseBase/$assetName"
        ChecksumUrl = "$releaseBase/SHA256SUMS"
    }
}

# ─────────────────────────────────────────────────────────────
# Version selection menu
# ─────────────────────────────────────────────────────────────
function Select-Version {
    if ($Version) {
        $normalizedVersion = $Version -replace '^v',''
        if ($normalizedVersion -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$') {
            throw "Invalid release version: $Version"
        }
        $script:SelectedVersion = $normalizedVersion
        Write-Info "Selected from command/environment: v$($script:SelectedVersion)"
        return
    }

    if ($env:NONINTERACTIVE -eq "1") {
        $latest = Get-LatestRelease
        if ($latest) { $script:SelectedVersion = $latest -replace '^v','' }
        return
    }

    Write-Host ""
    Write-Host "  Fetching available versions..." -ForegroundColor Cyan

    $releases = Get-Releases
    if (-not $releases -or $releases.Count -eq 0) {
        Write-Warn "Could not fetch version list, using latest"
        return
    }

    $versions = $releases | ForEach-Object { $_.tag_name -replace '^v','' }

    Write-Host ""
    Write-Host "────────────────────────────────────────────────" -ForegroundColor Cyan
    Write-Host "  Select a version to install:" -ForegroundColor White
    Write-Host "────────────────────────────────────────────────" -ForegroundColor Cyan
    Write-Host ""

    $i = 1
    foreach ($v in $versions) {
        $hint = if ($i -eq 1) { " (Latest)" } else { "" }
        $hintColor = if ($i -eq 1) { "Green" } else { "DarkGray" }
        Write-Host "  " -NoNewline
        Write-Host "$i)" -ForegroundColor Cyan -NoNewline
        Write-Host " v$v" -NoNewline
        if ($hint) { Write-Host $hint -ForegroundColor $hintColor } else { Write-Host "" }
        $i++
    }
    Write-Host ""
    Write-Host "  $i)" -ForegroundColor Cyan -NoNewline
    Write-Host " Build from Source (clone & compile main branch)" -ForegroundColor DarkGray
    $sourceOption = $i
    $i++
    Write-Host "  $i)" -ForegroundColor Cyan -NoNewline
    Write-Host " Cancel"
    $cancelOption = $i
    Write-Host ""

    $timeoutSecs = 30
    $choice = $null
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    Write-Host "  Choice [1] (auto-selects in ${timeoutSecs}s): " -NoNewline -ForegroundColor White
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSecs) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            # collect digits until Enter
            $input = ""
            if ($key.Key -ne [ConsoleKey]::Enter) {
                $input = $key.KeyChar
                Write-Host $input -NoNewline
                while ($true) {
                    $k2 = [Console]::ReadKey($true)
                    if ($k2.Key -eq [ConsoleKey]::Enter) { break }
                    $input += $k2.KeyChar
                    Write-Host $k2.KeyChar -NoNewline
                }
            }
            Write-Host ""
            $choice = if ($input -eq "") { "1" } else { $input }
            break
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $choice) { $choice = "1"; Write-Host "1 (timeout)" -ForegroundColor DarkGray }

    $choiceInt = 0
    if ([int]::TryParse($choice, [ref]$choiceInt)) {
        if ($choiceInt -eq $cancelOption) {
            Write-Host ""
            Write-Warn "Cancelled"
            exit 0
        }
        if ($choiceInt -eq $sourceOption) {
            $script:InstallFromSource = $true
            return
        }
        if ($choiceInt -ge 1 -and $choiceInt -le $versions.Count) {
            $script:SelectedVersion = $versions[$choiceInt - 1]
            Write-Info "Selected: v$($script:SelectedVersion)"
            return
        }
    }

    Write-Warn "Invalid selection, using latest"
}

# ─────────────────────────────────────────────────────────────
# Binary download / source build
# ─────────────────────────────────────────────────────────────
function Install-Binary {
    param([switch]$FromSource)

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    New-Item -ItemType Directory -Force -Path $ConfigDir  | Out-Null

    if ($FromSource -or $script:InstallFromSource) {
        Invoke-SourceBuild
        return
    }

    Write-Step "Downloading AtomCLI..."

    $version = if ($script:SelectedVersion) { "v$($script:SelectedVersion)" } else { Get-LatestRelease }

    if ($version) {
        $release = Get-ReleaseDownloadInfo -Version $version -Arch $script:ArchType
        $binaryName = $release.AssetName
        $url = $release.AssetUrl
        $checksumUrl = $release.ChecksumUrl
        $targetPath = Join-Path $InstallDir "atomcli.exe"
        $partialPath = "$targetPath.partial.$PID"
        $manifestPath = Join-Path $InstallDir "SHA256SUMS.partial.$PID"
        try {
            Invoke-WithSpinner -Message "Downloading $version..." -Action {
                param($u, $t, $cu, $ct)
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $web = New-Object System.Net.WebClient
                $web.DownloadFile($u, $t)
                $web.DownloadFile($cu, $ct)
            } -ArgumentList $url, $partialPath, $checksumUrl, $manifestPath

            if (-not (Test-Path -LiteralPath $partialPath) -or (Get-Item -LiteralPath $partialPath).Length -eq 0) {
                throw "Empty binary download"
            }
            if (-not (Test-ReleaseChecksum -BinaryPath $partialPath -ManifestPath $manifestPath -AssetName $binaryName)) {
                throw "SHA-256 checksum verification failed"
            }
            Move-Item -LiteralPath $partialPath -Destination $targetPath -Force
            Write-Success "Downloaded and verified AtomCLI $version"
            return
        } catch {
            Write-Warn "Binary download or verification failed, falling back to source build... ($($_.Exception.Message))"
        } finally {
            Remove-Item -LiteralPath $partialPath, $manifestPath -Force -ErrorAction SilentlyContinue
        }
    }

    Invoke-SourceBuild -Version $version
}

function Invoke-SourceBuild {
    param([string]$Version)
    Write-Step "Building from source..."
    Write-Info "(First install can take 10-20 min on slow connections)"
    Write-Host ""

    $tempDir = Join-Path $env:TEMP "atomcli-build-$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    Push-Location $tempDir

    try {
        # Clone
        Write-Step "Cloning repository..."
        $cloneJob = Start-Job -ScriptBlock {
            param($wd, $version)
            Set-Location $wd
            if ($version) {
                git clone --depth 1 --branch $version https://github.com/aToom13/AtomCLI.git 2>&1
            } else {
                git clone --depth 1 https://github.com/aToom13/AtomCLI.git 2>&1
            }
        } -ArgumentList $tempDir, $Version
        $chars = @('|','/','-','\'); $ci = 0
        while ($cloneJob.State -eq 'Running') {
            Write-Host "`r$($chars[$ci % 4]) Cloning...   " -NoNewline -ForegroundColor Blue
            Start-Sleep -Milliseconds 150; $ci++
        }
        Write-Host "`r                            `r" -NoNewline
        Receive-Job $cloneJob | Out-Null; Remove-Job $cloneJob
        Write-Success "Cloned repository"

        Set-Location AtomCLI

        # Install deps
        Write-Step "Installing dependencies..."
        Write-Info "(may take 1-3 minutes)"
        $depsJob = Start-Job -ScriptBlock { param($wd); Set-Location $wd; bun install 2>&1 } -ArgumentList $PWD.Path
        $elapsed = 0
        while ($depsJob.State -eq 'Running') {
            Write-Host "`r$($chars[$elapsed % 4]) Installing dependencies... ($elapsed`s)   " -NoNewline -ForegroundColor Blue
            Start-Sleep -Seconds 1; $elapsed++
            if ($elapsed -gt 900) { Stop-Job $depsJob; throw "Dependency install timed out" }
        }
        Write-Host "`r                                                     `r" -NoNewline
        $depsOut = Receive-Job $depsJob; Remove-Job $depsJob
        Write-Success "Dependencies installed"

        Set-Location AtomBase

        # Build
        Write-Host ""
        Write-Host "  [1/4] Preparing build environment..." -ForegroundColor Yellow
        Write-Host "  [2/4] Running build (bun run build --single)..." -ForegroundColor Yellow
        Write-Info "        (This may take 2-5 minutes)"

        $buildLog = Join-Path $env:TEMP "atomcli-build-$PID.log"
        $buildJob = Start-Job -ScriptBlock {
            param($wd, $log)
            Set-Location $wd
            bun run build --single 2>&1 | Out-Null
            $LASTEXITCODE
        } -ArgumentList $PWD.Path, $buildLog

        $be = 0
        while ($buildJob.State -eq 'Running') {
            Write-Host "`r$($chars[$be % 4]) Building... ($be`s)   " -NoNewline -ForegroundColor Blue
            Start-Sleep -Seconds 1; $be++
            if ($be -gt 1200) { Stop-Job $buildJob; throw "Build timed out after 20 minutes" }
        }
        Write-Host "`r                              `r" -NoNewline
        Receive-Job $buildJob | Out-Null; Remove-Job $buildJob

        Write-Host "  [3/4] Build completed" -ForegroundColor Yellow
        Write-Host "  [4/4] Locating binary..." -ForegroundColor Yellow

        # Find binary
        $builtBinary = Get-ChildItem -Path "dist" -Filter "atomcli*.exe" -Recurse -ErrorAction SilentlyContinue |
                       Select-Object -First 1
        if (-not $builtBinary) {
            $distDir = Get-ChildItem -Path "dist" -Directory -Filter "atomcli-windows*" -ErrorAction SilentlyContinue |
                       Select-Object -First 1
            if ($distDir) {
                $exePath = Join-Path $distDir.FullName "bin\atomcli.exe"
                if (Test-Path $exePath) { $builtBinary = Get-Item $exePath }
            }
        }

        if ($builtBinary) {
            $targetPath = Join-Path $InstallDir "atomcli.exe"
            Copy-Item $builtBinary.FullName -Destination $targetPath -Force
            Write-Success "Installed AtomCLI to $targetPath"
        } else {
            Write-Err "Could not find built binary in dist/"
            Write-Info "Available files in dist:"
            Get-ChildItem "dist" -Recurse | Select-Object -ExpandProperty FullName | ForEach-Object { Write-Info "  $_" }
            exit 1
        }

    } finally {
        Pop-Location
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
}

# ─────────────────────────────────────────────────────────────
# Playwright browser setup
# ─────────────────────────────────────────────────────────────
function Install-PlaywrightBrowsers {
    if ($env:ATOMCLI_SKIP_PLAYWRIGHT -eq "1") {
        Write-Warn "Skipping Playwright setup because ATOMCLI_SKIP_PLAYWRIGHT=1"
        return
    }

    $playwrightDir = Join-Path $ConfigDir "playwright"
    New-Item -ItemType Directory -Force -Path $playwrightDir | Out-Null

    $desiredVersion = $PlaywrightVersion
    $releaseTag = if ($script:SelectedVersion) { "v$($script:SelectedVersion)" } else { Get-LatestRelease }
    if ($releaseTag) {
        try {
            $releasePackage = Invoke-RestMethod -Uri "https://raw.githubusercontent.com/aToom13/AtomCLI/$releaseTag/AtomBase/package.json" -ErrorAction Stop
            if ("$($releasePackage.dependencies.playwright)" -match '^\d+\.\d+\.\d+$') {
                $desiredVersion = "$($releasePackage.dependencies.playwright)"
            }
        } catch {
            Write-Warn "Could not resolve the release Playwright version; using pinned $desiredVersion"
        }
    }

    $packageFile = Join-Path $playwrightDir "node_modules\playwright\package.json"
    $installedVersion = $null
    if (Test-Path $packageFile) {
        try { $installedVersion = (Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json).version } catch { }
    }

    Push-Location $playwrightDir
    try {
        $chars = @('|','/','-','\'); $pi = 0
        if ($installedVersion -ne $desiredVersion) {
            if ($installedVersion) { Write-Info "Updating Playwright $installedVersion -> $desiredVersion" }
            Write-Step "Installing Playwright $desiredVersion..."
            $pwJob = Start-Job -ScriptBlock {
                param($wd, $version)
                Set-Location $wd
                bun init -y 2>&1 | Out-Null
                bun add --exact "playwright@$version" 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "bun add failed with exit code $LASTEXITCODE" }
            } -ArgumentList $PWD.Path, $desiredVersion
            while ($pwJob.State -eq 'Running') {
                Write-Host "`r$($chars[$pi % 4]) Installing Playwright...   " -NoNewline -ForegroundColor Blue
                Start-Sleep -Milliseconds 200; $pi++
            }
            Write-Host "`r                                          `r" -NoNewline
            $pwState = $pwJob.State
            $pwOutput = Receive-Job $pwJob -ErrorAction SilentlyContinue | Out-String
            Remove-Job $pwJob
            if ($pwState -ne 'Completed') { throw "Playwright package installation failed: $pwOutput" }
            Write-Success "Playwright $desiredVersion installed"
        } else {
            Write-Success "Playwright $desiredVersion is current"
        }

        Write-Step "Downloading and configuring Chromium..."
        $chromJob = Start-Job -ScriptBlock {
            param($wd)
            Set-Location $wd
            bunx playwright install --no-shell chromium 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Chromium install failed with exit code $LASTEXITCODE" }
        } -ArgumentList $PWD.Path
        $ci2 = 0
        while ($chromJob.State -eq 'Running') {
            Write-Host "`r$($chars[$ci2 % 4]) Downloading Chromium... ($ci2`s)   " -NoNewline -ForegroundColor Blue
            Start-Sleep -Seconds 1; $ci2++
            if ($ci2 -gt 300) { Stop-Job $chromJob; throw "Chromium download timed out after 5 minutes" }
        }
        Write-Host "`r                                              `r" -NoNewline
        $chromState = $chromJob.State
        $chromOutput = Receive-Job $chromJob -ErrorAction SilentlyContinue | Out-String
        Remove-Job $chromJob -ErrorAction SilentlyContinue
        if ($chromState -ne 'Completed') { throw "Chromium installation failed: $chromOutput" }

        & bun --conditions=browser -e 'import { chromium } from "playwright"; const headless = process.platform !== "darwin" && process.platform !== "win32" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY; const browser = await chromium.launch({ headless, ...(headless ? { channel: "chromium" } : {}) }); await browser.close()' 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Chromium was downloaded but failed its launch verification" }
        Write-Success "Browser automation runtime verified"
    } finally {
        Pop-Location
    }
}

# ─────────────────────────────────────────────────────────────
# PATH
# ─────────────────────────────────────────────────────────────
function Add-ToPath {
    Write-Step "Adding to PATH..."
    $userPath = [Environment]::GetEnvironmentVariable("Path","User")
    if ($userPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("Path","$userPath;$InstallDir","User")
        $env:Path += ";$InstallDir"
        Write-Success "Added $InstallDir to PATH"
    } else {
        Write-Info "Already in PATH"
    }
}

function Install-Completion {
    Write-Step "Installing PowerShell tab completion..."
    $binary = Join-Path $InstallDir "atomcli.exe"
    $completionDir = Join-Path $ConfigDir "completions"
    $completionFile = Join-Path $completionDir "atomcli.ps1"
    New-Item -ItemType Directory -Force -Path $completionDir | Out-Null

    & $binary completion powershell | Set-Content -LiteralPath $completionFile -Encoding UTF8
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $completionFile -Force -ErrorAction SilentlyContinue
        Write-Warn "Could not generate PowerShell tab completion"
        return
    }

    $profilePath = $PROFILE.CurrentUserAllHosts
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $profilePath) | Out-Null
    if (-not (Test-Path -LiteralPath $profilePath)) {
        New-Item -ItemType File -Force -Path $profilePath | Out-Null
    }
    $sourceLine = ". '$completionFile'"
    if (-not (Select-String -LiteralPath $profilePath -SimpleMatch $sourceLine -Quiet)) {
        Add-Content -LiteralPath $profilePath -Value "`n# AtomCLI tab completion`n$sourceLine"
    }
    Write-Success "Installed PowerShell tab completion"
}

# ─────────────────────────────────────────────────────────────
# Default config
# ─────────────────────────────────────────────────────────────
function Initialize-Config {
    Write-Step "Setting up configuration..."
    New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir "skills") | Out-Null

    $configFile = Join-Path $ConfigDir "atomcli.json"
    if (-not (Test-Path $configFile)) {
        $defaultConfig = @"
{
  "provider": {
    "atomcli": {
      "models": {
        "minimax-m2.1-free": {
          "name": "Minimax-M2.1-Custom",
          "limit": {
            "context": 100000,
            "output": 4096
          }
        }
      }
    }
  },
  "model": "atomcli/minimax-m2.1-free",
  "mcp": {}
}
"@
        Set-Content -Path $configFile -Value $defaultConfig -Encoding UTF8
        Write-Success "Created default configuration"
    } else {
        Write-Info "Configuration already exists"
    }
}

# ─────────────────────────────────────────────────────────────
# Bundled skills installation
# ─────────────────────────────────────────────────────────────
function Install-SkillsBundle {
    Write-Step "Installing bundled skills..."

    $skillsDir = Join-Path $ConfigDir "skills"
    New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null

    # Local repository checkout first; $PSScriptRoot is empty under irm | iex
    if ($PSScriptRoot) {
        $bundledSkills = Join-Path $PSScriptRoot ".atomcli\skills"
        if (Test-Path $bundledSkills) {
            Copy-Item -Path "$bundledSkills\*" -Destination $skillsDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    $installedCount = @(Get-ChildItem -Path $skillsDir -Filter "SKILL.md" -Recurse -ErrorAction SilentlyContinue).Count
    if ($installedCount -gt 0) {
        Write-Success "Installed bundled skills from repository ($installedCount skills)"
        return
    }

    # Verified release archive: skills.zip ships next to the binaries since v* releases
    $version = if ($script:SelectedVersion) { "v$($script:SelectedVersion)" } else { Get-LatestRelease }
    if ($version) {
        $normalizedVersion = if ($version.StartsWith("v")) { $version } else { "v$version" }
        $archiveName = "skills.zip"
        $releaseBase = "https://github.com/aToom13/AtomCLI/releases/download/$normalizedVersion"
        $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "atomcli-skills-$PID"
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        try {
            Invoke-WithSpinner -Message "Downloading skills bundle..." -Action {
                param($u, $t, $cu, $ct)
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $web = New-Object System.Net.WebClient
                $web.DownloadFile($u, $t)
                $web.DownloadFile($cu, $ct)
            } -ArgumentList "$releaseBase/$archiveName", (Join-Path $tmpDir $archiveName), "$releaseBase/SHA256SUMS", (Join-Path $tmpDir "SHA256SUMS")

            if (-not (Test-ReleaseChecksum -BinaryPath (Join-Path $tmpDir $archiveName) -ManifestPath (Join-Path $tmpDir "SHA256SUMS") -AssetName $archiveName)) {
                throw "SHA-256 checksum verification failed"
            }
            Expand-Archive -LiteralPath (Join-Path $tmpDir $archiveName) -DestinationPath $ConfigDir -Force
            Write-Success "Installed bundled skills ($normalizedVersion)"
            return
        } catch {
            Write-Warn "Skills bundle download failed, creating core skills only... ($($_.Exception.Message))"
        } finally {
            Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
        }
    } else {
        Write-Warn "Could not resolve a release for the skills bundle, creating core skills only..."
    }

    # Offline fallback: minimal core skills so the feature still works out of the box
    $ralph = Join-Path $skillsDir "ralph"
    New-Item -ItemType Directory -Force -Path $ralph | Out-Null
    Set-Content -Path (Join-Path $ralph "SKILL.md") -Value @"
---
name: Ralph
description: Friendly AI coding assistant with personality
---

You are Ralph, a friendly and enthusiastic AI coding assistant. You have a warm personality and enjoy helping developers solve problems.
"@ -Encoding UTF8

    $gc = Join-Path $skillsDir "git-commit"
    New-Item -ItemType Directory -Force -Path $gc | Out-Null
    Set-Content -Path (Join-Path $gc "SKILL.md") -Value @"
---
name: git-commit
description: Generate conventional commit messages
---

Generate commit messages following Conventional Commits format: feat, fix, docs, style, refactor, test, chore.
"@ -Encoding UTF8

    Write-Success "Installed core skills into ~/.atomcli/skills/"
}

# ─────────────────────────────────────────────────────────────
# Interactive optional features
# ─────────────────────────────────────────────────────────────
function Prompt-YesNo {
    param([string]$Question, [bool]$Default = $true)
    $hint = if ($Default) { "[Y/n]" } else { "[y/N]" }
    Write-Host "  $Question $hint " -NoNewline -ForegroundColor White
    $key = [Console]::ReadKey($true)
    Write-Host $key.KeyChar
    if ($key.Key -eq [ConsoleKey]::Enter) { return $Default }
    return ($key.KeyChar -match '^[Yy]$')
}

function Setup-OptionalFeatures {
    Write-Host ""
    Write-Host "────────────────────────────────────────────────" -ForegroundColor White
    Write-Host "  Optional Features" -ForegroundColor White
    Write-Host "────────────────────────────────────────────────" -ForegroundColor White
    Write-Host ""

    # ── Kilocode ─────────────────────────────────────────────
    Write-Host "  +-----------------------------------------------+" -ForegroundColor Cyan
    Write-Host "  |  Kilocode - Free Cloud AI Models             |" -ForegroundColor Cyan
    Write-Host "  +-----------------------------------------------+" -ForegroundColor Cyan
    Write-Host "  |  Access 320+ free cloud models instantly.    |" -ForegroundColor DarkGray
    Write-Host "  |  No API key needed, just login with Google.  |" -ForegroundColor DarkGray
    Write-Host "  |  *(Ücretsiz modeller - sınırsız kullanım)   |" -ForegroundColor DarkGray
    Write-Host "  +-----------------------------------------------+" -ForegroundColor Cyan
    Write-Host ""
    $enableKilocode = Prompt-YesNo "Enable Kilocode (free cloud models)?"
    if ($enableKilocode) { 
        Write-Success "Kilocode will be enabled"
        $script:EnableKilocode = $true
    } else { 
        Write-Info "Skipping Kilocode"
        $script:EnableKilocode = $false
    }
    Write-Host ""

    # ── Skills ───────────────────────────────────────────────
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Magenta
    Write-Host "  |  Bundled Skills                            |" -ForegroundColor Magenta
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Magenta
    Write-Host "  |  Installed automatically with the release. |" -ForegroundColor DarkGray
    Write-Host "  |  OS admin skills for Windows/Linux/macOS   |" -ForegroundColor DarkGray
    Write-Host "  |  load on demand via trigger words.         |" -ForegroundColor DarkGray
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Magenta
    Write-Host ""

    # ── MCP Servers ──────────────────────────────────────────
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Yellow
    Write-Host "  |  MCP Servers (Model Context Protocol)      |" -ForegroundColor Yellow
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Yellow
    Write-Host "  |  - Seq-Thinking   complex reasoning        |" -ForegroundColor DarkGray
    Write-Host "  |  (Runs through Bun)                        |" -ForegroundColor DarkGray
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Yellow
    Write-Host ""
    $installMcps = Prompt-YesNo "Install default MCP servers?"
    if ($installMcps) { Write-Success "MCP servers will be installed" } else { Write-Info "Skipping MCP servers" }
    Write-Host ""

    # ── Apply ─────────────────────────────────────────────────
    Write-Host "  Applying selections..." -ForegroundColor White
    Write-Host ""

    if ($script:EnableKilocode) {
        Write-Step "Configuring Kilocode..."
        $configFile = Join-Path $ConfigDir "atomcli.json"
        $kilocodeConfig = @"
{
  "provider": {
    "atomcli": {
      "models": {
        "minimax-m2.1-free": {
          "name": "Minimax-M2.1-Custom",
          "limit": {
            "context": 100000,
            "output": 4096
          }
        }
      }
    }
  },
  "model": "kilocode/gpt-5-nano",
  "mcp": {}
}
"@
        Set-Content -Path $configFile -Value $kilocodeConfig -Encoding UTF8
        Write-Success "Kilocode configured"
    }

    if ($installMcps) {
        Write-Step "Configuring MCP servers..."
        $mcpFile = Join-Path $ConfigDir "mcp.json"
        $homeDir = $env:USERPROFILE -replace '\\','/'
        $mcpConfig = @"
{
  "mcp": {
    "sequential-thinking": {
      "type": "local",
      "command": ["bunx", "@modelcontextprotocol/server-sequential-thinking"],
      "enabled": true
    }
  }
}
"@
        Set-Content -Path $mcpFile -Value $mcpConfig -Encoding UTF8
        Write-Success "Installed MCP server: sequential-thinking"
    }
}

# ─────────────────────────────────────────────────────────────
# Verify
# ─────────────────────────────────────────────────────────────
function Test-Installation {
    Write-Host ""
    Write-Step "Verifying installation..."
    $binary = Join-Path $InstallDir "atomcli.exe"
    if (Test-Path $binary) {
        try {
            $v = & $binary --version 2>$null
            Write-Success "AtomCLI $v ready!"
        } catch {
            Write-Success "AtomCLI installed at $binary"
        }

        if ($script:EnableKilocode) {
            Write-Host ""
            Write-Step "Starting Kilocode authentication..."
            & $binary auth login --provider kilocode
        }
    } else {
        Write-Err "Installation verification failed - binary not found"
        exit 1
    }
}

function Show-Complete {
    param([bool]$Kilocode = $false)
    Write-Host ""
    Write-Host "────────────────────────────────────────────────────────" -ForegroundColor Green
    Write-Host ""
    Write-Success "AtomCLI installed successfully!"
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host ""
    if ($Kilocode) {
        Write-Host "    1. Authenticate with Kilocode:" -ForegroundColor Cyan
        Write-Host "       atomcli auth login --provider kilocode" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "    2. Start coding:" -ForegroundColor Cyan
        Write-Host "       atomcli" -ForegroundColor Cyan
    } else {
        Write-Host "    atomcli" -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Info "  Restart your terminal if 'atomcli' is not found."
    Write-Host ""
    Write-Host "────────────────────────────────────────────────────────" -ForegroundColor Green
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────
# Uninstall
# ─────────────────────────────────────────────────────────────
function Uninstall-AtomCLI {
    Show-Banner
    Write-Host "Uninstalling AtomCLI..." -ForegroundColor Yellow
    Write-Host ""

    $binary = Join-Path $InstallDir "atomcli.exe"
    if (Test-Path $binary) {
        Remove-Item $binary -Force
        Write-Success "Removed $binary"
    } else {
        Write-Info "Binary not found at $binary"
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path","User")
    if ($userPath -like "*$InstallDir*") {
        $newPath = ($userPath -split ';' | Where-Object { $_ -ne $InstallDir }) -join ';'
        [Environment]::SetEnvironmentVariable("Path",$newPath,"User")
        Write-Success "Removed from PATH"
    }


    $completionFile = Join-Path (Join-Path $ConfigDir "completions") "atomcli.ps1"
    $profilePath = $PROFILE.CurrentUserAllHosts
    if (Test-Path -LiteralPath $profilePath) {
        $lines = Get-Content -LiteralPath $profilePath
        $filtered = @()
        $skipNext = $false
        foreach ($line in $lines) {
            if ($skipNext) { $skipNext = $false; if ($line -eq ". '$completionFile'") { continue } }
            if ($line -eq "# AtomCLI tab completion") { $skipNext = $true; continue }
            if ($line -eq ". '$completionFile'") { continue }
            $filtered += $line
        }
        Set-Content -LiteralPath $profilePath -Value $filtered -Encoding UTF8
    }

    Write-Host ""
    Write-Host "  Remove configuration and data? ($ConfigDir)" -ForegroundColor Yellow
    Write-Info "  (includes skills, sessions, settings)"
    Write-Host ""
    $key = [Console]::ReadKey($true)
    Write-Host "  [y/N]: $($key.KeyChar)"
    if ($key.KeyChar -match '^[Yy]$') {
        if (Test-Path $ConfigDir) {
            Remove-Item -Recurse -Force $ConfigDir
            Write-Success "Removed $ConfigDir"
        }
    } else {
        Write-Info "Keeping configuration"
    }

    Write-Host ""
    Write-Success "AtomCLI uninstalled."
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────
# Update
# ─────────────────────────────────────────────────────────────
function Update-AtomCLI {
    Show-Banner
    $progressSteps = if ($RuntimeOnly) { 6 } else { 7 }
    Start-InstallProgress -Total $progressSteps
    Write-Host "Updating AtomCLI..." -ForegroundColor Cyan
    Write-Host ""

    $binary = Join-Path $InstallDir "atomcli.exe"
    if (Test-Path $binary) {
        Write-Info "Found existing installation at $binary"
    } else {
        Write-Warn "AtomCLI not found. Performing fresh installation."
    }

    Set-InstallProgress "System and dependency scan"
    Get-SystemInfo
    Test-Dependencies
    Install-Bun
    Select-Version

    if (-not $RuntimeOnly) {
        Set-InstallProgress "AtomCLI binary"
        Install-Binary -FromSource:($script:InstallFromSource -eq $true)
    } else {
        Write-Info "Binary replacement already completed; repairing release runtime"
    }
    Set-InstallProgress "Browser runtime"
    Install-PlaywrightBrowsers
    Set-InstallProgress "PATH configuration"
    Add-ToPath
    Set-InstallProgress "PowerShell completion"
    Install-Completion
    Set-InstallProgress "Bundled skills"
    Install-SkillsBundle
    Set-InstallProgress "Final verification"
    Test-Installation
    Complete-InstallProgress

    Write-Host ""
    Write-Host "────────────────────────────────────────────────────────" -ForegroundColor Green
    Write-Host ""
    Write-Success "AtomCLI updated successfully!"
    Write-Host ""
    Write-Host "────────────────────────────────────────────────────────" -ForegroundColor Green
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────
# Main install
# ─────────────────────────────────────────────────────────────
function Get-ProcessorEnvArch {
    # Fallback for Windows PowerShell 5.1 on .NET < 4.7.1 where
    # RuntimeInformation.OSArchitecture is absent. PROCESSOR_ARCHITEW6432 wins
    # because it reports the real architecture when the process runs under WOW64.
    $procArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    switch ($procArch) {
        "AMD64" { return "x64" }
        "ARM64" { return "arm64" }
        default { return $null }
    }
}

function Get-SystemInfo {
    $script:OsType = "windows"

    # A missing static property yields $null silently (even under EAP=Stop),
    # so guard before calling methods on it.
    $runtimeArch = $null
    try {
        $osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
        if ($null -ne $osArch) { $runtimeArch = "$osArch".ToLowerInvariant() }
    } catch { }

    $script:ArchType = if (@("x64", "arm64") -contains $runtimeArch) { $runtimeArch } else { Get-ProcessorEnvArch }
    if (@("x64", "arm64") -notcontains $script:ArchType) {
        $seen = if ($runtimeArch) { $runtimeArch } elseif ($env:PROCESSOR_ARCHITECTURE) { $env:PROCESSOR_ARCHITECTURE } else { "unknown" }
        throw "AtomCLI supports Windows x64 and ARM64; detected architecture: $seen"
    }
    Write-Info "OS: $script:OsType | Arch: $script:ArchType"
}

function Install-AtomCLI {
    param([switch]$FromSource)
    Show-Banner
    Start-InstallProgress -Total 8
    Set-InstallProgress "System and dependency scan"
    Get-SystemInfo
    Test-Dependencies
    Install-Bun
    Select-Version
    Set-InstallProgress "AtomCLI binary"
    Install-Binary -FromSource:$FromSource
    Set-InstallProgress "Browser runtime"
    Install-PlaywrightBrowsers
    Set-InstallProgress "PATH configuration"
    Add-ToPath
    Set-InstallProgress "PowerShell completion"
    Install-Completion
    Set-InstallProgress "Configuration"
    Initialize-Config
    Set-InstallProgress "Bundled skills"
    Install-SkillsBundle
    Setup-OptionalFeatures
    Set-InstallProgress "Final verification"
    Test-Installation
    Complete-InstallProgress
    Show-Complete -Kilocode:$script:EnableKilocode
}

# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────
if ($env:ATOMCLI_INSTALLER_LIBRARY_ONLY -eq "1") { return }
elseif ($Help)      { Show-Help }
elseif ($Uninstall) { Uninstall-AtomCLI }
elseif ($Update)    { Update-AtomCLI }
elseif ($Source)    { Install-AtomCLI -FromSource }
else                { Install-AtomCLI }
