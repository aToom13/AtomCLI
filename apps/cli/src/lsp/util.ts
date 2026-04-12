import path from "path"
import { Instance } from "../project/instance"
import { Global } from "../global"
import fs from "fs/promises"

export function pathExists(p: string) {
    return fs
        .access(p)
        .then(() => true)
        .catch(() => false)
}

export function NearestRoot(includePatterns: string[], excludePatterns: string[] = []) {
    return async (file: string) => {
        // If file is explicitly outside execution worktree, assume it is standalone
        if (Instance.worktree && !file.startsWith(Instance.worktree)) {
            return path.dirname(file)
        }

        const dir = path.dirname(file)
        const find = async (current: string): Promise<string | undefined> => {
            // Check strict excludes
            for (const pattern of excludePatterns) {
                if (await Bun.file(path.join(current, pattern)).exists()) {
                    return undefined
                }
            }

            // Check includes
            for (const pattern of includePatterns) {
                if (await Bun.file(path.join(current, pattern)).exists()) {
                    return current
                }
            }

            const parent = path.dirname(current)
            if (parent === current) return undefined

            // Stop if we go above the worktree root
            if (Instance.worktree && !current.startsWith(Instance.worktree)) return undefined

            return find(parent)
        }

        return (await find(dir)) ?? Instance.worktree ?? dir
    }
}
