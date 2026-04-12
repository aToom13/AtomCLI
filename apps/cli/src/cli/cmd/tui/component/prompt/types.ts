import type { JSX } from "solid-js"
import { PromptInfo } from "./history"

export type { PromptInfo }

export type PromptProps = {
    sessionID?: string
    visible?: boolean
    disabled?: boolean
    onSubmit?: () => void
    ref?: (ref: PromptRef) => void
    hint?: JSX.Element
    showPlaceholder?: boolean
}

export type PromptRef = {
    focused: boolean
    current: PromptInfo
    set(prompt: PromptInfo): void
    reset(): void
    blur(): void
    focus(): void
    submit(): void
}
