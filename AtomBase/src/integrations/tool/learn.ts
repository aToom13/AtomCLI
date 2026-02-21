import { Tool } from "./tool"
import { z } from "zod"
import { Learning } from "@/services/learning"

// Preprocess to handle JSON string serialization from LLM tool calls
const parseJsonIfString = <T extends z.ZodTypeAny>(schema: T) => {
  return z.preprocess((val) => {
    if (typeof val === "string") {
      try {
        return JSON.parse(val)
      } catch {
        return val
      }
    }
    return val
  }, schema)
}

// Self-learning tool - Agent'in öğrenmesini sağlar
export const LearnTool = Tool.define("learn", {
  description: "Learn from experience, errors, or research. Stores knowledge for future use.",
  parameters: z.object({
    action: z
      .enum([
        "record_error", // Hatadan öğren
        "record_pattern", // Pattern öğren
        "record_solution", // Çözüm öğren
        "research", // Araştırma yap
        "find_knowledge", // Bilgi ara
        "get_stats", // İstatistikler
      ])
      .describe("What learning action to perform"),

    // record_error, record_pattern, record_solution için
    title: z.string().optional().describe("Short title for what was learned"),
    description: z.string().optional().describe("Detailed description"),
    context: z.string().optional().describe("Technology/framework context (e.g., 'React', 'Node.js')"),
    problem: z.string().optional().describe("The problem or error that occurred"),
    solution: z.string().optional().describe("The solution or fix"),
    codeBefore: z.string().optional().describe("Code before the fix"),
    codeAfter: z.string().optional().describe("Code after the fix"),
    tags: parseJsonIfString(z.array(z.string())).optional().describe("Tags for categorization"),

    // research ve find_knowledge için
    query: z.string().optional().describe("Search query or topic to research"),
    topic: z.string().optional().describe("Topic category"),

    // Hata detayları için
    errorType: z.string().optional().describe("Error type (e.g., 'TypeError')"),
    errorMessage: z.string().optional().describe("Error message"),
    filePath: z.string().optional().describe("File where error occurred"),
  }),

  async execute(params, _ctx): Promise<any> {
    switch (params.action) {
      case "record_error":
        return recordError(params)

      case "record_pattern":
        return recordPattern(params)

      case "record_solution":
        return recordSolution(params)

      case "research":
        return doResearch(params)

      case "find_knowledge":
        return findKnowledge(params)

      case "get_stats":
        return getStats()

      default:
        return {
          title: "Error",
          output: "Unknown action",
          metadata: { error: true },
        }
    }
  },
})

async function recordError(params: any) {
  if (!params.errorType || !params.errorMessage) {
    return {
      title: "Error",
      output: "errorType and errorMessage are required for record_error",
      metadata: { error: true },
    }
  }

  // Öğrenme kaydı olarak ekle
  await Learning.learn({
    type: "error",
    title: params.title || `${params.errorType}: ${params.errorMessage.slice(0, 50)}`,
    description: params.description || params.errorMessage,
    context: params.context || "unknown",
    problem: params.errorMessage,
    solution: params.solution || "Solution recorded",
    codeBefore: params.codeBefore,
    codeAfter: params.codeAfter,
    tags: [...(params.tags || []), "error", params.errorType.toLowerCase()],
  })

  return {
    title: "Learned from Error",
    output: `Learned from error: ${params.errorType}. Will remember this for future tasks.\n\nRoot Cause: ${params.description || params.errorMessage}\nSolution: ${params.solution || "Recorded"}`,
    metadata: {
      errorType: params.errorType,
      recorded: true,
    },
  }
}

async function recordPattern(params: any) {
  if (!params.title || !params.solution) {
    return {
      title: "Error",
      output: "title and solution are required for record_pattern",
      metadata: { error: true },
    }
  }

  await Learning.learn({
    type: "pattern",
    title: params.title,
    description: params.description || params.title,
    context: params.context || "general",
    solution: params.solution,
    codeBefore: params.codeBefore,
    codeAfter: params.codeAfter,
    tags: params.tags || ["pattern"],
  })

  return {
    title: "Pattern Recorded",
    output: `Learned pattern: ${params.title}\n\n${params.solution}`,
    metadata: { recorded: true },
  }
}

async function recordSolution(params: any) {
  if (!params.title || !params.solution) {
    return {
      title: "Error",
      output: "title and solution are required for record_solution",
      metadata: { error: true },
    }
  }

  await Learning.learn({
    type: "solution",
    title: params.title,
    description: params.description || params.title,
    context: params.context || "general",
    problem: params.problem,
    solution: params.solution,
    codeBefore: params.codeBefore,
    codeAfter: params.codeAfter,
    tags: params.tags || ["solution"],
  })

  return {
    title: "Solution Recorded",
    output: `Learned solution: ${params.title}\n\nProblem: ${params.problem || "N/A"}\nSolution: ${params.solution}`,
    metadata: { recorded: true },
  }
}

async function doResearch(params: any) {
  if (!params.query || !params.topic) {
    return {
      title: "Error",
      output: "query and topic are required for research",
      metadata: { error: true },
    }
  }

  const result = await Learning.Research.research({
    query: params.query,
    topic: params.topic,
    depth: "quick",
  })

  return {
    title: "Research Complete",
    output: `Researched "${params.topic}". Found ${result.sources.length} sources.\n\nSummary:\n${result.summary}\n\nKey Points:\n${result.keyPoints.join("\n")}`,
    metadata: {
      sources: result.sources,
      confidence: result.confidence,
    },
  }
}

async function findKnowledge(params: any) {
  if (!params.query) {
    return {
      title: "Error",
      output: "query is required for find_knowledge",
      metadata: { error: true },
    }
  }

  const result = await Learning.findOrResearch({
    query: params.query,
    context: params.context,
    topic: params.topic || params.query,
    researchIfNotFound: true,
  })

  if (result.found) {
    return {
      title: "Knowledge Found",
      output: `Found knowledge from ${result.source}:\n\n${result.content}`,
      metadata: {
        source: result.source,
        confidence: result.confidence,
      },
    }
  }

  return {
    title: "No Knowledge Found",
    output: "No knowledge found for this query.",
    metadata: { found: false },
  }
}

async function getStats() {
  const stats = await Learning.getStats()

  return {
    title: "Learning Statistics",
    output: `Learning stats:
- Total Learned: ${stats.totalLearned} items
- Total Errors: ${stats.totalErrors}
- Total Researches: ${stats.totalResearches}
- Success Rate: ${(stats.successRate * 100).toFixed(1)}%
- Top Technologies: ${stats.topTechnologies.join(", ") || "None yet"}`,
    metadata: {
      totalLearned: stats.totalLearned,
      totalErrors: stats.totalErrors,
      totalResearches: stats.totalResearches,
      successRate: stats.successRate,
    },
  }
}
