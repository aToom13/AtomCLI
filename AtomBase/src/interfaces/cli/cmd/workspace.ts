/**
 * Multi-Project Workspace Command
 * 
 * Manages multiple projects simultaneously.
 * Supports cross-project refactoring and monorepo workflows.
 * 
 * Usage: atomcli workspace --add=../other-project
 */

import { cmd } from "./cmd"
import { Log } from "@/util/util/log"
import { Glob } from "@/integrations/tool/glob"
import { Read } from "@/integrations/tool/read"
import { Write } from "@/integrations/tool/write"
import fs from "fs/promises"
import path from "path"

export namespace WorkspaceManager {
  const log = Log.create({ service: "workspace" })
  const WORKSPACE_CONFIG = ".atomcli/workspace.json"

  export interface Workspace {
    version: string
    projects: Project[]
    createdAt: string
    updatedAt: string
  }

  export interface Project {
    id: string
    name: string
    path: string
    type: "app" | "lib" | "service" | "tool"
    dependencies: string[] // IDs of projects this depends on
    tags: string[]
  }

  export interface WorkspaceOptions {
    add?: string
    remove?: string
    list?: boolean
    analyze?: boolean
  }

  /**
   * Load workspace configuration
   */
  export async function loadWorkspace(): Promise<Workspace | null> {
    try {
      const content = await fs.readFile(WORKSPACE_CONFIG, "utf-8")
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Save workspace configuration
   */
  export async function saveWorkspace(workspace: Workspace): Promise<void> {
    await fs.mkdir(path.dirname(WORKSPACE_CONFIG), { recursive: true })
    await fs.writeFile(WORKSPACE_CONFIG, JSON.stringify(workspace, null, 2), "utf-8")
  }

  /**
   * Initialize new workspace
   */
  export async function initWorkspace(): Promise<Workspace> {
    const workspace: Workspace = {
      version: "1.0",
      projects: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await saveWorkspace(workspace)
    return workspace
  }

  /**
   * Add project to workspace
   */
  export async function addProject(projectPath: string): Promise<Project> {
    let workspace = await loadWorkspace()
    if (!workspace) {
      workspace = await initWorkspace()
    }

    // Resolve absolute path
    const absolutePath = path.resolve(projectPath)

    // Check if project exists
    try {
      await fs.access(absolutePath)
    } catch {
      throw new Error(`Project path does not exist: ${absolutePath}`)
    }

    // Check if already added
    if (workspace.projects.some((p) => p.path === absolutePath)) {
      throw new Error(`Project already in workspace: ${absolutePath}`)
    }

    // Detect project type and name
    const name = path.basename(absolutePath)
    const type = await detectProjectType(absolutePath)

    const project: Project = {
      id: `project-${Date.now()}`,
      name,
      path: absolutePath,
      type,
      dependencies: [],
      tags: [],
    }

    workspace.projects.push(project)
    workspace.updatedAt = new Date().toISOString()
    await saveWorkspace(workspace)

    log.info("project added", { name, path: absolutePath })
    return project
  }

  /**
   * Detect project type from package.json and structure
   */
  async function detectProjectType(projectPath: string): Promise<Project["type"]> {
    try {
      const pkgPath = path.join(projectPath, "package.json")
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"))

      // Check for app indicators
      if (pkg.scripts?.start || pkg.scripts?.dev || pkg.dependencies?.["react"] || pkg.dependencies?.["vue"]) {
        return "app"
      }

      // Check for CLI tool
      if (pkg.bin || pkg.keywords?.includes("cli")) {
        return "tool"
      }

      // Check for service
      if (pkg.dependencies?.["express"] || pkg.dependencies?.["fastify"] || pkg.dependencies?.["koa"]) {
        return "service"
      }

      return "lib"
    } catch {
      return "lib"
    }
  }

  /**
   * Remove project from workspace
   */
  export async function removeProject(projectId: string): Promise<void> {
    const workspace = await loadWorkspace()
    if (!workspace) {
      throw new Error("No workspace found")
    }

    const index = workspace.projects.findIndex((p) => p.id === projectId)
    if (index === -1) {
      throw new Error(`Project not found: ${projectId}`)
    }

    workspace.projects.splice(index, 1)
    workspace.updatedAt = new Date().toISOString()
    await saveWorkspace(workspace)

    log.info("project removed", { id: projectId })
  }

  /**
   * List all projects in workspace
   */
  export async function listProjects(): Promise<Project[]> {
    const workspace = await loadWorkspace()
    return workspace?.projects || []
  }

  /**
   * Cross-project search
   */
  export async function searchAcrossProjects(pattern: string): Promise<
    Array<{
      project: string
      file: string
      line: number
      content: string
    }>
  > {
    const workspace = await loadWorkspace()
    if (!workspace) {
      throw new Error("No workspace found")
    }

    const results: ReturnType<typeof searchAcrossProjects> extends Promise<infer T> ? T : never = []

    for (const project of workspace.projects) {
      const glob = new Bun.Glob("**/*.{ts,js,tsx,jsx,json,md}")

      for await (const file of glob.scan(project.path)) {
        if (file.includes("node_modules")) continue

        try {
          const content = await fs.readFile(path.join(project.path, file), "utf-8")
          const lines = content.split("\n")

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern)) {
              results.push({
                project: project.name,
                file: path.relative(project.path, file),
                line: i + 1,
                content: lines[i].trim(),
              })
            }
          }
        } catch {
          // Skip binary files
        }
      }
    }

    return results
  }

