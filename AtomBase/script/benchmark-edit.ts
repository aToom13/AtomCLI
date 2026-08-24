#!/usr/bin/env bun

import fs from "fs/promises"
import os from "os"
import path from "path"

type EditArgs = {
  oldString?: string
  newString?: string
  replaceAll?: boolean
  contentHash?: string
  startAnchor?: string
  endAnchor?: string
  operations?: Array<{
    oldString: string
    newString: string
    replaceAll?: boolean
    startAnchor?: string
    endAnchor?: string
  }>
}

type BenchmarkCase = {
  id: string
  run(filePath: string): Promise<void>
}

type CaseResult = {
  id: string
  passed: boolean
  medianMs: number
  samplesMs: number[]
  error?: string
}

const iterationsArgument = process.argv.find((argument) => argument.startsWith("--iterations="))
const iterations = Math.max(1, Number(iterationsArgument?.split("=")[1] ?? 3))
if (!Number.isInteger(iterations)) throw new Error("--iterations must be a positive integer")

const root = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-edit-benchmark-"))
process.env.ATOMCLI_TEST_HOME = path.join(root, "atomcli-home")
process.env.ATOMCLI_TEST = "true"
process.env.ATOMCLI_DISABLE_MODELS_FETCH = "true"
process.env.XDG_DATA_HOME = path.join(root, "share")
process.env.XDG_CACHE_HOME = path.join(root, "cache")
process.env.XDG_CONFIG_HOME = path.join(root, "config")
process.env.XDG_STATE_HOME = path.join(root, "state")
process.env.BUN_TMPDIR = path.join(root, "bun-tmp")
await fs.mkdir(process.env.BUN_TMPDIR, { recursive: true })
const [{ EditTool }, { ReadTool }, { Instance }, { Log }] = await Promise.all([
  import("@/integrations/tool/edit"),
  import("@/integrations/tool/read"),
  import("@/services/project/instance"),
  import("@/util/util/log"),
])
await Log.init({ print: false, dev: true, level: "ERROR" })
const sessionID = "edit-benchmark"
const baseContext = {
  sessionID,
  messageID: "benchmark",
  callID: "benchmark",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

async function read(filePath: string, limit?: number) {
  const tool = await ReadTool.init()
  return tool.execute({ filePath, limit }, baseContext)
}

async function edit(filePath: string, args: EditArgs, ask: () => Promise<void> = async () => {}) {
  const tool = await EditTool.init()
  return tool.execute({ filePath, ...args }, { ...baseContext, ask })
}

async function expectFailure(action: () => Promise<unknown>, pattern: RegExp) {
  try {
    await action()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (pattern.test(message)) return
    throw error
  }
  throw new Error(`Expected failure matching ${pattern}`)
}

async function expectContent(filePath: string, expected: string) {
  const actual = await Bun.file(filePath).text()
  if (actual !== expected) throw new Error(`Unexpected content: ${JSON.stringify(actual.slice(0, 200))}`)
}

const cases: BenchmarkCase[] = [
  {
    id: "exact-hash-guarded",
    async run(filePath) {
      await Bun.write(filePath, "alpha beta")
      const snapshot = await read(filePath)
      await edit(filePath, { oldString: "beta", newString: "gamma", contentHash: snapshot.metadata.contentHash })
      await expectContent(filePath, "alpha gamma")
    },
  },
  {
    id: "stale-edit-rejected",
    async run(filePath) {
      await Bun.write(filePath, "before")
      const snapshot = await read(filePath)
      await Bun.write(filePath, "changed elsewhere")
      await expectFailure(
        () => edit(filePath, { oldString: "before", newString: "after", contentHash: snapshot.metadata.contentHash }),
        /Stale edit/,
      )
      await expectContent(filePath, "changed elsewhere")
    },
  },
  {
    id: "ambiguous-edit-rejected",
    async run(filePath) {
      await Bun.write(filePath, "same middle same")
      await read(filePath)
      await expectFailure(() => edit(filePath, { oldString: "same", newString: "changed" }), /multiple matches/)
      await expectContent(filePath, "same middle same")
    },
  },
  {
    id: "repeated-text-anchor-scope",
    async run(filePath) {
      const original = "first\nrepeat\nend first\nsecond\nrepeat\nend second"
      await Bun.write(filePath, original)
      const snapshot = await read(filePath, 3)
      await edit(filePath, {
        oldString: "repeat",
        newString: "changed",
        contentHash: snapshot.metadata.contentHash,
        startAnchor: snapshot.metadata.startAnchor,
        endAnchor: snapshot.metadata.endAnchor,
      })
      await expectContent(filePath, "first\nchanged\nend first\nsecond\nrepeat\nend second")
    },
  },
  {
    id: "large-file",
    async run(filePath) {
      const original = `${"0123456789abcdef\n".repeat(100_000)}unique-tail`
      await Bun.write(filePath, original)
      const snapshot = await read(filePath, 5)
      await edit(filePath, {
        oldString: "unique-tail",
        newString: "updated-tail",
        contentHash: snapshot.metadata.contentHash,
      })
      const result = await Bun.file(filePath).text()
      if (!result.endsWith("updated-tail")) throw new Error("Large-file tail was not updated")
    },
  },
  {
    id: "concurrent-modification-rejected",
    async run(filePath) {
      await Bun.write(filePath, "original")
      const snapshot = await read(filePath)
      await expectFailure(
        () =>
          edit(
            filePath,
            { oldString: "original", newString: "agent", contentHash: snapshot.metadata.contentHash },
            async () => {
              await Bun.write(filePath, "external")
            },
          ),
        /awaiting permission/,
      )
      await expectContent(filePath, "external")
    },
  },
  {
    id: "atomic-multi-edit",
    async run(filePath) {
      await Bun.write(filePath, "alpha beta gamma")
      const snapshot = await read(filePath)
      await edit(filePath, {
        contentHash: snapshot.metadata.contentHash,
        operations: [
          { oldString: "alpha", newString: "one" },
          { oldString: "gamma", newString: "three" },
        ],
      })
      await expectContent(filePath, "one beta three")

      const secondSnapshot = await read(filePath)
      await expectFailure(
        () =>
          edit(filePath, {
            contentHash: secondSnapshot.metadata.contentHash,
            operations: [
              { oldString: "one", newString: "changed" },
              { oldString: "missing", newString: "never" },
            ],
          }),
        /not found/,
      )
      await expectContent(filePath, "one beta three")
    },
  },
  {
    id: "fuzzy-fallback",
    async run(filePath) {
      await Bun.write(filePath, "function run() {\n    return true\n}")
      const snapshot = await read(filePath)
      await edit(filePath, {
        oldString: "function run() {\nreturn true\n}",
        newString: "function run() {\n  return false\n}",
        contentHash: snapshot.metadata.contentHash,
      })
      await expectContent(filePath, "function run() {\n  return false\n}")
    },
  },
  {
    id: "single-and-operations-formats",
    async run(filePath) {
      await Bun.write(filePath, "a b c")
      const first = await read(filePath)
      await edit(filePath, { oldString: "a", newString: "A", contentHash: first.metadata.contentHash })
      const second = await read(filePath)
      await edit(filePath, {
        contentHash: second.metadata.contentHash,
        operations: [
          { oldString: "b", newString: "B" },
          { oldString: "c", newString: "C" },
        ],
      })
      await expectContent(filePath, "A B C")
    },
  },
]

try {
  await Bun.spawn(["git", "init", "--quiet", root]).exited
  const results = await Instance.provide({
    directory: root,
    fn: async () => {
      const output: CaseResult[] = []
      for (const benchmarkCase of cases) {
        const samplesMs: number[] = []
        let error: string | undefined
        for (let iteration = 0; iteration < iterations; iteration++) {
          const filePath = path.join(root, `${benchmarkCase.id}-${iteration}.txt`)
          const startedAt = Bun.nanoseconds()
          try {
            await benchmarkCase.run(filePath)
          } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
          }
          samplesMs.push(Number(Bun.nanoseconds() - startedAt) / 1_000_000)
          if (error) break
        }
        const sorted = [...samplesMs].sort((a, b) => a - b)
        output.push({
          id: benchmarkCase.id,
          passed: !error,
          medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
          samplesMs: samplesMs.map((sample) => Number(sample.toFixed(3))),
          ...(error ? { error } : {}),
        })
      }
      return output
    },
  })
  const passed = results.filter((result) => result.passed).length
  process.stdout.write(
    `${JSON.stringify(
      {
        formatVersion: 1,
        benchmark: "edit-reliability",
        iterations,
        providerIndependent: true,
        passed,
        total: results.length,
        cases: results,
      },
      null,
      2,
    )}\n`,
  )
  if (passed !== results.length) process.exitCode = 1
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
