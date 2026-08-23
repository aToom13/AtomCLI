#!/usr/bin/env bash
# Materializes two conflicting latency analyses plus the raw log that resolves
# the dispute. The full-log p99 is 842ms; the biased sample claims 118ms.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"

DIR="$WS/eval-fixtures/agent-coordination"
rm -rf "$DIR"
mkdir -p "$DIR/evidence" "$DIR/logs"

# Raw gateway log: 100 requests. Sorted latencies end with 700, 750, 820,
# 842, 901 so the nearest-rank p99 of the FULL log is exactly 842ms.
LOG="$DIR/logs/gateway.log"
: > "$LOG"
sec=0
emit() { # path ms
  sec=$((sec + 7))
  printf '2026-08-22T09:%02d:%02d.000Z GET %s 200 %s\n' $((sec / 60)) $((sec % 60)) "$1" "$2" >>"$LOG"
}
for i in $(seq 1 10); do
  for ms in 80 95 110 120 140; do emit /api/items "$ms"; done
done
for ms in 90 105 125 130 160; do emit /api/orders "$ms"; done   # lines 51-55
for i in $(seq 1 8); do
  for ms in 85 100 115 135 150; do emit /api/items "$ms"; done  # lines 56-95
done
emit /api/reports 700
emit /api/reports 750
emit /api/export 820
emit /api/export 842
emit /api/export 901

cat > "$DIR/evidence/metrics-a.json" <<'EOF'
{
  "metric": "latency_p99_ms",
  "value": 842,
  "method": "full log replay",
  "sample_size": 100,
  "analyst": "team-atlas"
}
EOF

cat > "$DIR/evidence/metrics-b.json" <<'EOF'
{
  "metric": "latency_p99_ms",
  "value": 118,
  "method": "sampled morning window",
  "sample_size": 50,
  "analyst": "team-orion"
}
EOF

cat > "$DIR/README.md" <<'EOF'
# Gateway latency dispute

Two analyses of `logs/gateway.log` disagree about p99 latency:

- `evidence/metrics-a.json` claims **842ms** (team-atlas)
- `evidence/metrics-b.json` claims **118ms** (team-orion)

Both teams insist their numbers are correct. The incident review needs an
adjudicated answer backed by the raw log data itself.
EOF

echo "fixture ready at $DIR"
