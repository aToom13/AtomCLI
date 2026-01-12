# AtomCLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

# Colors
function Write-Color($Text, $Color = "White") {
    Write-Host $Text -ForegroundColor $Color
}

function Write-Step($Text) {
    Write-Host "→ " -ForegroundColor Blue -NoNewline
    Write-Host $Text
}

function Write-Success($Text) {
    Write-Host "✓ " -ForegroundColor Green -NoNewline
    Write-Host $Text
}

function Write-Error2($Text) {
    Write-Host "✗ " -ForegroundColor Red -NoNewline
    Write-Host $Text
}

function Write-Warning2($Text) {
    Write-Host "! " -ForegroundColor Yellow -NoNewline
    Write-Host $Text
}

function Write-Progress2($Step, $Total, $Text) {
    Write-Host "[$Step/$Total] " -ForegroundColor Yellow -NoNewline
    Write-Host $Text
}

# Banner
function Show-Banner {
    Write-Host ""
    Write-Color "     █████╗ ████████╗ ██████╗ ███╗   ███╗   ██████╗██╗     ██╗" Cyan
    Write-Color "    ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║" Cyan
    Write-Color "    ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║" Cyan
    Write-Color "    ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║" Cyan
    Write-Color "    ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║" Cyan
    Write-Color "    ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝" Cyan
    Write-Host ""
    Write-Color "    Terminal AI Coding Assistant - by Atom13" DarkGray
    Write-Host ""
}

# Installation paths
$InstallDir = "$env:LOCALAPPDATA\AtomCLI"
$ConfigDir = "$env:USERPROFILE\.atomcli"

