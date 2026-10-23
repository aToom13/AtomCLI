"""Real TUI smoke driver. Default: local scripted provider; --home enables isolated live dogfood."""
import argparse
import fcntl
import http.server
import json
import os
import pathlib
import pty
import select
import signal
import sqlite3
import struct
import subprocess
import tempfile
import threading
import time

parser = argparse.ArgumentParser()
parser.add_argument("--home")
parser.add_argument("--workspace")
parser.add_argument("--prompt", default="Reply hello-pty.")
parser.add_argument("--session")
parser.add_argument("--seconds", type=float, default=12)
parser.add_argument("--type-prompt", action="store_true")
parser.add_argument("--stall-provider", action="store_true")
parser.add_argument("--resume-check", action="store_true")
parser.add_argument("--matrix", action="store_true")
args = parser.parse_args()
package = pathlib.Path(__file__).resolve().parents[3]
home = pathlib.Path(args.home or tempfile.mkdtemp(prefix="atomcli-pty-"))
workspace = pathlib.Path(args.workspace or home / "workspace")
workspace.mkdir(parents=True, exist_ok=True)
server = None
if not args.home:
    class Provider(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if args.stall_provider:
                time.sleep(30)
            tools = sum(message.get("role") == "tool" for message in request.get("messages", []))
            calls = [
                ("bash", {"command": "seq 1 50000", "description": "Long PTY tool output"}),
                ("read", {"filePath": str(workspace / "missing-pty.txt")}),
                ("bash", {"command": "sleep 2", "timeout": 1000, "description": "Intentional PTY tool timeout"}),
            ]
            if args.matrix and tools < len(calls):
                tool, arguments = calls[tools]
                deltas = [({"role": "assistant", "tool_calls": [{"index": 0, "id": f"fake-pty-tool-{tools}",
                           "type": "function", "function": {"name": tool, "arguments": json.dumps(arguments)}}]}, None),
                          ({}, "tool_calls")]
            else:
                deltas = [({"role": "assistant", "content": "hello-"}, None),
                          ({"content": "pty"}, None), ({}, "stop")]
            for delta, finish in deltas:
                chunk = {"id": "fake-pty-response", "object": "chat.completion.chunk", "created": 1,
                         "model": "smoke", "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.flush()
                time.sleep(0.05)
            self.wfile.write(b"data: [DONE]\n\n")
        def log_message(self, *_):
            pass
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    config = {"model": "pty-fixture/smoke", "small_model": "pty-fixture/smoke", "share": "disabled",
              "theme": "atomcli", "formatter": False, "review": {"enabled": False, "policy": "off"},
              "experimental": {"execution_classification": False, "smart_model_routing": False},
              "provider": {"pty-fixture": {"npm": "@ai-sdk/openai-compatible", "name": "PTY fixture",
                  "options": {"baseURL": f"http://127.0.0.1:{server.server_port}/v1", "apiKey": "fake-pty-key"},
                  "models": {"smoke": {"name": "PTY smoke", "limit": {"context": 32000, "output": 1000}}}}}}
    (workspace / "atomcli.json").write_text(json.dumps(config))
    cache = home / ".atomcli/cache"
    cache.mkdir(parents=True)
    (cache / "version").write_text("16")
    (cache / "models.json").write_bytes((package / "test/tool/fixtures/models-api.json").read_bytes())
    # Use installed workspace dependencies; TUI fixtures must not wait on registry installs.
    (home / ".atomcli/node_modules").symlink_to(package.parent / "node_modules", target_is_directory=True)
    os.environ["ATOMCLI_DISABLE_DEFAULT_PLUGINS"] = "1"

command = ["bun", "run", "--conditions=browser", str(package / "src/index.ts"), str(workspace)]
if not args.type_prompt:
    command += ["--prompt", args.prompt]
if args.session:
    command += ["--session", args.session]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(package)
    os.environ.update(ATOMCLI_TEST_HOME=str(home), TERM="xterm-256color", COLORTERM="truecolor",
                      DISPLAY="", WAYLAND_DISPLAY="", ATOMCLI_DISABLE_AUTOUPDATE="1")
    if not args.home:
        os.environ["MODELS_DEV_API_JSON"] = str(package / "test/tool/fixtures/models-api.json")
    else:
        os.environ.pop("MODELS_DEV_API_JSON", None)
    os.execvp(command[0], command)

def resize(rows, columns):
    fcntl.ioctl(fd, __import__("termios").TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    os.kill(pid, signal.SIGWINCH)

resize(32, 120)
events = []
prompt_sent = False
resize_offsets = []
rss_kib = []
if not args.home or args.matrix:
    events += [(6.5, lambda: os.write(fd, b"\x1b[200~resize-draft\nsecond line\x1b[201~")),
               (8.5, lambda: os.write(fd, b"\x03"))]
events += [(7, lambda: resize(24, 80)), (8, lambda: resize(40, 150))]
if args.seconds <= 15:
    events += [(9, lambda: os.write(fd, b"\x18l")), (10, lambda: os.write(fd, b"\x1b")),
               (10.5, lambda: os.write(fd, b"\x1b[200~multiline\ninput survives resize\x1b[201~")),
               (11, lambda: os.write(fd, b"\x03"))]
if args.matrix:
    events += [(9, lambda: os.write(fd, b"\x1b[5~\x1b[6~")),
               (9.5, lambda: os.write(fd, b"\x18b")),
               (10, lambda: os.write(fd, b"\x18b")),
               (10.5, lambda: os.write(fd, b"\x18g")),
               (11.5, lambda: os.write(fd, b"\x1b")),
               (12, lambda: os.write(fd, b"\x18l")),
               (13, lambda: os.write(fd, b"\r")),
               (14, lambda: os.write(fd, b"\x18n")),
               (15, lambda: os.write(fd, b"\x1b[200~" + ("long multiline input\n" * 60).encode() + b"\x1b[201~")),
               (15.5, lambda: os.write(fd, b"\x03")),
               (16, lambda: os.write(fd, b"rapid-input")),
               (16.1, lambda: os.write(fd, b"\x03")),
               (17, lambda: os.write(fd, b"\x18l")),
               (18, lambda: os.write(fd, b"\r")),
               (18.5, lambda: os.write(fd, b"\x1b[200~Follow-up after completion\x1b[201~")),
               (18.7, lambda: os.write(fd, b"\r"))]
events.sort(key=lambda event: event[0])
events += [(args.seconds, lambda: os.write(fd, b"\x03")),
           (args.seconds + 0.3, lambda: os.write(fd, b"\x03")),
           (args.seconds + 0.7, lambda: os.write(fd, b"\x1b[C")),
           (args.seconds + 1, lambda: os.write(fd, b"\r"))]
events.sort(key=lambda event: event[0])
output = bytearray()
raw_log = (home / "pty-output.log").open("wb")
start = time.monotonic()
active_start = None
status = None
reaped = False
while time.monotonic() - (active_start or start) < (args.seconds + 8 if active_start else 15):
    # ponytail: rendered readiness markers; use a native readiness event if labels change.
    if active_start is None and (b"Ask anything" in output or b"switch agent" in output):
        active_start = time.monotonic()
    elapsed = time.monotonic() - active_start if active_start else 0
    if active_start and len(resize_offsets) < 2 and elapsed >= 7 + len(resize_offsets):
        resize_offsets.append(len(output))
    try:
        status_text = pathlib.Path(f"/proc/{pid}/status").read_text()
        rss_kib.append(int(next(line for line in status_text.splitlines() if line.startswith("VmRSS:")).split()[1]))
    except (FileNotFoundError, StopIteration):
        pass
    if args.type_prompt and not prompt_sent and active_start:
        prompt_sent = True
        events += [(elapsed + 0.1, lambda: os.write(fd, b"\x1b[200~" + args.prompt.encode() + b"\x1b[201~")),
                   (elapsed + 0.3, lambda: os.write(fd, b"\r"))]
        events.sort(key=lambda event: event[0])
    while active_start and events and elapsed >= events[0][0]:
        events.pop(0)[1]()
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            output.extend(chunk)
            raw_log.write(chunk)
            raw_log.flush()
        except OSError:
            break
    exited, status = os.waitpid(pid, os.WNOHANG)
    if exited:
        reaped = True
        break
else:
    os.killpg(pid, signal.SIGKILL)
if not reaped:
    try:
        _, status = os.waitpid(pid, 0)
    except ChildProcessError:
        pass
os.close(fd)
raw_log.close()
(home / "pty-output.log").write_bytes(output)
summary = {"home": str(home), "workspace": str(workspace), "bytes": len(output),
           "exit": os.waitstatus_to_exitcode(status or 0), "seconds": round(time.monotonic() - start, 2),
           "scripted_provider": not bool(args.home), "typed_prompt": args.type_prompt}
summary["peak_rss_kib"] = max(rss_kib, default=0)
ledger = home / ".atomcli/data/execution-ledger.sqlite"
if ledger.exists():
    with sqlite3.connect(f"file:{ledger}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        summary["executions"] = [dict(row) for row in db.execute(
            "SELECT id,root_session_id,lifecycle,outcome,reason_code,terminal_at,mutation_revision FROM execution")]
        summary["checkpoints"] = db.execute("SELECT count(*) FROM execution_checkpoint").fetchone()[0]
        summary["tasks"] = [dict(row) for row in db.execute("SELECT id,status,session_id FROM execution_task")]
        summary["unknown_work"] = [dict(row) for row in db.execute(
            "SELECT kind,state,mutating FROM execution_work WHERE state='unknown'")]
(home / "pty-summary.json").write_text(json.dumps(summary, indent=2))
print(json.dumps(summary))
assert len(output) > 1000, "TUI produced no screen"
assert b"undefined is not an object" not in output, "TUI prompt ref crashed"
assert b"TypeError:" not in output, "TUI crashed"
assert summary["exit"] == 0, "TUI did not exit cleanly"
if args.type_prompt:
    assert prompt_sent, "Prompt readiness never appeared"
    assert summary.get("executions"), "Typed prompt did not create an execution"
if not args.home:
    assert b"hello-pty" in output, "Prompt/result never appeared"
    assert summary.get("executions"), "CLI prompt did not create an execution"
    # Session/timeline navigation is asserted by the dedicated matrix run;
    # this short stream run only checks that navigation keys do not crash.
    assert b"multiline" in output or args.matrix, "Bracketed multiline paste did not render"
    for offset in resize_offsets:
        assert b"resize-draft" in output[offset:], "Resize lost the prompt draft"
    if args.matrix:
        assert b"Timeline" in output, "Timeline did not open"
        assert b"Context" in output, "Sidebar did not render"
        assert b"rapid-input" in output, "Rapid input did not render"
        assert b"Long PTY tool output" in output, "Native long output tool did not render"
        assert b"missing-pty.txt" in output, "Native tool error did not render"
        assert b"timeout" in output, "Native timeout did not render"
        assert len(summary["executions"]) == 2, "Input did not return after terminal result/session switching"
    assert b"Exit AtomCLI?" in output, "Exit confirmation did not render"
    assert all(item["lifecycle"] == "terminal" for item in summary["executions"]), "Quit left an active execution"
    if args.stall_provider:
        assert all(item["outcome"] == "cancelled" for item in summary["executions"]), "Quit did not cancel streaming work"
    elif args.matrix:
        assert [(item["outcome"], item["reason_code"]) for item in summary["executions"]] == [
            ("blocked", "resource_limit"), ("failed", "recovery_required")
        ], "Interrupted shell work was accepted or recovery did not remain required"
        assert summary["unknown_work"] == [{"kind": "tool:bash", "state": "unknown", "mutating": 1}], \
            "Intentional timeout lost its uncertain effects"
    else:
        assert all(item["outcome"] == "completed" for item in summary["executions"]), "Scripted provider did not complete"
if args.resume_check:
    session = summary["executions"][0]["root_session_id"]
    resumed = subprocess.run(["python3", __file__, "--home", str(home), "--workspace", str(workspace),
                              "--session", session, "--type-prompt", "--prompt", "Reply resumed-pty.", "--seconds", "8"],
                             capture_output=True, text=True, timeout=25)
    assert resumed.returncode == 0, resumed.stdout + resumed.stderr
    result = json.loads(resumed.stdout.strip().splitlines()[-1])
    assert len(result["executions"]) == len(summary["executions"]) + 1, "Resume did not submit a new turn"
    assert all(item["root_session_id"] == session and item["outcome"] == "completed"
               for item in result["executions"]), "Resume switched session or failed"
    summary["resumed_turns"] = len(result["executions"])
    print(json.dumps(summary))
if server:
    server.shutdown()
