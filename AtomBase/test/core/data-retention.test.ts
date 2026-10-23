import "../preload"
import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test"
import { $ } from "bun"
import { Database } from "bun:sqlite"
import fs from "fs/promises"
import path from "path"
import { StorageManifest } from "@/core/storage/manifest"
import { Storage } from "@/core/storage/storage"
import { Snapshot } from "@/core/snapshot"
import { Global } from "@/core/global"
import { Instance } from "@/services/project/instance"
import { ExecutionLedger } from "@/core/execution/ledger"
import { tmpdir } from "../fixture/fixture"

const DAY = 86_400_000
afterEach(() => setSystemTime())

function ageFiles() {
  setSystemTime(new Date(Date.now() + 3 * DAY))
  return { olderThan: Date.now() - DAY, maxBytes: 1024 * 1024 }
}

test("blob GC preserves references/shared blobs/recent files and previews without deletion", async () => {
  await using tmp = await tmpdir()
  const manifest = await StorageManifest.open(tmp.path)
  try {
    await manifest.replace(["live"], '"shared"')
    await manifest.replace(["removed"], '"shared"')
    manifest.remove(["removed"])
    await manifest.replace(["changed"], '"old"')
    const orphan = manifest.pointer(["changed"])!.contentHash!
    await manifest.replace(["changed"], '"current"')
    expect(await Bun.file(manifest.blobPath(orphan)).exists()).toBe(false)
    // Legacy versions/crashed writers may still leave orphans for the sweeper.
    await Bun.write(manifest.blobPath(orphan), '"old"')
    const options = ageFiles()
    const preview = await manifest.collectGarbage({ ...options, dryRun: true })
    expect(preview.eligibleFiles).toBe(1)
    expect(preview.removedFiles).toBe(0)
    expect(await Bun.file(manifest.blobPath(orphan)).exists()).toBe(true)
    expect((await manifest.collectGarbage({ ...options, dryRun: false })).removedFiles).toBe(1)
    expect(await Bun.file(manifest.blobPath(orphan)).exists()).toBe(false)
    expect((await manifest.read(["live"]))!.content).toBe('"shared"')
    expect((await manifest.read(["changed"]))!.content).toBe('"current"')
    await manifest.replace(["recent"], '"new"')
    manifest.remove(["recent"])
    setSystemTime()
    expect(
      (await manifest.collectGarbage({ ...options, olderThan: Date.now() - DAY, dryRun: false })).removedFiles,
    ).toBe(0)
  } finally {
    manifest.close()
  }
})

test("GC byte budget, tombstones and symlinks cannot remove retained or external data", async () => {
  await using tmp = await tmpdir()
  const manifest = await StorageManifest.open(tmp.path)
  try {
    await manifest.replace(["deleted"], '"large orphan"')
    const orphan = manifest.pointer(["deleted"])!.contentHash!
    manifest.remove(["deleted"])
    await Bun.write(manifest.blobPath(orphan), '"large orphan"')
    const outside = path.join(tmp.path, "outside.json")
    await Bun.write(outside, '"outside"')
    await fs.symlink(outside, path.join(tmp.path, ".blobs", "a".repeat(64) + ".json"))
    const options = ageFiles()
    const limited = await manifest.collectGarbage({ ...options, maxBytes: 1, dryRun: false })
    expect(limited.limited).toBe(true)
    expect(limited.removedFiles).toBe(0)
    expect(manifest.pointer(["deleted"])!.tombstone).toBe(true)
    expect(await Bun.file(outside).text()).toBe('"outside"')
    await expect(manifest.collectGarbage({ ...options, olderThan: Date.now(), dryRun: false })).rejects.toThrow("grace")
    await expect(manifest.collectGarbage({ ...options, maxBytes: NaN, dryRun: false })).rejects.toThrow("budget")
  } finally {
    manifest.close()
  }
})

