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
PLAYWRIGHT_VERSION="1.62.0"

# Banner
print_banner() {
    echo ""
    echo -e "${CYAN}"
    echo "  █████╗ ████████╗ ██████╗ ███╗   ███╗   ██████╗██╗     ██╗"
    echo " ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║"
    echo " ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║"
    echo " ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║"
    echo " ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║"
    echo " ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝"
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

# Detect Linux distro family from /etc/os-release (debian | arch | fedora | other | "")
detect_distro() {
    if [ ! -f /etc/os-release ]; then
        echo ""
        return
    fi
    local id id_like combined
    id=$(grep -E '^ID=' /etc/os-release 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"' | tr '[:upper:]' '[:lower:]')
    id_like=$(grep -E '^ID_LIKE=' /etc/os-release 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"' | tr '[:upper:]' '[:lower:]')
    combined="$id $id_like"
    case "$combined" in
        *debian*|*ubuntu*) echo "debian" ;;
        *arch*|*cachyos*)  echo "arch" ;;
        *fedora*|*rhel*|*centos*) echo "fedora" ;;
        *) echo "other" ;;
    esac
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
        if [ "$OS_TYPE" = "darwin" ] && has brew; then
            warn "Attempting to install git via Homebrew..."
            brew install git >/dev/null 2>&1 && success "git installed via brew" || { error "brew install git failed"; deps_ok=false; }
        else
            deps_ok=false
        fi
    fi
    
    # Check curl or wget
    if has curl; then
        success "curl $(curl --version | head -1 | cut -d' ' -f2)"
    elif has wget; then
        success "wget $(wget --version | head -1 | cut -d' ' -f3)"
    else
        error "curl or wget not found"
        if [ "$OS_TYPE" = "darwin" ] && has brew; then
            warn "Attempting to install curl via Homebrew..."
            brew install curl >/dev/null 2>&1 && success "curl installed via brew" || { error "brew install curl failed"; deps_ok=false; }
        else
            deps_ok=false
        fi
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

download_file() {
    local url="$1"
    local destination="$2"
    if has curl; then
        curl -fsSL "$url" -o "$destination"
    else
        wget -q "$url" -O "$destination"
    fi
}

calculate_sha256() {
    local file="$1"
    if has sha256sum; then
        sha256sum "$file" | awk '{print $1}'
    elif has shasum; then
        shasum -a 256 "$file" | awk '{print $1}'
    else
        return 1
    fi
}

