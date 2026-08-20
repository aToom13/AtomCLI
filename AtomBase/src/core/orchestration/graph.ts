export namespace OrchestrationGraph {
  export interface Node {
    id: string
    dependsOn: string[]
  }

  export interface Result {
    status: "pending" | "running" | "completed" | "failed" | "skipped"
  }

  export function topologicalSort(tasks: Node[]): string[] {
    const graph = new Map<string, string[]>()
    const inDegree = new Map<string, number>()
    for (const task of tasks) {
      graph.set(task.id, [])
      inDegree.set(task.id, 0)
    }
    for (const task of tasks) {
      for (const dependency of task.dependsOn) {
        if (!graph.has(dependency)) throw new Error(`Task "${task.id}" depends on unknown task "${dependency}"`)
        graph.get(dependency)!.push(task.id)
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1)
      }
    }
    const queue = [...inDegree].filter(([, degree]) => degree === 0).map(([id]) => id)
    const sorted: string[] = []
    while (queue.length > 0) {
      const current = queue.shift()!
      sorted.push(current)
      for (const neighbor of graph.get(current) ?? []) {
        const degree = (inDegree.get(neighbor) ?? 0) - 1
        inDegree.set(neighbor, degree)
        if (degree === 0) queue.push(neighbor)
      }
    }
    if (sorted.length !== tasks.length) {
      const remaining = tasks.filter((task) => !sorted.includes(task.id)).map((task) => task.id)
      throw new Error(`Circular dependency detected among tasks: ${remaining.join(", ")}`)
    }
    return sorted
  }

  export function ready<T extends Node>(tasks: T[], results: Record<string, Result>): T[] {
    return tasks.filter((task) =>
      results[task.id]?.status === "pending" && task.dependsOn.every((dependency) => results[dependency]?.status === "completed"),
    )
  }

  export function hasFailedDependency(task: Node, results: Record<string, Result>) {
    return task.dependsOn.length > 0 && task.dependsOn.some((dependency) => {
      const status = results[dependency]?.status
      return status === "failed" || status === "skipped"
    })
  }
}
