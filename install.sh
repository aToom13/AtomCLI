#!/bin/bash
# AtomCLI Installer - https://github.com/aToom13/AtomCLI
# 
# Install:   curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash
# Uninstall: curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash -s -- --uninstall

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Symbols
CHECK="✓"
CROSS="✗"
ARROW="→"
SPINNER="◐◓◑◒"

# Installation directory - all under ~/.atomcli/
INSTALL_DIR="${ATOMCLI_INSTALL_DIR:-$HOME/.atomcli/bin}"
CONFIG_DIR="${ATOMCLI_CONFIG_DIR:-$HOME/.atomcli}"

# Banner
print_banner() {
    echo ""
    echo -e "${CYAN}"
    echo "     █████╗ ████████╗ ██████╗ ███╗   ███╗   ██████╗██╗     ██╗"
    echo "    ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║"
    echo "    ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║"
    echo "    ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║"
    echo "    ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║"
    echo "    ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝"
    echo -e "${NC}"
    echo -e "${DIM}    Terminal AI Coding Assistant - by Atom13${NC}"
    echo ""
}

# Spinner animation
spin() {
    local pid=$1
    local msg=$2
    local i=0
    while kill -0 $pid 2>/dev/null; do
        i=$(( (i+1) % 4 ))
        printf "\r${BLUE}${SPINNER:$i:1}${NC} ${msg}"
        sleep 0.1
    done
    printf "\r"
}

# Print step
step() {
    echo -e "${BLUE}${ARROW}${NC} $1"
}

# Print success
success() {
    echo -e "${GREEN}${CHECK}${NC} $1"
}

# Print error
error() {
    echo -e "${RED}${CROSS}${NC} $1"
}

# Print warning
warn() {
    echo -e "${YELLOW}!${NC} $1"
}

# Print info
info() {
    echo -e "${DIM}  $1${NC}"
}

# Detect OS
detect_os() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    
    case "$OS" in
        Linux*)     
            if [ -f /etc/NIXOS ] || grep -q "ID=nixos" /etc/os-release 2>/dev/null; then
                OS_TYPE="nixos"
            else
                OS_TYPE="linux" 
            fi
            ;;
        Darwin*)    OS_TYPE="darwin" ;;
        MINGW*|MSYS*|CYGWIN*) OS_TYPE="windows" ;;
        *)          OS_TYPE="unknown" ;;
    esac
    
    case "$ARCH" in
        x86_64|amd64)   ARCH_TYPE="x64" ;;
        aarch64|arm64)  ARCH_TYPE="arm64" ;;
        *)              ARCH_TYPE="unknown" ;;
    esac
}

# Check if command exists
has() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
check_dependencies() {
    echo ""
    echo -e "${BOLD}Checking dependencies...${NC}"
    echo ""
    
    local deps_ok=true
    
    # Check git
    if has git; then
        success "git $(git --version | cut -d' ' -f3)"
    else
        error "git not found"
        deps_ok=false
    fi
    
    # Check curl or wget
    if has curl; then
        success "curl $(curl --version | head -1 | cut -d' ' -f2)"
    elif has wget; then
        success "wget $(wget --version | head -1 | cut -d' ' -f3)"
    else
        error "curl or wget not found"
        deps_ok=false
    fi
    
    # Check Node.js (optional but recommended for MCP)
    if has node; then
        local node_version=$(node --version | cut -c2-)
        local node_major=$(echo $node_version | cut -d. -f1)
        if [ "$node_major" -ge 18 ]; then
            success "node v${node_version}"
        else
            warn "node v${node_version} (v18+ recommended for MCP)"
        fi
    else
        warn "node not found (optional, needed for MCP servers)"
    fi
    
    # Check Bun (will install if missing, except on NixOS)
    if has bun; then
        success "bun $(bun --version)"
        BUN_INSTALLED=true
    else
        if [ "$OS_TYPE" = "nixos" ]; then
            error "bun not found. On NixOS, please install bun manually."
            info "  Example: environment.systemPackages = [ pkgs.bun ];"
            info "  Or run inside a shell: nix-shell -p bun"
            exit 1
        else
            warn "bun not found (will be installed)"
            BUN_INSTALLED=false
        fi
    fi
    
    echo ""
    
    if [ "$deps_ok" = false ]; then
        error "Missing required dependencies. Please install them first."
        exit 1
    fi
}