verify_release_checksum() {
    local binary="$1"
    local manifest="$2"
    local asset_name="$3"
    local expected actual

    expected=$(awk -v name="$asset_name" '$2 == name || $2 == "*" name { print $1; exit }' "$manifest")
    case "$expected" in
        ""|*[!0-9a-fA-F]*) return 1 ;;
    esac
    [ "${#expected}" -eq 64 ] || return 1

    actual=$(calculate_sha256 "$binary") || return 1
    [ "$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')" ]
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
    if [ "$OS_TYPE" = "windows" ]; then
        binary_name="${binary_name}.exe"
    fi
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$CONFIG_DIR"
    
    if [ -n "$version" ]; then
        local url="https://github.com/aToom13/AtomCLI/releases/download/${version}/${binary_name}"
        local checksum_url="https://github.com/aToom13/AtomCLI/releases/download/${version}/SHA256SUMS"
        local download_dir tmp_binary tmp_manifest
        download_dir=$(mktemp -d)
        tmp_binary="$download_dir/$binary_name"
        tmp_manifest="$download_dir/SHA256SUMS"

        if download_file "$url" "$tmp_binary" \
            && download_file "$checksum_url" "$tmp_manifest" \
            && [ -s "$tmp_binary" ] \
            && verify_release_checksum "$tmp_binary" "$tmp_manifest" "$binary_name"; then
            chmod +x "$tmp_binary"
            mv "$tmp_binary" "$INSTALL_DIR/atomcli"
            rm -rf "$download_dir"
            success "Downloaded and verified AtomCLI ${version}"
            return 0
        fi

        rm -rf "$download_dir"
        warn "Download or checksum verification failed, attempting build from source..."
    fi
    
    # Fallback: build from source
    warn "No prebuilt binary available for ${OS_TYPE}-${ARCH_TYPE}"
    step "Building from source..."
    echo -e "${DIM}    (First-time install can take 10-20 minutes on slow connections)${NC}"
    echo ""
    
    local tmp_dir
    tmp_dir=$(mktemp -d)
    # Ensure temp dir is always cleaned up, even on error or set -e exit
    trap 'rm -rf "$tmp_dir" 2>/dev/null; trap - EXIT' EXIT INT TERM
    cd "$tmp_dir"
    
    step "Cloning repository..."
    if [ -n "$version" ]; then
        git clone --depth 1 --branch "$version" https://github.com/aToom13/AtomCLI.git >/dev/null 2>&1
    else
        git clone --depth 1 https://github.com/aToom13/AtomCLI.git >/dev/null 2>&1
    fi
    if [ $? -ne 0 ]; then
        error "Failed to clone repository"
        exit 1
    fi
    success "Cloned repository"
    
    # Read the playwright version pinned in AtomBase/package.json so the
    # standalone ~/.atomcli/playwright install matches it exactly (mismatched
    # versions cause "Executable doesn't exist" browser failures).
    PLAYWRIGHT_VERSION=$(grep -o '"playwright": *"[^"]*"' AtomCLI/AtomBase/package.json 2>/dev/null | head -1 | sed 's/.*"playwright": *"//;s/"//')
    if ! [[ "$PLAYWRIGHT_VERSION" =~ ^[0-9]+.[0-9]+.[0-9]+$ ]]; then
        warn "Could not read a valid pinned playwright version; installing unpinned"
        PLAYWRIGHT_VERSION=""
    fi
    if [ -n "$PLAYWRIGHT_VERSION" ]; then
        info "Pinned playwright version: $PLAYWRIGHT_VERSION"
    fi
    
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
    trap - EXIT INT TERM
    
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
            (bun add --exact "playwright@$PLAYWRIGHT_VERSION" > /dev/null 2>&1) &
            spin $! "Installing Playwright package..."
            
            if [ -d "node_modules/playwright" ]; then
                success "Playwright package installed"
                
                step "Installing Chromium browser..."
                (bunx playwright install chromium > /dev/null 2>&1) &
                spin $! "Installing Chromium..."
                success "Chromium installed"
                
                # Try to install system deps (Debian/Ubuntu only — apt-based)
                if [ "$(detect_distro)" = "debian" ] && command -v sudo >/dev/null 2>&1; then
                    info "Installing system dependencies (may require password)..."
                    sudo bunx playwright install-deps chromium 2>/dev/null || warn "Could not auto-install system deps"
                elif [ "$(detect_distro)" = "arch" ]; then
                    info "Arch-based system detected — Playwright install-deps is apt-only, skipping."
                    info "If the browser fails to launch, install system libraries via pacman:"
                    info "  sudo pacman -S --needed nss nspr alsa-lib at-spi2-core cups dbus libdrm libxkbcommon libxcomposite libxdamage libxfixes libxrandr mesa libxss gtk3 gdk-pixbuf2 pango cairo wayland libxrender libxtst libxshmfence"
                elif [ "$(detect_distro)" = "fedora" ]; then
                    info "Fedora/RHEL-based system detected. If Chromium reports missing libraries, run:"
                    info "  sudo dnf install alsa-lib atk at-spi2-atk cups-libs gtk3 libdrm libX11 libXcomposite libXdamage libXext libXfixes libXrandr libxcb libxkbcommon mesa-libgbm nss pango"
                fi
            else
                warn "Could not install Playwright package"
            fi
        else
            warn "Bun not found. Browser tool may not work."
            info "To install Playwright manually, run:"
            info "  bun add --exact playwright@$PLAYWRIGHT_VERSION && bunx playwright install chromium"
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
    
    # Detect shell rc file
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
    
    # Check if PATH entry is ALREADY WRITTEN in the shell rc file (not $PATH env!)
    # Bug fix: Previously checked $PATH env var, which holds stale values from
    # previous install sessions, causing the script to skip writing to .bashrc
    local needs_write=true
    if [ -n "$shell_rc" ] && [ -f "$shell_rc" ]; then
        if grep -qF "$INSTALL_DIR" "$shell_rc" 2>/dev/null; then
            needs_write=false
            info "PATH already configured in $shell_rc"
        fi
    fi
    
    # Write to shell rc file only if the entry doesn't exist yet
    if [ "$needs_write" = true ] && [ -n "$shell_rc" ]; then
        case "$SHELL" in
            */fish)
                mkdir -p "$(dirname "$shell_rc")"
                echo "" >> "$shell_rc"
                echo "# AtomCLI" >> "$shell_rc"
                echo "fish_add_path \"$INSTALL_DIR\"" >> "$shell_rc"
                ;;
            *)
                echo "" >> "$shell_rc"
                echo "# AtomCLI" >> "$shell_rc"
                echo "$path_line" >> "$shell_rc"
                ;;
        esac
        success "Added to PATH in $shell_rc"
    fi
    
    # Also add Bun to PATH if needed (check file content, not env)
    if [ "$BUN_INSTALLED" = false ] && [ -n "$shell_rc" ]; then
        if ! grep -qF ".bun/bin" "$shell_rc" 2>/dev/null; then
            case "$SHELL" in
                */fish)
                    echo "fish_add_path \"$HOME/.bun/bin\"" >> "$shell_rc"
                    ;;
                *)
                    echo "export BUN_INSTALL=\"\$HOME/.bun\"" >> "$shell_rc"
                    echo "export PATH=\"\$BUN_INSTALL/bin:\$PATH\"" >> "$shell_rc"
                    ;;
            esac
        fi
    fi
    
    # ALWAYS activate in current session (even if rc file already had the entry)
    export PATH="$INSTALL_DIR:$PATH"

    # ALWAYS source the shell rc file to ensure PATH is fully loaded
    if [ -n "$shell_rc" ] && [ -f "$shell_rc" ]; then
        # shellcheck disable=SC1090
        source "$shell_rc" 2>/dev/null || . "$shell_rc" 2>/dev/null || true
        # Re-export after source to guarantee it in the current process
        export PATH="$INSTALL_DIR:$PATH"
        success "Shell configuration reloaded"
    fi
}

