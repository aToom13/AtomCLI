import { Log } from "../util/log"
import { LearningMemory } from "./memory"
import { LearningResearch } from "./research"
import { LearningErrorAnalyzer } from "./error-analyzer"
import { LearningIntegration } from "./integration"
import { ulid } from "ulid"

export namespace Learning {
  const log = Log.create({ service: "learning" })

  // Re-export alt modüller
  export const Memory = LearningMemory
  export const Research = LearningResearch
  export const ErrorAnalyzer = LearningErrorAnalyzer
  export const Integration = LearningIntegration

  // Ana API: Bir şey öğren
  export async function learn(options: {
    type: "error" | "pattern" | "solution" | "research"
    title: string
    description: string
    context: string
    problem?: string
    solution: string
    codeBefore?: string
    codeAfter?: string
    source?: string
    tags?: string[]
  }): Promise<void> {
    log.info("learning new item", { type: options.type, title: options.title })

    const item: LearningMemory.LearnedItem = {
      id: ulid(),
      type: options.type,
      title: options.title,
      description: options.description,
      context: options.context,
      problem: options.problem,
      solution: options.solution,
      codeBefore: options.codeBefore,
      codeAfter: options.codeAfter,
      source: options.source || "experience",
      tags: options.tags || [],
      usageCount: 1,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      successRate: 1,
    }

    await LearningMemory.save(item)
  }

  // Bir konu hakkında bilgi ara (önce hafızada, sonra web'de)
  export async function findOrResearch(options: {
    query: string
    context?: string
    topic: string
    researchIfNotFound?: boolean
  }): Promise<{
    found: boolean
    source: "memory" | "research" | "none"
    content: string
    confidence: number
  }> {
    log.info("finding or researching", { query: options.query, topic: options.topic })

    // 1. Önce hafızada ara
    const memoryResults = await LearningMemory.search(
      options.query,
      options.context,
      3
    )

    if (memoryResults.length > 0) {
      const bestMatch = memoryResults[0]
      log.info("found in memory", { title: bestMatch.title })

      return {
        found: true,
        source: "memory",
        content: `${bestMatch.title}\n${bestMatch.description}\n\nSolution: ${bestMatch.solution}`,
        confidence: 0.85,
      }
    }

    // 2. Önceki araştırmaları kontrol et
    const previousResearch = await LearningResearch.checkPreviousResearch(options.topic)
    if (previousResearch) {
      log.info("found previous research", { topic: options.topic })
      return {
        found: true,
        source: "memory",
        content: previousResearch.summary,
        confidence: 0.75,
      }
    }

    // 3. Web'de araştır (eğer izin verilmişse)
    if (options.researchIfNotFound !== false) {
      log.info("researching on web", { query: options.query })

      const research = await LearningResearch.research({
        query: options.query,
        topic: options.topic,
        depth: "quick",
      })

      return {
        found: true,
        source: "research",
        content: research.summary,
        confidence: research.confidence,
      }
    }

    return {
      found: false,
      source: "none",
      content: "",
      confidence: 0,
    }
  }

  // Context oluştur (prompt'a eklenecek)
  export async function buildContext(
    task: string,
    technology?: string
  ): Promise<string> {
    const parts: string[] = []

    // 1. İlgili öğrenilmiş bilgileri bul
    const relevant = await LearningMemory.search(task, technology, 5)

    if (relevant.length > 0) {
      parts.push("## Previously Learned Knowledge:")
      for (const item of relevant) {
        parts.push(`\n### ${item.title}`)
        parts.push(item.description)
        if (item.solution) {
          parts.push(`**Solution:** ${item.solution}`)
        }
        if (item.codeAfter) {
          parts.push(`**Example:**\n\`\`\`\n${item.codeAfter}\n\`\`\``)
        }
      }
    }

    // 2. Teknolojiye özgü hataları bul
    if (technology) {
      const errors = await LearningErrorAnalyzer.getLearnedErrors(technology)
      const commonErrors = errors
        .sort((a, b) => b.appliedCount - a.appliedCount)
        .slice(0, 3)

      if (commonErrors.length > 0) {
        parts.push("\n## Common Errors to Avoid:")
        for (const error of commonErrors) {
          parts.push(`\n- **${error.errorType}**: ${error.rootCause}`)
          parts.push(`  Prevention: ${error.prevention}`)
        }
      }
    }

    return parts.join("\n")
  }

  // ⭐ YENİ: Session başında hafıza özetini getir
  export async function buildMemorySummary(): Promise<string> {
    const stats = await LearningMemory.getStats()
    const all = await LearningMemory.getAll()

    if (stats.totalLearned === 0) {
      return ""
    }

    const parts: string[] = []
    parts.push(`## 📚 My Learning Memory (${stats.totalLearned} items)`)

    // Son öğrenilenler (en fazla 5)
    const recentItems = all.items
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)

    if (recentItems.length > 0) {
      parts.push("\n### Recent Learnings:")
      for (const item of recentItems) {
        parts.push(`- **${item.title}** (${item.context})`)
      }
    }

    // En çok kullanılanlar (en fazla 3)
    const topItems = all.items
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 3)

    if (topItems.length > 0 && topItems[0].usageCount > 0) {
      parts.push("\n### Most Used:")
      for (const item of topItems) {
        if (item.usageCount > 0) {
          parts.push(`- **${item.title}**: used ${item.usageCount} times`)
        }
      }
    }

    // Teknoloji dağılımı
    if (stats.topTechnologies.length > 0) {
      parts.push(`\n### Knowledge Areas: ${stats.topTechnologies.join(", ")}`)
    }

    parts.push("\n> 💡 **Tip:** I automatically apply these learnings to relevant tasks.")

    return parts.join("\n")
  }

  // ⭐ YENİ: Hafızada belirli bir konu var mı kontrol et
  export async function hasKnowledgeAbout(
    keywords: string[]
  ): Promise<{ found: boolean; matches: Array<{ title: string; relevance: number }> }> {
    const all = await LearningMemory.getAll()
    const matches: Array<{ title: string; relevance: number }> = []

    for (const item of all.items) {
      let relevance = 0
      const searchText = `${item.title} ${item.description} ${item.tags.join(" ")}`.toLowerCase()

      for (const keyword of keywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          relevance += 1
        }
      }

      if (relevance > 0) {
        matches.push({ title: item.title, relevance })
      }
    }

    // Relevance'a göre sırala
    matches.sort((a, b) => b.relevance - a.relevance)

    return {
      found: matches.length > 0,
      matches: matches.slice(0, 5)
    }
  }

  // Öğrenme istatistikleri
  export async function getStats(): Promise<{
    totalLearned: number
    totalErrors: number
    totalResearches: number
    topTechnologies: string[]
    successRate: number
  }> {
    return LearningMemory.getStats()
  }

  // Tüm öğrenilenleri dışa aktar
  export async function exportAll(): Promise<string> {
    const all = await LearningMemory.getAll()
    return JSON.stringify(all, null, 2)
  }

  // Öğrenilenleri içe aktar
  export async function importAll(data: string): Promise<void> {
    const parsed = JSON.parse(data)

    if (parsed.items) {
      for (const item of parsed.items) {
        await LearningMemory.save(item)
      }
    }

    log.info("imported learning data", {
      items: parsed.items?.length || 0,
      errors: parsed.errors?.length || 0,
      researches: parsed.researches?.length || 0,
    })
  }
}