# Install Bun if needed
install_bun() {
    if [ "$BUN_INSTALLED" = false ]; then
        step "Installing Bun..."
        curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 &
        spin $! "Installing Bun..."
        
        # Source bun
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"
        
        if has bun; then
            success "Bun $(bun --version) installed"
        else
            error "Failed to install Bun"
            exit 1
        fi
    fi
}

# Get latest release
get_latest_release() {
    if has curl; then
        curl -fsSL "https://api.github.com/repos/aToom13/AtomCLI/releases/latest" 2>/dev/null | grep '"tag_name"' | cut -d'"' -f4
    else
        wget -qO- "https://api.github.com/repos/aToom13/AtomCLI/releases/latest" 2>/dev/null | grep '"tag_name"' | cut -d'"' -f4
    fi
}

# Download and install binary
install_binary() {
    step "Downloading AtomCLI..."
    
    # NixOS Special Logic: Source Install
    if [ "$OS_TYPE" = "nixos" ]; then
        info "NixOS detected: Performing source installation..."
        
        local SOURCE_DIR="$HOME/.local/share/atomcli/source"
        mkdir -p "$SOURCE_DIR"
        mkdir -p "$INSTALL_DIR"
        mkdir -p "$CONFIG_DIR"
        
        # Clone or update repo
        if [ -d "$SOURCE_DIR/.git" ]; then
            step "Updating source..."
            cd "$SOURCE_DIR"
            git pull >/dev/null 2>&1
        else
            step "Cloning repository..."
            rm -rf "$SOURCE_DIR"
            git clone --depth 1 https://github.com/aToom13/AtomCLI.git "$SOURCE_DIR" >/dev/null 2>&1
        fi
        
        if [ $? -ne 0 ]; then
            error "Failed to obtain source code"
            exit 1
        fi
        success "Source code ready"
        
        step "Installing dependencies..."
        cd "$SOURCE_DIR/AtomBase"
        bun install >/dev/null 2>&1
        if [ $? -ne 0 ]; then
            error "Failed to install dependencies"
            exit 1
        fi
        success "Dependencies installed"
        
        step "Installing Playwright browsers..."
        bunx playwright install chromium >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            success "Playwright browsers installed"
        else
            warn "Could not install Playwright browsers automatically"
            info "Run manually: cd $SOURCE_DIR/AtomBase && bunx playwright install chromium"
        fi
        
        step "Creating wrapper script..."
        cat > "$INSTALL_DIR/atomcli" << EOF
#!/bin/sh
export ATOMCLI_INSTALL_DIR="$SOURCE_DIR"
export ATOMCLI_CWD="\$PWD"
export NIXPKGS_ALLOW_UNFREE=1
export NODE_PATH="$SOURCE_DIR/AtomBase/node_modules:\$NODE_PATH"

cd "$SOURCE_DIR/AtomBase" || exit 1

if [ -f /etc/NIXOS ]; then
    # On NixOS, try using steam-run for native module compatibility
    if command -v steam-run >/dev/null 2>&1; then
        exec steam-run bun run src/index.ts "\$@"
    else
        # If steam-run is not in PATH, try via nix-shell (cached)
        # We construct the command string carefully to preserve arguments
        CMD="steam-run bun run src/index.ts"
        for arg in "\$@"; do
            CMD="\$CMD \"\$arg\""
        done
        exec nix-shell -p steam-run nodejs_22 --run "\$CMD"
    fi
else
    exec bun run src/index.ts "\$@"
fi
EOF
        chmod +x "$INSTALL_DIR/atomcli"
        success "Installed wrapper to $INSTALL_DIR/atomcli"
        return 0
    fi

    # Try to get from releases first
    # Try to get from releases first
    local version=""
    if [ -n "$VERSION" ]; then
        # Ensure starts with v
        case "$VERSION" in
            v*) version="$VERSION" ;;
            *) version="v$VERSION" ;;
        esac
    else
        version=$(get_latest_release)
    fi
    local binary_name="atomcli-${OS_TYPE}-${ARCH_TYPE}"
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$CONFIG_DIR"
    
    if [ -n "$version" ]; then
        local url="https://github.com/aToom13/AtomCLI/releases/download/${version}/${binary_name}"
        local tmp_binary="$(mktemp)"
        
        # progress bar if possible
        if has curl; then
            # Check if we can download successfully
            if curl -fsSL "$url" -o "$tmp_binary"; then
                if [ -s "$tmp_binary" ]; then
                    chmod +x "$tmp_binary"
                    mv "$tmp_binary" "$INSTALL_DIR/atomcli"
                    success "Downloaded AtomCLI ${version}"
                    return 0
                fi
            fi
        elif has wget; then
            if wget -q "$url" -O "$tmp_binary"; then
                if [ -s "$tmp_binary" ]; then
                    chmod +x "$tmp_binary"
                    mv "$tmp_binary" "$INSTALL_DIR/atomcli"
                    success "Downloaded AtomCLI ${version}"
                    return 0
                fi
            fi
        fi
        
        # Clean up temp file if failed
        rm -f "$tmp_binary"
        warn "Download failed or file empty, attempting build from source..."
    fi
    
    # Fallback: build from source
    warn "No prebuilt binary available for ${OS_TYPE}-${ARCH_TYPE}"
    step "Building from source..."
    echo -e "${DIM}    (First-time install can take 10-20 minutes on slow connections)${NC}"
    echo ""
    
    local tmp_dir=$(mktemp -d)
    cd "$tmp_dir"
    
    step "Cloning repository..."
    git clone --depth 1 https://github.com/aToom13/AtomCLI.git >/dev/null 2>&1
    if [ $? -ne 0 ]; then
        error "Failed to clone repository"
        exit 1
    fi
    success "Cloned repository"
    
    cd AtomCLI
    
    step "Installing dependencies..."
    echo -e "${DIM}    (This may take 1-3 minutes on first install)${NC}"
    
    local deps_log="/tmp/atomcli_deps_$$.log"
    
    # Run bun install with timeout and progress indicator
    (bun install > "$deps_log" 2>&1) &
    local pid=$!
    local elapsed=0
    local timeout_secs=900  # 15 minute timeout for slow connections
    
    while kill -0 $pid 2>/dev/null; do
        elapsed=$((elapsed + 1))
        if [ $elapsed -ge $timeout_secs ]; then
            kill $pid 2>/dev/null
            error "Dependency installation timed out after ${timeout_secs}s"
            echo -e "${DIM}Last 10 lines of log:${NC}"
            tail -10 "$deps_log" 2>/dev/null || echo "(no log)"
            exit 1
        fi
        # Show progress every 5 seconds
        if [ $((elapsed % 5)) -eq 0 ]; then
            printf "\r${BLUE}◐${NC} Installing dependencies... ${DIM}(${elapsed}s)${NC}  "
        fi
        sleep 1
    done
    
    wait $pid
    local exit_code=$?
    printf "\r"  # Clear progress line
    
    if [ $exit_code -ne 0 ]; then
        error "Failed to install dependencies"
        echo -e "${DIM}Last 20 lines of log:${NC}"
        tail -20 "$deps_log" 2>/dev/null || echo "(no log)"
        exit 1
    fi
    success "Installed dependencies"
    
    # Install Playwright package explicitly in AtomBase
    step "Installing Playwright package..."
    (cd AtomBase && bun add playwright > /dev/null 2>&1) || warn "Could not install playwright package"
    success "Playwright package installed"
    
    # Install Playwright browsers
    step "Installing Playwright browsers..."
    echo -e "${DIM}    (This may take 1-2 minutes)${NC}"
    
    local playwright_log="/tmp/atomcli_playwright_$$.log"
    (cd AtomBase && bunx playwright install chromium > "$playwright_log" 2>&1) &
    local pw_pid=$!
    local pw_elapsed=0
    local pw_timeout=300  # 5 minute timeout
    
    while kill -0 $pw_pid 2>/dev/null; do
        pw_elapsed=$((pw_elapsed + 1))
        if [ $pw_elapsed -ge $pw_timeout ]; then
            kill $pw_pid 2>/dev/null
            warn "Playwright browser installation timed out"
            info "You can install manually later: bunx playwright install chromium"
            break
        fi
        # Show progress every 5 seconds
        if [ $((pw_elapsed % 5)) -eq 0 ]; then
            printf "\r${BLUE}◐${NC} Installing Playwright browsers... ${DIM}(${pw_elapsed}s)${NC}  "
        fi
        sleep 1
    done
    
    wait $pw_pid 2>/dev/null
    printf "\r"  # Clear progress line
    success "Installed Playwright browsers"
    
    cd AtomBase
    echo ""
    echo -e "${YELLOW}[1/4]${NC} Preparing build environment..."
    
    # Create a log file for debugging
    local build_log="/tmp/atomcli_build_$$.log"
    
    echo -e "${YELLOW}[2/4]${NC} Running build script..."
    echo -e "${DIM}    (This may take 2-5 minutes depending on your system)${NC}"
    echo -e "${DIM}    Build log: $build_log${NC}"
    
    # Run build with progress indicator (timeout command not available on macOS)
    (bun run build --single > "$build_log" 2>&1) &
    local build_pid=$!
    local build_elapsed=0
    local build_timeout=1200  # 20 minute timeout for build
    
    while kill -0 $build_pid 2>/dev/null; do
        build_elapsed=$((build_elapsed + 1))
        if [ $build_elapsed -ge $build_timeout ]; then
            kill $build_pid 2>/dev/null
            error "Build timed out after ${build_timeout}s"
            echo -e "${DIM}Last 20 lines of build log:${NC}"
            tail -20 "$build_log" 2>/dev/null || echo "(no log)"
            exit 1
        fi
        # Show progress every 10 seconds
        if [ $((build_elapsed % 10)) -eq 0 ]; then
            printf "\r${BLUE}◐${NC} Building... ${DIM}(${build_elapsed}s)${NC}  "
        fi
        sleep 1
    done
    
    wait $build_pid
    local build_exit=$?
    printf "\r"  # Clear progress line
    
    if [ $build_exit -eq 0 ]; then
        echo -e "${YELLOW}[3/4]${NC} Build completed"
        success "Built AtomCLI"
    else
        error "Build failed (exit code: $build_exit)"
        echo ""
        echo -e "${DIM}Last 20 lines of build log:${NC}"
        tail -20 "$build_log" 2>/dev/null || echo "(no log available)"
        echo ""
        info "Full log available at: $build_log"
        exit 1
    fi
    
    echo -e "${YELLOW}[4/4]${NC} Locating binary..."
    
    # Detect libc type
    local libc_type="glibc"
    if ldd --version 2>&1 | grep -qi musl; then
        libc_type="musl"
    fi
    info "Detected libc: $libc_type"
    
    # Find and copy binary - prefer matching libc type
    local binary_path=""
    
    # First try exact match for our libc type (avoid musl if glibc)
    if [ "$libc_type" = "glibc" ]; then
        # Prefer non-musl version
        binary_path=$(find dist -path "*linux-x64/bin/atomcli" -type f ! -path "*musl*" 2>/dev/null | head -1)
        if [ -z "$binary_path" ]; then
            binary_path=$(find dist -path "*linux-arm64/bin/atomcli" -type f ! -path "*musl*" 2>/dev/null | head -1)
        fi
    else
        # Prefer musl version
        binary_path=$(find dist -path "*musl*/bin/atomcli" -type f 2>/dev/null | head -1)
    fi
    
    # Fallback: any atomcli binary (excluding musl if glibc)
    if [ -z "$binary_path" ]; then
        if [ "$libc_type" = "glibc" ]; then
            binary_path=$(find dist -name "atomcli" -type f ! -path "*musl*" 2>/dev/null | head -1)
        else
            binary_path=$(find dist -name "atomcli" -type f 2>/dev/null | head -1)
        fi
    fi
    
    # Fallback: find any atomcli binary
    if [ -z "$binary_path" ]; then
        binary_path=$(find dist -name "atomcli" -type f -executable 2>/dev/null | head -1)
    fi
    
    if [ -n "$binary_path" ] && [ -f "$binary_path" ]; then
        cp "$binary_path" "$INSTALL_DIR/atomcli"
        chmod +x "$INSTALL_DIR/atomcli"
        success "Installed binary from $binary_path"
    else
        error "Could not find built binary in dist/"
        info "Available files:"
        find dist -name "atomcli" 2>/dev/null || echo "  (none)"
        exit 1
    fi
    
    # Cleanup
    cd /
    rm -rf "$tmp_dir"
    
    success "Installed AtomCLI to $INSTALL_DIR"
    
    # Setup Playwright for browser tool (plug and play)
    step "Setting up Playwright for browser tool..."
    
    local playwright_dir="$CONFIG_DIR/playwright"
    mkdir -p "$playwright_dir"
    
    if [ ! -d "$playwright_dir/node_modules/playwright" ]; then
        cd "$playwright_dir"
        
        if has bun; then
            step "Installing Playwright package via bun..."
            bun init -y > /dev/null 2>&1 || true
            (bun add playwright > /dev/null 2>&1) &
            spin $! "Installing Playwright package..."
            
            if [ -d "node_modules/playwright" ]; then
                success "Playwright package installed"
                
                step "Installing Chromium browser..."
                (bunx playwright install chromium > /dev/null 2>&1) &
                spin $! "Installing Chromium..."
                success "Chromium installed"
                
                # Try to install system deps
                if command -v sudo >/dev/null 2>&1; then
                    info "Installing system dependencies (may require password)..."
                    sudo bunx playwright install-deps chromium 2>/dev/null || warn "Could not auto-install system deps"
                fi
            else
                warn "Could not install Playwright package"
            fi
        elif has npm; then
            step "Installing Playwright package via npm..."
            npm init -y > /dev/null 2>&1 || true
            (npm install playwright > /dev/null 2>&1) &
            spin $! "Installing Playwright package..."
            
            if [ -d "node_modules/playwright" ]; then
                success "Playwright package installed"
                
                step "Installing Chromium browser..."
                (npx playwright install chromium > /dev/null 2>&1) &
                spin $! "Installing Chromium..."
                success "Chromium installed"
                
                # Try to install system deps
                if command -v sudo >/dev/null 2>&1; then
                    info "Installing system dependencies (may require password)..."
                    sudo npx playwright install-deps chromium 2>/dev/null || warn "Could not auto-install system deps"
                fi
            else
                warn "Could not install Playwright package"
            fi
        else
            warn "Neither bun nor npm found. Browser tool may not work."
            info "To install Playwright manually, run:"
            info "  npm install playwright && npx playwright install chromium"
        fi
        
        cd - > /dev/null
    else
        success "Playwright already installed"
    fi
    
    # Set NODE_PATH hint for atomcli
    info "Note: If browser tool still fails, ensure NODE_PATH includes: $playwright_dir/node_modules"
}