# Install tab completion for the active shell.
setup_completion() {
    local shell_name completion_dir completion_file shell_rc source_line
    case "$SHELL" in
        */zsh)  shell_name="zsh"; shell_rc="$HOME/.zshrc" ;;
        */fish) shell_name="fish" ;;
        *)
            shell_name="bash"
            if [ -f "$HOME/.bashrc" ]; then shell_rc="$HOME/.bashrc"; else shell_rc="$HOME/.bash_profile"; fi
            ;;
    esac

    completion_dir="$CONFIG_DIR/completions"
    mkdir -p "$completion_dir"

    if [ "$shell_name" = "fish" ]; then
        completion_file="$HOME/.config/fish/completions/atomcli.fish"
        mkdir -p "$(dirname "$completion_file")"
    else
        completion_file="$completion_dir/atomcli.$shell_name"
    fi

    if ! "$INSTALL_DIR/atomcli" completion "$shell_name" > "$completion_file"; then
        rm -f "$completion_file"
        warn "Could not generate $shell_name tab completion"
        return
    fi

    if [ "$shell_name" != "fish" ]; then
        source_line=". \"$completion_file\""
        if ! grep -qF "$source_line" "$shell_rc" 2>/dev/null; then
            printf '\n# AtomCLI tab completion\n%s\n' "$source_line" >> "$shell_rc"
        fi
    fi
    success "Installed $shell_name tab completion"
}

# Pre-fetch models.dev catalog for instant model availability
prefetch_models_cache() {
    step "Pre-fetching model catalog..."
    
    # Cache directory matches app's Global.Path.cache
    local cache_dir="$CONFIG_DIR/cache"
    mkdir -p "$cache_dir"
    
    local cache_file="$cache_dir/models.json"
    
    if has curl; then
        curl -fsSL "https://models.dev/api.json" -o "$cache_file" 2>/dev/null
    elif has wget; then
        wget -q "https://models.dev/api.json" -O "$cache_file" 2>/dev/null
    fi
    
    if [ -s "$cache_file" ]; then
        success "Model catalog cached"
    else
        warn "Could not pre-fetch model catalog (will be fetched on first run)"
    fi
}

