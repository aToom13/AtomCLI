/**
 * Test Generation Command
 * 
 * Automatically generates unit tests for source files.
 * Supports Jest, Vitest, and Bun test frameworks.
 * Detects testable functions and generates comprehensive test cases.
 * 
 * Usage: atomcli test-gen --file=src/utils.ts
 */

import { cmd } from "./cmd"
import { Log } from "@/util/log"
import { Glob } from "@/tool/glob"
import { Read } from "@/tool/read"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { Identifier } from "@/id/id"
import { Session } from "@/session"
import { Config } from "@/config/config"
import { Write } from "@/tool/write"
import { Bash } from "@/tool/bash"
import { Instance } from "@/project/instance"
import path from "path"
import fs from "fs/promises"

export namespace TestGen {
  const log = Log.create({ service: "test-gen" })

  export type TestFramework = "jest" | "vitest" | "bun" | "unknown"

  export interface TestGenOptions {
    file: string
    framework?: TestFramework
    output?: string
    overwrite?: boolean
    includeEdgeCases?: boolean
  }

  export interface TestableFunction {
    name: string
    type: "function" | "class" | "method" | "arrow"
    parameters: string[]
    returnType?: string
    isExported: boolean
    isDefault: boolean
    location: {
      line: number
      column: number
    }
  }

  /**
   * Detect test framework from project configuration
   */
  export async function detectFramework(): Promise<TestFramework> {
    try {
      // Check for package.json
      const packageJson = await fs.readFile("package.json", "utf-8")
      const pkg = JSON.parse(packageJson)

      // Check devDependencies and dependencies
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }

      if (deps["vitest"]) return "vitest"
      if (deps["jest"]) return "jest"
      if (deps["bun"] || pkg.type === "module") return "bun"

      // Check for config files
      const files = await fs.readdir(".")
      if (files.some(f => f.includes("vitest.config"))) return "vitest"
      if (files.some(f => f.includes("jest.config"))) return "jest"

      return "unknown"
    } catch (e) {
      return "unknown"
    }
  }

  /**
   * Parse file to find testable functions
   */
  export async function analyzeFile(filePath: string): Promise<TestableFunction[]> {
    const content = await fs.readFile(filePath, "utf-8")
    const functions: TestableFunction[] = []

    // Simple regex-based parsing (can be enhanced with AST parser)
    const lines = content.split("\n")
    let currentExport = false
    let isDefault = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      // Check for export
      if (trimmed.startsWith("export ")) {
        currentExport = true
        isDefault = trimmed.includes("export default")
      }

      // Function declaration: function name(params)
      const funcMatch = trimmed.match(/^(export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/)
      if (funcMatch) {
        functions.push({
          name: funcMatch[2],
          type: "function",
          parameters: parseParameters(funcMatch[3]),
          isExported: currentExport || trimmed.startsWith("export"),
          isDefault: isDefault,
          location: { line: i + 1, column: 0 },
        })
      }

      // Arrow function: export const name = (params) =>
      const arrowMatch = trimmed.match(/^(export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/)
      if (arrowMatch) {
        functions.push({
          name: arrowMatch[2],
          type: "arrow",
          parameters: parseParameters(arrowMatch[3]),
          isExported: currentExport || trimmed.startsWith("export"),
          isDefault: isDefault,
          location: { line: i + 1, column: 0 },
        })
      }

      // Class declaration
      const classMatch = trimmed.match(/^(export\s+)?class\s+(\w+)/)
      if (classMatch) {
        functions.push({
          name: classMatch[2],
          type: "class",
          parameters: [],
          isExported: currentExport || trimmed.startsWith("export"),
          isDefault: isDefault,
          location: { line: i + 1, column: 0 },
        })
      }

      // Reset export state on empty lines or new declarations
      if (trimmed === "" || trimmed.startsWith("//")) {
        currentExport = false
        isDefault = false
      }
    }

    return functions
  }

  function parseParameters(params: string): string[] {
    if (!params.trim()) return []
    return params.split(",").map(p => p.trim().split(/[\s:=]/)[0]).filter(Boolean)
  }

  /**
   * Generate test file path from source file
   */
  export function getTestFilePath(sourcePath: string, framework: TestFramework): string {
    const dir = path.dirname(sourcePath)
    const basename = path.basename(sourcePath, path.extname(sourcePath))
    const ext = path.extname(sourcePath)

    switch (framework) {
      case "jest":
      case "vitest":
        return path.join(dir, `${basename}.test${ext}`)
      case "bun":
      default:
        return path.join(dir, `${basename}.test${ext}`)
    }
  }

  /**
   * Generate test code using AI
   */
  export async function generateTests(
    sourcePath: string,
    functions: TestableFunction[],
    framework: TestFramework,
    includeEdgeCases: boolean = true
  ): Promise<string> {
    const sourceContent = await fs.readFile(sourcePath, "utf-8")

    // Build prompt for test generation
    const prompt = buildTestPrompt(sourcePath, sourceContent, functions, framework, includeEdgeCases)

    // Get agent for code generation
    const agent = await Agent.get("general")
    if (!agent) {
      throw new Error("General agent not found")
    }

    const defaultModel = await Provider.defaultModel()
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)

    // Generate tests using LLM
    const userMessage: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: "test-gen-session",
      role: "user",
      time: { created: Date.now() },
      agent: "test-gen",
      model: { providerID: model.providerID, modelID: model.id },
    }

    const abortController = new AbortController()

    const stream = await LLM.stream({
      agent,
      user: userMessage,
      sessionID: "test-gen-session",
      model,
      system: [getTestGenSystemPrompt(framework)],
      abort: abortController.signal,
      messages: [
        { role: "user", content: prompt }
      ],
      tools: {},
    })

    const testCode = await stream.text
    return testCode
  }

  function buildTestPrompt(
    sourcePath: string,
    sourceContent: string,
    functions: TestableFunction[],
    framework: TestFramework,
    includeEdgeCases: boolean
  ): string {
    const functionList = functions.map(f => {
      const params = f.parameters.join(", ")
      return `- ${f.name}(${params}) [${f.type}]${f.isExported ? " (exported)" : ""}`
    }).join("\n")

    return `Generate comprehensive unit tests for the following TypeScript/JavaScript code.

Source file: ${sourcePath}
Test framework: ${framework}
Include edge cases: ${includeEdgeCases}

Functions to test:
${functionList}

Source code:
\`\`\`
${sourceContent}
\`\`\`

Requirements:
1. Use ${framework} test syntax
2. Import the functions from the source file
3. Write tests for each exported function
4. Include happy path tests
5. ${includeEdgeCases ? "Include edge case tests (null, undefined, empty, invalid inputs)" : "Focus on main functionality"}
6. Use descriptive test names
7. Group related tests with describe blocks

Return ONLY the test code, no explanations.`
  }

  function getTestGenSystemPrompt(framework: TestFramework): string {
    const imports = {
      jest: "import { describe, it, expect } from '@jest/globals'",
      vitest: "import { describe, it, expect } from 'vitest'",
      bun: "import { describe, it, expect } from 'bun:test'",
      unknown: "import { describe, it, expect } from 'bun:test'",
    }

    return `You are a test generation expert. Generate unit tests using ${framework}.

Rules:
1. Start with: ${imports[framework]}
2. Use describe() for grouping
3. Use it() or test() for individual tests
4. Use expect() with appropriate matchers
5. Test both success and failure cases
6. Mock external dependencies when needed
7. Write clean, maintainable test code

Example structure:
\`\`\`
${imports[framework]}
import { myFunction } from "./my-file"

describe("myFunction", () => {
  it("should return correct result for valid input", () => {
    expect(myFunction("input")).toBe("expected")
  })
  
  it("should handle edge cases", () => {
    expect(myFunction("")).toBe("")
  })
})
\`\`\``
  }

  /**
   * Write test file to disk
   */
  export async function writeTestFile(
    testPath: string,
    content: string,
    overwrite: boolean = false
  ): Promise<void> {
    // Check if file exists
    try {
      await fs.access(testPath)
      if (!overwrite) {
        throw new Error(`Test file already exists: ${testPath}. Use --overwrite to replace.`)
      }
    } catch (e) {
      // File doesn't exist, proceed
    }

    await fs.writeFile(testPath, content, "utf-8")
    log.info("test file written", { path: testPath })
  }

  /**
   * Run tests to verify they work
   */
  export async function runTests(testPath: string, framework: TestFramework): Promise<boolean> {
    try {
      let command: string
      switch (framework) {
        case "jest":
          command = `npx jest "${testPath}"`
          break
        case "vitest":
          command = `npx vitest run "${testPath}"`
          break
        case "bun":
        default:
          command = `bun test "${testPath}"`
      }

      const result = await Bun.spawn(["bash", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
      })

      const exitCode = await result.exited
      return exitCode === 0
    } catch (e) {
      log.error("test run failed", { error: e })
      return false
    }
  }
}

