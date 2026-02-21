import { Log } from "@/util/util/log"
import { LearningMemory } from "./memory"
import { ulid } from "ulid"

export namespace LearningResearch {
  const log = Log.create({ service: "learning.research" })

  export interface ResearchOptions {
    query: string
    topic: string
    maxResults?: number
    depth?: "quick" | "deep"
  }

  export interface ResearchResult {
    summary: string
    keyPoints: string[]
    codeExamples: string[]
    sources: string[]
    confidence: number
  }

  // Bir konu hakkında araştırma yap
  export async function research(options: ResearchOptions): Promise<ResearchResult> {
    log.info("starting research", { query: options.query, topic: options.topic })

    const maxResults = options.maxResults || 5
    const depth = options.depth || "quick"

    // 1. Web araştırması yap
    const searchResults = await performWebSearch(options.query, maxResults)
    
    // 2. Derinlemesine analiz (eğer deep mode ise)
    let detailedContent: string[] = []
    if (depth === "deep") {
      detailedContent = await fetchDetailedContent(searchResults)
    }

    // 3. Özet oluştur
    const summary = createSummary(searchResults, detailedContent, options.topic)
    
    // 4. Kod örneklerini çıkar
    const searchResultStrings = searchResults.map(r => `${r.title}\n${r.snippet}`)
    const codeExamples = extractCodeExamples([...searchResultStrings, ...detailedContent])

    // 5. Araştırmayı kaydet
    const research: LearningMemory.ResearchLearning = {
      id: ulid(),
      query: options.query,
      topic: options.topic,
      findings: searchResults.map(r => ({
        source: r.url,
        content: r.snippet,
        relevance: r.relevance || 0.5,
      })),
      summary: summary.summary,
      appliedTo: [],
      createdAt: new Date().toISOString(),
    }
    await LearningMemory.saveResearch(research)

    log.info("research completed", { 
      query: options.query, 
      sources: searchResults.length,
      confidence: summary.confidence 
    })

    return {
      summary: summary.summary,
      keyPoints: summary.keyPoints,
      codeExamples,
      sources: searchResults.map(r => r.url),
      confidence: summary.confidence,
    }
  }

  // Web araması yap
  async function performWebSearch(
    query: string, 
    maxResults: number
  ): Promise<Array<{ url: string; title: string; snippet: string; relevance?: number }>> {
    // WebSearch tool'unu kullan
    // Not: Bu mock implementasyon, gerçek implementasyonda WebSearch tool çağrılacak
    
    const searchQuery = `${query} best practices tutorial example`
    
    try {
      // WebSearch tool simulation
      // Gerçek implementasyonda:
      // const results = await WebSearch.execute({ query: searchQuery, maxResults })
      
      log.debug("web search performed", { query: searchQuery })
      
      // Mock sonuçlar
      return [
        {
          url: `https://example.com/${query.replace(/\s+/g, "-")}`,
          title: `${query} - Best Practices`,
          snippet: `Learn how to properly implement ${query} with examples...`,
          relevance: 0.9,
        },
      ]
    } catch (error) {
      log.error("web search failed", { error: String(error) })
      return []
    }
  }

  // Detaylı içerik çek
  async function fetchDetailedContent(
    searchResults: Array<{ url: string }>
  ): Promise<string[]> {
    const contents: string[] = []
    
    for (const result of searchResults.slice(0, 3)) {
      try {
        // WebFetch tool simulation
        // Gerçek implementasyonda:
        // const content = await WebFetch.execute({ url: result.url })
        
        log.debug("fetched content", { url: result.url })
        contents.push(`Content from ${result.url}`)
      } catch (error) {
        log.warn("failed to fetch content", { url: result.url, error: String(error) })
      }
    }
    
    return contents
  }

  // Özet oluştur
  function createSummary(
    searchResults: Array<{ title: string; snippet: string }>,
    detailedContent: string[],
    topic: string
  ): { summary: string; keyPoints: string[]; confidence: number } {
    const keyPoints: string[] = []
    
    // Arama sonuçlarından anahtar noktaları çıkar
    for (const result of searchResults) {
      if (result.snippet.includes("best practice")) {
        keyPoints.push(`Best practice: ${result.snippet.slice(0, 100)}...`)
      }
      if (result.snippet.includes("example")) {
        keyPoints.push(`Example available in: ${result.title}`)
      }
    }

    // Güven skoru hesapla
    const confidence = Math.min(
      0.3 + (searchResults.length * 0.1) + (detailedContent.length * 0.1),
      0.95
    )

    const summary = `Research on "${topic}" found ${searchResults.length} relevant sources. ` +
      `Key findings include: ${keyPoints.slice(0, 3).join("; ")}`

    return { summary, keyPoints, confidence }
  }

  // Kod örneklerini çıkar
  function extractCodeExamples(contents: string[]): string[] {
    const examples: string[] = []
    const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g
    
    for (const content of contents) {
      let match
      while ((match = codeBlockRegex.exec(content)) !== null) {
        examples.push(match[1].trim())
      }
    }
    
    return examples.slice(0, 5) // En fazla 5 örnek
  }

  // Önceki araştırmaları kontrol et
  export async function checkPreviousResearch(
    topic: string,
    maxAgeDays: number = 30
  ): Promise<LearningMemory.ResearchLearning | null> {
    const { researches } = await LearningMemory.getAll()
    
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays)
    
    const relevant = researches.find(r => {
      const isRecent = new Date(r.createdAt) > cutoffDate
      const isRelevant = r.topic.toLowerCase().includes(topic.toLowerCase()) ||
                        topic.toLowerCase().includes(r.topic.toLowerCase())
      return isRecent && isRelevant
    })
    
    if (relevant) {
      log.info("found previous research", { topic, id: relevant.id })
    }
    
    return relevant || null
  }
}