test("an open reader survives collection; concurrent publishers never reference missing blobs", async () => {
  await using tmp = await tmpdir()
  const writer = await StorageManifest.open(tmp.path)
  const collector = await StorageManifest.open(tmp.path)
  try {
    await writer.replace(["record"], '"original"')
    const opened = writer.openBlob(["record"])!
    try {
      await writer.replace(["record"], '"replacement"')
      const options = ageFiles()
      expect((await collector.collectGarbage({ ...options, dryRun: false })).removedFiles).toBe(0)
      expect(await opened.file.text()).toBe('"original"')
    } finally {
      opened.close()
    }
    const options = { olderThan: Date.now() - DAY, maxBytes: 1024 * 1024, dryRun: false }
    await Promise.all([
      (async () => {
        for (let i = 0; i < 100; i++) await writer.replace(["record"], JSON.stringify(i % 3))
      })(),
      (async () => {
        for (let i = 0; i < 10; i++) await collector.collectGarbage(options)
      })(),
    ])
    expect((await writer.read(["record"]))!.content).toBe("0")
  } finally {
    writer.close()
    collector.close()
  }
})

test("manifest prefix queries preserve exact JSON-key boundaries", async () => {
  await using tmp = await tmpdir()
  const manifest = await StorageManifest.open(tmp.path)
  try {
    for (const key of [
      ["part", "a"],
      ["part", "a", "x"],
      ["part", "ab", "x"],
      ["part", 'a"\\', "x"],
    ]) {
      await manifest.replace(key, "{}")
    }
    expect(manifest.list(["part", "a"])).toEqual([
      ["part", "a", "x"],
      ["part", "a"],
    ])
    expect(manifest.list(["part", 'a"\\'])).toEqual([["part", 'a"\\', "x"]])
  } finally {
    manifest.close()
  }
})

test("separate processes can publish and collect the same reused blobs without broken references", async () => {
  await using tmp = await tmpdir()
  const manifest = await StorageManifest.open(tmp.path)
  try {
    await manifest.replace(["record"], "0")
    const code = `
      import { StorageManifest } from "./src/core/storage/manifest.ts"
      const manifest = await StorageManifest.open(process.argv[1])
      const future = Date.now() + 3 * 86400000
      Date.now = () => future
      try {
        await Bun.sleep(100)
        for (let i = 0; i < 100; i++) {
          if (process.argv[2] === "write") await manifest.replace(["record"], String(i % 3))
          else await manifest.collectGarbage({ dryRun: false, olderThan: future - 86400000, maxBytes: 1048576 })
          if (!(await manifest.read(["record"]))) throw new Error("Missing live record")
        }
      } finally { manifest.close() }
    `
    await Promise.all(
      ["write", "collect"].map(async (operation) => {
        const child = Bun.spawn([process.execPath, "--eval", code, tmp.path, operation], {
          cwd: path.resolve(import.meta.dir, "../.."),
          env: process.env,
          stdout: "pipe",
          stderr: "pipe",
        })
        const [exit, error] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
          new Response(child.stdout).text(),
        ])
        if (exit !== 0) throw new Error(`Concurrent storage worker failed (${exit}): ${error}`)
      }),
    )
    expect((await manifest.read(["record"]))!.content).toBe("0")
  } finally {
    manifest.close()
  }
}, 15_000)

test("snapshot GC keeps retained legacy trees, in-flight pins and rollback; removes expired unused trees", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const projectID = Instance.project.id
      const git = path.join(Global.Path.data, "snapshot", projectID)
      await Bun.write(path.join(tmp.path, "file.txt"), "retained")
      const retained = (await Snapshot.track())!
      // Simulate snapshots created by the old version without persistent refs.
      for await (const ref of $`git --git-dir ${git} for-each-ref --format='%(refname)' refs/atomcli/`.lines()) {
        if (!ref) continue
        await $`git --git-dir ${git} update-ref -d ${ref}`.quiet()
      }
      await Storage.write(["session", projectID, "retention-session"], {
        id: "retention-session",
        revert: { snapshot: retained },
      })
      await Bun.write(path.join(tmp.path, "file.txt"), "obsolete")
      const obsolete = (await Snapshot.track())!
      await Bun.write(path.join(tmp.path, "file.txt"), "current")
      await Snapshot.track()
      const options = ageFiles()
      const pending = (await Snapshot.track())!
      expect((await Snapshot.collectGarbage({ ...options, dryRun: true })).applied).toBe(false)
      expect((await Snapshot.collectGarbage({ ...options, dryRun: false })).retainedTrees).toBe(1)
      expect((await $`git --git-dir ${git} cat-file -t ${obsolete}`.quiet().nothrow()).exitCode).not.toBe(0)
      expect((await $`git --git-dir ${git} cat-file -t ${pending}`.quiet()).text().trim()).toBe("tree")
      await Snapshot.restore(retained)
      expect(await Bun.file(path.join(tmp.path, "file.txt")).text()).toBe("retained")
      await Instance.dispose()
    },
  })
}, 30_000)

