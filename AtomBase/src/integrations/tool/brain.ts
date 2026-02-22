
import { Tool } from "./tool"
import { getEmbed } from "@/util/util/ai-compat"
// Note: ai package is imported dynamically to avoid Bun ESM resolution issues
import { createOpenAI } from "@ai-sdk/openai"
import { Config } from "@/core/config/config"
import { Global } from "@/core/global"
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { File } from "@/services/file"
import { Log } from "@/util/util/log"
import { bm25Search, type BM25Document } from "@/core/memory/core/bm25"

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

// Pre-computed magnitude cache: docId -> magnitude
const magnitudeCache = new Map<string, number>()

/** Compute the magnitude (L2 norm) of a vector */
function magnitude(vec: number[]): number {
    let sum = 0.0
    for (let i = 0; i < vec.length; i++) {
        sum += vec[i] * vec[i]
    }
    return Math.sqrt(sum)
}

/** Get or compute and cache the magnitude for a document */
function getCachedMagnitude(doc: Doc): number {
    let mag = magnitudeCache.get(doc.id)
    if (mag !== undefined) return mag
    mag = doc.embeddings ? magnitude(doc.embeddings) : 0
    magnitudeCache.set(doc.id, mag)
    return mag
}

/**
 * Optimized cosine similarity using pre-computed magnitudes.
 * Query magnitude is computed once by the caller and passed in.
 */
function cosineSimilarityOptimized(queryVec: number[], queryMag: number, doc: Doc): number {
    const docVec = doc.embeddings
    if (!queryVec || !docVec || queryVec.length !== docVec.length) return 0
    const docMag = getCachedMagnitude(doc)
    if (queryMag === 0 || docMag === 0) return 0

    let dotProduct = 0.0
    for (let i = 0; i < queryVec.length; i++) {
        dotProduct += queryVec[i] * docVec[i]
    }
    return dotProduct / (queryMag * docMag)
}

// Legacy fallback for standalone use
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

        // Initialize AI components only if API key is provided
        let openai: any = null
        let embed: any = null
        let embeddingModel: any = null

        if (apiKey) {
            openai = createOpenAI({ apiKey })
            // Dynamic import of ai package to avoid ESM resolution issues in tests
            embed = await getEmbed()
            embeddingModel = openai.embedding("text-embedding-3-small")
        }

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
                // File.search uses fuzzysort, not glob patterns. We fetch all and filter manually.
                const allFiles = await File.search({ query: "", limit: 5000, type: "file" })
                const allowedExts = [".ts", ".tsx", ".md", ".json", ".txt", ".js", ".jsx"]

                const files = allFiles.filter(f => allowedExts.includes(path.extname(f)))

                let count = 0
                for (const relativePath of files) {
                    try {
                        if (relativePath.includes("node_modules") || relativePath.includes("dist") || relativePath.includes(".git") || relativePath.includes("brain-index")) continue

                        // Resolve absolute path (File.search returns paths relative to project root / cwd)
                        const filePath = path.resolve(dir, relativePath)

                        const content = await fs.readFile(filePath, "utf-8").catch(() => null)
                        if (!content) continue
                        if (content.length > 20000) continue
                        if (content.trim().length < 50) continue

                        let embedding: number[] | undefined = undefined
                        if (apiKey && embed && embeddingModel) {
                            const result = await embed({
                                model: embeddingModel,
                                value: content,
                            })
                            embedding = result.embedding
                        }

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

                        // Pre-compute and cache magnitude if we have embeddings
                        if (embedding) {
                            magnitudeCache.set(doc.id, magnitude(embedding))
                        }

                        count++
                        if (count % 5 === 0) ctx.metadata({ title: `Brain: Indexed ${count} files...` })
                    } catch (e) {
                        const error = e instanceof Error ? e.message : String(e)
                        log.warn(`Failed to index file: ${relativePath}`, { error })
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
                let scored: Array<{ doc: Doc; score: number }> = []

                if (apiKey && embed && embeddingModel) {
                    const { embedding } = await embed({
                        model: embeddingModel,
                        value: params.query,
                    })

                    // Optimized search: compute query magnitude once, use cached doc magnitudes
                    const queryMag = magnitude(embedding)
                    scored = MEMORY.map(doc => ({
                        doc,
                        score: cosineSimilarityOptimized(embedding, queryMag, doc)
                    }))
                        .sort((a, b) => b.score - a.score)
                        .slice(0, params.limit)
                } else {
                    // Fallback to local BM25 search
                    const documents: BM25Document[] = MEMORY.map(doc => ({
                        id: doc.id,
                        text: `${doc.title} ${doc.content}`
                    }))

                    const bm25Results = bm25Search(params.query, documents, params.limit)

                    scored = bm25Results.map(result => ({
                        doc: MEMORY.find(d => d.id === result.id)!,
                        score: result.score
                    }))
                }

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
            magnitudeCache.clear()
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
