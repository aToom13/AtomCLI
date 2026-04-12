import { RGBA, type TerminalColors } from "@opentui/core"
import type { Theme, ThemeColors, ThemeJson, ColorValue } from "./types"

export function ansiToRgba(code: number): RGBA {
    // Standard ANSI colors (0-15)
    if (code < 16) {
        const ansiColors = [
            "#000000", // Black
            "#800000", // Red
            "#008000", // Green
            "#808000", // Yellow
            "#000080", // Blue
            "#800080", // Magenta
            "#008080", // Cyan
            "#c0c0c0", // White
            "#808080", // Bright Black
            "#ff0000", // Bright Red
            "#00ff00", // Bright Green
            "#ffff00", // Bright Yellow
            "#0000ff", // Bright Blue
            "#ff00ff", // Bright Magenta
            "#00ffff", // Bright Cyan
            "#ffffff", // Bright White
        ]
        return RGBA.fromHex(ansiColors[code] ?? "#000000")
    }

    // 6x6x6 Color Cube (16-231)
    if (code < 232) {
        const index = code - 16
        const b = index % 6
        const g = Math.floor(index / 6) % 6
        const r = Math.floor(index / 36)

        const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
        return RGBA.fromInts(val(r), val(g), val(b))
    }

    // Grayscale Ramp (232-255)
    if (code < 256) {
        const gray = (code - 232) * 10 + 8
        return RGBA.fromInts(gray, gray, gray)
    }

    // Fallback for invalid codes
    return RGBA.fromInts(0, 0, 0)
}

export function resolveTheme(theme: ThemeJson, mode: "dark" | "light") {
    const defs = theme.defs ?? {}
    function resolveColor(c: ColorValue): RGBA {
        if (c instanceof RGBA) return c
        if (typeof c === "string") {
            if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)

            if (c.startsWith("#")) return RGBA.fromHex(c)

            if (defs[c] != null) {
                return resolveColor(defs[c])
            } else if (theme.theme[c as keyof ThemeColors] !== undefined) {
                return resolveColor(theme.theme[c as keyof ThemeColors]!)
            } else {
                throw new Error(`Color reference "${c}" not found in defs or theme`)
            }
        }
        if (typeof c === "number") {
            return ansiToRgba(c)
        }
        return resolveColor(c[mode])
    }

    const resolved = Object.fromEntries(
        Object.entries(theme.theme)
            .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
            .map(([key, value]) => {
                return [key, resolveColor(value as ColorValue)]
            }),
    ) as Partial<ThemeColors>

    // Handle selectedListItemText separately since it's optional
    const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
    if (hasSelectedListItemText) {
        resolved.selectedListItemText = resolveColor(theme.theme.selectedListItemText!)
    } else {
        // Backward compatibility: if selectedListItemText is not defined, use background color
        // This preserves the current behavior for all existing themes
        resolved.selectedListItemText = resolved.background
    }

    // Handle backgroundMenu - optional with fallback to backgroundElement
    if (theme.theme.backgroundMenu !== undefined) {
        resolved.backgroundMenu = resolveColor(theme.theme.backgroundMenu)
    } else {
        resolved.backgroundMenu = resolved.backgroundElement
    }

    // Handle thinkingOpacity - optional with default of 0.6
    const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6

    return {
        ...resolved,
        _hasSelectedListItemText: hasSelectedListItemText,
        thinkingOpacity,
    } as Theme
}

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
    // If theme explicitly defines selectedListItemText, use it
    if (theme._hasSelectedListItemText) {
        return theme.selectedListItemText
    }

    // For transparent backgrounds, calculate contrast based on the actual bg (or fallback to primary)
    if (theme.background.a === 0) {
        const targetColor = bg ?? theme.primary
        const { r, g, b } = targetColor
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b
        return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
    }

    // Fall back to background color
    return theme.background
}

