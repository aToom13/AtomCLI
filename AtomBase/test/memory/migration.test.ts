import { describe, expect, test } from "bun:test"
import "../preload"
import fs from "fs/promises"
import path from "path"
import { exportMemories, importMemories } from "@/core/memory/storage/migration"
import { tmpdir } from "../fixture/fixture"

const memory = {
  id: "memory-1",
  type: "knowledge",
  title: "Fixture",
  content: "Fixture content",
  context: "test",
  tags: ["fixture"],
  metadata: { createdAt: new Date(0).toISOString(), source: "test", usageCount: 0, successRate: 1 },
  relationships: [],
  strength: 0.5,
}

describe("memory import integrity", () => {
  test("preserves an existing corrupt target instead of overwriting it", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "memories.json")
    await fs.writeFile(target, "{broken-json")

    const result = await importMemories(JSON.stringify([memory]), target)

    expect(result.imported).toBe(0)
    expect(result.errors[0]).toContain("existing target is invalid")
    expect(await fs.readFile(target, "utf8")).toBe("{broken-json")
  })

  test("deduplicates repeated IDs inside one import batch", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "memories.json")

    const result = await importMemories(JSON.stringify([memory, { ...memory, title: "Duplicate" }]), target)
    const stored = JSON.parse(await fs.readFile(target, "utf8"))

    expect(result).toMatchObject({ imported: 1, skipped: 1, errors: [] })
    expect(stored).toHaveLength(1)
    expect(stored[0].title).toBe("Fixture")
  })

  test("round-trips every field through CSV with commas, quotes, newlines and Unicode", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source.json")
    const target = path.join(tmp.path, "target.json")
    const rich = {
      ...memory,
      title: 'Başlık, "alıntı"',
      content: "ilk satır\nikinci satır, ✓",
      problem: "neden?",
      solution: "çözüm",
      codeBefore: 'const value = "a,b"',
      codeAfter: "const value = `a\\nb`",
      tags: ["virgül,etiket", 'tırnak"'],
      relationships: ["memory-0"],
      embedding: [0.1, -0.2],
    }
    await fs.writeFile(source, JSON.stringify([rich]))

    const csv = await exportMemories(source, "csv")
    const result = await importMemories(csv, target)

    expect(result).toEqual({ imported: 1, skipped: 0, errors: [] })
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual([rich])
  })

  test("rejects malformed CSV without changing the existing target", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "memories.json")
    await fs.writeFile(target, JSON.stringify([memory]))

    const result = await importMemories('id,type\n"unterminated', target)

    expect(result.imported).toBe(0)
    expect(result.errors[0]).toContain("neither valid memory JSON nor CSV")
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual([memory])
  })
})