# Setup PATH
setup_path() {
    local shell_rc=""
    local path_line="export PATH=\"$INSTALL_DIR:\$PATH\""
    
    # Detect shell
    case "$SHELL" in
        */zsh)  shell_rc="$HOME/.zshrc" ;;
        */bash) 
            if [ -f "$HOME/.bashrc" ]; then
                shell_rc="$HOME/.bashrc"
            else
                shell_rc="$HOME/.bash_profile"
            fi
            ;;
        */fish) shell_rc="$HOME/.config/fish/config.fish" ;;
        *)      shell_rc="$HOME/.profile" ;;
    esac
    
    # Check if already in PATH
    if echo "$PATH" | grep -q "$INSTALL_DIR"; then
        info "PATH already configured"
        return 0
    fi
    
    # Add to shell config
    if [ -n "$shell_rc" ]; then
        echo "" >> "$shell_rc"
        echo "# AtomCLI" >> "$shell_rc"
        echo "$path_line" >> "$shell_rc"
        success "Added to PATH in $shell_rc"
    fi
    
    # Also add Bun to PATH if needed
    if [ "$BUN_INSTALLED" = false ]; then
        echo "export BUN_INSTALL=\"\$HOME/.bun\"" >> "$shell_rc"
        echo "export PATH=\"\$BUN_INSTALL/bin:\$PATH\"" >> "$shell_rc"
    fi
    
    export PATH="$INSTALL_DIR:$PATH"
}