# Check if command exists
function Test-Command($Command) {
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Check dependencies
function Test-Dependencies {
    Write-Host ""
    Write-Host "Checking dependencies..." -ForegroundColor White
    Write-Host ""
    
    $depsOk = $true
    
    # Check Git
    if (Test-Command "git") {
        $gitVersion = (git --version) -replace "git version ", ""
        Write-Success "git $gitVersion"
    } else {
        Write-Error2 "git not found"
        Write-Host "  Install from: https://git-scm.com/download/win" -ForegroundColor DarkGray
        $depsOk = $false
    }
    
    # Check Node.js (optional)
    if (Test-Command "node") {
        $nodeVersion = (node --version) -replace "v", ""
        Write-Success "node v$nodeVersion"
    } else {
        Write-Warning2 "node not found (optional, needed for MCP servers)"
    }
    
    # Check Bun
    if (Test-Command "bun") {
        $bunVersion = bun --version
        Write-Success "bun $bunVersion"
        $script:BunInstalled = $true
    } else {
        Write-Warning2 "bun not found (will be installed)"
        $script:BunInstalled = $false
    }
    
    Write-Host ""
    
    if (-not $depsOk) {
        Write-Error2 "Missing required dependencies. Please install them first."
        exit 1
    }
}

# Install Bun
function Install-Bun {
    if (-not $script:BunInstalled) {
        Write-Step "Installing Bun..."
        
        try {
            # Use official Bun installer for Windows
            irm bun.sh/install.ps1 | iex
            
            # Refresh environment
            $env:BUN_INSTALL = "$env:USERPROFILE\.bun"
            $env:PATH = "$env:BUN_INSTALL\bin;$env:PATH"
            
            if (Test-Command "bun") {
                $bunVersion = bun --version
                Write-Success "Bun $bunVersion installed"
            } else {
                Write-Error2 "Failed to install Bun"
                exit 1
            }
        } catch {
            Write-Error2 "Failed to install Bun: $_"
            exit 1
        }
    }
}

# Install AtomCLI
function Install-AtomCLI {
    Write-Step "Downloading AtomCLI..."
    
    # Create directories
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    
    # Try to download from releases first
    try {
        $releases = Invoke-RestMethod "https://api.github.com/repos/aToom13/AtomCLI/releases/latest" -ErrorAction SilentlyContinue
        $version = $releases.tag_name
        $assetUrl = $releases.assets | Where-Object { $_.name -like "*windows-x64*" } | Select-Object -First 1 -ExpandProperty browser_download_url
        
        if ($assetUrl) {
            Invoke-WebRequest -Uri $assetUrl -OutFile "$InstallDir\atomcli.exe" -UseBasicParsing
            Write-Success "Downloaded AtomCLI $version"
            return
        }
    } catch {
        # Fallback to building from source
    }
    
    # Build from source
    Write-Step "Building from source..."
    
    $tempDir = Join-Path $env:TEMP "atomcli_install_$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    
    Push-Location $tempDir
    
    try {
        Write-Progress2 1 4 "Cloning repository..."
        git clone --depth 1 https://github.com/aToom13/AtomCLI.git 2>&1 | Out-Null
        Write-Success "Cloned repository"
        
        Set-Location AtomCLI
        
        Write-Progress2 2 4 "Installing dependencies..."
        bun install 2>&1 | Out-Null
        Write-Success "Installed dependencies"
        
        Set-Location AtomBase
        
        Write-Progress2 3 4 "Building (this may take a minute)..."
        $buildLog = Join-Path $env:TEMP "atomcli_build.log"
        bun run build --single 2>&1 | Tee-Object -FilePath $buildLog
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error2 "Build failed"
            Write-Host "Build log: $buildLog" -ForegroundColor DarkGray
            exit 1
        }
        Write-Success "Built AtomCLI"
        
        Write-Progress2 4 4 "Locating binary..."
        
        # Find the Windows binary
        $binaryPath = Get-ChildItem -Path "dist" -Recurse -Filter "atomcli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
        
        if (-not $binaryPath) {
            # Try without .exe
            $binaryPath = Get-ChildItem -Path "dist" -Recurse -Filter "atomcli" -ErrorAction SilentlyContinue | 
                          Where-Object { $_.FullName -like "*windows*" } | 
                          Select-Object -First 1 -ExpandProperty FullName
        }
        
        if ($binaryPath) {
            Copy-Item $binaryPath "$InstallDir\atomcli.exe" -Force
            Write-Success "Installed binary from $binaryPath"
        } else {
            Write-Error2 "Could not find built binary"
            exit 1
        }
        
    } finally {
        Pop-Location
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
    
    Write-Success "Installed AtomCLI to $InstallDir"
}

# Setup PATH
function Set-AtomCLIPath {
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    
    if ($currentPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("PATH", "$InstallDir;$currentPath", "User")
        $env:PATH = "$InstallDir;$env:PATH"
        Write-Success "Added to PATH"
    } else {
        Write-Host "  PATH already configured" -ForegroundColor DarkGray
    }
}

# Setup config
function Set-AtomCLIConfig {
    Write-Step "Setting up configuration..."
    
    $configPath = Join-Path $ConfigDir "atomcli.json"
    
    if (-not (Test-Path $configPath)) {
        $config = @{
            mcp = @{
                "memory-bank" = @{
                    type = "local"
                    command = @("npx", "-y", "github:alioshr/memory-bank-mcp")
                    enabled = $true
                }
                "sequential-thinking" = @{
                    type = "local"
                    command = @("npx", "-y", "@modelcontextprotocol/server-sequential-thinking")
                    enabled = $true
                }
            }
        }
        
        $config | ConvertTo-Json -Depth 10 | Set-Content $configPath
        Write-Success "Created default configuration"
    } else {
        Write-Host "  Configuration already exists" -ForegroundColor DarkGray
    }
    
    # Create skills directory
    New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir "skills") | Out-Null
}

# Verify installation
function Test-Installation {
    Write-Host ""
    Write-Step "Verifying installation..."
    
    $atomcliPath = Join-Path $InstallDir "atomcli.exe"
    
    if (Test-Path $atomcliPath) {
        try {
            $version = & $atomcliPath --version 2>&1
            Write-Success "AtomCLI $version ready!"
        } catch {
            Write-Success "AtomCLI installed!"
        }
    } else {
        Write-Error2 "Installation verification failed"
        exit 1
    }
}

# Complete message
function Show-Complete {
    Write-Host ""
    Write-Color "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" Green
    Write-Host ""
    Write-Host "  " -NoNewline
    Write-Color "✓" Green -NoNewline
    Write-Host " " -NoNewline
    Write-Host "AtomCLI installed successfully!" -ForegroundColor White
    Write-Host ""
    Write-Host "  To get started, run:" -ForegroundColor DarkGray
    Write-Host ""
    Write-Color "    atomcli" Cyan
    Write-Host ""
    Write-Host "  Or restart your terminal first if atomcli is not found." -ForegroundColor DarkGray
    Write-Host ""
    Write-Color "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" Green
    Write-Host ""
}

# Main
function Main {
    Show-Banner
    
    Write-Host "  OS: Windows | Arch: $env:PROCESSOR_ARCHITECTURE" -ForegroundColor DarkGray
    
    Test-Dependencies
    Install-Bun
    Install-AtomCLI
    Set-AtomCLIPath
    Set-AtomCLIConfig
    Test-Installation
    Show-Complete
}

# Run
Main
