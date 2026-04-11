import { Tool } from "./tool"
import { Global } from "@/core/global"
import { Log } from "@/util/util/log"
import z from "zod"
import path from "path"
import fs from "fs/promises"
import { ulid } from "ulid"

// ─── Storage ────────────────────────────────────────────────────────────────

const MEMORY_FILE = () => path.join(Global.Path.home, ".atomcli", "memory.jsonl")
const MCP_CONFIG_FILE = () => path.join(Global.Path.home, ".atomcli", "mcp.json")

interface MemoryEntry {
  id: string
  kind: "fact"
  content: string
  tags: string[]
  source: string
  createdAt: string
  accessCount: number
  lastAccessAt?: string
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(MEMORY_FILE()), { recursive: true })
}

async function loadAll(): Promise<MemoryEntry[]> {
  try {
    const raw = await fs.readFile(MEMORY_FILE(), "utf-8")
    const entries: MemoryEntry[] = []
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        entries.push(JSON.parse(trimmed) as MemoryEntry)
      } catch {
        // Skip corrupt lines — JSONL fault tolerance
      }
    }
    return entries
  } catch {
    return []
  }
}

async function appendEntry(entry: MemoryEntry): Promise<void> {
  await ensureDir()
  await fs.appendFile(MEMORY_FILE(), JSON.stringify(entry) + "\n", "utf-8")
}

async function saveAll(entries: MemoryEntry[]): Promise<void> {
  await ensureDir()
  const lines = entries.map((e) => JSON.stringify(e)).join("\n")
  await fs.writeFile(MEMORY_FILE(), lines ? lines + "\n" : "", "utf-8")
}

// ─── Alias Normalization ────────────────────────────────────────────────────

/**
 * Kural tabanlı alias tablosu — Türkçe↔İngilizce sinonim normaliz asyonu.
 * Her giriş: pipe-separated anahtar listesi → normalize edilmiş tag dizisi
 * Embedding-free, deterministik, offline çalışır.
 */
