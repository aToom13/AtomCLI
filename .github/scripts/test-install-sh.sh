#!/usr/bin/env bash

set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT

printf 'atomcli installer checksum fixture\n' > "$fixture_dir/atomcli-linux-x64"
fixture_hash=$(sha256sum "$fixture_dir/atomcli-linux-x64" | awk '{print $1}')
printf '%s  atomcli-linux-x64\n' "$fixture_hash" > "$fixture_dir/SHA256SUMS"

ATOMCLI_INSTALLER_LIBRARY_ONLY=1 source "$repository_root/install.sh"
verify_release_checksum \
    "$fixture_dir/atomcli-linux-x64" \
    "$fixture_dir/SHA256SUMS" \
    "atomcli-linux-x64"

printf '%064d  atomcli-linux-x64\n' 0 > "$fixture_dir/SHA256SUMS"
if verify_release_checksum \
    "$fixture_dir/atomcli-linux-x64" \
    "$fixture_dir/SHA256SUMS" \
    "atomcli-linux-x64"; then
    echo "tampered installer fixture unexpectedly passed checksum verification" >&2
    exit 1
fi

release_dir="$fixture_dir/release"
install_dir="$fixture_dir/install"
mkdir -p "$release_dir"
printf 'mock release binary\n' > "$release_dir/atomcli-linux-x64"
release_hash=$(sha256sum "$release_dir/atomcli-linux-x64" | awk '{print $1}')
printf '%s  atomcli-linux-x64\n' "$release_hash" > "$release_dir/SHA256SUMS"

download_file() {
    local url="$1"
    local destination="$2"
    printf '%s\n' "$url" >> "$fixture_dir/downloads"
    case "$url" in
        */atomcli-linux-x64) cp "$release_dir/atomcli-linux-x64" "$destination" ;;
        */SHA256SUMS) cp "$release_dir/SHA256SUMS" "$destination" ;;
        *) return 1 ;;
    esac
}

OS_TYPE="linux"
ARCH_TYPE="x64"
VERSION="9.8.7"
INSTALL_DIR="$install_dir"
CONFIG_DIR="$fixture_dir/config"
install_binary >/dev/null

cmp "$release_dir/atomcli-linux-x64" "$install_dir/atomcli"
grep -Fxq \
    "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/atomcli-linux-x64" \
    "$fixture_dir/downloads"
grep -Fxq \
    "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/SHA256SUMS" \
    "$fixture_dir/downloads"

# Browser runtime setup must run independently of the source-build fallback so
# prebuilt installs and updates both synchronize and launch-check Playwright.
fake_bin="$fixture_dir/fake-bin"
browser_config="$fixture_dir/browser-config"
mkdir -p "$fake_bin" "$browser_config/playwright/node_modules/playwright"
printf '{"version":"1.62.0"}\n' > "$browser_config/playwright/node_modules/playwright/package.json"
cat > "$fake_bin/bun" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$ATOMCLI_INSTALLER_TEST_COMMANDS"
exit 0
EOF
chmod +x "$fake_bin/bun"
ln -s bun "$fake_bin/bunx"

export ATOMCLI_INSTALLER_TEST_COMMANDS="$fixture_dir/browser-commands"
PATH="$fake_bin:$PATH"
CONFIG_DIR="$browser_config"
PLAYWRIGHT_VERSION="1.62.0"
OS_TYPE="linux"
RESOLVED_VERSION=""
detect_distro() { echo "other"; }
setup_playwright >/dev/null

grep -Fxq "playwright install --no-shell chromium" "$ATOMCLI_INSTALLER_TEST_COMMANDS"
grep -Fq -- "--conditions=browser -e" "$ATOMCLI_INSTALLER_TEST_COMMANDS"

progress_output=$(progress_start 2; progress_step "one"; progress_step "two")
printf '%s' "$progress_output" | grep -Fq "100%  two"
