import type { KeyEvent } from "@opentui/core"

export type AutocompleteRef = {
    onInput: (value: string) => void
    onKeyDown: (e: KeyEvent) => void
    visible: false | "@" | "/"
}

export type AutocompleteOption = {
    display: string
    value?: string
    aliases?: string[]
    disabled?: boolean
    description?: string
    isDirectory?: boolean
    onSelect?: () => void
    path?: string
}
