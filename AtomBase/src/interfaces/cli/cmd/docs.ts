/**
 * Documentation Generator Command
 * 
 * Automatically generates documentation from source code.
 * Creates JSDoc/TSDoc comments, updates README, and generates API documentation.
 * 
 * Usage: atomcli docs --generate
 */

import { cmd } from "./cmd"
import { Log } from "@/util/util/log"
import { Glob } from "@/integrations/tool/glob"
import { Read } from "@/integrations/tool/read"
import { Write } from "@/integrations/tool/write"
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"
import { LLM } from "@/core/session/llm"
import { MessageV2 } from "@/core/session/message-v2"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import path from "path"
import fs from "fs/promises"

export namespace DocsGen {
  const log = Log.create({ service: "docs-gen" })

  export interface DocsOptions {
    generate?: boolean
    updateReadme?: boolean
    files?: string[]
    output?: string
  }

  export interface CodeElement {
    name: string
    type: "function" | "class" | "interface" | "type" | "variable" | "enum"
    exported: boolean
    location: { line: number; file: string }
    signature?: string
    parameters?: Array<{ name: string; type: string; optional?: boolean }>
    returnType?: string
    description?: string
    examples?: string[]
  }

  /**
   * Parse source file to extract code elements
   */
  export async function parseSourceFile(filePath: string): Promise<CodeElement[]> {
    const content = await fs.readFile(filePath, "utf-8")
    const elements: CodeElement[] = []
    const lines = content.split("\n")

    let currentComment: string[] = []
    let inComment = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      // Capture JSDoc comments
      if (trimmed.startsWith("/**")) {
        inComment = true
        currentComment = [trimmed]
        continue
      }

      if (inComment) {
        currentComment.push(trimmed)
        if (trimmed.endsWith("*/")) {
          inComment = false
        }
        continue
      }

      // Parse exported declarations
      const isExported = trimmed.startsWith("export")
      const cleanLine = trimmed.replace(/^export\s+(default\s+)?/, "")

      // Function: function name(params): ReturnType
      const funcMatch = cleanLine.match(/^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w+))?/)
      if (funcMatch && isExported) {
        elements.push({
          name: funcMatch[1],
          type: "function",
          exported: true,
          location: { line: i + 1, file: filePath },
          signature: funcMatch[0],
          parameters: parseParameters(funcMatch[2]),
          returnType: funcMatch[3],
          description: extractDescription(currentComment),
        })
      }

      // Arrow function: export const name = (params) =>
      const arrowMatch = cleanLine.match(/^const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/)
      if (arrowMatch && isExported) {
        elements.push({
          name: arrowMatch[1],
          type: "function",
          exported: true,
          location: { line: i + 1, file: filePath },
          signature: `${arrowMatch[1]}(${arrowMatch[2]})`,
          parameters: parseParameters(arrowMatch[2]),
          returnType: arrowMatch[3]?.trim(),
          description: extractDescription(currentComment),
        })
      }

      // Class: class Name
      const classMatch = cleanLine.match(/^class\s+(\w+)(?:\s+extends\s+(\w+))?/)
      if (classMatch && isExported) {
        elements.push({
          name: classMatch[1],
          type: "class",
          exported: true,
          location: { line: i + 1, file: filePath },
          signature: classMatch[0],
          description: extractDescription(currentComment),
        })
      }

      // Interface: interface Name
      const interfaceMatch = cleanLine.match(/^interface\s+(\w+)(?:\s+extends\s+([^{]+))?/)
      if (interfaceMatch && isExported) {
        elements.push({
          name: interfaceMatch[1],
          type: "interface",
          exported: true,
          location: { line: i + 1, file: filePath },
          signature: interfaceMatch[0],
          description: extractDescription(currentComment),
        })
      }

      // Type: type Name =
      const typeMatch = cleanLine.match(/^type\s+(\w+)\s*=/)
      if (typeMatch && isExported) {
        elements.push({
          name: typeMatch[1],
          type: "type",
          exported: true,
          location: { line: i + 1, file: filePath },
          description: extractDescription(currentComment),
        })
      }

      // Enum: enum Name
      const enumMatch = cleanLine.match(/^enum\s+(\w+)/)
      if (enumMatch && isExported) {
        elements.push({
          name: enumMatch[1],
          type: "enum",
          exported: true,
          location: { line: i + 1, file: filePath },
          description: extractDescription(currentComment),
        })
      }

      currentComment = []
    }

    return elements
  }

  function parseParameters(params: string): CodeElement["parameters"] {
    if (!params.trim()) return []

    return params.split(",").map(p => {
      const trimmed = p.trim()
      const optional = trimmed.includes("?")
      const parts = trimmed.replace(/\?/, "").split(/:\s*/)

      return {
        name: parts[0].trim(),
        type: parts[1]?.trim() || "any",
        optional,
      }
    }).filter(p => p.name)
  }

  function extractDescription(comment: string[]): string | undefined {
    if (comment.length === 0) return undefined

    const lines = comment
      .map(line => line.replace(/^\s*\/\*\*?\s*/, "").replace(/\s*\*\/$/, "").replace(/^\s*\*\s?/, ""))
      .filter(line => !line.startsWith("@"))
      .join(" ")
      .trim()

    return lines || undefined
  }

  /**
   * Generate JSDoc comment for an element
   */
  export async function generateJSDoc(element: CodeElement): Promise<string> {
    const agent = await Agent.get("general")
    if (!agent) throw new Error("General agent not found")

    const defaultModel = await Provider.defaultModel()
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)

    const prompt = `Generate a JSDoc comment for this ${element.type}:

Name: ${element.name}
Type: ${element.type}
Signature: ${element.signature || "N/A"}
Parameters: ${JSON.stringify(element.parameters || [])}
ReturnType: ${element.returnType || "void"}

Generate a concise JSDoc comment that includes:
1. Brief description of what it does
2. @param tags for each parameter
3. @returns tag describing return value
4. Any relevant @example if helpful

Return ONLY the JSDoc comment, no other text.`

    const userMessage: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: "docs-gen-session",
      role: "user",
      time: { created: Date.now() },
      agent: "general",
      model: {
        providerID: model.providerID,
        modelID: model.id,
      },
    }

    const abortController = new AbortController()
    const stream = await LLM.stream({
      agent,
      user: userMessage,
      sessionID: "docs-gen-session",
      model,
      system: ["You are a documentation expert. Generate clear, concise JSDoc comments."],
      abort: abortController.signal,
      messages: [{ role: "user", content: prompt }],
      tools: {},
    })

    return await stream.text
  }

  /**
   * Update source file with generated JSDoc
   */
  export async function updateFileWithJSDoc(
    filePath: string,
    elements: CodeElement[]
  ): Promise<void> {
    let content = await fs.readFile(filePath, "utf-8")
    const lines = content.split("\n")
    const updates: Array<{ line: number; jsdoc: string }> = []

    // Generate JSDoc for elements that don't have it
    for (const element of elements) {
      if (!element.description) {
        const jsdoc = await generateJSDoc(element)
        updates.push({ line: element.location.line - 1, jsdoc })
      }
    }

    // Apply updates in reverse order to maintain line numbers
    updates.sort((a, b) => b.line - a.line)

    for (const update of updates) {
      lines.splice(update.line, 0, ...update.jsdoc.split("\n"))
    }

    await fs.writeFile(filePath, lines.join("\n"), "utf-8")
    log.info("updated file with JSDoc", { file: filePath, updates: updates.length })
  }

  /**
   * Generate API documentation
   */
  export async function generateAPIDocs(
    elements: CodeElement[],
    outputPath: string
  ): Promise<void> {
    const grouped = groupByFile(elements)

    let markdown = `# API Documentation\n\nGenerated automatically by AtomCLI.\n\n`

    for (const [file, fileElements] of Object.entries(grouped)) {
      markdown += `## ${path.basename(file)}\n\n`

      for (const element of fileElements) {
        markdown += renderElementMarkdown(element)
      }
    }

    await fs.writeFile(outputPath, markdown, "utf-8")
    log.info("API documentation generated", { output: outputPath })
  }

  function groupByFile(elements: CodeElement[]): Record<string, CodeElement[]> {
    return elements.reduce((acc, el) => {
      const file = el.location.file
      if (!acc[file]) acc[file] = []
      acc[file].push(el)
      return acc
    }, {} as Record<string, CodeElement[]>)
  }

  function renderElementMarkdown(element: CodeElement): string {
    const params = element.parameters
      ?.map(p => `${p.name}${p.optional ? "?" : ""}: ${p.type}`)
      .join(", ") || ""

    let md = `### ${element.name}\n\n`
    md += `**Type:** ${element.type}  \n`

    if (element.description) {
      md += `\n${element.description}\n\n`
    }

    if (element.signature) {
      md += `\`\`\`typescript\n${element.signature}\n\`\`\`\n\n`
    }

    if (element.parameters && element.parameters.length > 0) {
      md += `**Parameters:**\n\n`
      for (const param of element.parameters) {
        md += `- \`${param.name}\`${param.optional ? " (optional)" : ""}: ${param.type}\n`
      }
      md += `\n`
    }

    if (element.returnType) {
      md += `**Returns:** ${element.returnType}\n\n`
    }

    return md
  }

  /**
   * Update README with project documentation
   */
  export async function updateReadme(
    projectInfo: {
      name: string
      description: string
      elements: CodeElement[]
    }
  ): Promise<void> {
    const readmePath = "README.md"
    let content: string

    try {
      content = await fs.readFile(readmePath, "utf-8")
    } catch {
      content = ""
    }

    // Generate README content using AI
    const agent = await Agent.get("general")
    if (!agent) throw new Error("General agent not found")

    const defaultModel = await Provider.defaultModel()
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)

    const exportedFunctions = projectInfo.elements
      .filter(e => e.exported)
      .map(e => `- ${e.name} (${e.type})`)
      .join("\n")

    const prompt = `Update this README for a project:

Project Name: ${projectInfo.name}
Description: ${projectInfo.description}

Exported API:
${exportedFunctions}

Current README:
${content || "(empty)"}

Generate a comprehensive README that includes:
1. Project title and description
2. Installation instructions
3. Usage examples
4. API overview
5. Contributing section

Return the complete README content.`

    const userMessage: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: "docs-gen-session",
      role: "user",
      time: { created: Date.now() },
      agent: "general",
      model: {
        providerID: model.providerID,
        modelID: model.id,
      },
    }

    const abortController = new AbortController()
    const stream = await LLM.stream({
      agent,
      user: userMessage,
      sessionID: "docs-gen-session",
      model,
      system: ["You are a technical writer. Generate clear, professional README documentation."],
      abort: abortController.signal,
      messages: [{ role: "user", content: prompt }],
      tools: {},
    })

    const newReadme = await stream.text
    await fs.writeFile(readmePath, newReadme, "utf-8")
    log.info("README updated", { path: readmePath })
  }
}

