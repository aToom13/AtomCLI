import type { AgentBenchmark } from "@/core/eval/benchmark"

export namespace EvalProgress {
  export interface Stream {
    isTTY?: boolean
    columns?: number
    write(value: string): unknown
  }

  export function duration(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1_000))
    const hours = Math.floor(seconds / 3_600)
    const minutes = Math.floor((seconds % 3_600) / 60)
    const remainder = seconds % 60
    if (hours > 0)
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
  }

  function compact(value: string, width: number) {
    if (value.length <= width) return value.padEnd(width)
    return value.slice(0, Math.max(1, width - 1)) + "…"
  }

  export function create(input: {
    stream: Stream
    suite: string
    version: string
    model: string
    total: number
    now?: () => number
  }) {
    const now = input.now ?? Date.now
    const totalStartedAt = now()
    let current: Extract<AgentBenchmark.Progress, { type: "case_started" }> | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let attempted = 0
    let stoppedByLimit = false
    const write = (value: string) => {
      try {
        input.stream.write(value)
      } catch {
        // Progress output is best-effort; the benchmark result remains authoritative.
      }
    }

    const clearLiveLine = () => {
      if (input.stream.isTTY) write("\r\u001b[2K")
    }
    const width = () => Math.max(18, Math.min(36, (input.stream.columns ?? 100) - 52))
    const render = () => {
      if (!current || !input.stream.isTTY) return
      const caseElapsed = now() - current.startedAt
      const totalElapsed = now() - totalStartedAt
      clearLiveLine()
      write(
        `[${current.index}/${current.total}] RUNNING ${compact(current.id, width())} ` +
          `case ${duration(caseElapsed)} | total ${duration(totalElapsed)}`,
      )
    }

    write(`Benchmark ${input.suite} v${input.version}\nModel: ${input.model}\nCases: ${input.total}\n\n`)
    if (input.stream.isTTY) {
      timer = setInterval(render, 1_000)
      timer.unref?.()
    }

    return {
      update(event: AgentBenchmark.Progress) {
        if (event.type === "case_started") {
          current = event
          if (input.stream.isTTY) render()
          else write(`[${event.index}/${event.total}] START ${event.id} (${event.category})\n`)
          return
        }

        attempted = event.index
        stoppedByLimit ||= event.rateLimited
        clearLiveLine()
        current = undefined
        const status = event.ok ? "DONE" : event.rateLimited ? "RATE_LIMIT" : "ERROR"
        write(
          `[${event.index}/${event.total}] ${status} ${event.id} | ${duration(event.durationMs)}` +
            (event.error ? ` | ${event.error.replace(/\s+/g, " ").slice(0, 160)}` : "") +
            "\n",
        )
      },
      finish(failed = false) {
        if (timer) clearInterval(timer)
        timer = undefined
        clearLiveLine()
        current = undefined
        const label = stoppedByLimit
          ? "Stopped by provider rate limit"
          : failed
            ? "Benchmark execution failed"
            : "Benchmark execution finished"
        write(`${label}: ${attempted}/${input.total} attempted | total ${duration(now() - totalStartedAt)}\n\n`)
      },
    }
  }
}