const ALIAS_GROUPS: Array<{ keys: RegExp; tags: string[] }> = [
  // Kimlik / İnsan
  { keys: /username|kullanıcı\s*adı|kullanici\s*adi|user\s*name|\bkişi\b|\bisim\b|\badım\b|\badın\b/i, tags: ["user", "identity", "person"] },
  { keys: /password|şifre|sifre|parola|credentials?/i, tags: ["auth", "credential", "security"] },
  { keys: /email|e-?mail|eposta|e-?posta/i, tags: ["contact", "email"] },
  { keys: /telefon|phone|numara|number/i, tags: ["contact", "phone"] },

  // Ses / Medya
  { keys: /tts|text.to.speech|ses\s*sentez|speech\s*synth/i, tags: ["audio", "tts", "speech"] },
  { keys: /audio|ses|sound|mp3|wav/i, tags: ["audio", "media"] },
  { keys: /video|görüntü|goruntu/i, tags: ["video", "media"] },
  { keys: /image|resim|görsel|gorsel|foto/i, tags: ["image", "media"] },

  // Hata / Debug
  { keys: /error|hata|exception|bug|crash|fail/i, tags: ["error", "debug"] },
  { keys: /fix|düzelt|duzelt|çöz|coz|solution|çözüm|cozum|patch/i, tags: ["solution", "fix"] },
  { keys: /warning|uyarı|uyari|warn/i, tags: ["warning", "debug"] },

  // API / Servis
  { keys: /api|endpoint|route|rest|http|request|response/i, tags: ["api", "http"] },
  { keys: /auth|authentication|login|otp|token|jwt/i, tags: ["auth", "security"] },
  { keys: /webhook|callback|event/i, tags: ["api", "event"] },

  // Veritabanı / Storage
  { keys: /database|veritaban|db|sql|nosql|mongodb|postgres|sqlite/i, tags: ["db", "storage"] },
  { keys: /cache|önbellek|onbellek|redis/i, tags: ["cache", "performance"] },
  { keys: /file|dosya|path|directory|dizin/i, tags: ["file", "filesystem"] },

  // Dil / Framework
  { keys: /\btypescript\b|(?<![a-z0-9])ts(?![a-z0-9])/i, tags: ["typescript", "javascript"] },
  { keys: /\bjavascript\b|(?<![a-z0-9])js(?![a-z0-9])/i, tags: ["javascript"] },
  { keys: /python|py\b/i, tags: ["python"] },
  { keys: /react|nextjs|next\.js/i, tags: ["react", "frontend"] },
  { keys: /bun\b/i, tags: ["bun", "javascript"] },
  { keys: /node\.?js|nodejs/i, tags: ["nodejs", "javascript"] },
  { keys: /flutter|dart/i, tags: ["flutter", "mobile"] },

  // AI / Model
  { keys: /openai|gpt|chatgpt/i, tags: ["ai", "openai"] },
  { keys: /gemini|google\s*ai/i, tags: ["ai", "gemini"] },
  { keys: /claude|anthropic/i, tags: ["ai", "claude"] },
  { keys: /llm|model|embedding|vector/i, tags: ["ai", "ml"] },

  // Pattern / Mimari
  { keys: /pattern|kalıp|kalip|best\s*practice/i, tags: ["pattern", "architecture"] },
  { keys: /refactor|yeniden\s*yaz|düzenle|duzenle/i, tags: ["refactor", "architecture"] },
  { keys: /test|spec|unittest|integration/i, tags: ["test"] },
  { keys: /install|kur|yükle|yukle|setup|kurulum/i, tags: ["setup", "install"] },
  { keys: /config|configuration|ayar|settings/i, tags: ["config", "setup"] },
  { keys: /deploy|production|build|release/i, tags: ["deploy", "devops"] },

  // AtomCLI spesifik
  { keys: /atomcli|atom.cli/i, tags: ["atomcli", "tool"] },
  { keys: /mcp|tool\s*call|function\s*call/i, tags: ["mcp", "tool"] },
  { keys: /skill|agent|subagent/i, tags: ["agent", "tool"] },
]

/**
 * İçerikten otomatik tag üret.
 * content + kullanıcı tag'leri birleştirilerek normalize edilmiş tag seti döner.
 */
function extractTags(content: string, userTags: string[]): string[] {
  const auto = new Set<string>()

  for (const group of ALIAS_GROUPS) {
    if (group.keys.test(content)) {
      for (const tag of group.tags) auto.add(tag)
    }
  }

  // Kullanıcı tag'leri de normalize et
  for (const tag of userTags) {
    auto.add(tag.toLowerCase().trim())
    // On these too
    for (const group of ALIAS_GROUPS) {
      if (group.keys.test(tag)) {
        for (const t of group.tags) auto.add(t)
      }
    }
  }

  return [...auto]
}

/**
 * Query'yi token + alias genişletmesiyle arama tag'lerine çevir.
 * Dönen dizideki herhangi bir token eşleşmesi yeterli (OR semantiği).
 */
function expandQuery(query: string): string[] {
  const tokens = query.toLowerCase().split(/[\s,;]+/).filter(Boolean)
  const expanded = new Set<string>(tokens)

  for (const group of ALIAS_GROUPS) {
    if (group.keys.test(query)) {
      for (const tag of group.tags) expanded.add(tag)
      // Add original tokens from the group too via test on query
    }
  }

  return [...expanded]
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function score(entry: MemoryEntry, queryTokens: string[]): number {
  let s = 0
  const contentLower = entry.content.toLowerCase()
  const tagsLower = entry.tags.map((t) => t.toLowerCase())

  for (const token of queryTokens) {
    if (token.length < 2) continue

    // Exact tag match — highest signal
    if (tagsLower.includes(token)) {
      s += 4
      continue
    }

    // Partial tag match:
    //   t.includes(token): "typescript" tag contains "type" query → valid
    //   token.includes(t): "typescript" query contains "ts" tag → only if tag >= 4 chars
    //                      prevents "blockchain".includes("ai") false positive
    const partialMatch = tagsLower.some(
      (t) => t.includes(token) || (t.length >= 4 && token.includes(t)),
    )
    if (partialMatch) s += 2

    // Content match
    if (contentLower.includes(token)) s += 2

    // Prefix match in content (longer phrases)
    if (contentLower.split(/\s+/).some((w) => w.startsWith(token) && token.length >= 3)) s += 1
  }

  // Recency bonus — entries from last 30 days get slight boost
  const ageMs = Date.now() - new Date(entry.createdAt).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays < 30) s += 0.5
  if (ageDays < 7) s += 0.5

  // Access frequency bonus
  s += Math.min(entry.accessCount * 0.1, 1)

  return s
}

