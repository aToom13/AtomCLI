import path from "path"
import { mergeDeep } from "remeda"
import type { Schemas } from "./schemas"

// Custom merge function that concatenates array fields instead of replacing them
export function mergeConfigConcatArrays(target: Schemas.Info, source: Schemas.Info): Schemas.Info {
    const merged = mergeDeep(target, source)
    if (target.plugin && source.plugin) {
        merged.plugin = Array.from(new Set([...target.plugin, ...source.plugin]))
    }
    if (target.instructions && source.instructions) {
        merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
    }
    return merged
}

/**
 * Extracts a canonical plugin name from a plugin specifier.
 * - For file:// URLs: extracts filename without extension
 * - For npm packages: extracts package name without version
 *
 * @example
 * getPluginName("file:///path/to/plugin/foo.js") // "foo"
 * getPluginName("oh-my-atomcli@2.4.3") // "oh-my-atomcli"
 * getPluginName("@scope/pkg@1.0.0") // "@scope/pkg"
 */
export function getPluginName(plugin: string): string {
    if (plugin.startsWith("file://")) {
        return path.parse(new URL(plugin).pathname).name
    }
    const lastAt = plugin.lastIndexOf("@")
    if (lastAt > 0) {
        return plugin.substring(0, lastAt)
    }
    return plugin
}

/**
 * Deduplicates plugins by name, with later entries (higher priority) winning.
 * Priority order (highest to lowest):
 * 1. Local plugin/ directory
 * 2. Local atomcli.json
 * 3. Global plugin/ directory
 * 4. Global atomcli.json
 *
 * Since plugins are added in low-to-high priority order,
 * we reverse, deduplicate (keeping first occurrence), then restore order.
 */
export function deduplicatePlugins(plugins: string[]): string[] {
    // seenNames: canonical plugin names for duplicate detection
    // e.g., "oh-my-atomcli", "@scope/pkg"
    const seenNames = new Set<string>()

    // uniqueSpecifiers: full plugin specifiers to return
    // e.g., "oh-my-atomcli@2.4.3", "file:///path/to/plugin.js"
    const uniqueSpecifiers: string[] = []

    for (const specifier of plugins.toReversed()) {
        const name = getPluginName(specifier)
        if (!seenNames.has(name)) {
            seenNames.add(name)
            uniqueSpecifiers.push(specifier)
        }
    }

    return uniqueSpecifiers.toReversed()
}