export function generateSystem(colors: TerminalColors, mode: "dark" | "light"): ThemeJson {
    const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!)
    const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7]!)
    const isDark = mode == "dark"

    const col = (i: number) => {
        const value = colors.palette[i]
        if (value) return RGBA.fromHex(value)
        return ansiToRgba(i)
    }

    const tint = (base: RGBA, overlay: RGBA, alpha: number) => {
        const r = base.r + (overlay.r - base.r) * alpha
        const g = base.g + (overlay.g - base.g) * alpha
        const b = base.b + (overlay.b - base.b) * alpha
        return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
    }

    // Generate gray scale based on terminal background
    const grays = generateGrayScale(bg, isDark)
    const textMuted = generateMutedTextColor(bg, isDark)

    // ANSI color references
    const ansiColors = {
        black: col(0),
        red: col(1),
        green: col(2),
        yellow: col(3),
        blue: col(4),
        magenta: col(5),
        cyan: col(6),
        white: col(7),
        redBright: col(9),
        greenBright: col(10),
    }

    const diffAlpha = isDark ? 0.22 : 0.14
    const diffAddedBg = tint(bg, ansiColors.green, diffAlpha)
    const diffRemovedBg = tint(bg, ansiColors.red, diffAlpha)
    const diffAddedLineNumberBg = tint(grays[3], ansiColors.green, diffAlpha)
    const diffRemovedLineNumberBg = tint(grays[3], ansiColors.red, diffAlpha)

    return {
        theme: {
            // Primary colors using ANSI
            primary: ansiColors.cyan,
            secondary: ansiColors.magenta,
            accent: ansiColors.cyan,

            // Status colors using ANSI
            error: ansiColors.red,
            warning: ansiColors.yellow,
            success: ansiColors.green,
            info: ansiColors.cyan,

            // Text colors
            text: fg,
            textMuted,
            selectedListItemText: bg,

            // Background colors
            background: bg,
            backgroundPanel: grays[2],
            backgroundElement: grays[3],
            backgroundMenu: grays[3],

            // Border colors
            borderSubtle: grays[6],
            border: grays[7],
            borderActive: grays[8],

            // Diff colors
            diffAdded: ansiColors.green,
            diffRemoved: ansiColors.red,
            diffContext: grays[7],
            diffHunkHeader: grays[7],
            diffHighlightAdded: ansiColors.greenBright,
            diffHighlightRemoved: ansiColors.redBright,
            diffAddedBg,
            diffRemovedBg,
            diffContextBg: grays[1],
            diffLineNumber: grays[6],
            diffAddedLineNumberBg,
            diffRemovedLineNumberBg,

            // Markdown colors
            markdownText: fg,
            markdownHeading: fg,
            markdownLink: ansiColors.blue,
            markdownLinkText: ansiColors.cyan,
            markdownCode: ansiColors.green,
            markdownBlockQuote: ansiColors.yellow,
            markdownEmph: ansiColors.yellow,
            markdownStrong: fg,
            markdownHorizontalRule: grays[7],
            markdownListItem: ansiColors.blue,
            markdownListEnumeration: ansiColors.cyan,
            markdownImage: ansiColors.blue,
            markdownImageText: ansiColors.cyan,
            markdownCodeBlock: fg,

            // Syntax colors
            syntaxComment: textMuted,
            syntaxKeyword: ansiColors.magenta,
            syntaxFunction: ansiColors.blue,
            syntaxVariable: fg,
            syntaxString: ansiColors.green,
            syntaxNumber: ansiColors.yellow,
            syntaxType: ansiColors.cyan,
            syntaxOperator: ansiColors.cyan,
            syntaxPunctuation: fg,
        },
    }
}

export function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
    const grays: Record<number, RGBA> = {}

    // RGBA stores floats in range 0-1, convert to 0-255
    const bgR = bg.r * 255
    const bgG = bg.g * 255
    const bgB = bg.b * 255

    const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

    for (let i = 1; i <= 12; i++) {
        const factor = i / 12.0

        let grayValue: number
        let newR: number
        let newG: number
        let newB: number

        if (isDark) {
            if (luminance < 10) {
                grayValue = Math.floor(factor * 0.4 * 255)
                newR = grayValue
                newG = grayValue
                newB = grayValue
            } else {
                const newLum = luminance + (255 - luminance) * factor * 0.4

                const ratio = newLum / luminance
                newR = Math.min(bgR * ratio, 255)
                newG = Math.min(bgG * ratio, 255)
                newB = Math.min(bgB * ratio, 255)
            }
        } else {
            if (luminance > 245) {
                grayValue = Math.floor(255 - factor * 0.4 * 255)
                newR = grayValue
                newG = grayValue
                newB = grayValue
            } else {
                const newLum = luminance * (1 - factor * 0.4)

                const ratio = newLum / luminance
                newR = Math.max(bgR * ratio, 0)
                newG = Math.max(bgG * ratio, 0)
                newB = Math.max(bgB * ratio, 0)
            }
        }

        grays[i] = RGBA.fromInts(Math.floor(newR), Math.floor(newG), Math.floor(newB))
    }

    return grays
}

export function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
    // RGBA stores floats in range 0-1, convert to 0-255
    const bgR = bg.r * 255
    const bgG = bg.g * 255
    const bgB = bg.b * 255

    const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

    let grayValue: number

    if (isDark) {
        if (bgLum < 10) {
            // Very dark/black background
            grayValue = 180 // #b4b4b4
        } else {
            // Scale up for lighter dark backgrounds
            grayValue = Math.min(Math.floor(160 + bgLum * 0.3), 200)
        }
    } else {
        if (bgLum > 245) {
            // Very light/white background
            grayValue = 75 // #4b4b4b
        } else {
            // Scale down for darker light backgrounds
            grayValue = Math.max(Math.floor(100 - (255 - bgLum) * 0.2), 60)
        }
    }

    return RGBA.fromInts(grayValue, grayValue, grayValue)
}