// ─── Migration ──────────────────────────────────────────────────────────────

async function runMigrationIfNeeded(log: ReturnType<typeof Log.create>): Promise<void> {
  const migrationFlagFile = path.join(Global.Path.home, ".atomcli", ".memory-migrated")

  // Already migrated
  try {
    await fs.access(migrationFlagFile)
    return
  } catch { /* not migrated yet */ }

  log.info("running memory migration from learn/* → memory.jsonl")
  const entries: MemoryEntry[] = []

  // 1. Migrate learn/memory.json
  try {
    const learnMemFile = path.join(Global.Path.home, ".atomcli", "learning", "memory.json")
    const raw = await fs.readFile(learnMemFile, "utf-8")
    const items = JSON.parse(raw) as any[]

    for (const item of items) {
      // Skip clearly corrupt entries (XML tags leaked into fields)
      if (item.solution?.includes("</solution>")) continue

      const content = [
        item.title,
        item.description !== item.title ? item.description : null,
        item.solution ? `Solution: ${item.solution}` : null,
        item.problem ? `Problem: ${item.problem}` : null,
        item.codeAfter ? `\`\`\`\n${item.codeAfter}\n\`\`\`` : null,
      ]
        .filter(Boolean)
        .join("\n\n")

      entries.push({
        id: item.id ?? ulid(),
        kind: "fact",
        content,
        tags: extractTags(content, item.tags ?? []),
        source: "migration:learn",
        createdAt: item.createdAt ?? new Date().toISOString(),
        accessCount: item.usageCount ?? 0,
        lastAccessAt: item.lastUsed,
      })
    }

    log.info("migrated learn/memory.json", { count: items.length, imported: entries.length })
  } catch (e) {
    log.warn("could not migrate learn/memory.json", { error: (e as Error).message })
  }

  // 2. Migrate learn/research.json
  try {
    const researchFile = path.join(Global.Path.home, ".atomcli", "learning", "research.json")
    const raw = await fs.readFile(researchFile, "utf-8")
    const researches = JSON.parse(raw) as any[]

    for (const r of researches) {
      if (!r.summary || r.summary.length < 20) continue

      const content = `Research: ${r.topic}\n\n${r.summary}`
      entries.push({
        id: r.id ?? ulid(),
        kind: "fact",
        content,
        tags: extractTags(content, [r.topic]),
        source: "migration:learn-research",
        createdAt: r.createdAt ?? new Date().toISOString(),
        accessCount: 0,
      })
    }

    log.info("migrated learn/research.json", { count: researches.length })
  } catch (e) {
    log.warn("could not migrate learn/research.json", { error: (e as Error).message })
  }

  // 3. Write migrated entries
  if (entries.length > 0) {
    await ensureDir()
    const existingLines = await loadAll()
    const existingIds = new Set(existingLines.map((e) => e.id))
    const newEntries = entries.filter((e) => !existingIds.has(e.id))
    await saveAll([...existingLines, ...newEntries])
    log.info("memory migration complete", { imported: newEntries.length })
  }

  // 4. Clean dead MCP entries from all known config files
  const mcpConfigCandidates = [
    MCP_CONFIG_FILE(), // ~/.atomcli/mcp.json (global)
  ]
  // Also search for project-level atomcli.json files in common locations
  try {
    const projectRoot = process.cwd()
    const projectAtomcli = path.join(projectRoot, ".atomcli", "atomcli.json")
    mcpConfigCandidates.push(projectAtomcli)
    // Walk up one level too
    const parentAtomcli = path.join(path.dirname(projectRoot), ".atomcli", "atomcli.json")
    mcpConfigCandidates.push(parentAtomcli)
  } catch { /* ignore */ }

  const deadKeys = ["memory", "memory-bank"]
  for (const mcpFile of mcpConfigCandidates) {
    try {
      const raw = await fs.readFile(mcpFile, "utf-8")
      const config = JSON.parse(raw)
      const mcpObj = config.mcp ?? config
      let changed = false
      for (const key of deadKeys) {
        if (key in mcpObj) {
          delete mcpObj[key]
          changed = true
        }
      }
      if (changed) {
        await fs.writeFile(mcpFile, JSON.stringify(config, null, 2) + "\n", "utf-8")
        log.info("cleaned dead MCP entries", { file: mcpFile })
      }
    } catch { /* file doesn't exist or not parseable — skip */ }
  }

  // 5. Write migration flag
  await fs.writeFile(migrationFlagFile, new Date().toISOString(), "utf-8")
}

