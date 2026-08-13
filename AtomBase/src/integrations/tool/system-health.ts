import z from "zod"
import os from "os"
import path from "path"
import { statfs } from "fs/promises"
import { Tool } from "./tool"

const COMMAND_TIMEOUT_MS = 5_000
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024

const DESCRIPTION = `Read-only system health diagnostics.

Provides:
- CPU, memory, disk, uptime, platform, and architecture information
- A bounded list of high-CPU processes
- Best-effort GPU information

This tool never terminates processes, removes files, or clears package-manager caches.`

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCommand(command: string[], signal: AbortSignal): Promise<CommandResult> {
  if (signal.aborted) throw signal.reason

  const subprocess = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stop = () => {
    try {
      subprocess.kill()
    } catch {}
  }
  signal.addEventListener("abort", stop, { once: true })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    stop()
  }, COMMAND_TIMEOUT_MS)

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      readBounded(subprocess.stdout, stop),
      readBounded(subprocess.stderr, stop),
    ])
    if (signal.aborted) throw signal.reason
    if (timedOut) throw new Error(`${command[0]} timed out after ${COMMAND_TIMEOUT_MS} ms`)
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener("abort", stop)
  }
}

async function readBounded(stream: ReadableStream<Uint8Array>, stop: () => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_COMMAND_OUTPUT_BYTES) {
        stop()
        await reader.cancel().catch(() => {})
        throw new Error(`Command output exceeds ${MAX_COMMAND_OUTPUT_BYTES} bytes`)
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join("")
  } finally {
    reader.releaseLock()
  }
}

function cpuTotals() {
  return os.cpus().reduce(
    (total, cpu) => {
      total.idle += cpu.times.idle
      total.all += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
      return total
    },
    { idle: 0, all: 0 },
  )
}

async function cpuUsagePercent() {
  const before = cpuTotals()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const after = cpuTotals()
  const elapsed = after.all - before.all
  return elapsed > 0 ? ((elapsed - (after.idle - before.idle)) / elapsed) * 100 : 0
}

function gib(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

async function diskUsage() {
  const root = path.parse(process.cwd()).root || "/"
  const stats = await statfs(root, { bigint: true })
  const total = Number(stats.blocks * stats.bsize)
  const free = Number(stats.bavail * stats.bsize)
  return { root, total, free, usedPercent: total > 0 ? ((total - free) / total) * 100 : 0 }
}

type ProcessInfo = {
  pid: string
  user: string
  cpu: number
  memory: string
  command: string
}

type SystemHealthMetadata = {
  platform: NodeJS.Platform
  count?: number
  cpuPercent?: number
  cpuCount?: number
  loadAverage?: number[]
  memory?: { total: number; free: number }
  disk?: Awaited<ReturnType<typeof diskUsage>>
  uptime?: number
  arch?: string
}

function parseUnixProcesses(output: string): ProcessInfo[] {
  return output
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      pid: match[1],
      user: match[2],
      cpu: Number(match[3]) || 0,
      memory: `${match[4]}%`,
      command: match[5],
    }))
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 15)
}

function parseWindowsProcesses(output: string): ProcessInfo[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 15)
    .map((line) => {
      const columns = Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g), (match) =>
        match[1].replaceAll('""', '"'),
      )
      return {
        pid: columns[1] ?? "?",
        user: "-",
        cpu: 0,
        memory: columns[4] ?? "?",
        command: columns[0] ?? line,
      }
    })
}

async function processes(signal: AbortSignal) {
  const command =
    process.platform === "win32"
      ? ["tasklist", "/FO", "CSV", "/NH"]
      : ["ps", "-axo", "pid=,user=,%cpu=,%mem=,command="]
  const result = await runCommand(command, signal)
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `${command[0]} exited with ${result.exitCode}`)
  return process.platform === "win32" ? parseWindowsProcesses(result.stdout) : parseUnixProcesses(result.stdout)
}

