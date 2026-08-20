export namespace WorkflowBlackboard {
  export type Kind = "fact" | "decision" | "constraint" | "open_question" | "edited_file" | "test_result" | "failure" | "summary"

  export interface Artifact {
    id: string
    taskID: string
    kind: Kind
    content: string
    createdAt: number
  }

  const MAX_ARTIFACTS = 500
  const MAX_CONTENT = 4_000

  export function fromOutput(taskID: string, output: string): Artifact[] {
    const lines = output.split("\n").map((line) => line.trim()).filter(Boolean)
    const picked: Array<{ kind: Kind; content: string }> = []
    for (const line of lines) {
      const lower = line.toLowerCase()
      const kind: Kind | undefined =
        /^(decision|karar)[:\s]/.test(lower) ? "decision" :
        /^(constraint|kısıt)[:\s]/.test(lower) ? "constraint" :
        /^(question|open question|soru)[:\s]/.test(lower) ? "open_question" :
        /^(test|tests|typecheck|lint)[:\s]/.test(lower) ? "test_result" :
        /^(error|failure|hata)[:\s]/.test(lower) ? "failure" :
        /^(file|edited|changed)[:\s]/.test(lower) ? "edited_file" : undefined
      if (kind) picked.push({ kind, content: line })
      if (picked.length >= 24) break
    }
    picked.unshift({ kind: "summary", content: output.slice(0, MAX_CONTENT) })
    return picked.slice(0, MAX_ARTIFACTS).map((item, index) => ({
      id: `${taskID}:${index}`,
      taskID,
      kind: item.kind,
      content: item.content.slice(0, MAX_CONTENT),
      createdAt: Date.now(),
    }))
  }

  export function render(artifacts: Artifact[], maxChars = 32_000) {
    return artifacts.map((item) => `[${item.kind}] ${item.content}`).join("\n").slice(0, maxChars)
  }
}
