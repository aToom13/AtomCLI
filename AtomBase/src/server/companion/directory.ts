import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "@/services/project/instance"
import { InstanceBootstrap } from "@/services/project/bootstrap"
import { Project } from "@/services/project/project"
import { Filesystem } from "@/util/util/filesystem"

export async function knownDirectories(current: string) {
  const projects = await Project.list().catch(() => [])
  const directories = new Set<string>()
  for (const candidate of [current, ...projects.flatMap((project) => [project.worktree, ...project.sandboxes])]) {
    if (!candidate) continue
    try {
      const resolved = await fs.realpath(candidate)
      if ((await fs.stat(resolved)).isDirectory()) directories.add(resolved)
    } catch {}
  }
  return Array.from(directories)
}

export async function resolveCompanionDirectory(candidate: string | undefined, fallback: string) {
  const requested = candidate ? path.resolve(candidate) : fallback
  const home = await fs.realpath(os.homedir())
  const resolved = await fs.realpath(requested)
  const current = await fs.realpath(fallback)
  const projectRoots = await knownDirectories(current)
  if (
    !Filesystem.contains(home, resolved) &&
    !projectRoots.some((projectRoot) => Filesystem.contains(projectRoot, resolved))
  ) {
    throw new Error("Directory must be inside the user's home folder or a known AtomCLI workspace")
  }
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error("Selected path is not a directory")
  return resolved
}

export async function inDirectory<R>(candidate: string | undefined, fallback: string, fn: () => R) {
  const selected = await resolveCompanionDirectory(candidate, fallback)
  return Instance.provide({ directory: selected, init: InstanceBootstrap, fn })
}