# Setup default config
setup_config() {
    step "Setting up configuration..."
    
    # Create config directory
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$CONFIG_DIR/skills"
    
    # Create default config if doesn't exist
    if [ ! -f "$CONFIG_DIR/atomcli.json" ]; then
        cat > "$CONFIG_DIR/atomcli.json" << 'EOF'
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
EOF
        success "Created default configuration"
    else
        info "Configuration already exists"
    fi
}

# Interactive setup for optional features
setup_optional_features() {
    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  Optional Features${NC}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # Check if running interactively (not piped and tty available)
    if [ ! -t 0 ] || [ ! -e /dev/tty ]; then
        info "Non-interactive mode: skipping optional features"
        info "Run 'atomcli auth login' to set up manually"
        return 0
    fi
    
    # ─────────────────────────────────────────────────────────────
    # Antigravity (Free Claude & Gemini models)
    # ─────────────────────────────────────────────────────────────
    echo -e "${CYAN}┌─────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│${NC}  ${BOLD}🚀 Antigravity - Free AI Models${NC}              ${CYAN}│${NC}"
    echo -e "${CYAN}├─────────────────────────────────────────────────┤${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}Access Claude Sonnet 4.5, Gemini 3, and more${NC} ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}completely FREE via Google OAuth.${NC}            ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}                                                 ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}Models: claude-sonnet-4-5-thinking,${NC}          ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}gemini-3-pro, gemini-2.5-flash, and more${NC}     ${CYAN}│${NC}"
    echo -e "${CYAN}└─────────────────────────────────────────────────┘${NC}"
    echo ""
    
    ENABLE_ANTIGRAVITY=false
    read -p "Enable Antigravity (free models)? [Y/n] " -n 1 -r REPLY < /dev/tty
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        ENABLE_ANTIGRAVITY=true
        success "Antigravity will be enabled"
    else
        info "Skipping Antigravity"
    fi
    echo ""
    
    # ─────────────────────────────────────────────────────────────
    # Default Skills
    # ─────────────────────────────────────────────────────────────
    echo -e "${MAGENTA}┌─────────────────────────────────────────────────┐${NC}"
    echo -e "${MAGENTA}│${NC}  ${BOLD}📚 Default Skills${NC}                            ${MAGENTA}│${NC}"
    echo -e "${MAGENTA}├─────────────────────────────────────────────────┤${NC}"
    echo -e "${MAGENTA}│${NC}  ${DIM}Pre-configured skills for common tasks:${NC}      ${MAGENTA}│${NC}"
    echo -e "${MAGENTA}│${NC}  ${DIM}• Ralph - AI assistant personality${NC}           ${MAGENTA}│${NC}"
    echo -e "${MAGENTA}│${NC}  ${DIM}• Code Review - automatic code analysis${NC}      ${MAGENTA}│${NC}"
    echo -e "${MAGENTA}│${NC}  ${DIM}• Git Commit - smart commit messages${NC}         ${MAGENTA}│${NC}"
    echo -e "${MAGENTA}└─────────────────────────────────────────────────┘${NC}"
    echo ""
    
    INSTALL_SKILLS=false
    read -p "Install default skills? [Y/n] " -n 1 -r REPLY < /dev/tty
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        INSTALL_SKILLS=true
        success "Default skills will be installed"
    else
        info "Skipping default skills"
    fi
    echo ""
    
    # ─────────────────────────────────────────────────────────────
    # MCP Servers
    # ─────────────────────────────────────────────────────────────
    echo -e "${YELLOW}┌─────────────────────────────────────────────────┐${NC}"
    echo -e "${YELLOW}│${NC}  ${BOLD}🔧 MCP Servers (Model Context Protocol)${NC}      ${YELLOW}│${NC}"
    echo -e "${YELLOW}├─────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}│${NC}  ${DIM}Extend AtomCLI with external tools:${NC}          ${YELLOW}│${NC}"
    echo -e "${YELLOW}│${NC}  ${DIM}• Filesystem - file operations${NC}               ${YELLOW}│${NC}"
    echo -e "${YELLOW}│${NC}  ${DIM}• Memory - persistent context${NC}                ${YELLOW}│${NC}"
    echo -e "${YELLOW}│${NC}  ${DIM}• Sequential Thinking - complex reasoning${NC}    ${YELLOW}│${NC}"
    echo -e "${YELLOW}│${NC}                                                 ${YELLOW}│${NC}"
    echo -e "${YELLOW}│${NC}  ${DIM}(Requires Node.js 18+)${NC}                       ${YELLOW}│${NC}"
    echo -e "${YELLOW}└─────────────────────────────────────────────────┘${NC}"
    echo ""
    
    INSTALL_MCPS=false
    if has node; then
        local node_major=$(node --version | cut -c2- | cut -d. -f1)
        if [ "$node_major" -ge 18 ]; then
            read -p "Install default MCP servers? [Y/n] " -n 1 -r REPLY < /dev/tty
            echo ""
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                INSTALL_MCPS=true
                success "MCP servers will be installed"
            else
                info "Skipping MCP servers"
            fi
        else
            warn "Node.js 18+ required for MCP servers (you have v$(node --version | cut -c2-))"
            info "Skipping MCP servers"
        fi
    else
        warn "Node.js not found - MCP servers require Node.js 18+"
        info "Skipping MCP servers"
    fi
    echo ""
    
    # ─────────────────────────────────────────────────────────────
    # Apply selections
    # ─────────────────────────────────────────────────────────────
    echo -e "${BOLD}Applying selections...${NC}"
    echo ""
    
    # Apply Antigravity
    if [ "$ENABLE_ANTIGRAVITY" = true ]; then
        step "Configuring Antigravity plugin..."
        
        # Update atomcli.json to include Antigravity plugin
        cat > "$CONFIG_DIR/atomcli.json" << 'EOF'
{
  "plugin": ["opencode-antigravity-auth@beta"],
  "provider": {
    "google": {
      "models": {
        "antigravity-gemini-3-pro": {
          "name": "Gemini 3 Pro (Antigravity)",
          "limit": { "context": 1048576, "output": 65535 }
        },
        "antigravity-gemini-3-flash": {
          "name": "Gemini 3 Flash (Antigravity)",
          "limit": { "context": 1048576, "output": 65536 }
        },
        "antigravity-claude-sonnet-4-5-thinking": {
          "name": "Claude Sonnet 4.5 Thinking (Antigravity)",
          "limit": { "context": 200000, "output": 64000 }
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
          "limit": { "context": 1048576, "output": 65536 }
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro",
          "limit": { "context": 1048576, "output": 65536 }
        }
      }
    }
  },
  "mcp": {}
}
EOF
        success "Antigravity plugin configured"
        info "Run 'atomcli auth login' → Google → Antigravity OAuth to authenticate"
    fi
    
    # Apply Skills
    if [ "$INSTALL_SKILLS" = true ]; then
        step "Installing default skills..."
        
        # Create Ralph skill
        mkdir -p "$CONFIG_DIR/skills/ralph"
        cat > "$CONFIG_DIR/skills/ralph/SKILL.md" << 'EOF'
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
- Occasionally uses emoji to express enthusiasm 🎉
EOF
        
        # Create Code Review skill
        mkdir -p "$CONFIG_DIR/skills/code-review"
        cat > "$CONFIG_DIR/skills/code-review/SKILL.md" << 'EOF'
---
name: Code Review
description: Automated code review with best practices
---

When reviewing code, analyze for:
1. **Security** - vulnerabilities, injection risks
2. **Performance** - inefficiencies, memory leaks
3. **Readability** - naming, structure, comments
4. **Best Practices** - patterns, error handling
5. **Tests** - coverage, edge cases

Provide specific, actionable feedback with line references.
EOF
        
        # Create Git Commit skill
        mkdir -p "$CONFIG_DIR/skills/git-commit"
        cat > "$CONFIG_DIR/skills/git-commit/SKILL.md" << 'EOF'
---
name: Git Commit
description: Generate conventional commit messages
---

Generate commit messages following Conventional Commits format:

<type>(<scope>): <description>

[optional body]

Types: feat, fix, docs, style, refactor, test, chore
Keep first line under 72 characters.
EOF
        
        success "Installed 3 default skills"
    fi
    
    # Apply MCPs
    if [ "$INSTALL_MCPS" = true ]; then
        step "Installing MCP servers..."
        
        # Add MCPs to config
        local config_file="$CONFIG_DIR/mcp.json"
        
        # Read existing config and add MCPs with correct format
        # Use node to create/update JSON
        node -e "
            const fs = require('fs');
            const configFile = '$config_file';
            let config = {};
            if (fs.existsSync(configFile)) {
                try {
                    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
                } catch (e) {}
            }
            
            config.mcp = config.mcp || {};
            
            config.mcp['filesystem'] = {
                type: 'local',
                command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', process.env.HOME],
                enabled: true
            };
            config.mcp['memory'] = {
                type: 'local',
                command: ['npx', '-y', '@modelcontextprotocol/server-memory'],
                enabled: true
            };
            config.mcp['sequential-thinking'] = {
                type: 'local',
                command: ['npx', '-y', '@modelcontextprotocol/server-sequential-thinking'],
                enabled: true
            };
            fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        " 2>/dev/null && success "Installed 3 MCP servers to mcp.json" || warn "Could not configure MCPs automatically"
        
        info "MCP servers: filesystem, memory, sequential-thinking"
    fi
}

