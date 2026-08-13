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
