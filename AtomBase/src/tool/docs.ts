/**
 * Docs Tool - AI Aracı
 * 
 * Otomatik dokümantasyon üretir
 * CLI'deki docs komutunun AI entegrasyonu
 */

import { Tool } from "./tool"
import { z } from "zod"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { DocsGen } from "@/cli/cmd/docs"

export const DocsTool = Tool.define("docs", {
  description: "Generate documentation from source code (JSDoc, README, API docs)",
  parameters: z.object({
    generate: z.boolean().default(true).describe("Generate JSDoc comments for source files"),
    readme: z.boolean().default(false).describe("Update README.md with project documentation"),
    api: z.boolean().default(false).describe("Generate API documentation"),
    files: z.string().array().optional().describe("Specific files to document (default: all source files)"),
    output: z.string().default("./docs").describe("Output directory for generated documentation"),
  }),
  async execute(input, ctx) {
    const log = Log.create({ service: "docs-tool" })
    
    try {
      return await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          // Find files to process
          let files: string[] = input.files || []
          
          if (files.length === 0) {
            const glob = new Bun.Glob("src/**/*.{ts,js}")
            for await (const file of glob.scan(".")) {
              if (!file.includes(".test.") && !file.includes(".spec.")) {
                files.push(file)
              }
            }
          }

          if (files.length === 0) {
            return {
              title: "No Files Found",
              output: "No source files found to document",
              metadata: { success: false, files_processed: 0 },
            }
          }

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

          let resultMessage = `Parsed ${allElements.length} code elements from ${files.length} files. `

          // Generate JSDoc
          if (input.generate) {
            let updatedCount = 0
            for (const file of files) {
              const fileElements = allElements.filter(e => e.location.file === file)
              if (fileElements.length > 0) {
                await DocsGen.updateFileWithJSDoc(file, fileElements)
                updatedCount++
              }
            }
            resultMessage += `Updated ${updatedCount} files with JSDoc. `
          }

          // Generate API docs
          let apiPath = ""
          if (input.api) {
            const outputPath = `${input.output}/API.md`
            await Bun.write(outputPath, "")
            await DocsGen.generateAPIDocs(allElements, outputPath)
            apiPath = outputPath
            resultMessage += `API docs: ${outputPath}. `
          }

          // Update README
          if (input.readme) {
            const pkg = JSON.parse(await Bun.file("package.json").text())
            await DocsGen.updateReadme({
              name: pkg.name || "Project",
              description: pkg.description || "",
              elements: allElements,
            })
            resultMessage += "README.md updated. "
          }

          return {
            title: "Documentation Generated",
            output: resultMessage.trim(),
            metadata: { success: true, files_processed: files.length, output_path: apiPath || undefined },
          }
        }
      })
    } catch (error) {
      log.error("documentation generation failed", { error })
      return {
        title: "Documentation Error",
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { success: false, files_processed: 0 },
      }
    }
  },
})
