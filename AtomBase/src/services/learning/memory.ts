import path from "path"
import os from "os"
import fs from "fs/promises"
import { Log } from "@/util/util/log"
import { Instance } from "../project/instance"
import { z } from "zod"

export namespace LearningMemory {
  const log = Log.create({ service: "learning.memory" })

  // Öğrenilen bilgi yapısı
  export const LearnedItem = z.object({
    id: z.string(),
    type: z.enum(["error", "pattern", "solution", "research"]),
    title: z.string(),
    description: z.string(),
    context: z.string(), // Hangi teknoloji/framework
    problem: z.string().optional(), // Orijinal hata/problem
    solution: z.string(), // Çözüm
    codeBefore: z.string().optional(), // Hatalı kod
    codeAfter: z.string().optional(), // Düzeltilmiş kod
    source: z.string().optional(), // Kaynak (web, experience, docs)
    tags: z.array(z.string()).default([]),
    usageCount: z.number().default(0), // Kaç kez kullanıldı
    createdAt: z.string().datetime(),
    lastUsed: z.string().datetime().optional(),
    successRate: z.number().min(0).max(1).default(1), // Başarı oranı
  })
  export type LearnedItem = z.infer<typeof LearnedItem>

  // Hata öğrenme kaydı
  export const ErrorLearning = z.object({
    errorType: z.string(), // "TypeError", "ReferenceError" vb.
    errorMessage: z.string(),
    stackTrace: z.string().optional(),
    filePath: z.string().optional(),
    lineNumber: z.number().optional(),
    
    // Analiz
    rootCause: z.string(), // Neden oldu
    solution: z.string(), // Nasıl çözüldü
    prevention: z.string(), // Nasıl önlenir
    
    // Meta
    technology: z.string(), // "React", "Node.js", "Python" vb.
    learnedAt: z.string().datetime(),
    appliedCount: z.number().default(0),
    successfulFixes: z.number().default(0),
  })
  export type ErrorLearning = z.infer<typeof ErrorLearning>

  // Araştırma kaydı
  export const ResearchLearning = z.object({
    id: z.string(),
    query: z.string(), // Arama sorgusu
    topic: z.string(), // Konu
    findings: z.array(z.object({
      source: z.string(),
      content: z.string(),
      relevance: z.number(),
    })),
    summary: z.string(),
    appliedTo: z.array(z.string()).default([]), // Hangi görevlerde kullanıldı
    createdAt: z.string().datetime(),
  })
  export type ResearchLearning = z.infer<typeof ResearchLearning>

  // Memory dosya yolları
  function getMemoryDir(): string {
    return path.join(os.homedir(), ".atomcli", "learning")
  }

  function getMemoryFile(): string {
    return path.join(getMemoryDir(), "memory.json")
  }

  function getErrorsFile(): string {
    return path.join(getMemoryDir(), "errors.json")
  }

  function getResearchFile(): string {
    return path.join(getMemoryDir(), "research.json")
  }

