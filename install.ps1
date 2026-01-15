# AtomCLI Installer for Windows PowerShell
# https://github.com/aToom13/AtomCLI
#
# Install:   irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex
# Uninstall: irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex -Uninstall

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Installation directories
$InstallDir = if ($env:ATOMCLI_INSTALL_DIR) { $env:ATOMCLI_INSTALL_DIR } else { "$env:LOCALAPPDATA\AtomCLI\bin" }
$ConfigDir = if ($env:ATOMCLI_CONFIG_DIR) { $env:ATOMCLI_CONFIG_DIR } else { "$env:USERPROFILE\.atomcli" }

# Colors
function Write-ColorText {
    param([string]$Text, [ConsoleColor]$Color = 'White')
    Write-Host $Text -ForegroundColor $Color -NoNewline
}

# Banner
function Show-Banner {
    Write-Host ""
    Write-Host "     ██████╗ ████████╗ ██████╗ ███╗   ███╗   ██████╗██╗     ██╗" -ForegroundColor Cyan
    Write-Host "    ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║" -ForegroundColor Cyan
    Write-Host "    ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║" -ForegroundColor Cyan
    Write-Host "    ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║" -ForegroundColor Cyan
    Write-Host "    ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║" -ForegroundColor Cyan
    Write-Host "    ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    Terminal AI Coding Assistant - by Atom13" -ForegroundColor DarkGray
    Write-Host ""
}

# Status messages
function Write-Step { param([string]$Message) Write-Host "→ $Message" -ForegroundColor Blue }
function Write-Success { param([string]$Message) Write-Host "✓ $Message" -ForegroundColor Green }
function Write-Error { param([string]$Message) Write-Host "✗ $Message" -ForegroundColor Red }
function Write-Warning { param([string]$Message) Write-Host "! $Message" -ForegroundColor Yellow }
function Write-Info { param([string]$Message) Write-Host "  $Message" -ForegroundColor DarkGray }

# Check if command exists
function Test-Command {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Get OS and Architecture
function Get-SystemInfo {
    $script:OsType = "windows"
    $script:ArchType = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    Write-Info "OS: $script:OsType | Arch: $script:ArchType"
}

# Check dependencies
function Test-Dependencies {
    Write-Host ""
    Write-Host "Checking dependencies..." -ForegroundColor White
    Write-Host ""
    
    $depsOk = $true
    
    # Check git
    if (Test-Command "git") {
        $gitVersion = (git --version) -replace 'git version ', ''
        Write-Success "git $gitVersion"
    } else {
        Write-Error "git not found"
        Write-Info "Install from: https://git-scm.com/download/win"
        $depsOk = $false
    }
    
    # Check Node.js (optional)
    if (Test-Command "node") {
        $nodeVersion = (node --version) -replace 'v', ''
        $nodeMajor = [int]($nodeVersion.Split('.')[0])
        if ($nodeMajor -ge 18) {
            Write-Success "node v$nodeVersion"
        } else {
            Write-Warning "node v$nodeVersion (v18+ recommended for MCP)"
        }
    } else {
        Write-Warning "node not found (optional, needed for MCP servers)"
    }
    
    # Check Bun
    if (Test-Command "bun") {
        $bunVersion = bun --version
        Write-Success "bun $bunVersion"
        $script:BunInstalled = $true
    } else {
        Write-Warning "bun not found (will be installed)"
        $script:BunInstalled = $false
    }
    
    Write-Host ""
    
    if (-not $depsOk) {
        Write-Error "Missing required dependencies. Please install them first."
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
            
            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
            
            if (Test-Command "bun") {
                Write-Success "Bun $(bun --version) installed"
            } else {
                # Try adding common bun paths
                $bunPath = "$env:USERPROFILE\.bun\bin"
                if (Test-Path $bunPath) {
                    $env:Path += ";$bunPath"
                }
            }
        } catch {
            Write-Error "Failed to install Bun: $_"
            exit 1
        }
    }
}

# Get latest release version
function Get-LatestRelease {
    try {
        $response = Invoke-RestMethod -Uri "https://api.github.com/repos/aToom13/AtomCLI/releases/latest" -ErrorAction SilentlyContinue
        return $response.tag_name
    } catch {
        return $null
    }
}

