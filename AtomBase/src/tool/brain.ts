
import { Tool } from "./tool"
import { embed, type EmbeddingModel } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { Config } from "../config/config"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { File } from "../file"

// Interface for a stored document
interface Doc {
    id: string
    title: string
    url: string // File path
    content: string
    embeddings?: number[]
}

// Simple in-memory storage 
const MEMORY: Doc[] = []

// Cosine Similarity implementation
function cosineSimilarity(vecA: number[], vecB: number[]) {
    let dotProduct = 0.0
    let normA = 0.0
    let normB = 0.0
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i]
        normA += vecA[i] * vecA[i]
        normB += vecB[i] * vecB[i]
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export const BrainTool = Tool.define("brain", {
    description: "Semantic search and memory. Indexes project files and allows conceptual searching.",
    parameters: z.object({
        action: z.enum(["index", "search", "clear"]).describe("Action to perform"),
        query: z.string().optional().describe("Search query (required for 'search')"),
        path: z.string().optional().describe("Path to index (required for 'index', defaults to cwd)"),
        limit: z.number().default(5).describe("Number of results to return"),
    }),
    async execute(params, ctx) {
        const config = await Config.get()
        const apiKey = process.env.OPENAI_API_KEY || config.provider?.openai?.options?.apiKey

        // Check API Key
        if (!apiKey) {
            if (params.action === "search" || params.action === "index") {
                return {
                    title: "Brain Error",
                    output: "Error: OPENAI_API_KEY is missing. Configuring 'openai' provider in atomcli.json or env var is required for Semantic Search.",
                    metadata: {}
                }
            }
        }

        const openai = createOpenAI({ apiKey })

        // Default embedding model
        const embeddingModel: EmbeddingModel<string> = openai.embedding("text-embedding-3-small")

        const indexFile = path.join(Global.Path.home, ".atomcli", "brain-index.json")

        // Load persisted memory on first run
        if (MEMORY.length === 0) {
            try {
                if (await fs.exists(indexFile)) {
                    const data = await fs.readFile(indexFile, "utf-8")
                    const docs = JSON.parse(data) as Doc[]
                    MEMORY.push(...docs)
                }
            } catch { }
        }

        if (params.action === "index") {
            const dir = params.path || process.cwd()
            ctx.metadata({ title: "Brain: Indexing..." })

            const files = await File.search({ query: "**/*.{ts,md,json,txt}", limit: 50, type: "file" })

            let count = 0
            for (const filePath of files) {
                try {
                    if (filePath.includes("node_modules") || filePath.includes("dist") || filePath.includes(".git") || filePath.includes("brain-index")) continue

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
                    // ignore
                }
            }

            // Persist to JSON
            try {
                await fs.writeFile(indexFile, JSON.stringify(MEMORY), "utf-8")
            } catch (e) { }

            return {
                title: "Brain Indexing Complete",
                output: `Indexed ${count} files from ${dir}. Total Knowledge Base: ${MEMORY.length} documents.`,
                metadata: {
                    count,
                    total: MEMORY.length
                }
            }
        }

        if (params.action === "search") {
            if (!params.query) throw new Error("Query required for search")

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
                metadata: { count: 0 }
            }

            const output = scored.map((r: any) => {
                const doc = r.item || r.doc as Doc
                return `[Score: ${r.score.toFixed(4)}] ${doc.url}\n${doc.content.slice(0, 300).replace(/\n/g, ' ')}...`
            }).join("\n\n")

            return {
                title: `Brain Search Results: "${params.query}"`,
                output,
                metadata: {
                    query: params.query,
                    count: scored.length
                }
            }
        }

        if (params.action === "clear") {
            MEMORY.length = 0
            try { await fs.unlink(indexFile) } catch { }
            return {
                title: "Brain Cleared",
                output: "Brain memory cleared.",
                metadata: { count: 0 }
            }
        }

        return {
            title: "Unknown Action",
            output: "Unknown action provided to brain tool.",
            metadata: {}
        }
    }
})
