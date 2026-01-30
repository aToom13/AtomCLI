import { Log } from "../util/log"
import { LearningMemory } from "./memory"
import { ulid } from "ulid"

export namespace LearningErrorAnalyzer {
  const log = Log.create({ service: "learning.error" })

  export interface ErrorContext {
    error: Error
    command?: string
    filePath?: string
    technology: string // "React", "Node.js", "Python" vb.
    codeBefore?: string
  }

  export interface ErrorAnalysis {
    errorType: string
    errorMessage: string
    rootCause: string
    solution: string
    prevention: string
    codeFix?: string
    confidence: number
  }

  // Hata analizi yap
  export async function analyze(errorContext: ErrorContext): Promise<ErrorAnalysis> {
    log.info("analyzing error", { 
      type: errorContext.error.name,
      tech: errorContext.technology 
    })

    const error = errorContext.error

    // 1. Önce öğrenilmiş çözümleri kontrol et
    const existingSolution = await LearningMemory.findErrorSolution(
      error.name,
      error.message,
      errorContext.technology
    )

    if (existingSolution) {
      log.info("found existing solution", { errorType: error.name })
      return {
        errorType: existingSolution.errorType,
        errorMessage: existingSolution.errorMessage,
        rootCause: existingSolution.rootCause,
        solution: existingSolution.solution,
        prevention: existingSolution.prevention,
        confidence: 0.9,
      }
    }

    // 2. Yeni hata analizi yap
    const analysis = await performAnalysis(errorContext)

    // 3. Öğrenilen olarak kaydet
    const errorLearning: LearningMemory.ErrorLearning = {
      errorType: analysis.errorType,
      errorMessage: analysis.errorMessage,
      stackTrace: error.stack,
      filePath: errorContext.filePath,
      rootCause: analysis.rootCause,
      solution: analysis.solution,
      prevention: analysis.prevention,
      technology: errorContext.technology,
      learnedAt: new Date().toISOString(),
      appliedCount: 0,
      successfulFixes: 0,
    }

    await LearningMemory.saveError(errorLearning)
    log.info("saved new error learning", { type: analysis.errorType })

    return analysis
  }

  // Hata analizi yap
  async function performAnalysis(errorContext: ErrorContext): Promise<ErrorAnalysis> {
    const error = errorContext.error
    const message = error.message

    // Pattern-based analiz
    const patterns: Array<{
      pattern: RegExp
      rootCause: string
      solution: string
      prevention: string
    }> = [
      {
        pattern: /cannot find module|module not found/i,
        rootCause: "Missing dependency or incorrect import path",
        solution: "Install the missing package or fix the import path",
        prevention: "Always check package.json and use correct relative paths",
      },
      {
        pattern: /is not defined|referenceerror/i,
        rootCause: "Variable or function used before declaration",
        solution: "Declare the variable/function before using it, or check scope",
        prevention: "Use 'use strict' and linters to catch undefined variables",
      },
      {
        pattern: /cannot read propert(?:y|ies) of (null|undefined)/i,
        rootCause: "Accessing property on null/undefined value",
        solution: "Add null checks or optional chaining (?.)",
        prevention: "Always validate data before accessing nested properties",
      },
      {
        pattern: /websocket|socket/i,
        rootCause: "WebSocket connection issue or SSR incompatibility",
        solution: "Check if window is defined before using WebSocket, or handle connection errors",
        prevention: "Use typeof window !== 'undefined' checks for browser APIs",
      },
      {
        pattern: /async|await|promise/i,
        rootCause: "Asynchronous code handling issue",
        solution: "Add proper await, handle promise rejections, or use try-catch",
        prevention: "Always await promises and wrap async code in try-catch",
      },
      {
        pattern: /type.*is not assignable|typescript/i,
        rootCause: "TypeScript type mismatch",
        solution: "Fix type annotation or use type assertion/casting",
        prevention: "Use strict TypeScript config and proper type definitions",
      },
    ]

    // Pattern eşleştir
    for (const p of patterns) {
      if (p.pattern.test(message)) {
        return {
          errorType: error.name,
          errorMessage: message,
          rootCause: p.rootCause,
          solution: p.solution,
          prevention: p.prevention,
          confidence: 0.8,
        }
      }
    }

    // Stack trace analizi
    if (error.stack && errorContext.filePath) {
      const lineMatch = error.stack.match(/:(\d+):(\d+)/)
      if (lineMatch) {
        const lineNumber = parseInt(lineMatch[1])
        
        // Dosyayı oku ve kontekst bul
        try {
          // ReadTool.execute çağrısı - tool context gerektirir
          // Şimdilik sadece logla, gerçek implementasyonda düzgün context ile çağrılacak
          log.debug("error context", { 
            file: errorContext.filePath, 
            line: lineNumber,
            message: "Would read file for context"
          })
        } catch {
          // Dosya okunamazsa atla
        }
      }
    }

    // Genel analiz (pattern eşleşmezse)
    return {
      errorType: error.name,
      errorMessage: message,
      rootCause: "Unknown - requires investigation",
      solution: "Check documentation and error message details",
      prevention: "Add better error handling and logging",
      confidence: 0.5,
    }
  }

  // Çözüm başarısını kaydet
  export async function reportSuccess(
    errorType: string,
    errorMessage: string,
    technology: string
  ): Promise<void> {
    const file = await LearningMemory.getAll()
    const error = file.errors.find(
      e => e.errorType === errorType && 
           e.errorMessage === errorMessage &&
           e.technology === technology
    )

    if (error) {
      error.successfulFixes++
      error.appliedCount++
      log.info("reported successful fix", { errorType, tech: technology })
    }
  }

  // Çözüm başarısızlığını kaydet
  export async function reportFailure(
    errorType: string,
    errorMessage: string,
    technology: string,
    alternativeSolution: string
  ): Promise<void> {
    // Yeni bir öğrenme kaydı olarak alternatif çözümü kaydet
    const learnedItem: LearningMemory.LearnedItem = {
      id: ulid(),
      type: "solution",
      title: `Alternative fix for ${errorType}`,
      description: `Alternative solution when standard fix doesn't work`,
      context: technology,
      problem: errorMessage,
      solution: alternativeSolution,
      tags: ["error-fix", "alternative", errorType.toLowerCase()],
      usageCount: 1,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      successRate: 1,
    }

    await LearningMemory.save(learnedItem)
    log.info("saved alternative solution", { errorType, tech: technology })
  }

  // Öğrenilen hataları listele
  export async function getLearnedErrors(
    technology?: string
  ): Promise<LearningMemory.ErrorLearning[]> {
    const { errors } = await LearningMemory.getAll()
    
    if (technology) {
      return errors.filter(e => e.technology === technology)
    }
    
    return errors
  }
}
