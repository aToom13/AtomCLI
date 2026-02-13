
import { Tool } from "./tool"
import { getEmbed } from "@/util/ai-compat"
// Note: ai package is imported dynamically to avoid Bun ESM resolution issues
import { createOpenAI } from "@ai-sdk/openai"
import { Config } from "../config/config"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { File } from "../file"
import { Log } from "../util/log"

// Interface for a stored document
interface Doc {
    id: string
    title: string
    url: string // File path
    content: string
    embeddings?: number[]
}

// Storage abstraction to allow future backend swaps
interface BrainStorage {
    load(): Promise<Doc[]>
    save(docs: Doc[]): Promise<void>
    clear(): Promise<void>
}

// Simple JSON file storage implementation
class JsonStorage implements BrainStorage {
    private filePath: string

    constructor() {
        this.filePath = path.join(Global.Path.home, ".atomcli", "brain-index.json")
    }

    async load(): Promise<Doc[]> {
        if (!await fs
            .access(this.filePath)
            .then(() => true)
            .catch(() => false)) {
            return []
        }
        try {
            const data = await fs.readFile(this.filePath, "utf-8")
            return JSON.parse(data) as Doc[]
        } catch (error) {
            Log.Default.error("Brain: Failed to load index", { error })
            return []
        }
    }

    async save(docs: Doc[]): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.filePath), { recursive: true })
            await fs.writeFile(this.filePath, JSON.stringify(docs), "utf-8")
        } catch (error) {
            Log.Default.error("Brain: Failed to save index", { error })
        }
    }

    async clear(): Promise<void> {
        try {
            await fs.unlink(this.filePath)
        } catch (error) {
            // Ignore if file doesn't exist
        }
    }
}

// In-memory cache
const MEMORY: Doc[] = []
const storage = new JsonStorage()
let isLoaded = false