# Verify installation
verify_installation() {
    echo ""
    step "Verifying installation..."
    
    if [ -x "$INSTALL_DIR/atomcli" ]; then
        local version=$("$INSTALL_DIR/atomcli" --version 2>/dev/null || echo "installed")
        success "AtomCLI ${version} ready!"
    else
        error "Installation verification failed"
        exit 1
    fi
}

# Print completion message
print_complete() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  ${GREEN}${CHECK}${NC} ${BOLD}AtomCLI installed successfully!${NC}"
    echo ""
    echo -e "  ${DIM}Next steps:${NC}"
    echo ""
    
    if [ "$ENABLE_ANTIGRAVITY" = true ]; then
        echo -e "    ${CYAN}1.${NC} Authenticate for free models:"
        echo -e "       ${CYAN}atomcli auth login${NC}"
        echo -e "       ${DIM}→ Select Google → Antigravity OAuth${NC}"
        echo ""
        echo -e "    ${CYAN}2.${NC} Start coding:"
        echo -e "       ${CYAN}atomcli${NC}"
        echo ""
    else
        echo -e "    ${CYAN}atomcli${NC}"
        echo ""
    fi
    
    echo -e "  ${DIM}Or restart your terminal first if atomcli is not found.${NC}"
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Main installation flow
main_install() {
    print_banner
    detect_os
    
    echo -e "${DIM}  OS: ${OS_TYPE} | Arch: ${ARCH_TYPE}${NC}"
    
    check_dependencies
    install_bun
    install_binary
    setup_path
    setup_config
    setup_optional_features
    verify_installation
    print_complete
}

