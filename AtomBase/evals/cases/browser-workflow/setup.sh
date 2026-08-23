#!/usr/bin/env bash
# Materializes a local web app with planted accessibility issues and starts it
# on http://localhost:4591. Requests are logged to the run sandbox.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"

DIR="$WS/eval-fixtures/browser-workflow"
rm -rf "$DIR"
mkdir -p "$DIR/app" "$SB/browser-workflow"

# Kill a stale server from an earlier run, if any.
if [ -f /tmp/atomcli-browser-case.pid ]; then
  kill "$(cat /tmp/atomcli-browser-case.pid)" >/dev/null 2>&1 || true
  rm -f /tmp/atomcli-browser-case.pid
fi
if curl -s --max-time 1 http://localhost:4591/ >/dev/null 2>&1; then
  echo "port 4591 is already in use" >&2
  exit 2
fi

cat > "$DIR/app/index.html" <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Orion Newsletter</title>
  </head>
  <body>
    <h1 style="color: #cccccc; background: #ffffff">Subscribe to our newsletter</h1>
    <form id="signup">
      <input type="email" name="email" placeholder="you@example.com" />
      <button type="submit">&#10148;</button>
    </form>
    <p id="status"></p>
    <script>
      document.getElementById("signup").addEventListener("submit", async (event) => {
        event.preventDefault()
        const email = new FormData(event.target).get("email")
        const response = await fetch("/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        })
        document.getElementById("status").textContent = (await response.json()).ok ? "Subscribed!" : "Failed"
      })
    </script>
  </body>
</html>
EOF

ACCESS_LOG="$SB/browser-workflow/access.log"
INDEX_HTML="$DIR/app/index.html"
export INDEX_HTML
: > "$ACCESS_LOG"
nohup bun -e '
const server = Bun.serve({
  port: 4591,
  async fetch(request) {
    const url = new URL(request.url)
    console.log(`${request.method} ${url.pathname}`)
    if (request.method === "POST" && url.pathname === "/submit") {
      await request.json().catch(() => ({}))
      return Response.json({ ok: true })
    }
    return new Response(await Bun.file(process.env.INDEX_HTML).text(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  },
})
process.on("SIGTERM", () => { server.stop(true); process.exit(0) })
' >>"$ACCESS_LOG" 2>&1 &
echo $! > /tmp/atomcli-browser-case.pid

for _ in $(seq 1 20); do
  curl -sf http://localhost:4591/ >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sf http://localhost:4591/ >/dev/null || { echo "server did not come up" >&2; exit 3; }

echo "fixture ready at $DIR (server pid $(cat /tmp/atomcli-browser-case.pid))"
