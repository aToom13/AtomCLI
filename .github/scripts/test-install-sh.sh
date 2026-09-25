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
printf 'mock musl release binary\n' > "$release_dir/atomcli-linux-x64-musl"
printf 'mock baseline release binary\n' > "$release_dir/atomcli-linux-x64-baseline"
printf 'mock baseline musl release binary\n' > "$release_dir/atomcli-linux-x64-baseline-musl"
release_hash=$(sha256sum "$release_dir/atomcli-linux-x64" | awk '{print $1}')
musl_release_hash=$(sha256sum "$release_dir/atomcli-linux-x64-musl" | awk '{print $1}')
baseline_hash=$(sha256sum "$release_dir/atomcli-linux-x64-baseline" | awk '{print $1}')
baseline_musl_hash=$(sha256sum "$release_dir/atomcli-linux-x64-baseline-musl" | awk '{print $1}')
printf '%s  atomcli-linux-x64\n%s  atomcli-linux-x64-musl\n%s  atomcli-linux-x64-baseline\n%s  atomcli-linux-x64-baseline-musl\n' \
    "$release_hash" "$musl_release_hash" "$baseline_hash" "$baseline_musl_hash" > "$release_dir/SHA256SUMS"

download_file() {
    local url="$1"
    local destination="$2"
    printf '%s\n' "$url" >> "$fixture_dir/downloads"
    case "$url" in
        */atomcli-linux-x64) cp "$release_dir/atomcli-linux-x64" "$destination" ;;
        */atomcli-linux-x64-musl) cp "$release_dir/atomcli-linux-x64-musl" "$destination" ;;
        */atomcli-linux-x64-baseline) cp "$release_dir/atomcli-linux-x64-baseline" "$destination" ;;
        */atomcli-linux-x64-baseline-musl) cp "$release_dir/atomcli-linux-x64-baseline-musl" "$destination" ;;
        */SHA256SUMS) cp "$release_dir/SHA256SUMS" "$destination" ;;
        *) return 1 ;;
    esac
}

OS_TYPE="linux"
ARCH_TYPE="x64"
VERSION="9.8.7"
INSTALL_DIR="$install_dir"
CONFIG_DIR="$fixture_dir/config"
is_baseline_required() { return 1; }
install_binary >/dev/null

cmp "$release_dir/atomcli-linux-x64" "$install_dir/atomcli"
grep -Fxq \
    "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/atomcli-linux-x64" \
    "$fixture_dir/downloads"
grep -Fxq \
    "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/SHA256SUMS" \
    "$fixture_dir/downloads"

is_musl_linux() { return 0; }
musl_install_dir="$fixture_dir/musl-install"
INSTALL_DIR="$musl_install_dir"
install_binary >/dev/null
cmp "$release_dir/atomcli-linux-x64-musl" "$musl_install_dir/atomcli"
grep -Fxq \
    "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/atomcli-linux-x64-musl" \
    "$fixture_dir/downloads"

is_baseline_required() { return 0; }
is_musl_linux() { return 1; }
baseline_install_dir="$fixture_dir/baseline-install"
INSTALL_DIR="$baseline_install_dir"
install_binary >/dev/null
cmp "$release_dir/atomcli-linux-x64-baseline" "$baseline_install_dir/atomcli"
grep -Fxq \
    "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/atomcli-linux-x64-baseline" \
    "$fixture_dir/downloads"

is_musl_linux() { return 0; }
baseline_musl_install_dir="$fixture_dir/baseline-musl-install"
INSTALL_DIR="$baseline_musl_install_dir"
install_binary >/dev/null
cmp "$release_dir/atomcli-linux-x64-baseline-musl" "$baseline_musl_install_dir/atomcli"
grep -Fxq \
    "https://github.com/aToom13/AtomCLI/releases/download/v9.8.7/atomcli-linux-x64-baseline-musl" \
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

progress_output=$(progress_start 2; progress_step "one"; progress_step "two"; progress_complete)
printf '%s' "$progress_output" | grep -Fq " 50%  two"
printf '%s' "$progress_output" | grep -Fq "100%  Complete"
if printf '%s' "$progress_output" | grep -Fq "100%  two"; then
    echo "installer reported 100% before completion" >&2
    exit 1
fi

curl() { return 22; }
CONFIG_DIR="$fixture_dir/prefetch-config"
prefetch_models_cache >/dev/null
if [ -e "$CONFIG_DIR/cache/models.json" ]; then
    echo "failed model catalog download left a partial cache" >&2
    exit 1
fi

apk() {
    [ "$1" != "info" ]
}
run_privileged() {
    printf '%s\n' "$*" > "$fixture_dir/privileged-command"
}
OS_TYPE="linux"
ensure_alpine_runtime_dependencies >/dev/null
grep -Fxq "apk add --no-cache libstdc++ libgcc" "$fixture_dir/privileged-command"
