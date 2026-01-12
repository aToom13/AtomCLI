#!/bin/bash
# AtomCLI Installer - https://github.com/aToom13/AtomCLI
# Usage: curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash

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

# Installation directory
INSTALL_DIR="${ATOMCLI_INSTALL_DIR:-$HOME/.local/bin}"
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
        Linux*)     OS_TYPE="linux" ;;
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
    
    # Check Bun (will install if missing)
    if has bun; then
        success "bun $(bun --version)"
        BUN_INSTALLED=true
    else
        warn "bun not found (will be installed)"
        BUN_INSTALLED=false
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
    
    # Try to get from releases first
    local version=$(get_latest_release)
    local binary_name="atomcli-${OS_TYPE}-${ARCH_TYPE}"
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$CONFIG_DIR"
    
    if [ -n "$version" ]; then
        local url="https://github.com/aToom13/AtomCLI/releases/download/${version}/${binary_name}"
        
        if has curl; then
            curl -fsSL "$url" -o "$INSTALL_DIR/atomcli" 2>/dev/null && chmod +x "$INSTALL_DIR/atomcli"
        else
            wget -q "$url" -O "$INSTALL_DIR/atomcli" 2>/dev/null && chmod +x "$INSTALL_DIR/atomcli"
        fi
        
        if [ -f "$INSTALL_DIR/atomcli" ]; then
            success "Downloaded AtomCLI ${version}"
            return 0
        fi
    fi
    
    # Fallback: build from source
    step "Building from source..."
    
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
    bun install >/dev/null 2>&1
    if [ $? -ne 0 ]; then
        error "Failed to install dependencies"
        exit 1
    fi
    success "Installed dependencies"
    
    cd AtomBase
    step "Building (this may take a minute)..."
    
    # Show build output for debugging
    if ! bun run build --single 2>&1; then
        error "Failed to build"
        exit 1
    fi
    success "Built AtomCLI"
    
    # Debug: Show what's in dist
    step "Finding binary..."
    
    # Find and copy binary - check multiple possible paths
    local binary_path=""
    
    # First try exact match
    binary_path=$(find dist -path "*/bin/atomcli" -type f 2>/dev/null | head -1)
    
    # Fallback: any atomcli file
    if [ -z "$binary_path" ]; then
        binary_path=$(find dist -name "atomcli" -type f 2>/dev/null | head -1)
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
    
    # Create default config
    if [ ! -f "$CONFIG_DIR/atomcli.json" ]; then
        cat > "$CONFIG_DIR/atomcli.json" << 'EOF'
{
  "mcp": {
    "memory-bank": {
      "type": "local",
      "command": ["npx", "-y", "github:alioshr/memory-bank-mcp"],
      "enabled": true
    },
    "sequential-thinking": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
      "enabled": true
    }
  }
}
EOF
        success "Created default configuration"
    else
        info "Configuration already exists"
    fi
    
    # Create skills directory
    mkdir -p "$CONFIG_DIR/skills"
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
    echo -e "  ${DIM}To get started, run:${NC}"
    echo ""
    echo -e "    ${CYAN}atomcli${NC}"
    echo ""
    echo -e "  ${DIM}Or restart your terminal first if atomcli is not found.${NC}"
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Main installation flow
main() {
    print_banner
    detect_os
    
    echo -e "${DIM}  OS: ${OS_TYPE} | Arch: ${ARCH_TYPE}${NC}"
    
    check_dependencies
    install_bun
    install_binary
    setup_path
    setup_config
    verify_installation
    print_complete
}

# Run main
main "$@"
