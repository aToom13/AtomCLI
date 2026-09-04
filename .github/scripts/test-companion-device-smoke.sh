#!/usr/bin/env bash
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/bin"
: > "$TEST_DIR/app.apk"

cat > "$TEST_DIR/bin/adb" <<'MOCK_ADB'
#!/usr/bin/env bash
set -eu

if [ "${1:-}" = "devices" ]; then
  printf 'List of devices attached\n'
  if [ "${FAKE_ANDROID_DEVICE:-0}" = "1" ]; then printf 'device-1\tdevice product:test model:Galaxy_Test\n'; fi
  exit 0
fi
if [ "${1:-}" = "-s" ]; then shift 2; fi
if [ "${1:-}" = "install" ]; then exit 0; fi
if [ "${1:-}" = "logcat" ]; then exit 0; fi
if [ "${1:-}" != "shell" ]; then exit 0; fi
shift
case "${1:-} ${2:-}" in
  "getprop ro.product.manufacturer") printf 'samsung\n' ;;
  "getprop ro.product.model") printf 'Galaxy Test\n' ;;
  "getprop ro.build.version.sdk") printf '36\n' ;;
  "getprop ro.build.version.release") printf '16\n' ;;
  "getprop ro.build.version.oneui") printf '8.0\n' ;;
  "getprop ro.build.version.sep") printf '160000\n' ;;
  "am force-stop") ;;
  "am start") printf 'Status: ok\n' ;;
  "pidof io.atomcli.companion") printf '123\n' ;;
  "dumpsys package") printf 'versionName=3.4.2\nandroid.permission.INTERNET\nandroid.permission.POST_PROMOTED_NOTIFICATIONS\nallowBackup=false\n' ;;
  "dumpsys window") printf 'Window io.atomcli.companion/io.atomcli.companion.MainActivity\n  mAttrs={(0,0)(fillxfill)\n    fl=81812100\n' ;;
esac
MOCK_ADB
chmod +x "$TEST_DIR/bin/adb"

set +e
PATH="$TEST_DIR/bin:$PATH" "$ROOT/companion/tool/verify-android-device.sh" "$TEST_DIR/app.apk" \
  > "$TEST_DIR/no-device.out" 2>&1
NO_DEVICE_STATUS=$?
set -e
if [ "$NO_DEVICE_STATUS" -ne 3 ] || ! grep -q 'INCONCLUSIVE' "$TEST_DIR/no-device.out"; then
  printf 'expected no-device run to be explicitly inconclusive\n' >&2
  cat "$TEST_DIR/no-device.out" >&2
  exit 1
fi

FAKE_ANDROID_DEVICE=1 PATH="$TEST_DIR/bin:$PATH" \
  "$ROOT/companion/tool/verify-android-device.sh" "$TEST_DIR/app.apk" > "$TEST_DIR/device.out"
grep -q 'PASS  release APK installed' "$TEST_DIR/device.out"
grep -q 'PASS  Live Update promotion permission is declared' "$TEST_DIR/device.out"
grep -q 'PASS  active AtomCLI window flags include FLAG_SECURE (0x2000)' "$TEST_DIR/device.out"
grep -q 'CHECK Samsung/Now Bar eligibility detected' "$TEST_DIR/device.out"
if grep -q 'PASS.*Now Bar' "$TEST_DIR/device.out"; then
  printf 'Now Bar eligibility must never be reported as placement success\n' >&2
  exit 1
fi

printf 'companion device smoke classification tests passed\n'