# Download and install binary
function Install-Binary {
    Write-Step "Downloading AtomCLI..."
    
    # Create directories
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    
    $version = Get-LatestRelease
    $binaryName = "atomcli-$script:OsType-$script:ArchType.exe"
    
    if ($version) {
        $url = "https://github.com/aToom13/AtomCLI/releases/download/$version/$binaryName"
        $targetPath = Join-Path $InstallDir "atomcli.exe"
        
        try {
            Invoke-WebRequest -Uri $url -OutFile $targetPath -ErrorAction Stop
            Write-Success "Downloaded AtomCLI $version"
            return $true
        } catch {
            Write-Warning "Binary not found in releases, building from source..."
        }
    }
    
    # Build from source
    Write-Step "Building from source..."
    
    $tempDir = Join-Path $env:TEMP "atomcli-build-$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    
    Push-Location $tempDir
    
    try {
        Write-Step "Cloning repository..."
        git clone --depth 1 https://github.com/aToom13/AtomCLI.git 2>&1 | Out-Null
        Write-Success "Cloned repository"
        
        Set-Location AtomCLI
        
        Write-Step "Installing dependencies..."
        bun install 2>&1 | Out-Null
        Write-Success "Installed dependencies"
        
        Set-Location AtomBase
        
        Write-Host ""
        Write-Host "[1/4] Preparing build environment..." -ForegroundColor Yellow
        Write-Host "[2/4] Running build script..." -ForegroundColor Yellow
        Write-Host "      (This may take 2-5 minutes depending on your system)" -ForegroundColor DarkGray
        
        bun run build 2>&1 | Out-Null
        
        Write-Host "[3/4] Build completed" -ForegroundColor Yellow
        Write-Host "[4/4] Locating binary..." -ForegroundColor Yellow
        
        # Find and copy binary
        $builtBinary = Get-ChildItem -Path "dist" -Filter "atomcli*.exe" -Recurse | Select-Object -First 1
        
        if ($builtBinary) {
            $targetPath = Join-Path $InstallDir "atomcli.exe"
            Copy-Item $builtBinary.FullName -Destination $targetPath -Force
            Write-Success "Installed AtomCLI to $targetPath"
        } else {
            # Windows build might produce different structure
            $distDir = Get-ChildItem -Path "dist" -Directory -Filter "atomcli-windows*" | Select-Object -First 1
            if ($distDir) {
                $exePath = Join-Path $distDir.FullName "bin\atomcli.exe"
                if (Test-Path $exePath) {
                    $targetPath = Join-Path $InstallDir "atomcli.exe"
                    Copy-Item $exePath -Destination $targetPath -Force
                    Write-Success "Installed AtomCLI to $targetPath"
                }
            }
        }
    } finally {
        Pop-Location
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
}

# Add to PATH
function Add-ToPath {
    Write-Step "Adding to PATH..."
    
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    
    if ($userPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
        $env:Path += ";$InstallDir"
        Write-Success "Added $InstallDir to PATH"
    } else {
        Write-Info "Already in PATH"
    }
}

# Create default configuration
function Initialize-Config {
    Write-Step "Setting up configuration..."
    
    $configFile = Join-Path $ConfigDir "atomcli.json"
    
    if (-not (Test-Path $configFile)) {
        $defaultConfig = @{
            provider = @{}
            mcp = @{}
        } | ConvertTo-Json -Depth 10
        
        Set-Content -Path $configFile -Value $defaultConfig -Encoding UTF8
        Write-Success "Created default configuration"
    } else {
        Write-Info "Configuration already exists"
    }
}

# Uninstall
function Uninstall-AtomCLI {
    Show-Banner
    Write-Host "Uninstalling AtomCLI..." -ForegroundColor Yellow
    Write-Host ""
    
    # Remove binary
    $binaryPath = Join-Path $InstallDir "atomcli.exe"
    if (Test-Path $binaryPath) {
        Remove-Item $binaryPath -Force
        Write-Success "Removed $binaryPath"
    }
    
    # Remove from PATH
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -like "*$InstallDir*") {
        $newPath = ($userPath -split ';' | Where-Object { $_ -ne $InstallDir }) -join ';'
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Success "Removed from PATH"
    }
    
    # Ask about config
    Write-Host ""
    $removeConfig = Read-Host "Remove configuration directory ($ConfigDir)? [y/N]"
    if ($removeConfig -eq 'y' -or $removeConfig -eq 'Y') {
        if (Test-Path $ConfigDir) {
            Remove-Item -Recurse -Force $ConfigDir
            Write-Success "Removed configuration"
        }
    }
    
    Write-Host ""
    Write-Success "AtomCLI has been uninstalled."
    Write-Host ""
}

# Main installation
function Install-AtomCLI {
    Show-Banner
    Get-SystemInfo
    Test-Dependencies
    Install-Bun
    Install-Binary
    Add-ToPath
    Initialize-Config
    
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host ""
    Write-Success "AtomCLI installed successfully!"
    Write-Host ""
    Write-Host "  To get started, run:" -ForegroundColor White
    Write-Host ""
    Write-Host "    atomcli" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Or open a new terminal and run 'atomcli'" -ForegroundColor DarkGray
    Write-Host ""
}

# Entry point
if ($Uninstall) {
    Uninstall-AtomCLI
} else {
    Install-AtomCLI
}