  // Dizin oluştur
  async function ensureDir(): Promise<void> {
    const dir = getMemoryDir()
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      // Zaten varsa sorun değil
    }
  }

  // Öğrenilen bilgileri kaydet
  export async function save(item: LearnedItem): Promise<void> {
    await ensureDir()
    const file = getMemoryFile()
    
    let memory: LearnedItem[] = []
    try {
      const content = await fs.readFile(file, "utf-8")
      memory = JSON.parse(content)
    } catch {
      // Dosya yoksa boş başla
    }

    // Aynı bilgi var mı kontrol et
    const existingIndex = memory.findIndex(
      m => m.title === item.title && m.context === item.context
    )

    if (existingIndex >= 0) {
      // Güncelle
      memory[existingIndex] = {
        ...memory[existingIndex],
        ...item,
        usageCount: memory[existingIndex].usageCount + 1,
        lastUsed: new Date().toISOString(),
      }
    } else {
      // Yeni ekle
      memory.push(item)
    }

    await fs.writeFile(file, JSON.stringify(memory, null, 2))
    log.info("saved learning item", { id: item.id, type: item.type })
  }

  // Hata öğrenmesi kaydet
  export async function saveError(error: ErrorLearning): Promise<void> {
    await ensureDir()
    const file = getErrorsFile()
    
    let errors: ErrorLearning[] = []
    try {
      const content = await fs.readFile(file, "utf-8")
      errors = JSON.parse(content)
    } catch {
      // Dosya yoksa boş başla
    }

    // Benzer hata var mı kontrol et
    const existingIndex = errors.findIndex(
      e => e.errorMessage === error.errorMessage && e.technology === error.technology
    )

    if (existingIndex >= 0) {
      // Güncelle
      errors[existingIndex].appliedCount++
    } else {
      // Yeni ekle
      errors.push(error)
    }

    await fs.writeFile(file, JSON.stringify(errors, null, 2))
    log.info("saved error learning", { type: error.errorType, tech: error.technology })
  }

  // Araştırma kaydet
  export async function saveResearch(research: ResearchLearning): Promise<void> {
    await ensureDir()
    const file = getResearchFile()
    
    let researches: ResearchLearning[] = []
    try {
      const content = await fs.readFile(file, "utf-8")
      researches = JSON.parse(content)
    } catch {
      // Dosya yoksa boş başla
    }

    researches.push(research)
    await fs.writeFile(file, JSON.stringify(researches, null, 2))
    log.info("saved research", { query: research.query })
  }

  // Öğrenilen bilgileri ara
  export async function search(
    query: string,
    context?: string,
    limit: number = 5
  ): Promise<LearnedItem[]> {
    const file = getMemoryFile()
    
    try {
      const content = await fs.readFile(file, "utf-8")
      const memory: LearnedItem[] = JSON.parse(content)

      // Basit skorlama
      const scored = memory.map(item => {
        let score = 0
        
        // Başlık eşleşmesi
        if (item.title.toLowerCase().includes(query.toLowerCase())) score += 3
        
        // Açıklama eşleşmesi
        if (item.description.toLowerCase().includes(query.toLowerCase())) score += 2
        
        // Tag eşleşmesi
        if (item.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))) score += 2
        
        // Context eşleşmesi
        if (context && item.context.toLowerCase() === context.toLowerCase()) score += 2
        
        // Kullanım sayısı bonus
        score += Math.min(item.usageCount * 0.1, 1)
        
        // Başarı oranı bonus
        score += item.successRate * 2

        return { item, score }
      })

      // Sırala ve filtrele
      return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.item)
    } catch {
      return []
    }
  }

  // Hata çözümü ara
  export async function findErrorSolution(
    errorType: string,
    errorMessage: string,
    technology?: string
  ): Promise<ErrorLearning | null> {
    const file = getErrorsFile()
    
    try {
      const content = await fs.readFile(file, "utf-8")
      const errors: ErrorLearning[] = JSON.parse(content)

      // En iyi eşleşmeyi bul
      const match = errors.find(e => {
        const typeMatch = e.errorType === errorType
        const messageMatch = e.errorMessage.includes(errorMessage) || 
                            errorMessage.includes(e.errorMessage)
        const techMatch = !technology || e.technology === technology
        
        return typeMatch && messageMatch && techMatch
      })

      if (match) {
        // Kullanım sayısını artır
        match.appliedCount++
        await fs.writeFile(file, JSON.stringify(errors, null, 2))
      }

      return match || null
    } catch {
      return null
    }
  }

  // Tüm öğrenilenleri getir
  export async function getAll(): Promise<{
    items: LearnedItem[]
    errors: ErrorLearning[]
    researches: ResearchLearning[]
  }> {
    const result = {
      items: [] as LearnedItem[],
      errors: [] as ErrorLearning[],
      researches: [] as ResearchLearning[],
    }

    try {
      const memoryContent = await fs.readFile(getMemoryFile(), "utf-8")
      result.items = JSON.parse(memoryContent)
    } catch { /* ignore */ }

    try {
      const errorsContent = await fs.readFile(getErrorsFile(), "utf-8")
      result.errors = JSON.parse(errorsContent)
    } catch { /* ignore */ }

    try {
      const researchContent = await fs.readFile(getResearchFile(), "utf-8")
      result.researches = JSON.parse(researchContent)
    } catch { /* ignore */ }

    return result
  }

  // İstatistikler
  export async function getStats(): Promise<{
    totalLearned: number
    totalErrors: number
    totalResearches: number
    topTechnologies: string[]
    successRate: number
  }> {
    const { items, errors, researches } = await getAll()

    const techCount: Record<string, number> = {}
    items.forEach(item => {
      techCount[item.context] = (techCount[item.context] || 0) + 1
    })
    errors.forEach(error => {
      techCount[error.technology] = (techCount[error.technology] || 0) + 1
    })

    const topTechnologies = Object.entries(techCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tech]) => tech)

    const totalSuccesses = errors.reduce((sum, e) => sum + e.successfulFixes, 0)
    const totalAttempts = errors.reduce((sum, e) => sum + e.appliedCount, 0)

    return {
      totalLearned: items.length,
      totalErrors: errors.length,
      totalResearches: researches.length,
      topTechnologies,
      successRate: totalAttempts > 0 ? totalSuccesses / totalAttempts : 1,
    }
  }
}