# Uninstall function
uninstall() {
    print_banner
    
    echo -e "${YELLOW}${BOLD}Uninstalling AtomCLI...${NC}"
    echo ""
    
    local removed=false
    
    # Remove binary
    if [ -f "$INSTALL_DIR/atomcli" ]; then
        step "Removing binary..."
        rm -f "$INSTALL_DIR/atomcli"
        success "Removed $INSTALL_DIR/atomcli"
        removed=true
    else
        info "Binary not found at $INSTALL_DIR/atomcli"
    fi
    
    # Ask about config
    echo ""
    echo -e "${YELLOW}Do you want to remove configuration, data, and source?${NC}"
    echo -e "${DIM}  This will delete: $CONFIG_DIR${NC}"
    if [ -d "$HOME/.local/share/atomcli/source" ]; then
        echo -e "${DIM}  And source: $HOME/.local/share/atomcli/source${NC}"
    fi
    echo -e "${DIM}  (includes skills, sessions, and settings)${NC}"
    echo ""
    
    # Check if running interactively
    if [ -t 0 ]; then
        read -p "Remove config? [y/N] " -n 1 -r REPLY < /dev/tty
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if [ -d "$CONFIG_DIR" ]; then
                step "Removing configuration..."
                rm -rf "$CONFIG_DIR"
                success "Removed $CONFIG_DIR"
                removed=true
            fi
            
            # Remove source if it exists (NixOS install)
            if [ -d "$HOME/.local/share/atomcli/source" ]; then
                step "Removing source code..."
                rm -rf "$HOME/.local/share/atomcli/source"
                success "Removed source code"
            fi
        else
            info "Keeping configuration and source"
        fi
    else
        # Non-interactive: keep config by default
        info "Non-interactive mode: keeping configuration"
        info "To remove config manually: rm -rf $CONFIG_DIR"
    fi
    
    # Remove from PATH (inform user)
    echo ""
    info "Note: PATH entry in shell config was not removed."
    info "You can manually remove the AtomCLI line from your shell config."
    
    # Print completion
    echo ""
    if [ "$removed" = true ]; then
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo -e "  ${GREEN}${CHECK}${NC} ${BOLD}AtomCLI uninstalled successfully!${NC}"
        echo ""
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    else
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo -e "  ${YELLOW}!${NC} AtomCLI was not fully installed."
        echo ""
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    fi
    echo ""
}