# Install bundled skills so they are available on first run.
# Preference order: local repository checkout -> verified release archive
# (skills.tar.gz) -> minimal core-skill stubs as offline fallback.
# This runs automatically and must not depend on interactive prompts,
# because curl | bash leaves $SCRIPT_DIR empty.
install_skills_bundle() {
    if [ "$OS_TYPE" = "nixos" ]; then
        info "NixOS source install: bundled skills load from the source tree"
        return 0
    fi

    step "Installing bundled skills..."

    local skills_dir="$CONFIG_DIR/skills"
    mkdir -p "$skills_dir"

    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -d "$script_dir/.atomcli/skills" ]; then
        cp -r "$script_dir/.atomcli/skills/"* "$skills_dir/" 2>/dev/null || true
        if ls "$skills_dir"/*/SKILL.md >/dev/null 2>&1; then
            success "Installed bundled skills from repository"
            return 0
        fi
    fi

    local version=""
    case "$VERSION" in
        v*)  version="$VERSION" ;;
        "")  version=$(get_latest_release) ;;
        *)   version="v$VERSION" ;;
    esac

    if [ -n "$version" ]; then
        local url="https://github.com/aToom13/AtomCLI/releases/download/${version}/skills.tar.gz"
        local checksum_url="https://github.com/aToom13/AtomCLI/releases/download/${version}/SHA256SUMS"
        local download_dir tmp_archive tmp_manifest
        download_dir=$(mktemp -d)
        tmp_archive="$download_dir/skills.tar.gz"
        tmp_manifest="$download_dir/SHA256SUMS"

        if download_file "$url" "$tmp_archive" \
            && download_file "$checksum_url" "$tmp_manifest" \
            && [ -s "$tmp_archive" ] \
            && verify_release_checksum "$tmp_archive" "$tmp_manifest" "skills.tar.gz" \
            && tar -xzf "$tmp_archive" -C "$CONFIG_DIR"; then
            rm -rf "$download_dir"
            success "Installed bundled skills (${version})"
            return 0
        fi

        rm -rf "$download_dir"
        warn "Skills bundle download failed, creating core skills only..."
    else
        warn "Could not resolve a release for the skills bundle, creating core skills only..."
    fi

    mkdir -p "$skills_dir/ralph"
    cat > "$skills_dir/ralph/SKILL.md" << 'EOF'
---
name: Ralph
description: Friendly AI coding assistant with personality
---

You are Ralph, a friendly and enthusiastic AI coding assistant. You have a warm personality and enjoy helping developers solve problems.
EOF

    mkdir -p "$skills_dir/git-commit"
    cat > "$skills_dir/git-commit/SKILL.md" << 'EOF'
---
name: git-commit
description: Generate conventional commit messages
---

Generate commit messages following Conventional Commits format: feat, fix, docs, style, refactor, test, chore.
EOF

    success "Installed core skills into ~/.atomcli/skills/"
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
  "model": "atomcli/atomcli-free",
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
    
    # Check if /dev/tty is available or NONINTERACTIVE is set
    if [ ! -e /dev/tty ] || [ "${NONINTERACTIVE:-}" = "1" ]; then
        info "Non-interactive mode: skipping optional features"
        info "Run 'atomcli auth login' to set up manually"
        return 0
    fi
    
    # ─────────────────────────────────────────────────────────────
    # Kilocode (Free Cloud Models)
    # ─────────────────────────────────────────────────────────────
    echo -e "${CYAN}┌─────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│${NC}  ${BOLD}☁️ Kilocode - Free Cloud AI Models${NC}           ${CYAN}│${NC}"
    echo -e "${CYAN}├─────────────────────────────────────────────────┤${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}Access 320+ free cloud models instantly.${NC}          ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}No API key needed, just login with Google.${NC}         ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}                                                 ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}Models: gpt-5-nano, gemini, Minimax ${NC}      ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}llama, mistral + 300+ more (completely free)${NC}  ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  ${DIM}*(Ücretsiz modeller - sınırsız kullanım)${NC}    ${CYAN}│${NC}"
    echo -e "${CYAN}└─────────────────────────────────────────────────┘${NC}"
    echo ""
    
    ENABLE_KILOCODE=false
    read -p "Enable Kilocode (free cloud models)? [Y/n] " -n 1 -r REPLY < /dev/tty
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        ENABLE_KILOCODE=true
        success "Kilocode will be enabled"
    else
        info "Skipping Kilocode"
    fi
    echo ""
    
    # ─────────────────────────────────────────────────────────────
    # MCP Servers
    # ─────────────────────────────────────────────────────────────
    echo -e "${YELLOW}┌─────────────────────────────────────────────────┐${NC}"
    echo -e "${YELLOW}│${NC}  ${BOLD}🔧 MCP Servers (Model Context Protocol)${NC}      ${YELLOW}│${NC}"
    echo -e "${YELLOW}├─────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}│${NC}  ${DIM}Extend AtomCLI with external tools:${NC}          ${YELLOW}│${NC}"
    echo -e "${YELLOW}│${NC}  ${DIM}• Sequential Thinking - complex reasoning${NC}    ${YELLOW}│${NC}"
    echo -e "${YELLOW}│${NC}                                                 ${YELLOW}│${NC}"
    echo -e "${YELLOW}│${NC}  ${DIM}(Runs through Bun)${NC}                           ${YELLOW}│${NC}"
    echo -e "${YELLOW}└─────────────────────────────────────────────────┘${NC}"
    echo ""
    
    INSTALL_MCPS=false
    read -p "Install default MCP servers? [Y/n] " -n 1 -r REPLY < /dev/tty
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        INSTALL_MCPS=true
        success "MCP servers will be installed"
    else
        info "Skipping MCP servers"
    fi
    echo ""
    
    # ─────────────────────────────────────────────────────────────
    # Apply selections
    # ─────────────────────────────────────────────────────────────
    echo -e "${BOLD}Applying selections...${NC}"
    echo ""
    
    # Apply Kilocode
    if [ "$ENABLE_KILOCODE" = true ]; then
        step "Configuring Kilocode..."
        
        # Kilocode is built-in, just create default config
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
  "model": "atomcli/atomcli-free",
  "mcp": {}
}
EOF
        success "Kilocode configured"
    fi
    
    # Apply MCPs
    if [ "$INSTALL_MCPS" = true ]; then
        step "Installing MCP servers..."
        
        # Add MCPs to config
        local config_file="$CONFIG_DIR/mcp.json"
        
        # Read existing config and add MCPs with correct format
        # Use Bun to create/update JSON
        bun -e "
            const fs = require('fs');
            const configFile = '$config_file';
            let config = {};
            if (fs.existsSync(configFile)) {
                try {
                    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
                } catch (e) {}
            }
            
            config.mcp = config.mcp || {};
            
            config.mcp['sequential-thinking'] = {
                type: 'local',
                command: ['bunx', '@modelcontextprotocol/server-sequential-thinking'],
                enabled: true
            };
            fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        " 2>/dev/null && success "Installed MCP server: sequential-thinking" || warn "Could not configure MCPs automatically"
        
        info "MCP server: sequential-thinking"
    fi
}

# Verify installation
verify_installation() {
    echo ""
    step "Verifying installation..."
    
    if [ ! -x "$INSTALL_DIR/atomcli" ]; then
        error "Installation verification failed: binary not found or not executable"
        exit 1
    fi
    
    local version
    version=$("$INSTALL_DIR/atomcli" --version 2>/dev/null)
    local exit_code=$?
    
    if [ $exit_code -eq 0 ] && [ -n "$version" ]; then
        success "AtomCLI ${version} ready!"
    elif [ $exit_code -eq 0 ]; then
        success "AtomCLI installed and responding"
    else
        # Binary exists but crashed — likely a runtime dependency issue
        error "Binary found but failed to run (exit code: $exit_code)"
        info "This may be a libc mismatch (musl vs glibc) or missing dependency."
        info "Try building from source: curl -fsSL <url> | bash -s -- --source"
        exit 1
    fi

    if [ "$ENABLE_KILOCODE" = true ]; then
        echo ""
        step "Starting Kilocode authentication..."
        # Re-attach stdin to terminal so prompts work even in curl | bash
        # --method 0 skips the "Login method" prompt, --provider skips provider selection
        # || true prevents set -e from crashing if user cancels or auth fails
        "$INSTALL_DIR/atomcli" auth login --provider kilocode --method 0 < /dev/tty || true
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
    echo -e "    ${CYAN}1.${NC} Complete setup (providers, models, preferences):"
    echo -e "       ${BOLD}${CYAN}atomcli setup${NC}"
    echo ""
    echo -e "    ${CYAN}2.${NC} Start coding:"
    echo -e "       ${CYAN}atomcli${NC}"
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
    
    # Interactive version selection when a terminal is available (works even with curl | bash)
    if [ -e /dev/tty ] && [ -r /dev/tty ] && [ -z "$VERSION" ]; then
        select_version
        
        if [ "${INSTALL_FROM_SOURCE:-false}" = true ]; then
            info "Building from source..."
            local tmp_dir
            tmp_dir=$(mktemp -d)
            step "Cloning repository..."
            git clone --depth 1 https://github.com/aToom13/AtomCLI.git "$tmp_dir/AtomCLI" 2>/dev/null
            step "Building..."
            cd "$tmp_dir/AtomCLI/AtomBase" && bun install && bun run build --single
            local built_binary
            built_binary=$(find "$tmp_dir/AtomCLI/AtomBase/dist" -path '*/bin/atomcli' -type f | head -1)
            if [ -n "$built_binary" ] && [ -f "$built_binary" ]; then
                mkdir -p "$INSTALL_DIR"
                cp "$built_binary" "$INSTALL_DIR/atomcli"
                chmod +x "$INSTALL_DIR/atomcli"
                success "Built and installed from source"
            else
                error "Build produced no binary"
            fi
            rm -rf "$tmp_dir"
            setup_path
            setup_completion
            setup_config
            prefetch_models_cache
            install_skills_bundle
            setup_optional_features
            verify_installation 
            print_complete
            return
        fi
    fi
    
    install_binary
    setup_path
    setup_completion
    setup_config
    prefetch_models_cache
    install_skills_bundle
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

    # Fish completion lives outside CONFIG_DIR and must always be cleaned up.
    rm -f "$HOME/.config/fish/completions/atomcli.fish"
    
    # Ask about config
    echo ""
    echo -e "${YELLOW}Do you want to remove configuration, data, and source?${NC}"
    echo -e "${DIM}  This will delete: $CONFIG_DIR${NC}"
    if [ -d "$HOME/.local/share/atomcli/source" ]; then
        echo -e "${DIM}  And source: $HOME/.local/share/atomcli/source${NC}"
    fi
    echo -e "${DIM}  (includes skills, sessions, and settings)${NC}"
    echo ""
    
    # Check if a terminal is available (works with curl | bash too)
    if [ -e /dev/tty ] && [ -r /dev/tty ]; then
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
    info "Note: remove the AtomCLI PATH/completion block from your shell config if it remains."
    
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