test("missing or malformed retained roots block snapshot pruning", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const tree = (await Snapshot.track())!
      const projectID = Instance.project.id
      await Storage.write(["session", projectID, "bad-root"], { id: "bad-root", revert: { snapshot: "a".repeat(40) } })
      await expect(Snapshot.collectGarbage({ ...ageFiles(), dryRun: false })).rejects.toThrow("cleanup refused")
      await Storage.write(["session", projectID, "bad-root"], { id: "bad-root", revert: { snapshot: "../outside" } })
      await expect(Snapshot.collectGarbage({ olderThan: Date.now() - DAY, dryRun: false })).rejects.toThrow(
        "Invalid retained",
      )
      await Snapshot.restore(tree)
      await Instance.dispose()
    },
  })
})

test("snapshot maintenance lock waits asynchronously and is released by a crashed owner", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      const lock = path.join(Global.Path.data, "snapshot-locks", `${Instance.project.id}.sqlite`)
      const db = new Database(lock)
      db.run("BEGIN IMMEDIATE")
      let completed = false
      const tracking = Snapshot.track().then(() => {
        completed = true
      })
      await Bun.sleep(60)
      expect(completed).toBe(false)
      db.close() // Crash-equivalent: rollback/releases SQLite's OS lock.
      await tracking
      expect(completed).toBe(true)
      await Instance.dispose()
    },
  })
})

test("unfinished execution protects even unpersisted snapshot pins beyond their grace period", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const tree = (await Snapshot.track())!
      const ledger = ExecutionLedger.open(path.join(Global.Path.data, "execution-ledger.sqlite"))
      try {
        ledger.start({
          id: crypto.randomUUID(),
          projectID: Instance.project.id,
          rootSessionID: "retention-active",
          fence: 1,
        })
        await expect(Snapshot.collectGarbage({ ...ageFiles(), dryRun: false })).rejects.toThrow(
          "unfinished or uncertain",
        )
        await Snapshot.restore(tree)
      } finally {
        ledger.close()
        await Instance.dispose()
      }
    },
  })
})

test("replacements retire immediately; shared references and failed CAS remain readable", async () => {
  await using tmp = await tmpdir()
  const manifest = await StorageManifest.open(tmp.path)
  try {
    await manifest.replace(["a"], '"shared"')
    await manifest.replace(["b"], '"shared"')
    const shared = manifest.pointer(["a"])!.contentHash!
    const revision = manifest.pointer(["a"])!.revision
    await manifest.replace(["a"], '"new"')
    expect(await Bun.file(manifest.blobPath(shared)).exists()).toBe(true)
    expect(await manifest.compareAndSwap(["a"], revision, '"conflict"')).toBeUndefined()
    expect((await manifest.read(["a"]))!.content).toBe('"new"')
    manifest.remove(["b"])
    expect(await Bun.file(manifest.blobPath(shared)).exists()).toBe(false)
    expect((await fs.readdir(path.join(tmp.path, ".blobs"))).length).toBe(1)
  } finally {
    manifest.close()
  }
})

test("diagnostic expiry preserves chats and recent replay records", async () => {
  await using tmp = await tmpdir()
  const manifest = await StorageManifest.open(tmp.path)
  try {
    for (const namespace of ["session", "message", "part", "request", "session_event"]) {
      await manifest.replace([namespace, "old"], JSON.stringify({ namespace }))
    }
    setSystemTime(new Date(Date.now() + 8 * DAY))
    await manifest.replace(["request", "recent"], '"recent"')
    const cutoff = Date.now() - 7 * DAY
    expect(manifest.expireDiagnostics(cutoff, true).eligible).toBe(2)
    expect((await manifest.read(["request", "old"]))!.content).toBeTruthy()
    expect(manifest.expireDiagnostics(cutoff, false).removed).toBe(2)
    for (const namespace of ["session", "message", "part"])
      expect(await manifest.read([namespace, "old"])).toBeDefined()
    expect(await manifest.read(["request", "recent"])).toBeDefined()
    expect(await manifest.read(["request", "old"])).toBeUndefined()
  } finally {
    manifest.close()
  }
})

