#!/usr/bin/env bash
set -eu

PACKAGE="io.atomcli.companion"
APK="${1:-build/app/outputs/flutter-apk/app-release.apk}"
SERIAL="${ATOMCLI_ANDROID_SERIAL:-}"
FAILURES=0

pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'CHECK %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

if ! command -v adb >/dev/null 2>&1; then
  printf 'FAIL  adb is not installed or not on PATH\n' >&2
  exit 2
fi
if [ ! -f "$APK" ]; then
  printf 'FAIL  APK not found: %s\n' "$APK" >&2
  exit 2
fi

if [ -z "$SERIAL" ]; then
  SERIAL="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }' | head -n 1)"
fi
if [ -z "$SERIAL" ]; then
  printf 'INCONCLUSIVE  no authorized Android device is attached; no device claim was made\n' >&2
  exit 3
fi

adb_device() { adb -s "$SERIAL" "$@"; }
MANUFACTURER="$(adb_device shell getprop ro.product.manufacturer | tr -d '\r')"
MODEL="$(adb_device shell getprop ro.product.model | tr -d '\r')"
API="$(adb_device shell getprop ro.build.version.sdk | tr -d '\r')"
ANDROID="$(adb_device shell getprop ro.build.version.release | tr -d '\r')"
ONE_UI="$(adb_device shell getprop ro.build.version.oneui | tr -d '\r')"
SEP="$(adb_device shell getprop ro.build.version.sep | tr -d '\r')"
printf 'DEVICE serial=%s manufacturer=%s model=%s android=%s api=%s one_ui=%s sep=%s\n' \
  "$SERIAL" "$MANUFACTURER" "$MODEL" "$ANDROID" "$API" "${ONE_UI:-unknown}" "${SEP:-unknown}"

adb_device install -r "$APK" >/dev/null && pass "release APK installed" || fail "release APK installation"
adb_device logcat -c
adb_device shell am force-stop "$PACKAGE"
START_OUTPUT="$(adb_device shell am start -W -n "$PACKAGE/.MainActivity" 2>&1 | tr -d '\r')"
if printf '%s' "$START_OUTPUT" | grep -q 'Status: ok'; then
  pass "cold launch reached MainActivity"
else
  fail "cold launch did not report Status: ok"
fi

sleep 3
PID="$(adb_device shell pidof "$PACKAGE" | tr -d '\r')"
if [ -n "$PID" ]; then
  pass "app process remains alive after cold launch"
else
  fail "app process exited after cold launch"
fi

PACKAGE_DUMP="$(adb_device shell dumpsys package "$PACKAGE" 2>/dev/null | tr -d '\r')"
printf '%s\n' "$PACKAGE_DUMP" | grep -q 'versionName=' && pass "installed package reports a version" || fail "package version missing"
printf '%s\n' "$PACKAGE_DUMP" | grep -q 'android.permission.INTERNET' && pass "network permission is declared" || fail "network permission missing"
printf '%s\n' "$PACKAGE_DUMP" | grep -q 'android.permission.POST_PROMOTED_NOTIFICATIONS' && pass "Live Update promotion permission is declared" || fail "Live Update promotion permission missing"

APK_ANALYZER="$(command -v apkanalyzer || true)"
if [ -z "$APK_ANALYZER" ] && [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -x "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/apkanalyzer" ]; then
  APK_ANALYZER="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/apkanalyzer"
fi
if [ -z "$APK_ANALYZER" ] && [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer" ]; then
  APK_ANALYZER="$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer"
fi
APK_MANIFEST=""
if [ -n "$APK_ANALYZER" ]; then
  APK_MANIFEST="$("$APK_ANALYZER" manifest print "$APK" 2>/dev/null || true)"
fi

if printf '%s\n' "$APK_MANIFEST" | grep -q 'android:allowBackup="false"'; then
  pass "APK manifest disables Android backup"
elif printf '%s\n' "$PACKAGE_DUMP" | grep -q 'allowBackup=false'; then
  pass "Android backup is disabled"
else
  warn "confirm allowBackup=false with APK analyzer; this Android build did not expose it in dumpsys"
fi
if [ -n "$APK_MANIFEST" ]; then
  if printf '%s\n' "$APK_MANIFEST" | grep -q 'android.permission.POST_PROMOTED_NOTIFICATIONS'; then
    pass "APK manifest requests promoted ongoing notifications"
  else
    fail "APK manifest does not request promoted ongoing notifications"
  fi
  if printf '%s\n' "$APK_MANIFEST" | grep -q 'flutter_background_service.BootReceiver'; then
    fail "APK still contains the unsafe background-service boot receiver"
  else
    pass "APK excludes the background-service boot/package-update receiver"
  fi
else
  warn "apkanalyzer unavailable; boot receiver exclusion was not inspected from the APK"
fi

WINDOW_DUMP="$(adb_device shell dumpsys window windows 2>/dev/null | tr -d '\r')"
WINDOW_SECTION="$(printf '%s\n' "$WINDOW_DUMP" | grep -F -A 30 "$PACKAGE/$PACKAGE.MainActivity" || true)"
WINDOW_FLAGS="$(printf '%s\n' "$WINDOW_SECTION" | sed -n 's/.*fl=\([0-9A-Fa-f][0-9A-Fa-f]*\).*/\1/p' | head -n 1)"
if printf '%s\n' "$WINDOW_SECTION" | grep -Eq 'FLAG_SECURE|SECURE'; then
  pass "active AtomCLI window reports secure capture protection"
elif [ -n "$WINDOW_FLAGS" ] && (( (16#$WINDOW_FLAGS & 0x2000) != 0 )); then
  pass "active AtomCLI window flags include FLAG_SECURE (0x2000)"
else
  warn "verify screenshot/recording manually; active window flags did not expose FLAG_SECURE"
fi

CRASHES="$(adb_device logcat -d -v brief | grep -E "FATAL EXCEPTION|AndroidRuntime.*$PACKAGE" || true)"
if [ -z "$CRASHES" ]; then
  pass "no package crash was observed during launch"
else
  fail "AndroidRuntime reported a package crash"
  printf '%s\n' "$CRASHES"
fi

if [ "${MANUFACTURER,,}" = "samsung" ] && [ "${API:-0}" -ge 35 ]; then
  warn "Samsung/Now Bar eligibility detected; pair AtomCLI, start one mission, then verify promoted Live Update placement manually"
else
  warn "this device cannot prove Samsung Now Bar behavior; standard notification fallback still needs inspection"
fi
warn "repeat with notification permission denied, private/secret lock-screen modes, battery saver, Doze, Wi-Fi/mobile-data handoff, force-stop and process restart"

if [ "$FAILURES" -ne 0 ]; then
  exit 1
fi