# Interactive version selection menu
select_version() {
    echo ""
    echo -e "${CYAN}${BOLD}  Fetching available versions...${NC}"
    
    # Fetch releases from GitHub
    local releases_json=""
    if command -v curl &>/dev/null; then
        releases_json=$(curl -fsSL "https://api.github.com/repos/aToom13/AtomCLI/releases?per_page=8" 2>/dev/null || echo "")
    elif command -v wget &>/dev/null; then
        releases_json=$(wget -qO- "https://api.github.com/repos/aToom13/AtomCLI/releases?per_page=8" 2>/dev/null || echo "")
    fi
    
    if [ -z "$releases_json" ] || [ "$releases_json" = "[]" ]; then
        warn "Could not fetch version list"
        echo -e "  ${DIM}Falling back to latest version${NC}"
        return 0
    fi
    
    # Parse version tags (portable: no jq dependency)
    local versions=()
    while IFS= read -r tag; do
        tag="${tag#v}"  # Strip leading 'v'
        [ -n "$tag" ] && versions+=("$tag")
    done < <(echo "$releases_json" | grep -o '"tag_name": *"[^"]*"' | sed 's/"tag_name": *"//;s/"//')
    
    if [ ${#versions[@]} -eq 0 ]; then
        warn "No versions found"
        return 0
    fi
    
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${BOLD}Select a version to install:${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    local i=1
    for v in "${versions[@]}"; do
        local hint=""
        [ "$i" -eq 1 ] && hint=" ${GREEN}(Latest)${NC}"
        echo -e "  ${CYAN}${i})${NC} v${v}${hint}"
        i=$((i+1))
    done
    echo ""
    echo -e "  ${CYAN}${i})${NC} 🔧 Build from Source ${DIM}(clone & compile main branch)${NC}"
    local source_option=$i
    i=$((i+1))
    echo -e "  ${CYAN}${i})${NC} Cancel"
    local cancel_option=$i
    echo ""
    
    local choice=""
    read -t 30 -p "$(echo -e "  ${BOLD}Choice [1]:${NC} ")" choice < /dev/tty
    
    if [ -z "$choice" ]; then
        choice=1
    fi
    
    if [ "$choice" -eq "$cancel_option" ] 2>/dev/null; then
        echo ""
        echo -e "  ${YELLOW}Cancelled${NC}"
        exit 0
    fi
    
    if [ "$choice" -eq "$source_option" ] 2>/dev/null; then
        INSTALL_FROM_SOURCE=true
        return 0
    fi
    
    if [ "$choice" -ge 1 ] && [ "$choice" -le "${#versions[@]}" ] 2>/dev/null; then
        SELECTED_VERSION="${versions[$((choice-1))]}"
        VERSION="$SELECTED_VERSION"
        export SELECTED_VERSION VERSION
        info "Selected version: v${SELECTED_VERSION}"
        return 0
    fi
    
    warn "Invalid selection, using latest"
    return 0
}

# Update function
update() {
    print_banner
    
    echo -e "${CYAN}${BOLD}Updating AtomCLI...${NC}"
    echo ""
    
    if [ ! -x "$INSTALL_DIR/atomcli" ]; then
        warn "AtomCLI not found. Performing fresh installation."
    else
        info "Found existing installation at $INSTALL_DIR/atomcli"
    fi
    
    # Interactive version selection when a terminal is available (works with curl | bash)
    if [ -e /dev/tty ] && [ -r /dev/tty ] && [ -z "$VERSION" ]; then
        select_version
        
        if [ "${INSTALL_FROM_SOURCE:-false}" = true ]; then
            info "Building from source..."
            detect_os
            check_dependencies
            # Clone and build from source
            local tmp_dir
            tmp_dir=$(mktemp -d)
            step "Cloning repository..."
            git clone --depth 1 https://github.com/aToom13/AtomCLI.git "$tmp_dir/AtomCLI" 2>/dev/null
            step "Building..."
            cd "$tmp_dir/AtomCLI/AtomBase" && bun install && bun run build --single
            local built_binary
            built_binary=$(find "$tmp_dir/AtomCLI/AtomBase/dist" -path '*/bin/atomcli' -type f | head -1)
            if [ -n "$built_binary" ] && [ -f "$built_binary" ]; then
                cp "$built_binary" "$INSTALL_DIR/atomcli"
                chmod +x "$INSTALL_DIR/atomcli"
                success "Built and installed from source"
            else
                error "Build produced no binary"
            fi
            rm -rf "$tmp_dir"
            echo ""
            echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "  ${GREEN}${CHECK}${NC} ${BOLD}AtomCLI built from source successfully!${NC}"
            echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo ""
            return
        fi
    fi
    
    # Run main install flow
    detect_os
    echo -e "${DIM}  OS: ${OS_TYPE} | Arch: ${ARCH_TYPE}${NC}"
    check_dependencies
    
    # Force reinstall of binary
    install_binary
    
    # Setup path/config again to ensure they are correct (idempotent)
    setup_path
    setup_completion
    setup_config
    prefetch_models_cache
    install_skills_bundle
    setup_optional_features
    
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
    echo "  --update       Update AtomCLI (interactive version selection)"
    echo "  --source       Build and install from source"
    echo "  --uninstall    Remove AtomCLI from the system"
    echo "  --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  curl -fsSL .../install.sh | bash                      # Install"
    echo "  curl -fsSL .../install.sh | bash -s -- --update       # Update (interactive)"
    echo "  curl -fsSL .../install.sh | bash -s -- --source       # Build from source"
    echo "  curl -fsSL .../install.sh | bash -s -- --uninstall    # Uninstall"
}

# Parse arguments and run
if [ "${ATOMCLI_INSTALLER_LIBRARY_ONLY:-0}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

if [ -n "$VERSION" ]; then
    NONINTERACTIVE="1"
fi

case "${1:-}" in
    --update)
        update
        ;;
    --source)
        INSTALL_FROM_SOURCE=true
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