test("capture excludes generated and oversized files without touching originals or the project index", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Bun.write(path.join(tmp.path, "source.ts"), "original")
      await Bun.write(path.join(tmp.path, "large.mp4"), new Uint8Array(3 * 1024 * 1024))
      await $`git add source.ts`.cwd(tmp.path).quiet()
      await Bun.write(path.join(tmp.path, ".gitignore"), "build/\nsource.ts\n")
      await Bun.write(path.join(tmp.path, "build", "output.txt"), "generated")
      await Bun.write(path.join(tmp.path, ":(glob)literal.txt"), "literal")
      const before = await $`git ls-files --stage`.cwd(tmp.path).quiet().text()
      const tree = (await Snapshot.track())!
      const git = path.join(Global.Path.data, "snapshot", Instance.project.id)
      const files = await $`git --git-dir ${git} ls-tree -r --name-only ${tree}`.quiet().text()
      expect(files).toContain("source.ts")
      expect(files).toContain(":(glob)literal.txt")
      expect(files).not.toContain("large.mp4")
      expect(files).not.toContain("output.txt")
      expect((await fs.stat(path.join(tmp.path, "large.mp4"))).size).toBe(3 * 1024 * 1024)
      expect(await Bun.file(path.join(tmp.path, "build", "output.txt")).text()).toBe("generated")
      expect(await $`git ls-files --stage`.cwd(tmp.path).quiet().text()).toBe(before)
      await Instance.dispose()
    },
  })
})

test("global capture quota stops new snapshots while preserving existing rollback", async () => {
  await using tmp = await tmpdir({ git: true })
  await Bun.write(path.join(tmp.path, "atomcli.json"), JSON.stringify({ retention: { snapshot_mib: 1024 } }))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const git = path.join(Global.Path.data, "snapshot", Instance.project.id)
      await Bun.write(path.join(tmp.path, "source.ts"), "retained")
      const config = await import("@/core/config/config")
      const tree = (await Snapshot.track())!
      expect(tree).toBeTruthy()
      await config.Config.update({ retention: { snapshot_mib: 1 } })
      expect((await config.Config.get()).retention?.snapshot_mib).toBe(1)
      const object = path.join(git, "objects", "ab", "c".repeat(38))
      await Bun.write(object, new Uint8Array(2 * 1024 * 1024))
      try {
        expect(await Snapshot.track()).toBeUndefined()
        await Bun.write(path.join(tmp.path, "source.ts"), "changed")
        await Snapshot.restore(tree)
        expect(await Bun.file(path.join(tmp.path, "source.ts")).text()).toBe("retained")
      } finally {
        await fs.unlink(object)
        await Instance.dispose()
      }
    },
  })
})

test("live record quota rejects growth before writing blobs, permits deletion/shrink and serializes writers", async () => {
  await using tmp = await tmpdir()
  const a = await StorageManifest.open(tmp.path, { maxBytes: 6000 })
  const b = await StorageManifest.open(tmp.path, { maxBytes: 6000 })
  try {
    const attempts = await Promise.allSettled([
      a.replace(["a"], JSON.stringify("a".repeat(1000))),
      b.replace(["b"], JSON.stringify("b".repeat(1000))),
    ])
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1)
    const key = a.pointer(["a"]) ? ["a"] : ["b"]
    const before = (await a.read(key))!.content
    const count = (await fs.readdir(path.join(tmp.path, ".blobs"))).length
    await expect(a.replace(key, JSON.stringify("x".repeat(10000)))).rejects.toThrow("Storage limit")
    expect((await a.read(key))!.content).toBe(before)
    expect((await fs.readdir(path.join(tmp.path, ".blobs"))).length).toBe(count)
    await a.replace(key, '"small"')
    a.remove(key)
    await b.replace(["after-delete"], '"allowed"')
    expect((await a.read(["after-delete"]))!.content).toBe('"allowed"')
  } finally {
    a.close()
    b.close()
  }
})