# Update function
update() {
    print_banner
    
    echo -e "${CYAN}${BOLD}Updating AtomCLI...${NC}"
    echo ""
    
    # Just run main install, but without re-checking basic dependencies essentially 
    # (though re-checking is fast and safe).
    # The key is checking if we have an existing install.
    
    if [ ! -x "$INSTALL_DIR/atomcli" ]; then
        warn "AtomCLI not found. Performing fresh installation."
    else
        info "Found existing installation at $INSTALL_DIR/atomcli"
    fi
    
    # Run main install flow
    detect_os
    echo -e "${DIM}  OS: ${OS_TYPE} | Arch: ${ARCH_TYPE}${NC}"
    check_dependencies
    
    # Force reinstall of binary
    install_binary
    
    # Setup path/config again to ensure they are correct (idempotent)
    setup_path
    setup_config
    
    verify_installation
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  ${GREEN}${CHECK}${NC} ${BOLD}AtomCLI updated successfully!${NC}"
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Show help
show_help() {
    echo "AtomCLI Installer"
    echo ""
    echo "Usage:"
    echo "  install.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --update       Update AtomCLI to the latest version"
    echo "  --uninstall    Remove AtomCLI from the system"
    echo "  --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  curl -fsSL .../install.sh | bash                      # Install"
    echo "  curl -fsSL .../install.sh | bash -s -- --update       # Update"
    echo "  curl -fsSL .../install.sh | bash -s -- --uninstall    # Uninstall"
}

# Parse arguments and run
case "${1:-}" in
    --update)
        update
        ;;
    --uninstall|-u)
        uninstall
        ;;
    --help|-h)
        show_help
        ;;
    *)
        main_install
        ;;
esac