// ─── Tool ────────────────────────────────────────────────────────────────────

export const MemoryTool = Tool.define("memory", {
  description:
    "Persistent memory across sessions. Save facts, preferences, solutions — recall them later with natural language search. Replaces brain (remember/recall) and learn (record_*/find_knowledge).",
  parameters: z.object({
    action: z
      .enum(["save", "search", "list"])
      .describe(
        "save: store a fact/note/solution. search: find stored memories by natural language query. list: show recent memories.",
      ),
    content: z
      .string()
      .optional()
      .describe("Required for save. The text to remember — free-form, any language."),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional extra tags for save. System auto-generates tags from content."),
    query: z.string().optional().describe("Required for search. Natural language query."),
    limit: z.number().int().min(1).max(50).default(5).describe("Max results to return (default 5)."),
    tag: z.string().optional().describe("Optional tag filter for list action."),
  }),

  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any> }> {
    const log = Log.create({ service: "tool.memory", sessionID: ctx.sessionID })

    // Run migration once on first use
    await runMigrationIfNeeded(log)

    // ── SAVE ──────────────────────────────────────────────────────────────
    if (params.action === "save") {
      if (!params.content?.trim()) {
        return { title: "Error", output: "content is required for save", metadata: { error: true } }
      }

      const tags = extractTags(params.content, params.tags ?? [])
      const entry: MemoryEntry = {
        id: ulid(),
        kind: "fact",
        content: params.content.trim(),
        tags,
        source: "agent",
        createdAt: new Date().toISOString(),
        accessCount: 0,
      }

      await appendEntry(entry)
      log.info("memory saved", { id: entry.id, tags })

      return {
        title: "Memory Saved",
        output: `Saved. Tags: ${tags.length > 0 ? tags.join(", ") : "(none)"}`,
        metadata: { id: entry.id, tags },
      }
    }

    // ── SEARCH ────────────────────────────────────────────────────────────
    if (params.action === "search") {
      if (!params.query?.trim()) {
        return { title: "Error", output: "query is required for search", metadata: { error: true } }
      }

      const entries = await loadAll()
      if (entries.length === 0) {
        return {
          title: "No Memories",
          output: "No memories stored yet. Use action='save' to add notes.",
          metadata: { count: 0 },
        }
      }

      const queryTokens = expandQuery(params.query)
      const scored = entries
        .map((e) => ({ entry: e, score: score(e, queryTokens) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, params.limit)

      if (scored.length === 0) {
        return {
          title: "No Matches",
          output: `No memories matched "${params.query}". Try different keywords or use action='list' to see all.`,
          metadata: { count: 0, query: params.query },
        }
      }

      // Update access counts
      const idToUpdate = new Set(scored.map((x) => x.entry.id))
      const now = new Date().toISOString()
      const allEntries = entries.map((e) => {
        if (idToUpdate.has(e.id)) {
          return { ...e, accessCount: e.accessCount + 1, lastAccessAt: now }
        }
        return e
      })
      await saveAll(allEntries)

      const output = scored
        .map(({ entry, score: s }) => {
          const preview = entry.content.length > 400 ? entry.content.slice(0, 400) + "…" : entry.content
          const tagStr = entry.tags.length > 0 ? `[${entry.tags.slice(0, 6).join(", ")}]` : ""
          return `[score:${s.toFixed(1)}] ${tagStr}\n${preview}`
        })
        .join("\n\n---\n\n")

      return {
        title: `Memory Search: "${params.query}"`,
        output,
        metadata: { count: scored.length, query: params.query },
      }
    }

    // ── LIST ──────────────────────────────────────────────────────────────
    if (params.action === "list") {
      const entries = await loadAll()
      if (entries.length === 0) {
        return {
          title: "No Memories",
          output: "No memories stored yet.",
          metadata: { count: 0 },
        }
      }

      let filtered = [...entries].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )

      if (params.tag) {
        const filterTag = params.tag.toLowerCase()
        filtered = filtered.filter((e) => e.tags.some((t) => t.toLowerCase().includes(filterTag)))
      }

      const limited = filtered.slice(0, params.limit)

      const output = [
        `Total memories: ${entries.length}${params.tag ? ` (filtered by tag: "${params.tag}")` : ""}`,
        "",
        ...limited.map((e, i) => {
          const date = new Date(e.createdAt).toLocaleDateString("tr-TR")
          const preview = e.content.length > 200 ? e.content.slice(0, 200) + "…" : e.content
          const tagStr = e.tags.slice(0, 5).join(", ")
          return `${i + 1}. [${date}] ${tagStr ? `[${tagStr}]` : ""}\n   ${preview}`
        }),
      ].join("\n")

      return {
        title: "Memory List",
        output,
        metadata: { count: entries.length, shown: limited.length },
      }
    }

    return {
      title: "Unknown Action",
      output: "Unknown action. Use: save, search, or list.",
      metadata: { error: true },
    }
  },
})

