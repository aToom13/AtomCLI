import z from "zod"
import { Tool } from "./tool"
import { execSync } from "child_process"
import * as os from "os"

const DESCRIPTION = `System health monitoring and management tool.

Provides:
- CPU, RAM, Disk, GPU usage monitoring
- Process management (list, kill)
- System optimization suggestions
- Resource cleanup options

**USE PROACTIVELY:**
- Check system health periodically during long operations
- Kill high-resource processes if needed
- Monitor system resources before heavy operations

**ACTIONS:**
- "check": Get current system health status (CPU, RAM, Disk, GPU)
- "processes": List top resource-consuming processes
- "kill": Terminate a process by PID
- "optimize": Clean up system resources (cache, temp files)
- "gpu": Detailed GPU information`

export const SystemHealthTool = Tool.define("system_health", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["check", "processes", "kill", "optimize", "gpu"]).describe("The action to perform"),
    pid: z.number().optional().describe("Process ID to kill (for 'kill' action)"),
    signal: z.enum(["SIGTERM", "SIGKILL"]).optional().describe("Signal to send (default: SIGTERM)"),
  }),
  async execute(params, ctx): Promise<any> {
    switch (params.action) {
      case "check": {
        const cpuLoad = os.loadavg()
        const totalMem = os.totalmem()
        const freeMem = os.freemem()
        const usedMemPercent = (((totalMem - freeMem) / totalMem) * 100).toFixed(1)

        // Get disk usage
        let diskInfo = "Unknown"
        try {
          diskInfo = execSync("df -h / | tail -1", { encoding: "utf-8" }).trim()
        } catch { }

        // Get uptime
        const uptime = os.uptime()
        const uptimeHours = Math.floor(uptime / 3600)
        const uptimeMins = Math.floor((uptime % 3600) / 60)

        return {
          title: "System Health Check",
          output: `## System Status

**CPU Load:**
- 1 min: ${cpuLoad[0].toFixed(2)}
- 5 min: ${cpuLoad[1].toFixed(2)}
- 15 min: ${cpuLoad[2].toFixed(2)}

**Memory:**
- Total: ${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB
- Free: ${(freeMem / 1024 / 1024 / 1024).toFixed(1)} GB
- Used: ${usedMemPercent}%

**Disk (root):**
${diskInfo}

**Uptime:** ${uptimeHours}h ${uptimeMins}m

**Platform:** ${os.platform()} ${os.release()}
**Arch:** ${os.arch()}`,
          metadata: {
            cpuLoad,
            memory: { total: totalMem, free: freeMem, usedPercent: parseFloat(usedMemPercent) },
            uptime,
          },
        }
      }

      case "processes": {
        let output = "## Top Processes by CPU\n\n"
        output += "| PID    | User     | CPU%  | MEM%  | Command\n"
        output += "|--------|----------|-------|-------|------------------\n"

        try {
          const result = execSync("ps aux --sort=-%cpu | head -15", { encoding: "utf-8" })
          const lines = result.trim().split("\n").slice(1) // Skip header

          for (const line of lines) {
            const parts = line.split(/\s+/)
            const user = parts[0].substring(0, 8)
            const pid = parts[1]
            const cpu = parts[2]
            const mem = parts[3]
            const cmd = parts.slice(10).join(" ").substring(0, 30)
            output += `| ${pid.padEnd(6)} | ${user.padEnd(8)} | ${cpu.padEnd(5)} | ${mem.padEnd(5)} | ${cmd}\n`
          }
        } catch (e) {
          output += "Error getting process list: " + (e as Error).message
        }

        return {
          title: "Top Processes",
          output,
          metadata: { cpuLoad: undefined, memory: undefined, uptime: undefined, pid: undefined, signal: undefined, error: undefined, freedBytes: undefined },
        }
      }

      case "kill": {
        if (!params.pid) {
          return {
            title: "Error",
            output: "PID is required for kill action",
            metadata: { cpuLoad: undefined, memory: undefined, uptime: undefined, pid: undefined, signal: undefined, error: undefined, freedBytes: undefined },
          }
        }

        const signal = params.signal || "SIGTERM"

        try {
          process.kill(params.pid, signal)
          return {
            title: `Process ${params.pid} terminated`,
            output: `Sent ${signal} to process ${params.pid}`,
            metadata: { pid: params.pid, signal, cpuLoad: undefined, memory: undefined, uptime: undefined, error: undefined, freedBytes: undefined },
          }
        } catch (e) {
          return {
            title: "Failed to kill process",
            output: `Error: ${(e as Error).message}`,
            metadata: { error: (e as Error).message, cpuLoad: undefined, memory: undefined, uptime: undefined, pid: undefined, signal: undefined, freedBytes: undefined },
          }
        }
      }

      case "optimize": {
        let output = "## System Optimization\n\n"
        let freed = 0

        // Clear package manager cache (if exists)
        try {
          // npm cache
          execSync("npm cache clean --force 2>/dev/null || true", { encoding: "utf-8" })
          output += "- npm cache cleaned\n"
        } catch { }

        // Clear temp files (older than 1 day)
        try {
          const result = execSync("find /tmp -type f -mtime +1 -delete 2>/dev/null | wc -l", { encoding: "utf-8" })
          output += `- Cleaned ${result.trim()} old temp files\n`
        } catch { }

        // Sync filesystem buffers
        try {
          execSync("sync", { encoding: "utf-8" })
          output += "- Filesystem buffers synced\n"
        } catch { }

        output += "\nOptimization complete."

        return {
          title: "System Optimized",
          output,
          metadata: { freedBytes: freed, cpuLoad: undefined, memory: undefined, uptime: undefined, pid: undefined, signal: undefined, error: undefined },
        }
      }

      case "gpu": {
        let output = "## GPU Information\n\n"

        // Check for NVIDIA GPU
        try {
          const gpuInfo = execSync(
            "nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv,noheader 2>/dev/null",
            { encoding: "utf-8" },
          ).trim()

          if (gpuInfo) {
            const lines = gpuInfo.split("\n")
            let gpuIndex = 0
            for (const line of lines) {
              const [name, memTotal, memUsed, memFree, util, temp] = line.split(", ")
              output += `**GPU ${gpuIndex}:**\n`
              output += `- Name: ${name}\n`
              output += `- Memory: ${memUsed.trim()} / ${memTotal.trim()} used (${memFree.trim()} free)\n`
              output += `- Utilization: ${util.trim()}\n`
              output += `- Temperature: ${temp.trim()}\n\n`
              gpuIndex++
            }

            // Add GPU processes
            try {
              const gpuProcesses = execSync(
                "nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null | head -10",
                { encoding: "utf-8" },
              ).trim()
              if (gpuProcesses) {
                output += "**GPU Processes:**\n"
                output += "| PID | Process | Memory |\n"
                output += "|-----|---------|--------|\n"
                for (const line of gpuProcesses.split("\n")) {
                  const [pid, name, mem] = line.split(", ")
                  output += `| ${pid} | ${name} | ${mem} |\n`
                }
              }
            } catch { }
          }
        } catch {
          output += "No NVIDIA GPU detected or nvidia-smi not available.\n"

          // Check for AMD GPU
          try {
            const amdGpu = execSync("lspci | grep -i vga | grep -i amd", { encoding: "utf-8" }).trim()
            if (amdGpu) {
              output += `\n**AMD GPU detected:**\n${amdGpu}\n`
            }
          } catch { }
        }

        return {
          title: "GPU Status",
          output,
          metadata: { cpuLoad: undefined, memory: undefined, uptime: undefined, pid: undefined, signal: undefined, error: undefined, freedBytes: undefined },
        }
      }
    }
  },
})
