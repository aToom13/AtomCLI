// Chain state management for Agent mode

/**
 * Step status types for the agent chain
 */
export type StepStatus =
    | "pending" // ⏳ Bekliyor
    | "running" // 🔄 Çalışıyor (genel)
    | "coding" // 💻 Kod yazıyor
    | "searching_web" // 🌐 Web'de arıyor
    | "searching_code" // 🔍 Kod arıyor
    | "reading_file" // 📖 Dosya okuyor
    | "writing_file" // ✏️ Dosya yazıyor
    | "running_command" // ⚡ Komut çalıştırıyor
    | "analyzing" // 🧠 Analiz ediyor
    | "thinking" // 💭 Düşünüyor
    | "complete" // ✅ Tamamlandı
    | "failed" // ❌ Başarısız
    | "retrying" // 🔁 Tekrar deniyor

/**
 * Chain status types
 */
export type ChainStatus =
    | "planning" // 📋 Planlama yapılıyor
    | "executing" // ⚙️ Çalıştırılıyor
    | "verifying" // 🧪 Doğrulanıyor
    | "waiting_user" // 👤 Kullanıcı bekleniyor
    | "complete" // ✅ Tamamlandı
    | "failed" // ❌ Başarısız

/**
 * A sub-step within a parent step's sub-plan
 */
export interface SubStep {
    id: string
    name: string
    description: string
    status: StepStatus
}

/**
 * A single step in the agent chain
 */
export interface ChainStep {
    id: string
    name: string
    description: string
    status: StepStatus
    retryCount: number
    output?: string
    error?: string
    tool?: string // Hangi tool kullanılıyor (bash, read, write, etc.)
    todos?: StepTodo[] // Per-step todo list
    subSteps?: SubStep[] // Nested sub-plan steps
    subPlanActive?: boolean // Whether a sub-plan is currently running
    subPlanReason?: string // Why the sub-plan was created
}

/**
 * Per-step todo item
 */
export interface StepTodo {
    id: string
    content: string
    status: "pending" | "in_progress" | "complete" | "failed"
}

/**
 * The full agent chain state
 */
export interface AgentChain {
    steps: ChainStep[]
    currentStep: number
    status: ChainStatus
    mode: "safe" | "autonomous"
}

/**
 * Status icons for display
 */
export const StatusIcons: Record<StepStatus, string> = {
    pending: "⏳",
    running: "🔄",
    coding: "💻",
    searching_web: "🌐",
    searching_code: "🔍",
    reading_file: "📖",
    writing_file: "✏️",
    running_command: "⚡",
    analyzing: "🧠",
    thinking: "💭",
    complete: "✅",
    failed: "❌",
    retrying: "🔁",
}

export const ChainStatusIcons: Record<ChainStatus, string> = {
    planning: "📋",
    executing: "⚙️",
    verifying: "🧪",
    waiting_user: "👤",
    complete: "✅",
    failed: "❌",
}

export namespace Chain {
    /**
     * Create a new empty chain
     */
    export function create(mode: "safe" | "autonomous" = "safe"): AgentChain {
        return {
            steps: [],
            currentStep: 0,
            status: "planning",
            mode,
        }
    }

    /**
     * Add a step to the chain
     */
    export function addStep(
        chain: AgentChain,
        step: Omit<ChainStep, "id" | "status" | "retryCount">
    ): AgentChain {
        return {
            ...chain,
            steps: [
                ...chain.steps,
                {
                    ...step,
                    id: crypto.randomUUID(),
                    status: "pending",
                    retryCount: 0,
                },
            ],
        }
    }

    /**
     * Update the status of the current step
     */
    export function updateStepStatus(
        chain: AgentChain,
        status: StepStatus,
        tool?: string
    ): AgentChain {
        const steps = [...chain.steps]
        if (steps[chain.currentStep]) {
            steps[chain.currentStep] = {
                ...steps[chain.currentStep],
                status,
                tool: tool ?? steps[chain.currentStep].tool,
            }
        }
        return { ...chain, steps }
    }

    /**
     * Complete the current step and move to the next
     */
    export function completeStep(chain: AgentChain, output?: string): AgentChain {
        const steps = [...chain.steps]
        if (steps[chain.currentStep]) {
            steps[chain.currentStep] = {
                ...steps[chain.currentStep],
                status: "complete",
                output,
            }
        }

        const nextStep = chain.currentStep + 1
        const allComplete = nextStep >= steps.length

        return {
            ...chain,
            steps,
            currentStep: allComplete ? chain.currentStep : nextStep,
            status: allComplete ? "complete" : "executing",
        }
    }

    /**
     * Mark the current step as failed
     */
    export function failStep(chain: AgentChain, error: string): AgentChain {
        const steps = [...chain.steps]
        if (steps[chain.currentStep]) {
            steps[chain.currentStep] = {
                ...steps[chain.currentStep],
                status: "failed",
                error,
            }
        }
        return { ...chain, steps, status: "failed" }
    }

    /**
     * Retry the current step
     */
    export function retryStep(chain: AgentChain): AgentChain {
        const steps = [...chain.steps]
        if (steps[chain.currentStep]) {
            steps[chain.currentStep] = {
                ...steps[chain.currentStep],
                status: "retrying",
                retryCount: steps[chain.currentStep].retryCount + 1,
            }
        }
        return { ...chain, steps, status: "executing" }
    }

    /**
     * Check if we should ask user for help (after max retries)
     */
    export function shouldAskUser(chain: AgentChain, maxRetries: number = 3): boolean {
        const currentStep = chain.steps[chain.currentStep]
        return currentStep ? currentStep.retryCount >= maxRetries : false
    }

    /**
     * Set the chain to waiting for user
     */
    export function waitForUser(chain: AgentChain): AgentChain {
        return { ...chain, status: "waiting_user" }
    }

    /**
     * Start execution (move from planning to executing)
     */
    export function startExecution(chain: AgentChain): AgentChain {
        return { ...chain, status: "executing" }
    }

    /**
     * Format chain for display
     */
    export function format(chain: AgentChain): string {
        const lines: string[] = []
        lines.push(`${ChainStatusIcons[chain.status]} Task Chain (${chain.status})`)
        lines.push("")

        for (let i = 0; i < chain.steps.length; i++) {
            const step = chain.steps[i]
            const icon = StatusIcons[step.status]
            const current = i === chain.currentStep ? " ← current" : ""
            lines.push(`${i + 1}. ${icon} ${step.name}${current}`)
            if (step.description) {
                lines.push(`   ${step.description}`)
            }
        }

        return lines.join("\n")
    }
}
