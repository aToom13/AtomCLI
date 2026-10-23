import { expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"

export namespace VerifierRegressions {
  export function register() {
    test("resume verifier parses JSON while rejecting invalid records and changes to completed work", async () => {
      await using tmp = {
        path: await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-verifier-regression-")),
        async [Symbol.asyncDispose]() {
          await fs.rm(this.path, { recursive: true, force: true })
        },
      }
      const workspace = path.join(tmp.path, "workspace")
      const sandbox = path.join(tmp.path, "sandbox")
      await fs.mkdir(workspace)
      await fs.mkdir(sandbox)
      const scripts = path.resolve(import.meta.dir, "../../resume-checkpoint")
      const run = async (script: string) => {
        const proc = Bun.spawn(["bash", path.join(scripts, script)], {
          cwd: workspace,
          env: { ...process.env, ATOMCLI_EVAL_WORKSPACE: workspace, ATOMCLI_EVAL_SANDBOX: sandbox },
          stdout: "pipe",
          stderr: "pipe",
        })
        const [exit, stdout, stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        return { exit, output: stdout + stderr }
      }
      expect((await run("setup.sh")).exit).toBe(0)
      const fixture = path.join(workspace, "eval-fixtures/resume-checkpoint")
      const sourceFile = path.join(fixture, "migrate.ts")
      const source = await Bun.file(sourceFile).text()
      await Bun.write(
        sourceFile,
        source.replace("import { readFileSync }", "import { existsSync, readFileSync, writeFileSync }").replace(
          "return parseCsv(csv).map(convertRow)",
          `return parseCsv(csv).map((row) => {
    const record = convertRow(row)
    const file = path.join(dir, "migrated", record.id + ".json")
    if (!existsSync(file)) writeFileSync(file, JSON.stringify(record, null, 2) + "\\n")
    return record
  })`,
        ),
      )
      const valid = await run("verify/run.sh")
      expect(valid.output).toContain("VERIFY PASS")
      expect(valid.exit).toBe(0)
      const recordFile = path.join(fixture, "migrated/rec-006.json")
      const record = await Bun.file(recordFile).json()
      for (const invalid of [
        "not JSON",
        JSON.stringify({ ...record, schemaVersion: "2" }),
        JSON.stringify({ ...record, schemaVersion: 1, nested: { schemaVersion: 2 } }),
        JSON.stringify({ ...record, id: "rec-007" }),
        JSON.stringify({ ...record, email: "wrong@example.com" }),
        JSON.stringify({ ...record, name: "Wrong Name" }),
      ]) {
        await Bun.write(recordFile, invalid)
        const rejected = await run("verify/run.sh")
        expect(rejected.exit, invalid + "\n" + rejected.output).toBe(1)
      }
      await Bun.write(recordFile, JSON.stringify(record))
      expect((await run("verify/run.sh")).exit).toBe(0)
      const completed = path.join(fixture, "migrated/rec-001.json")
      const original = await Bun.file(completed).text()
      await Bun.write(completed, original + "\n")
      expect((await run("verify/run.sh")).exit).toBe(1)
    })

    test("coordination verifier grades structured evidence independently of prose and rejects incorrect claims", async () => {
      await using tmp = {
        path: await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-verifier-regression-")),
        async [Symbol.asyncDispose]() {
          await fs.rm(this.path, { recursive: true, force: true })
        },
      }
      const workspace = path.join(tmp.path, "workspace")
      const sandbox = path.join(tmp.path, "sandbox")
      await fs.mkdir(workspace)
      await fs.mkdir(path.join(sandbox, "agent-coordination"), { recursive: true })
      const scripts = path.resolve(import.meta.dir, "..")
      const run = async (script: string) => {
        const proc = Bun.spawn(["bash", path.join(scripts, script)], {
          cwd: workspace,
          env: { ...process.env, ATOMCLI_EVAL_WORKSPACE: workspace, ATOMCLI_EVAL_SANDBOX: sandbox },
          stdout: "pipe",
          stderr: "pipe",
        })
        const [exit, stdout, stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        return { exit, output: stdout + stderr }
      }
      expect((await run("setup.sh")).exit).toBe(0)
      const fixture = path.join(workspace, "eval-fixtures/agent-coordination")
      const target = path.join(fixture, "VERDICT.md")
      const claim = {
        metric: "latency_p99_ms",
        population: "full_log",
        value: 842,
        sample_size: 100,
        rank: 99,
        accepted_source: "evidence/metrics-a.json",
        rejected_source: "evidence/metrics-b.json",
        rejected_value: 118,
        rejected_sample_size: 50,
        rejected_claim_applies_to_full_log: false,
      }
      const write = (value: unknown, prose = "842 ms covers the full log; 118 ms cannot represent it.") =>
        Bun.write(target, `${prose}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`)
      for (const prose of [
        "842 ms covers the full log; 118 ms cannot represent it.",
        "The full 100-request p99 is 842 ms. The 118 ms figure describes a separate 50-request morning window.",
      ]) {
        await write(claim, prose)
        const result = await run("verify/run.sh")
        expect(result.exit, result.output).toBe(0)
      }
      for (const invalid of [
        { ...claim, value: 118 },
        { ...claim, value: "842" },
        { ...claim, sample_size: 50 },
        { ...claim, rank: 100 },
        { ...claim, population: "sample" },
        { ...claim, accepted_source: "evidence/metrics-b.json" },
        { ...claim, rejected_source: "evidence/metrics-a.json" },
        { ...claim, rejected_value: 842 },
        { ...claim, rejected_sample_size: 100 },
        { ...claim, rejected_claim_applies_to_full_log: true },
        null,
      ]) {
        await write(invalid)
        const result = await run("verify/run.sh")
        expect(result.exit, JSON.stringify(invalid) + "\n" + result.output).toBe(1)
      }
      await Bun.write(target, "842 ms is correct, 118 is wrong; metrics-a and metrics-b use different samples.")
      expect((await run("verify/run.sh")).exit).toBe(1)
      await write(claim)
      const raw = path.join(fixture, "logs/gateway.log")
      const original = await Bun.file(raw).text()
      await Bun.write(raw, original + "\n")
      expect((await run("verify/run.sh")).exit).toBe(1)
      await Bun.write(raw, original)
      expect((await run("verify/run.sh")).exit).toBe(0)
      await Bun.write(path.join(fixture, "evidence/metrics-b.json"), '{"value":842}')
      expect((await run("verify/run.sh")).exit).toBe(1)
    })
  }
}