test("verified legacy compaction preserves current values, tombstones, unknown keys and malformed originals", async () => {
  await using tmp = await tmpdir()
  const code = `
    import { strict as assert } from "node:assert"
    import fs from "node:fs/promises"
    import path from "node:path"
    import { StorageManifest } from "./src/core/storage/manifest.ts"
    import { Storage } from "./src/core/storage/storage.ts"
    const dir = path.join(process.env.ATOMCLI_TEST_HOME, ".atomcli/data/storage")
    const manifest = await StorageManifest.open(dir)
    await manifest.replace(["sample", "current"], '"new"')
    manifest.remove(["sample", "deleted"])
    for (const [name, value] of [["current", '"old"'], ["deleted", '"deleted"'], ["missing", '"imported"'], ["broken", "\\u0000"]]) {
      await Bun.write(path.join(dir, "sample", name + ".json"), value)
    }
    assert.equal((await Storage.compactLegacy(true)).removedFiles, 0)
    assert.equal(manifest.pointer(["sample", "missing"]), undefined)
    const result = await Storage.compactLegacy(false)
    assert.equal(result.removedFiles, 3)
    assert.equal(result.unreadableFiles, 1)
    assert.equal(await Storage.read(["sample", "current"]), "new")
    assert.equal(await Storage.read(["sample", "missing"]), "imported")
    assert.equal(manifest.pointer(["sample", "deleted"]).tombstone, true)
    assert.equal(await Bun.file(path.join(dir, "sample/broken.json")).text(), "\\u0000")
    manifest.close()
  `
  const child = Bun.spawn([process.execPath, "--eval", code], {
    cwd: path.resolve(import.meta.dir, "../.."),
    env: { ...process.env, ATOMCLI_TEST_HOME: tmp.path },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exit, error] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ])
  if (exit !== 0) throw new Error(`Legacy compaction worker failed (${exit}): ${error}`)
})

test("normal tools retain applied provenance without duplicating arguments/results; replay is opt-in", async () => {
  const { ToolRuntime } = await import("@/integrations/tool/runtime")
  for (const replay of [false, true]) {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "atomcli.json"), JSON.stringify({ retention: { replay } }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `retention-tool-${crypto.randomUUID()}`
        const result = await ToolRuntime.execute({
          tool: "read",
          args: { payload: "input".repeat(1000) },
          context: {
            sessionID,
            messageID: "message",
            agent: "build",
            abort: new AbortController().signal,
            metadata() {},
            async ask() {},
          },
          execute: async () => ({ title: "read", output: "output".repeat(1000), metadata: {} }),
        })
        expect(result.output).toHaveLength(6000)
        const events = await Promise.all(
          (await Storage.list(["session_event", sessionID])).map((key) => Storage.read<any>(key)),
        )
        expect(events.some((event) => event.type === "tool.applied")).toBe(true)
        expect(events.some((event) => event.type === "tool.call")).toBe(replay)
        expect(events.some((event) => event.type === "tool.result")).toBe(replay)
        await Instance.dispose()
      },
    })
  }
})

test("a file growing after inspection cannot bypass snapshot size admission", async () => {
  await using tmp = await tmpdir({ git: true })
  const growing = path.join(tmp.path, "growing.bin")
  await Bun.write(growing, "small")
  const open = fs.open.bind(fs)
  let expanded = false
  const intercepted = spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === growing && !expanded) {
      expanded = true
      await Bun.write(growing, new Uint8Array(3 * 1024 * 1024))
    }
    return open(...args)
  })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tree = (await Snapshot.track())!
        const git = path.join(Global.Path.data, "snapshot", Instance.project.id)
        const files = await $`git --git-dir ${git} ls-tree -r --name-only ${tree}`.quiet().text()
        expect(expanded).toBe(true)
        expect(files).not.toContain("growing.bin")
        expect((await fs.stat(growing)).size).toBe(3 * 1024 * 1024)
        await Instance.dispose()
      },
    })
  } finally {
    intercepted.mockRestore()
  }
})

test("turning off replay removes old request copies immediately without removing chats or recent applied provenance", async () => {
  await using tmp = await tmpdir()
  const manifest = await StorageManifest.open(tmp.path)
  try {
    await manifest.replace(["request", "session", "recent"], '"duplicated prompt"')
    await manifest.replace(["message", "session", "recent"], '"chat"')
    await manifest.replace(["session_event", "session", "recent"], '{"type":"tool.applied"}')
    const cutoff = Date.now() - 7 * DAY
    expect(manifest.expireDiagnostics(cutoff, true, false).eligible).toBe(1)
    expect(await manifest.read(["request", "session", "recent"])).toBeDefined()
    expect(manifest.expireDiagnostics(cutoff, false, false).removed).toBe(1)
    expect(await manifest.read(["request", "session", "recent"])).toBeUndefined()
    expect(await manifest.read(["message", "session", "recent"])).toBeDefined()
    expect(await manifest.read(["session_event", "session", "recent"])).toBeDefined()
  } finally {
    manifest.close()
  }
})