// Cosine Similarity implementation
function cosineSimilarity(vecA: number[], vecB: number[]) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0
    let dotProduct = 0.0
    let normA = 0.0
    let normB = 0.0
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i]
        normA += vecA[i] * vecA[i]
        normB += vecB[i] * vecB[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Metadata type definition
type BrainMetadata = {
    count?: number
    total?: number
    error?: string
    query?: string
}

export const BrainTool = Tool.define("brain", {
    description: "Semantic search and memory. Indexes project files and allows conceptual searching.",
    parameters: z.object({
        action: z.enum(["index", "search", "clear", "remember", "recall"]).describe("Action to perform: index/search/clear for semantic search, remember/recall for persistent notes"),
        query: z.string().optional().describe("Search query (required for 'search')"),
        path: z.string().optional().describe("Path to index (required for 'index', defaults to cwd)"),
        content: z.string().optional().describe("Content to remember (required for 'remember')"),
        limit: z.number().default(5).describe("Number of results to return"),
    }),
    async execute(params, ctx) {
        const log = Log.create({ service: "tool.brain", sessionID: ctx.sessionID })
        const config = await Config.get()
        const apiKey = process.env.OPENAI_API_KEY || config.provider?.openai?.options?.apiKey

        // Handle remember/recall actions first — they don't need API key
        const memoryDir = path.join(Global.Path.home, ".atomcli", "brain")
        const memoryFile = path.join(memoryDir, "memory.md")

        if (params.action === "remember") {
            if (!params.content) throw new Error("Content required for remember")
            try {
                await fs.mkdir(memoryDir, { recursive: true })
                const timestamp = new Date().toISOString()
                const entry = `\n---\n**[${timestamp}]**\n${params.content}\n`
                await fs.appendFile(memoryFile, entry, "utf-8")
                return {
                    title: "Memory Saved",
                    output: `Remembered: ${params.content.slice(0, 100)}${params.content.length > 100 ? "..." : ""}`,
                    metadata: { count: 1 } as BrainMetadata
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error)
                return {
                    title: "Memory Error",
                    output: `Failed to save memory: ${msg}`,
                    metadata: { error: msg } as BrainMetadata
                }
            }
        }

        if (params.action === "recall") {
            try {
                const content = await fs.readFile(memoryFile, "utf-8").catch(() => "")
                if (!content.trim()) {
                    return {
                        title: "No Memories",
                        output: "No memories stored yet. Use action='remember' to save notes.",
                        metadata: { count: 0 } as BrainMetadata
                    }
                }
                return {
                    title: "Brain Memory",
                    output: content,
                    metadata: { count: content.split("---").length - 1 } as BrainMetadata
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error)
                return {
                    title: "Memory Error",
                    output: `Failed to recall memory: ${msg}`,
                    metadata: { error: msg } as BrainMetadata
                }
            }
        }

        // Check API Key (only needed for index/search/clear)
        if (!apiKey) {
            if (params.action === "search" || params.action === "index") {
                return {
                    title: "Brain Error",
                    output: "Error: OPENAI_API_KEY is missing. Configuring 'openai' provider in atomcli.json or env var is required for Semantic Search.",
                    metadata: { count: 0, total: 0, error: "Missing API Key" } as BrainMetadata
                }
            }
        }

        const openai = createOpenAI({ apiKey })

        // Dynamic import of ai package to avoid ESM resolution issues in tests
        const embed = await getEmbed()

        // Default embedding model
        const embeddingModel = openai.embedding("text-embedding-3-small")

        // Load persisted memory on first run
        if (!isLoaded) {
            const docs = await storage.load()
            MEMORY.push(...docs)
            isLoaded = true
        }

        if (params.action === "index") {
            const dir = params.path || process.cwd()
            log.info("Indexing started", { dir })
            ctx.metadata({ title: "Brain: Indexing..." })

            try {
                const files = await File.search({ query: "**/*.{ts,md,json,txt}", limit: 50, type: "file" })

                let count = 0
                for (const filePath of files) {
                    try {
                        if (filePath.includes("node_modules") || filePath.includes("dist") || filePath.includes(".git") || filePath.includes("brain-index")) continue

                        // Check if file is already indexed and unchanged (mock check for now, ideally check hash/mtime)
                        // For now we re-index to ensure freshness

                        const content = await fs.readFile(filePath, "utf-8")
                        if (content.length > 20000) continue
                        if (content.trim().length < 50) continue

                        const { embedding } = await embed({
                            model: embeddingModel,
                            value: content,
                        })

                        const doc: Doc = {
                            id: filePath,
                            title: path.basename(filePath),
                            url: filePath,
                            content: content,
                            embeddings: embedding,
                        }

                        // Update or Add
                        const existingIdx = MEMORY.findIndex(d => d.id === filePath)
                        if (existingIdx >= 0) {
                            MEMORY[existingIdx] = doc
                        } else {
                            MEMORY.push(doc)
                        }

                        count++
                        if (count % 5 === 0) ctx.metadata({ title: `Brain: Indexed ${count} files...` })
                    } catch (e) {
                        const error = e instanceof Error ? e.message : String(e)
                        log.warn(`Failed to index file: ${filePath}`, { error })
                    }
                }

                // Persist to JSON
                await storage.save(MEMORY)

                log.info("Indexing completed", { count, total: MEMORY.length })
                return {
                    title: "Brain Indexing Complete",
                    output: `Indexed ${count} files from ${dir}. Total Knowledge Base: ${MEMORY.length} documents.`,
                    metadata: {
                        count,
                        total: MEMORY.length
                    } as BrainMetadata
                }

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                log.error("Indexing failed", { error: errorMessage })
                return {
                    title: "Brain Indexing Failed",
                    output: `An error occurred during indexing: ${errorMessage}`,
                    metadata: { error: errorMessage } as BrainMetadata
                }
            }
        }

        if (params.action === "search") {
            if (!params.query) throw new Error("Query required for search")

            try {
                const { embedding } = await embed({
                    model: embeddingModel,
                    value: params.query,
                })

                // Linear search with Cosine Similarity
                const scored = MEMORY.map(doc => ({
                    doc,
                    score: cosineSimilarity(embedding, doc.embeddings || [])
                }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, params.limit)

                if (scored.length === 0) return {
                    title: "No Matches",
                    output: "No semantic matches found (Index might be empty? Try action='index').",
                    metadata: { count: 0 } as BrainMetadata
                }

                const output = scored.map((r: { doc: Doc; score: number }) => {
                    const doc = r.doc
                    return `[Score: ${r.score.toFixed(4)}] ${doc.url}\n${doc.content.slice(0, 300).replace(/\n/g, ' ')}...`
                }).join("\n\n")

                return {
                    title: `Brain Search Results: "${params.query}"`,
                    output,
                    metadata: {
                        query: params.query,
                        count: scored.length
                    } as BrainMetadata
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                log.error("Search failed", { error: errorMessage })
                return {
                    title: "Brain Search Failed",
                    output: `An error occurred during search: ${errorMessage}`,
                    metadata: { error: errorMessage } as BrainMetadata
                }
            }
        }

        if (params.action === "clear") {
            MEMORY.length = 0
            isLoaded = false
            try {
                await storage.clear()
            } catch (error) {
                log.error("Failed to clear storage", { error })
            }
            return {
                title: "Brain Cleared",
                output: "Brain memory cleared.",
                metadata: { count: 0 } as BrainMetadata
            }
        }

        return {
            title: "Unknown Action",
            output: "Unknown action provided to brain tool.",
            metadata: { count: 0, total: 0, error: "Unknown Action" } as BrainMetadata
        }
    }
})
