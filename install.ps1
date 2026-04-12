# AtomCLI Installer for Windows PowerShell
# https://github.com/aToom13/AtomCLI
#
# Install:   irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex
# Uninstall: irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex; Uninstall-AtomCLI
# Update:    irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex; Update-AtomCLI
# Source:    irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex; Install-AtomCLI -FromSource

param(
    [switch]$Uninstall,
    [switch]$Update,
    [switch]$Source,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# Installation directories
$InstallDir = if ($env:ATOMCLI_INSTALL_DIR) { $env:ATOMCLI_INSTALL_DIR } else { "$env:LOCALAPPDATA\AtomCLI\bin" }
$ConfigDir  = if ($env:ATOMCLI_CONFIG_DIR)  { $env:ATOMCLI_CONFIG_DIR  } else { "$env:USERPROFILE\.atomcli" }

# ─────────────────────────────────────────────────────────────
# Output helpers
# ─────────────────────────────────────────────────────────────
function Write-Step    { param([string]$M) Write-Host "-> $M" -ForegroundColor Blue }
function Write-Success { param([string]$M) Write-Host "v  $M" -ForegroundColor Green }
function Write-Err     { param([string]$M) Write-Host "x  $M" -ForegroundColor Red }
function Write-Warn    { param([string]$M) Write-Host "!  $M" -ForegroundColor Yellow }
function Write-Info    { param([string]$M) Write-Host "   $M" -ForegroundColor DarkGray }

function Show-Banner {
    Write-Host ""
    Write-Host "    ███████╗ ██████╗ ███████╗  ███╗ ███     ██████╗██╗     ██╗" -ForegroundColor Cyan
    Write-Host "    ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║" -ForegroundColor Cyan
    Write-Host "    ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║" -ForegroundColor Cyan
    Write-Host "    ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║" -ForegroundColor Cyan
    Write-Host "    ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║" -ForegroundColor Cyan
    Write-Host "    ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝" -ForegroundColor Cyan
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

    # ── Node.js ───────────────────────────────────────────────
    $script:NodeOk = $false
    if (Test-Command "node") {
        $nv = (node --version) -replace 'v',''
        $major = [int]($nv.Split('.')[0])
        if ($major -ge 18) {
            Write-Success "node v$nv"
            $script:NodeOk = $true
        } else {
            Write-Warn "node v$nv is too old (18+ required for MCP)"
            $script:NodeOk = $false
        }
    } else {
        Write-Warn "node not found (needed for MCP servers and Playwright)"
    }

    if (-not $script:NodeOk) {
        if (Test-WingetAvailable) {
            Write-Step "Installing Node.js LTS via winget..."
            winget install --id OpenJS.NodeJS.LTS -e --source winget `
                --accept-package-agreements --accept-source-agreements `
                --silent 2>&1 | Out-Null
            Refresh-Path
            if (Test-Command "node") {
                $nv = (node --version) -replace 'v',''
                Write-Success "node v$nv installed"
                $script:NodeOk = $true
            } else {
                Write-Warn "Node.js install failed. MCP servers will not work."
            }
        } else {
            Write-Warn "winget not available. Node.js install skipped."
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
            powershell -c "irm bun.sh/install.ps1 | iex" 2>&1 | Out-Null
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

# ─────────────────────────────────────────────────────────────
# Version selection menu
# ─────────────────────────────────────────────────────────────
function Select-Version {
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
    $binaryName = "atomcli-windows-x64.exe"

    if ($version) {
        $url        = "https://github.com/aToom13/AtomCLI/releases/download/$version/$binaryName"
        $targetPath = Join-Path $InstallDir "atomcli.exe"
        try {
            Invoke-WithSpinner -Message "Downloading $version..." -Action {
                param($u, $t)
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $web = New-Object System.Net.WebClient
                $web.DownloadFile($u, $t)
            } -ArgumentList $url, $targetPath

            # fallback — spinner runs in job so file written there; re-run direct
            if (-not (Test-Path $targetPath) -or (Get-Item $targetPath).Length -eq 0) {
                throw "Empty download"
            }
            Write-Success "Downloaded AtomCLI $version"
            return
        } catch {
            Write-Warn "Binary not found in releases, falling back to source build... ($($_.Exception.Message))"
        }
    }

    Invoke-SourceBuild
}

function Invoke-SourceBuild {
    Write-Step "Building from source..."
    Write-Info "(First install can take 10-20 min on slow connections)"
    Write-Host ""

    $tempDir = Join-Path $env:TEMP "atomcli-build-$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    Push-Location $tempDir

    try {
        # Clone
        Write-Step "Cloning repository..."
        $cloneJob = Start-Job -ScriptBlock { param($wd); Set-Location $wd; git clone --depth 1 https://github.com/aToom13/AtomCLI.git 2>&1 } -ArgumentList $tempDir
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

        # Install Playwright package in AtomBase
        Write-Step "Installing Playwright package..."
        Push-Location AtomBase
        $pwPkg = Start-Job -ScriptBlock { param($wd); Set-Location $wd; bun add playwright 2>&1 } -ArgumentList $PWD.Path
        $pi = 0
        while ($pwPkg.State -eq 'Running') {
            Write-Host "`r$($chars[$pi % 4]) Installing Playwright...   " -NoNewline -ForegroundColor Blue
            Start-Sleep -Milliseconds 200; $pi++
        }
        Write-Host "`r                                    `r" -NoNewline
        Receive-Job $pwPkg | Out-Null; Remove-Job $pwPkg
        Write-Success "Playwright package installed"
        Pop-Location

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
    if (-not $script:NodeOk) {
        Write-Warn "Skipping Playwright browsers (Node.js not available)"
        return
    }

    $playwrightDir = Join-Path $ConfigDir "playwright"
    New-Item -ItemType Directory -Force -Path $playwrightDir | Out-Null

    if (Test-Path (Join-Path $playwrightDir "node_modules\playwright")) {
        Write-Success "Playwright already installed"
        return
    }

    Push-Location $playwrightDir
    try {
        Write-Step "Installing Playwright package..."
        $pwJob = Start-Job -ScriptBlock { param($wd); Set-Location $wd; bun init -y 2>&1; bun add playwright 2>&1 } -ArgumentList $PWD.Path
        $chars = @('|','/','-','\'); $pi = 0
        while ($pwJob.State -eq 'Running') {
            Write-Host "`r$($chars[$pi % 4]) Installing Playwright package...   " -NoNewline -ForegroundColor Blue
            Start-Sleep -Milliseconds 200; $pi++
        }
        Write-Host "`r                                          `r" -NoNewline
        Receive-Job $pwJob | Out-Null; Remove-Job $pwJob

        if (Test-Path (Join-Path $playwrightDir "node_modules\playwright")) {
            Write-Success "Playwright package installed"

            Write-Step "Installing Chromium browser..."
            Write-Info "(may take 1-2 minutes)"
            $chromJob = Start-Job -ScriptBlock { param($wd); Set-Location $wd; bunx playwright install chromium 2>&1 } -ArgumentList $PWD.Path
            $ci2 = 0
            while ($chromJob.State -eq 'Running') {
                Write-Host "`r$($chars[$ci2 % 4]) Downloading Chromium... ($ci2`s)   " -NoNewline -ForegroundColor Blue
                Start-Sleep -Seconds 1; $ci2++
                if ($ci2 -gt 300) { Stop-Job $chromJob; Write-Warn "Chromium download timed out"; break }
            }
            Write-Host "`r                                              `r" -NoNewline
            Receive-Job $chromJob -ErrorAction SilentlyContinue | Out-Null
            Remove-Job $chromJob -ErrorAction SilentlyContinue
            Write-Success "Chromium installed"
        } else {
            Write-Warn "Could not install Playwright package"
            Write-Info "Run manually: cd $playwrightDir && bun add playwright && bunx playwright install chromium"
        }
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
    Write-Host "  |  Default Skills                             |" -ForegroundColor Magenta
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Magenta
    Write-Host "  |  - Ralph        AI assistant personality   |" -ForegroundColor DarkGray
    Write-Host "  |  - Code Review  automatic code analysis    |" -ForegroundColor DarkGray
    Write-Host "  |  - Git Commit   smart commit messages      |" -ForegroundColor DarkGray
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Magenta
    Write-Host ""
    $installSkills = Prompt-YesNo "Install default skills?"
    if ($installSkills) { Write-Success "Default skills will be installed" } else { Write-Info "Skipping skills" }
    Write-Host ""

    # ── MCP Servers ──────────────────────────────────────────
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Yellow
    Write-Host "  |  MCP Servers (Model Context Protocol)      |" -ForegroundColor Yellow
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Yellow
    Write-Host "  |  - Seq-Thinking   complex reasoning        |" -ForegroundColor DarkGray
    Write-Host "  |  (Requires Node.js 18+)                    |" -ForegroundColor DarkGray
    Write-Host "  +─────────────────────────────────────────────+" -ForegroundColor Yellow
    Write-Host ""
    $installMcps = $false
    if ($script:NodeOk) {
        $installMcps = Prompt-YesNo "Install default MCP servers?"
        if ($installMcps) { Write-Success "MCP servers will be installed" } else { Write-Info "Skipping MCP servers" }
    } else {
        Write-Warn "Node.js 18+ not available - skipping MCP servers"
    }
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

    if ($installSkills) {
        Write-Step "Installing default skills..."
        $skillsDir = Join-Path $ConfigDir "skills"

        $ralph = Join-Path $skillsDir "ralph"
        New-Item -ItemType Directory -Force -Path $ralph | Out-Null
        Set-Content -Path (Join-Path $ralph "SKILL.md") -Value @"
---
name: Ralph
description: Friendly AI coding assistant with personality
---

You are Ralph, a friendly and enthusiastic AI coding assistant. You have a warm personality and enjoy helping developers solve problems.

Your traits:
- Encouraging and supportive
- Uses casual, friendly language
- Celebrates wins with the user
- Explains concepts clearly
- Occasionally uses emoji to express enthusiasm
"@ -Encoding UTF8

        $cr = Join-Path $skillsDir "code-review"
        New-Item -ItemType Directory -Force -Path $cr | Out-Null
        Set-Content -Path (Join-Path $cr "SKILL.md") -Value @"
---
name: Code Review
description: Automated code review with best practices
---

When reviewing code, analyze for:
1. Security - vulnerabilities, injection risks
2. Performance - inefficiencies, memory leaks
3. Readability - naming, structure, comments
4. Best Practices - patterns, error handling
5. Tests - coverage, edge cases

Provide specific, actionable feedback with line references.
"@ -Encoding UTF8

        $gc = Join-Path $skillsDir "git-commit"
        New-Item -ItemType Directory -Force -Path $gc | Out-Null
        Set-Content -Path (Join-Path $gc "SKILL.md") -Value @"
---
name: Git Commit
description: Generate conventional commit messages
---

Generate commit messages following Conventional Commits format:

<type>(<scope>): <description>

[optional body]

Types: feat, fix, docs, style, refactor, test, chore
Keep first line under 72 characters.
"@ -Encoding UTF8

        Write-Success "Installed 3 default skills"
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
      "command": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
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
    Write-Host "Updating AtomCLI..." -ForegroundColor Cyan
    Write-Host ""

    $binary = Join-Path $InstallDir "atomcli.exe"
    if (Test-Path $binary) {
        Write-Info "Found existing installation at $binary"
    } else {
        Write-Warn "AtomCLI not found. Performing fresh installation."
    }

    Get-SystemInfo
    Test-Dependencies
    Install-Bun
    Select-Version

    Install-Binary -FromSource:($script:InstallFromSource -eq $true)
    Add-ToPath
    Test-Installation

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
function Get-SystemInfo {
    $script:OsType   = "windows"
    $script:ArchType = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    Write-Info "OS: $script:OsType | Arch: $script:ArchType"
}

function Install-AtomCLI {
    param([switch]$FromSource)
    Show-Banner
    Get-SystemInfo
    Test-Dependencies
    Install-Bun
    Select-Version
    Install-Binary -FromSource:$FromSource
    Install-PlaywrightBrowsers
    Add-ToPath
    Initialize-Config
    Setup-OptionalFeatures
    Test-Installation
    Show-Complete -Kilocode:$script:EnableKilocode
}

# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────
if ($Help)      { Show-Help }
elseif ($Uninstall) { Uninstall-AtomCLI }
elseif ($Update)    { Update-AtomCLI }
elseif ($Source)    { Install-AtomCLI -FromSource }
else                { Install-AtomCLI }