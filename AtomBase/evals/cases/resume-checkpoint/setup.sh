#!/usr/bin/env bash
# Materializes a partially completed migration with a checkpoint document.
# Steps 1-2 are done; the agent must resume without redoing them.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"

DIR="$WS/eval-fixtures/resume-checkpoint"
rm -rf "$DIR"
mkdir -p "$DIR/migrated"

cat > "$DIR/records.csv" <<'EOF'
id,name,email
1,Ada Lovelace,ada@example.com
2,Alan Turing,alan@example.com
3,Grace Hopper,grace@example.com
4,Linus Benedict,linus@example.com
5,Margaret Hamilton,margaret@example.com
6,Barbara Liskov,barbara@example.com
7,Donald Knuth,donald@example.com
8,Edsger Dijkstra,edsger@example.com
9,Frances Allen,frances@example.com
10,Gordon Bell,gordon@example.com
EOF

make_record() { # id name email
  printf '{"id":"rec-%03d","name":"%s","email":"%s","schemaVersion":2}' "$1" "$2" "$3"
}
make_record 1 "Ada Lovelace" "ada@example.com" > "$DIR/migrated/rec-001.json"
make_record 2 "Alan Turing" "alan@example.com" > "$DIR/migrated/rec-002.json"
make_record 3 "Grace Hopper" "grace@example.com" > "$DIR/migrated/rec-003.json"
make_record 4 "Linus Benedict" "linus@example.com" > "$DIR/migrated/rec-004.json"
make_record 5 "Margaret Hamilton" "margaret@example.com" > "$DIR/migrated/rec-005.json"

cat > "$DIR/CHECKPOINT.md" <<'EOF'
# Migration run #4711 — checkpoint

Workflow: migrate `records.csv` into per-record JSON files under `migrated/`.

## Completed
- [x] Step 1: v2 record shape agreed (`{id: rec-XXX, name, email, schemaVersion: 2}`)
- [x] Step 2: records 1-5 migrated to `migrated/rec-001.json` .. `rec-005.json`

## Remaining
- [ ] Step 3: migrate the remaining records (6-10) into `migrated/`
- [ ] Step 4: confirm every output file carries `schemaVersion: 2`

Do NOT rewrite files that step 2 already produced.
EOF

cat > "$DIR/migrate.ts" <<'EOF'
import { readFileSync } from "node:fs"
import path from "node:path"

export interface MigratedRecord {
  id: string
  name: string
  email: string
  schemaVersion: 2
}

export function convertRow(row: { id: number; name: string; email: string }): MigratedRecord {
  return {
    id: `rec-${String(row.id).padStart(3, "0")}`,
    name: row.name,
    email: row.email,
    schemaVersion: 2,
  }
}

export function parseCsv(content: string): Array<{ id: number; name: string; email: string }> {
  return content
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [id, name, email] = line.split(",")
      return { id: Number(id), name, email }
    })
}

// TODO(resume): convert only rows whose target file does not exist yet in
// migrated/, writing each result as migrated/<id>.json.
export function resumeMigration(dir = import.meta.dir): MigratedRecord[] {
  const csv = readFileSync(path.join(dir, "records.csv"), "utf8")
  return parseCsv(csv).map(convertRow)
}
EOF

cat > "$DIR/migrate.test.ts" <<'EOF'
import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import path from "node:path"
import { resumeMigration } from "./migrate"

describe("resume migration", () => {
  test("all ten records exist exactly once", () => {
    resumeMigration(import.meta.dir)
    const files = readdirSync(path.join(import.meta.dir, "migrated")).sort()
    expect(files).toEqual([
      "rec-001.json",
      "rec-002.json",
      "rec-003.json",
      "rec-004.json",
      "rec-005.json",
      "rec-006.json",
      "rec-007.json",
      "rec-008.json",
      "rec-009.json",
      "rec-010.json",
    ])
  })
})
EOF

mkdir -p "$SB/resume-checkpoint"
for file in "$DIR"/migrated/rec-00{1,2,3,4,5}.json; do
  sha256sum "$file"
done | sed "s|$WS/||" > "$SB/resume-checkpoint/completed.sha256"

echo "fixture ready at $DIR"
