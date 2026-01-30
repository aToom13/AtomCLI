/**
 * TestGen Tool - AI Aracı
 * 
 * Kullanıcıdan dosya alır ve otomatik test üretir
 * CLI'deki test-gen komutunun AI entegrasyonu
 */

import { Tool } from "./tool"
import { z } from "zod"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { TestGen } from "@/cli/cmd/test-gen"

export const TestGenTool = Tool.define("test_gen", {
  description: "Generate unit tests for a source file automatically",
  parameters: z.object({
    file: z.string().describe("Source file path to generate tests for"),
    framework: z.enum(["jest", "vitest", "bun"]).optional().describe("Test framework (auto-detected if not specified)"),
    output: z.string().optional().describe("Output path for test file"),
    edge_cases: z.boolean().default(true).describe("Include edge case tests"),
    run: z.boolean().default(false).describe("Run tests after generation"),
  }),
  async execute(input, ctx) {
    const log = Log.create({ service: "test-gen-tool" })
    
    try {
      return await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          // Detect framework
          const framework = input.framework || await TestGen.detectFramework()
          if (framework === "unknown") {
            return {
              title: "Test Generation Failed",
              output: "Could not detect test framework. Please specify with framework parameter",
              metadata: { success: false, functions_found: 0 },
            }
          }

          // Analyze source file
          const functions = await TestGen.analyzeFile(input.file)
          
          if (functions.length === 0) {
            return {
              title: "No Functions Found",
              output: `No exported functions found in ${input.file}`,
              metadata: { success: false, functions_found: 0 },
            }
          }

          // Generate test file path
          const testPath = input.output || TestGen.getTestFilePath(input.file, framework)

          // Generate tests
          const testCode = await TestGen.generateTests(
            input.file,
            functions,
            framework,
            input.edge_cases
          )

          // Write test file
          await TestGen.writeTestFile(testPath, testCode, false)

          // Run tests if requested
          let testResult = ""
          if (input.run) {
            const passed = await TestGen.runTests(testPath, framework)
            testResult = passed ? " All tests passed!" : " Some tests failed."
          }

          return {
            title: "Tests Generated",
            output: `Generated tests for ${functions.length} functions in ${testPath}.${testResult}`,
            metadata: { success: true, test_file: testPath, functions_found: functions.length },
          }
        }
      })
    } catch (error) {
      log.error("test generation failed", { error })
      return {
        title: "Test Generation Error",
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { success: false, functions_found: 0 },
      }
    }
  },
})