/**
 * CLI Command Definition
 */
export const TestGenCommand = cmd({
  command: "test-gen",
  describe: "Generate unit tests for source files",
  builder: (yargs) =>
    yargs
      .option("file", {
        type: "string",
        alias: "f",
        describe: "Source file to generate tests for",
        demandOption: true,
      })
      .option("framework", {
        type: "string",
        choices: ["jest", "vitest", "bun"],
        describe: "Test framework to use (auto-detected if not specified)",
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Output path for test file (auto-generated if not specified)",
      })
      .option("overwrite", {
        type: "boolean",
        describe: "Overwrite existing test file",
        default: false,
      })
      .option("edge-cases", {
        type: "boolean",
        describe: "Include edge case tests",
        default: true,
      })
      .option("run", {
        type: "boolean",
        describe: "Run tests after generation",
        default: false,
      }),
  handler: async (args) => {
    const log = Log.create({ service: "test-gen-cli" })

    try {
      // Initialize instance context
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          // Detect framework
          const framework = (args.framework || await TestGen.detectFramework()) as TestGen.TestFramework
          if (framework === "unknown") {
            log.error("Could not detect test framework. Please specify with --framework")
            process.exit(1)
          }
          log.info("using framework", { framework })

          // Analyze source file
          log.info("analyzing file", { file: args.file })
          const functions = await TestGen.analyzeFile(args.file)

          if (functions.length === 0) {
            log.warn("no testable functions found", { file: args.file })
            console.log("No exported functions found in the file.")
            return
          }

          log.info("found functions", { count: functions.length })

          // Generate test file path
          const testPath = args.output || TestGen.getTestFilePath(args.file, framework)
          log.info("test file path", { path: testPath })

          // Generate tests
          console.log(`Generating tests for ${functions.length} functions...`)
          const testCode = await TestGen.generateTests(
            args.file,
            functions,
            framework,
            args.edgeCases
          )

          // Write test file
          await TestGen.writeTestFile(testPath, testCode, args.overwrite)
          console.log(`✅ Test file created: ${testPath}`)

          // Run tests if requested
          if (args.run) {
            console.log("Running tests...")
            const passed = await TestGen.runTests(testPath, framework)
            if (passed) {
              console.log("✅ All tests passed!")
            } else {
              console.log("❌ Some tests failed. Check the output above.")
              process.exit(1)
            }
          }
        }
      })
    } catch (error) {
      log.error("test generation failed", { error })
      console.error("Error:", error instanceof Error ? error.message : error)
      process.exit(1)
    }
  },
})
