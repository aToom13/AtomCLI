import path from "path"
import fs from "fs/promises"
import { Filesystem } from "@/util/util/filesystem"
import { Instance } from "@/services/project/instance"
import type { RootFunction } from "./types"

export const pathExists = async (p: string) =>
    fs
        .stat(p)
        .then(() => true)
        .catch(() => false)

export const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
    return async (file) => {
        if (excludePatterns) {
            const excludedFiles = Filesystem.up({
                targets: excludePatterns,
                start: path.dirname(file),
                stop: Instance.directory,
            })
            const excluded = await excludedFiles.next()
            await excludedFiles.return()
            if (excluded.value) return undefined
        }
        const files = Filesystem.up({
            targets: includePatterns,
            start: path.dirname(file),
            stop: Instance.directory,
        })
        const first = await files.next()
        await files.return()
        if (!first.value) return Instance.directory
        return path.dirname(first.value)
    }
}
