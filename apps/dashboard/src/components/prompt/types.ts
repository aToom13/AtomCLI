import { Component } from "solid-js"
import { Prompt } from "@/context/prompt"

export interface PromptInputProps {
    class?: string
    ref?: (el: HTMLDivElement) => void
    onNewSessionWorktreeReset?: () => void
    newSessionWorktree?: string
}

export type AtOption = { type: "agent"; name: string; display: string } | { type: "file"; path: string; display: string }

export interface SlashCommand {
    id: string
    trigger: string
    title: string
    description?: string
    keybind?: string
    type: "builtin" | "custom"
}
