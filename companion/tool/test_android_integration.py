#!/usr/bin/env python3
"""Drive the real Android app against two isolated AtomCLI processes."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--device", required=True)
parser.add_argument("--output", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
output = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix="atomcli-companion-e2e-"))
if output.is_relative_to(root):
    parser.error("Keep integration evidence and test credentials outside the repository")
output.mkdir(parents=True, exist_ok=True, mode=0o700)
if any(output.iterdir()):
    parser.error("Use an empty output directory for each integration run")
children = []
ports = []
logs = []
RUN_TIMEOUT_SECONDS = 20 * 60
finished = threading.Event()

def adb(*command, check=True):
    return subprocess.run(["adb", "-s", args.device, *command], check=check, capture_output=True, text=True)

def grant_permissions():
    while not finished.wait(1):
        for permission in ["CAMERA", "POST_NOTIFICATIONS"]:
            adb("shell", "pm", "grant", "io.atomcli.companion.e2e", "android.permission." + permission, check=False)

try:
    adb("get-state")
    # Only the dedicated test package is reset; the normal app is untouched.
    adb("shell", "pm", "clear", "io.atomcli.companion.e2e", check=False)
    controls = []
    for name in ["a", "b"]:
        folder = output / name
        folder.mkdir(exist_ok=True)
        workspace = folder / "workspace"
        workspace.mkdir(exist_ok=True)
        subprocess.run(["git", "init", "--quiet", str(workspace)], check=True)
        state = folder / "ready.json"
        state.unlink(missing_ok=True)
        env = {key: value for key, value in os.environ.items()
               if key in {"PATH", "HOME", "SHELL", "USER", "LOGNAME", "LANG", "TMPDIR", "BUN_INSTALL", "TERM"}
               or key.startswith("LC_")}
        env.update({"ATOMCLI_TEST_HOME": str(folder / "home"),
               "ATOMCLI_DEVICE_WORKSPACE": str(workspace), "ATOMCLI_DEVICE_STATE": str(state),
               "ATOMCLI_TEST": "true", "ATOMCLI_DISABLE_DEFAULT_PLUGINS": "true",
               "ATOMCLI_DISABLE_MODELS_FETCH": "true", "ATOMCLI_BASH_SANDBOX_BYPASS": "true",
               "MODELS_DEV_API_JSON": str(root / "AtomBase/test/tool/fixtures/models-api.json")})
        log = (folder / "server.log").open("w")
        logs.append(log)
        proc = subprocess.Popen(["bun", "run", "--conditions=browser", "test/companion/device-fixture.ts"],
                                cwd=root / "AtomBase", env=env, stdout=log, stderr=log, start_new_session=True)
        children.append(proc)
        deadline = time.monotonic() + 60
        while not state.exists():
            if proc.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError(f"Fixture {name} failed; inspect {folder / 'server.log'}")
            time.sleep(0.2)
        info = json.loads(state.read_text())
        for port in [info["port"], info["controlPort"]]:
            adb("reverse", f"tcp:{port}", f"tcp:{port}")
            ports.append(port)
        controls.append(f"http://127.0.0.1:{info['controlPort']}")
    threading.Thread(target=grant_permissions, daemon=True).start()
    command = ["flutter", "test", "integration_test/companion_e2e_test.dart", "-d", args.device,
               "--reporter", "expanded", "--verbose", "--no-uninstall", f"--dart-define=ATOMCLI_E2E_CONTROL_A={controls[0]}",
               f"--dart-define=ATOMCLI_E2E_CONTROL_B={controls[1]}"]
    with (output / "android-integration.log").open("w") as log:
        proc = subprocess.Popen(command, cwd=root / "companion", env={**os.environ, "ATOMCLI_ANDROID_E2E": "1"},
                                stdout=log, stderr=log, start_new_session=True)
        children.append(proc)
        try:
            code = proc.wait(timeout=RUN_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            code = 124
            print("Android integration exceeded its 20-minute build/start/test ceiling", flush=True)
    for name, control in zip(["a", "b"], controls):
        try:
            with urllib.request.urlopen(control + "/state", timeout=10) as response:
                (output / name / "evidence.json").write_bytes(response.read())
        except OSError as error:
            (output / name / "evidence-error.txt").write_text(str(error) + "\n")
            code = code or 1
    (output / "android-integration.exit").write_text(str(code) + "\n")
    print(json.dumps({"exit": code, "output": str(output)}), flush=True)
    raise SystemExit(code)
finally:
    finished.set()
    for name, command in [("android-crash.log", ["logcat", "-b", "crash", "-d", "-v", "threadtime"]),
                          ("android-runtime.log", ["logcat", "-d", "-v", "threadtime", "-s", "flutter", "AndroidRuntime", "DEBUG", "libc"])]:
        try:
            result = subprocess.run(["adb", "-s", args.device, *command], capture_output=True, text=True, timeout=10)
            (output / name).write_text(result.stdout + result.stderr)
        except subprocess.TimeoutExpired:
            (output / name).write_text("adb diagnostics timed out\n")
    adb("shell", "am", "force-stop", "io.atomcli.companion.e2e", check=False)
    for proc in children:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
    for proc in children:
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
    for log in logs:
        log.close()
    for port in ports:
        adb("reverse", "--remove", f"tcp:{port}", check=False)