  /**
   * Analyze dependencies between projects
   */
  export async function analyzeDependencies(): Promise<
    Array<{
      project: string
      internalDeps: string[]
      externalDeps: string[]
      circular?: boolean
    }>
  > {
    const workspace = await loadWorkspace()
    if (!workspace) {
      throw new Error("No workspace found")
    }

    const results: ReturnType<typeof analyzeDependencies> extends Promise<infer T> ? T : never = []

    for (const project of workspace.projects) {
      try {
        const pkgPath = path.join(project.path, "package.json")
        const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"))

        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        }

        const internalDeps: string[] = []
        const externalDeps: string[] = []

        for (const depName of Object.keys(allDeps)) {
          const isInternal = workspace.projects.some((p) => p.name === depName)
          if (isInternal) {
            internalDeps.push(depName)
          } else {
            externalDeps.push(depName)
          }
        }

        results.push({
          project: project.name,
          internalDeps,
          externalDeps,
        })
      } catch {
        // Skip projects without package.json
      }
    }

    // Detect circular dependencies
    for (const result of results) {
      for (const internalDep of result.internalDeps) {
        const depProject = results.find((r) => r.project === internalDep)
        if (depProject?.internalDeps.includes(result.project)) {
          result.circular = true
        }
      }
    }

    return results
  }

  /**
   * Generate workspace report
   */
  export async function generateReport(): Promise<string> {
    const workspace = await loadWorkspace()
    if (!workspace) {
      return "No workspace found. Run 'atomcli workspace --add=<path>' to create one."
    }

    const deps = await analyzeDependencies()

    let report = `# Workspace Report\n\n`
    report += `**Projects:** ${workspace.projects.length}\n`
    report += `**Created:** ${workspace.createdAt}\n`
    report += `**Updated:** ${workspace.updatedAt}\n\n`

    report += `## Projects\n\n`
    for (const project of workspace.projects) {
      report += `### ${project.name}\n`
      report += `- **Type:** ${project.type}\n`
      report += `- **Path:** ${project.path}\n`
      if (project.tags.length > 0) {
        report += `- **Tags:** ${project.tags.join(", ")}\n`
      }
      report += `\n`
    }

    report += `## Dependencies\n\n`
    for (const dep of deps) {
      report += `### ${dep.project}\n`
      if (dep.internalDeps.length > 0) {
        report += `- **Internal:** ${dep.internalDeps.join(", ")}\n`
      }
      if (dep.circular) {
        report += `- ⚠️ **Circular dependency detected!**\n`
      }
      report += `\n`
    }

    return report
  }
}