/**
 * CLI Command Definition
 */
export const DocsCommand = cmd({
  command: "docs",
  describe: "Generate documentation from source code",
  builder: (yargs) =>
    yargs
      .option("generate", {
        type: "boolean",
        alias: "g",
        describe: "Generate JSDoc comments for source files",
        default: false,
      })
      .option("readme", {
        type: "boolean",
        alias: "r",
        describe: "Update README.md with project documentation",
        default: false,
      })
      .option("api", {
        type: "boolean",
        alias: "a",
        describe: "Generate API documentation",
        default: false,
      })
      .option("files", {
        type: "string",
        alias: "f",
        describe: "Specific files to document (comma-separated)",
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Output directory for generated documentation",
        default: "./docs",
      }),
  handler: async (args) => {
    const log = Log.create({ service: "docs-cli" })

    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        try {
          // Find source files
          let files: string[] = []

          if (args.files) {
            files = args.files.split(",").map(f => f.trim())
          } else {
            // Find all TypeScript/JavaScript files
            const glob = new Bun.Glob("src/**/*.{ts,js}")
            for await (const file of glob.scan(".")) {
              if (!file.includes(".test.") && !file.includes(".spec.")) {
                files.push(file)
              }
            }
          }

          log.info("found files", { count: files.length })

          // Parse all source files
          const allElements: DocsGen.CodeElement[] = []

          for (const file of files) {
            try {
              const elements = await DocsGen.parseSourceFile(file)
              allElements.push(...elements)
            } catch (e) {
              log.warn("failed to parse file", { file, error: e })
            }
          }

          log.info("parsed elements", { count: allElements.length })

          // Generate JSDoc
          if (args.generate) {
            console.log(`Generating JSDoc for ${allElements.length} elements...`)

            for (const file of files) {
              const fileElements = allElements.filter(e => e.location.file === file)
              if (fileElements.length > 0) {
                await DocsGen.updateFileWithJSDoc(file, fileElements)
                console.log(`✅ Updated: ${file}`)
              }
            }
          }

          // Generate API docs
          if (args.api) {
            const outputPath = path.join(args.output, "API.md")
            await fs.mkdir(args.output, { recursive: true })
            await DocsGen.generateAPIDocs(allElements, outputPath)
            console.log(`✅ API documentation: ${outputPath}`)
          }

          // Update README
          if (args.readme) {
            const pkg = JSON.parse(await fs.readFile("package.json", "utf-8"))
            await DocsGen.updateReadme({
              name: pkg.name || "Project",
              description: pkg.description || "",
              elements: allElements,
            })
            console.log(`✅ README.md updated`)
          }

          console.log("\n✨ Documentation generation complete!")

        } catch (error) {
          log.error("documentation generation failed", { error })
          console.error("Error:", error instanceof Error ? error.message : error)
          process.exit(1)
        }
      }
    })
  },
})
