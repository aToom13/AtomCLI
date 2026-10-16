import z from "zod"
import { LedgerTypes } from "./ledger/types"
import { OrchestrationGraph } from "@/core/orchestration/graph"

export namespace AtomicPlan {
  export const Acceptance = LedgerTypes.TaskAcceptance.refine(
    (criterion) => criterion.verification === "automatic" || criterion.command === undefined,
    { message: "Only automatic acceptance accepts a command; reviewer and parent criteria require runtime evidence" },
  )
  export const Definition = z.object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    goal: z.string().trim().min(1).max(100_000),
    agent: z.string().min(1).max(100),
    dependsOn: z.array(z.string().min(1).max(100)).max(50).default([]),
    acceptance: z.array(Acceptance).min(1).max(100),
    execution: LedgerTypes.TaskExecution,
    expectedVersion: z.number().int().positive().optional(),
  })
  export type Definition = z.infer<typeof Definition>

  export function validate(input: Definition[]) {
    const tasks = z.array(Definition).min(1).max(50).parse(input)
    if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Duplicate Atomic Work task ID")
    for (const task of tasks) {
      if (task.acceptance.some((criterion) => !criterion.description.trim() || !criterion.id.trim()))
        throw new Error("Atomic Work acceptance cannot be blank")
      if (new Set(task.acceptance.map((criterion) => criterion.id)).size !== task.acceptance.length)
        throw new Error(`Duplicate acceptance criterion in ${task.id}`)
      if (new Set(task.dependsOn).size !== task.dependsOn.length) throw new Error(`Duplicate dependency in ${task.id}`)
      for (const claimed of task.execution.owns)
        if (
          claimed.includes("\0") ||
          claimed.includes("\\") ||
          claimed.startsWith("/") ||
          claimed.split("/").some((part) => part === ".." || part === ".") ||
          claimed.endsWith("/")
        )
          throw new Error(`Invalid ownership path: ${claimed}`)
    }
    const order = OrchestrationGraph.topologicalSort(tasks)
    const ancestors = new Map<string, Set<string>>()
    for (const id of order) {
      const task = tasks.find((task) => task.id === id)!
      ancestors.set(id, new Set(task.dependsOn.flatMap((dep) => [dep, ...ancestors.get(dep)!])))
    }
    for (let i = 0; i < tasks.length; i++)
      for (const right of tasks.slice(i + 1)) {
        const left = tasks[i]
        if (ancestors.get(left.id)!.has(right.id) || ancestors.get(right.id)!.has(left.id)) continue
        if (
          left.execution.owns.some((a) =>
            right.execution.owns.some(
              (b) => a === "" || b === "" || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`),
            ),
          )
        )
          throw new Error(`Unordered ownership overlap: ${left.id}, ${right.id}`)
      }
    return order.map((id) => tasks.find((task) => task.id === id)!)
  }
}