function processTable(items: ProcessInfo[]) {
  if (items.length === 0) return "No process information available."
  const rows = items.map(
    (item) =>
      `| ${item.pid} | ${item.user.slice(0, 16)} | ${item.cpu.toFixed(1)} | ${item.memory} | ${item.command.slice(0, 80)} |`,
  )
  return ["| PID | User | CPU% | Memory | Command |", "|---:|---|---:|---:|---|", ...rows].join("\n")
}

async function fallbackGpuInfo(signal: AbortSignal) {
  if (process.platform === "darwin") {
    return runCommand(["system_profiler", "SPDisplaysDataType", "-detailLevel", "mini"], signal)
  }
  if (process.platform === "win32") {
    return runCommand(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | Format-List | Out-String",
      ],
      signal,
    )
  }
  if (process.platform === "freebsd") return runCommand(["pciconf", "-lv"], signal)
  return runCommand(["lspci", "-nn"], signal)
}

async function gpuInfo(signal: AbortSignal) {
  try {
    const nvidia = await runCommand(
      [
        "nvidia-smi",
        "--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu",
        "--format=csv,noheader",
      ],
      signal,
    )
    if (nvidia.exitCode === 0 && nvidia.stdout.trim()) return nvidia.stdout.trim()
  } catch {
    if (signal.aborted) throw signal.reason
  }

  try {
    const fallback = await fallbackGpuInfo(signal)
    if (fallback.exitCode !== 0) return "GPU information is unavailable on this system."
    const lines = fallback.stdout
      .split(/\r?\n/)
      .filter((line) => {
        if (process.platform === "linux") return /vga|3d|display/i.test(line)
        if (process.platform === "freebsd") return /vga|display/i.test(line)
        return true
      })
      .slice(0, 100)
    return lines.join("\n").trim() || "No GPU was detected."
  } catch {
    if (signal.aborted) throw signal.reason
    return "GPU information is unavailable on this system."
  }
}

const parameters = z.object({
  action: z.enum(["check", "processes", "gpu"]).describe("The read-only diagnostic to perform"),
})

export const SystemHealthTool = Tool.define<typeof parameters, SystemHealthMetadata>("system_health", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    if (params.action === "processes") {
      try {
        const items = await processes(ctx.abort)
        return {
          title: "System Processes",
          output: processTable(items),
          metadata: { count: items.length, platform: process.platform },
        }
      } catch (error) {
        return {
          title: "System Processes",
          output: `Process information is unavailable: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { count: 0, platform: process.platform },
        }
      }
    }

    if (params.action === "gpu") {
      return {
        title: "GPU Status",
        output: await gpuInfo(ctx.abort),
        metadata: { platform: process.platform },
      }
    }

    const [cpuPercent, disk] = await Promise.all([cpuUsagePercent(), diskUsage().catch(() => undefined)])
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const uptime = os.uptime()
    const loadAverage = os.loadavg()
    const diskLine = disk
      ? `${disk.root}: ${gib(disk.free)} free / ${gib(disk.total)} total (${disk.usedPercent.toFixed(1)}% used)`
      : "Unavailable"

    return {
      title: "System Health Check",
      output: [
        "## System Status",
        "",
        `- CPU: ${cpuPercent.toFixed(1)}% across ${os.cpus().length} logical cores`,
        `- Load average (1/5/15m): ${loadAverage.map((value) => value.toFixed(2)).join(" / ")}`,
        `- Memory: ${gib(totalMemory - freeMemory)} used / ${gib(totalMemory)} total`,
        `- Disk: ${diskLine}`,
        `- Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        `- Platform: ${os.platform()} ${os.release()} (${os.arch()})`,
      ].join("\n"),
      metadata: {
        cpuPercent,
        cpuCount: os.cpus().length,
        loadAverage,
        memory: { total: totalMemory, free: freeMemory },
        disk,
        uptime,
        platform: os.platform(),
        arch: os.arch(),
      },
    }
  },
})
