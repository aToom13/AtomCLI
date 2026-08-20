import z from "zod"

export namespace WorkflowBlackboard {
  export type Kind =
    | "fact"
    | "decision"
    | "constraint"
    | "open_question"
    | "edited_file"
    | "test_result"
    | "failure"
    | "summary"

  export interface Artifact {
    id: string
    taskID: string
    kind: Kind
    content: string
    createdAt: number
    key?: string
    evidence?: string[]
    confidence?: number
  }

  const MAX_ARTIFACTS = 500
  const MAX_CONTENT = 4_000

  const StructuredEntry = z.union([
    z.string(),
    z.object({
      key: z.string().min(1).optional(),
      value: z.string(),
      evidence: z.array(z.string()).optional(),
    }),
  ])
  const StructuredResult = z.object({
    summary: z.string().optional(),
    facts: z.array(StructuredEntry).optional(),
    decisions: z.array(StructuredEntry).optional(),
    constraints: z.array(z.string()).optional(),
    openQuestions: z.array(z.string()).optional(),
    editedFiles: z.array(z.string()).optional(),
    tests: z.array(z.string()).optional(),
    failures: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  type StructuredResult = z.infer<typeof StructuredResult>

  function structured(output: string): StructuredResult | undefined {
    const match =
      output.match(/<agent_result>\s*([\s\S]*?)\s*<\/agent_result>/i) ??
      output.match(/```agent-result\s*([\s\S]*?)```/i)
    if (!match) return
    try {
      const value = StructuredResult.safeParse(JSON.parse(match[1]))
      return value.success ? value.data : undefined
    } catch {
      return
    }
  }

  function item(taskID: string, kind: Kind, content: string, index: number, extra?: Partial<Artifact>): Artifact {
    return {
      id: `${taskID}:${index}`,
      taskID,
      kind,
      content: content.slice(0, MAX_CONTENT),
      createdAt: Date.now(),
      ...extra,
    }
  }

  export function fromOutput(taskID: string, output: string): Artifact[] {
    const parsed = structured(output)
    if (parsed) {
      const artifacts: Artifact[] = []
      const push = (kind: Kind, content: string, extra?: Partial<Artifact>) => {
        if (!content.trim() || artifacts.length >= MAX_ARTIFACTS) return
        artifacts.push(item(taskID, kind, content.trim(), artifacts.length, extra))
      }
      push("summary", parsed.summary ?? output.slice(0, MAX_CONTENT), { confidence: parsed.confidence })
      for (const entry of parsed.facts ?? []) {
        if (typeof entry === "string") push("fact", entry, { confidence: parsed.confidence })
        else
          push("fact", entry.value ?? "", { key: entry.key, evidence: entry.evidence, confidence: parsed.confidence })
      }
      for (const entry of parsed.decisions ?? []) {
        if (typeof entry === "string") push("decision", entry, { confidence: parsed.confidence })
        else
          push("decision", entry.value ?? "", {
            key: entry.key,
            evidence: entry.evidence,
            confidence: parsed.confidence,
          })
      }
      for (const value of parsed.constraints ?? []) push("constraint", value)
      for (const value of parsed.openQuestions ?? []) push("open_question", value)
      for (const value of parsed.editedFiles ?? []) push("edited_file", value)
      for (const value of parsed.tests ?? []) push("test_result", value)
      for (const value of parsed.failures ?? []) push("failure", value)
      return artifacts
    }

    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const picked: Array<{ kind: Kind; content: string }> = []
    for (const line of lines) {
      const lower = line.toLowerCase()
      const kind: Kind | undefined = /^(decision|karar)[:\s]/.test(lower)
        ? "decision"
        : /^(constraint|kısıt)[:\s]/.test(lower)
          ? "constraint"
          : /^(question|open question|soru)[:\s]/.test(lower)
            ? "open_question"
            : /^(test|tests|typecheck|lint)[:\s]/.test(lower)
              ? "test_result"
              : /^(error|failure|hata)[:\s]/.test(lower)
                ? "failure"
                : /^(file|edited|changed)[:\s]/.test(lower)
                  ? "edited_file"
                  : undefined
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
    return artifacts
      .map((item) => {
        const key = item.key ? ` key=${item.key}` : ""
        const confidence = item.confidence === undefined ? "" : ` confidence=${item.confidence.toFixed(2)}`
        const evidence = item.evidence?.length ? ` evidence=${item.evidence.join(" | ")}` : ""
        return `[${item.kind}${key}${confidence}] ${item.content}${evidence}`
      })
      .join("\n")
      .slice(0, maxChars)
  }

  export function conflicts(artifacts: Artifact[]) {
    const byKey = new Map<string, Artifact[]>()
    for (const artifact of artifacts) {
      if (!artifact.key || (artifact.kind !== "fact" && artifact.kind !== "decision")) continue
      const key = `${artifact.kind}:${artifact.key.toLowerCase()}`
      byKey.set(key, [...(byKey.get(key) ?? []), artifact])
    }
    return [...byKey.entries()].flatMap(([key, values]) => {
      const distinct = [...new Set(values.map((value) => value.content.trim().toLowerCase()))]
      return distinct.length > 1 ? [{ key, artifacts: values }] : []
    })
  }
}
