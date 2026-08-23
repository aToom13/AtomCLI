#!/usr/bin/env bash
# Materializes a well-specified module that has zero test coverage.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"

DIR="$WS/eval-fixtures/test-authoring"
rm -rf "$DIR"
mkdir -p "$DIR"

cat > "$DIR/slugify.ts" <<'EOF'
/**
 * Converts arbitrary text into a URL-safe slug.
 *
 * Contract:
 * - Unicode accents are transliterated away ("Café" -> "cafe").
 * - The result is lowercased.
 * - Every run of non-alphanumeric characters becomes a single dash.
 * - Leading and trailing dashes are removed.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
EOF

cat > "$DIR/README.md" <<'EOF'
# slugify

`slugify(input: string): string`

## Required behaviors

| Input              | Expected        | Why                          |
| ------------------ | --------------- | ---------------------------- |
| `"Hello World"`    | `hello-world`   | lowercasing + space collapse |
| `"a  b___c"`       | `a-b-c`         | separator runs collapse      |
| `"Café Ünïcode"`   | `cafe-unicode`  | accent stripping             |
| `"--hi-- there--"` | `hi-there`      | edge dashes trimmed          |
| `""`               | `""`            | empty input                  |
| `"v2.0 release!"`  | `v2-0-release`  | digits + punctuation         |

This module currently has **no tests**. Regression coverage is overdue.
EOF

echo "fixture ready at $DIR"