// ─── Prompt Integration Utilities ────────────────────────────────────────────
// Replace LearningIntegration.recall() and Learning.buildMemorySummary()
// previously from services/learning (now deleted).

/**
 * Recall relevant memories for a user query — injected into system prompt.
 * Returns an XML-wrapped string ready for prompt insertion, or "" if no matches.
 */
export async function recall(
  query: string,
  _context?: { technology?: string; sessionID?: string },
): Promise<string> {
  const entries = await loadAll()
  if (entries.length === 0) return ""

  const queryTokens = expandQuery(query)
  const scored = entries
    .map((e) => ({ entry: e, score: score(e, queryTokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  if (scored.length === 0) return ""

  let memory = `\n<memory>\nI found some relevant past experiences that might help:\n`
  for (const { entry } of scored) {
    const preview = entry.content.length > 300 ? entry.content.slice(0, 300) + "…" : entry.content
    memory += `- ${preview}\n`
  }
  memory += `</memory>\n`
  return memory
}

/**
 * Build a brief summary of stored memories — injected at session start.
 * Returns "" if no memories exist.
 */
export async function buildMemorySummary(): Promise<string> {
  const entries = await loadAll()
  if (entries.length === 0) return ""

  const recent = [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  const parts = [`## 📚 Memory (${entries.length} stored facts)`]
  for (const e of recent) {
    const preview = e.content.length > 120 ? e.content.slice(0, 120) + "…" : e.content
    parts.push(`- ${preview}`)
  }
  parts.push(`\n> 💡 Use memory search to retrieve full details.`)
  return parts.join("\n")
}