/**
 * CLI Command Definition
 */
export const WorkspaceCommand = cmd({
  command: "workspace",
  describe: "Manage multi-project workspace",
  builder: (yargs) =>
    yargs
      .option("add", {
        type: "string",
        alias: "a",
        describe: "Add project to workspace",
      })
      .option("remove", {
        type: "string",
        alias: "r",
        describe: "Remove project from workspace by ID",
      })
      .option("list", {
        type: "boolean",
        alias: "l",
        describe: "List all projects in workspace",
        default: false,
      })
      .option("search", {
        type: "string",
        alias: "s",
        describe: "Search pattern across all projects",
      })
      .option("deps", {
        type: "boolean",
        alias: "d",
        describe: "Analyze dependencies between projects",
        default: false,
      })
      .option("report", {
        type: "boolean",
        describe: "Generate workspace report",
        default: false,
      }),
  handler: async (args) => {
    const log = Log.create({ service: "workspace-cli" })

    try {
      // Add project
      if (args.add) {
        const project = await WorkspaceManager.addProject(args.add)
        console.log(`✅ Added project: ${project.name} (${project.type})`)
        console.log(`   Path: ${project.path}`)
        return
      }

      // Remove project
      if (args.remove) {
        await WorkspaceManager.removeProject(args.remove)
        console.log(`✅ Removed project: ${args.remove}`)
        return
      }

      // List projects
      if (args.list) {
        const projects = await WorkspaceManager.listProjects()
        if (projects.length === 0) {
          console.log("No projects in workspace. Use --add to add projects.")
          return
        }

        console.log(`\n📁 Workspace Projects (${projects.length}):\n`)
        for (const project of projects) {
          console.log(`  ${project.name} (${project.type})`)
          console.log(`    Path: ${project.path}`)
          console.log(`    ID: ${project.id}`)
          console.log()
        }
        return
      }

      // Search across projects
      if (args.search) {
        console.log(`🔍 Searching for "${args.search}" across all projects...\n`)
        const results = await WorkspaceManager.searchAcrossProjects(args.search)

        if (results.length === 0) {
          console.log("No results found.")
          return
        }

        console.log(`Found ${results.length} results:\n`)
        for (const result of results.slice(0, 20)) {
          console.log(`  [${result.project}] ${result.file}:${result.line}`)
          console.log(`    ${result.content.substring(0, 80)}`)
          console.log()
        }

        if (results.length > 20) {
          console.log(`  ... and ${results.length - 20} more results`)
        }
        return
      }

      // Analyze dependencies
      if (args.deps) {
        console.log("📊 Analyzing dependencies...\n")
        const deps = await WorkspaceManager.analyzeDependencies()

        for (const dep of deps) {
          console.log(`${dep.project}:`)
          if (dep.internalDeps.length > 0) {
            console.log(`  Internal deps: ${dep.internalDeps.join(", ")}`)
          }
          if (dep.externalDeps.length > 0) {
            console.log(`  External deps: ${dep.externalDeps.length} packages`)
          }
          if (dep.circular) {
            console.log(`  ⚠️ Circular dependency detected!`)
          }
          console.log()
        }
        return
      }

      // Generate report
      if (args.report) {
        const report = await WorkspaceManager.generateReport()
        console.log(report)
        return
      }

      // Default: show help
      console.log("Use one of the following options:")
      console.log("  --add=<path>     Add project to workspace")
      console.log("  --remove=<id>    Remove project from workspace")
      console.log("  --list           List all projects")
      console.log("  --search=<term>  Search across projects")
      console.log("  --deps           Analyze dependencies")
      console.log("  --report         Generate report")
    } catch (error) {
      log.error("workspace command failed", { error })
      console.error("Error:", error instanceof Error ? error.message : error)
      process.exit(1)
    }
  },
})
