/**
 * Agent Teams - Task Board
 *
 * A shared, mutex-protected task list that agents use to coordinate work.
 *
 * Features:
 *   - Atomic claim/release (Mutex per task)
 *   - Dependency resolution (task won't start until deps are done)
 *   - Deadlock detection (DFS cycle check on dependency graph)
 *   - Event emission on every state change
 */

import type { Task, TaskStatus, AgentTeamsEventMap } from "./types"
import type { AgentEventBus } from "./event-bus"
import { ulid } from "ulid"

interface MutexLock {
    taskId: string
    agentId: string
    acquiredAt: number
}

export class TaskBoard {
    private tasks = new Map<string, Task>()
    private locks = new Map<string, MutexLock>()
    private eventBus: AgentEventBus

    constructor(eventBus: AgentEventBus) {
        this.eventBus = eventBus
    }

    /**
     * Add a new task to the board.
     */
    addTask(input: {
        title: string
        description: string
        assignee?: string
        dependencies?: string[]
        priority?: number
    }): Task {
        const task: Task = {
            id: ulid(),
            title: input.title,
            description: input.description,
            status: "pending",
            assignee: input.assignee,
            dependencies: input.dependencies ?? [],
            priority: input.priority ?? 10,
            time: {
                created: Date.now(),
            },
        }

        this.tasks.set(task.id, task)
        this.eventBus.emit("task:created", { task })
        return task
    }

    /**
     * Try to claim a task for an agent.
     * Returns true if claim succeeded, false if already claimed or blocked by dependencies.
     */
    claim(taskId: string, agentId: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false
        if (task.status !== "pending") return false

        // Check if locked by another agent
        if (this.locks.has(taskId)) return false

        // Check dependencies
        if (!this.areDependenciesMet(taskId)) return false

        // Acquire lock
        this.locks.set(taskId, {
            taskId,
            agentId,
            acquiredAt: Date.now(),
        })

        task.status = "claimed"
        task.claimedBy = agentId
        task.time.claimed = Date.now()

        this.eventBus.emit("task:claimed", { taskId, agentId })
        return true
    }

    /**
     * Move a claimed task to "in_progress".
     */
    start(taskId: string, agentId: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false
        if (task.claimedBy !== agentId) return false
        if (task.status !== "claimed") return false

        task.status = "in_progress"
        task.time.started = Date.now()

        this.eventBus.emit("task:updated", { taskId, status: "in_progress" })
        return true
    }

    /**
     * Mark a task as completed and release the lock.
     */
    complete(taskId: string, agentId: string, result?: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false
        if (task.claimedBy !== agentId) return false

        task.status = "done"
        task.result = result
        task.time.completed = Date.now()

        this.locks.delete(taskId)
        this.eventBus.emit("task:completed", { taskId, result })
        return true
    }

    /**
     * Mark a task as failed and release the lock.
     */
    fail(taskId: string, agentId: string, error: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false
        if (task.claimedBy !== agentId) return false

        task.status = "failed"
        task.error = error
        task.time.completed = Date.now()

        this.locks.delete(taskId)
        this.eventBus.emit("task:failed", { taskId, error })
        return true
    }

    /**
     * Skip a non-critical task (graceful degradation).
     */
    skip(taskId: string, reason: string): void {
        const task = this.tasks.get(taskId)
        if (!task) return

        task.status = "skipped"
        task.error = reason
        task.time.completed = Date.now()

        this.locks.delete(taskId)
        this.eventBus.emit("task:updated", { taskId, status: "skipped", detail: reason })
    }

    /**
     * Get the next available task for an agent type.
     * Returns the highest priority task that:
     *   1. Is "pending"
     *   2. Has all dependencies met
     *   3. Matches the agent's type (if assignee is set)
     */
    getNextTask(agentType?: string): Task | undefined {
        const available = Array.from(this.tasks.values())
            .filter((t) => {
                if (t.status !== "pending") return false
                if (this.locks.has(t.id)) return false
                if (!this.areDependenciesMet(t.id)) return false
                if (agentType && t.assignee && t.assignee !== agentType) return false
                return true
            })
            .sort((a, b) => a.priority - b.priority)

        return available[0]
    }

    /**
     * Check if all dependencies of a task are completed.
     */
    private areDependenciesMet(taskId: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false

        return task.dependencies.every((depId) => {
            const dep = this.tasks.get(depId)
            return dep && (dep.status === "done" || dep.status === "skipped")
        })
    }

    /**
     * Detect deadlocks using DFS cycle detection on the dependency graph.
     * Returns the IDs of tasks that form a cycle, or null if no deadlock.
     */
    detectDeadlock(): string[] | null {
        const visited = new Set<string>()
        const inStack = new Set<string>()
        const path: string[] = []

        const dfs = (taskId: string): string[] | null => {
            if (inStack.has(taskId)) {
                // Found a cycle - extract it
                const cycleStart = path.indexOf(taskId)
                return path.slice(cycleStart)
            }
            if (visited.has(taskId)) return null

            visited.add(taskId)
            inStack.add(taskId)
            path.push(taskId)

            const task = this.tasks.get(taskId)
            if (task) {
                for (const depId of task.dependencies) {
                    const cycle = dfs(depId)
                    if (cycle) return cycle
                }
            }

            inStack.delete(taskId)
            path.pop()
            return null
        }

        for (const taskId of this.tasks.keys()) {
            const cycle = dfs(taskId)
            if (cycle) return cycle
        }

        return null
    }

    /**
     * Break a deadlock by skipping the lowest-priority task in the cycle.
     */
    breakDeadlock(): boolean {
        const cycle = this.detectDeadlock()
        if (!cycle || cycle.length === 0) return false

        // Find the lowest priority (highest number) task in the cycle
        let lowestPriority: Task | undefined
        for (const taskId of cycle) {
            const task = this.tasks.get(taskId)
            if (task && (!lowestPriority || task.priority > lowestPriority.priority)) {
                lowestPriority = task
            }
        }

        if (lowestPriority) {
            this.skip(lowestPriority.id, `Skipped to break deadlock in cycle: [${cycle.join(" -> ")}]`)
            return true
        }

        return false
    }

    /**
     * Get all tasks.
     */
    getAllTasks(): Task[] {
        return Array.from(this.tasks.values())
    }

    /**
     * Get tasks by status.
     */
    getTasksByStatus(status: TaskStatus): Task[] {
        return Array.from(this.tasks.values()).filter((t) => t.status === status)
    }

    /**
     * Load tasks from a snapshot (for resume).
     */
    loadFromSnapshot(tasks: Task[]): void {
        this.tasks.clear()
        this.locks.clear()
        for (const task of tasks) {
            this.tasks.set(task.id, task)
            if (task.status === "claimed" || task.status === "in_progress") {
                // Re-lock tasks that were in progress
                if (task.claimedBy) {
                    this.locks.set(task.id, {
                        taskId: task.id,
                        agentId: task.claimedBy,
                        acquiredAt: task.time.claimed ?? Date.now(),
                    })
                }
            }
        }
    }
}
