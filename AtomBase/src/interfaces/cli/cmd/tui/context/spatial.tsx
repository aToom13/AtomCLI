import type { JSX } from "solid-js"
import { createContext, createSignal, onCleanup, useContext, createEffect, onMount, Show } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { Log } from "@/util/util/log"
import { useTheme } from "./theme"

const log = Log.create({ service: "tui-spatial" })

export type FocusableElement = {
    id: string
    ref: BoxRenderable
    onPress: () => void
    disabled?: boolean
    layer: number
}

interface SpatialState {
    focusedId: string | null
    elements: Map<string, FocusableElement>
    register: (element: FocusableElement) => void
    unregister: (id: string, ref: BoxRenderable) => void
    focus: (id: string | null) => void
}

const SpatialContext = createContext<SpatialState>()
const SpatialLayerContext = createContext<number>(0)

export function SpatialLayer(props: { children: JSX.Element }) {
    const parentLayer = useContext(SpatialLayerContext) || 0
    return (
        <SpatialLayerContext.Provider value={parentLayer + 1}>
            {props.children}
        </SpatialLayerContext.Provider>
    )
}

export function SpatialProvider(props: { children: JSX.Element }) {
    const [focusedId, setFocusedId] = createSignal<string | null>(null)
    const [elements, setElements] = createSignal<Map<string, FocusableElement>>(new Map())
    const [cursorPos, setCursorPos] = createSignal<{ x: number, y: number } | null>(null)
    const renderer = useRenderer()
    const { theme } = useTheme()

    const register = (element: FocusableElement) => {
        setElements((prev) => {
            const next = new Map(prev)
            next.set(element.id, element)
            return next
        })
    }

    const unregister = (id: string, ref: BoxRenderable) => {
        setElements((prev) => {
            const existing = prev.get(id)
            if (existing && existing.ref === ref) {
                const next = new Map(prev)
                next.delete(id)
                if (focusedId() === id) {
                    setFocusedId(null)
                }
                return next
            }
            return prev
        })
        setTimeout(() => renderer.requestRender(), 0)
    }

    // Calculates center X, Y coordinates of an element on screen using absolute points
    const getCenter = (node: any) => {
        try {
            if (!node || typeof node.x !== "number") return null
            return {
                x: node.x + (node.width / 2),
                y: node.y + (node.height / 2),
                width: node.width,
                height: node.height
            }
        } catch (e) {
            log.error("Failed to calculate center", { error: String(e) })
            return null
        }
    }

    // Move the virtual trackpad cursor and check for collisions
    const navigate = (direction: "up" | "down" | "left" | "right", stepMultiplier: number = 1) => {
        const currentElements = elements()
        if (currentElements.size === 0) return

        let maxLayer = 0
        for (const el of currentElements.values()) {
            if (!el.disabled && el.layer > maxLayer && el.ref?.width > 0) {
                maxLayer = el.layer
            }
        }

        let currentPos = cursorPos()
        if (!currentPos) {
            let startEl = focusedId() ? currentElements.get(focusedId()!) : undefined
            if (!startEl || startEl.layer !== maxLayer || !startEl.ref || startEl.ref.width === 0) {
                startEl = Array.from(currentElements.values()).find(e => !e.disabled && e.layer === maxLayer && e.ref?.width > 0)
            }
            if (startEl && startEl.ref) {
                currentPos = { x: startEl.ref.x + Math.floor(startEl.ref.width / 2), y: startEl.ref.y + Math.floor(startEl.ref.height / 2) }
            } else {
                currentPos = { x: 2, y: 2 }
            }
        }

        // Horizontal step relies on fonts being roughly ~2:1 aspect ratio
        const stepX = 2 * stepMultiplier
        const stepY = 1 * stepMultiplier

        let newX = currentPos.x
        let newY = currentPos.y

        if (direction === "up") newY -= stepY
        if (direction === "down") newY += stepY
        if (direction === "left") newX -= stepX
        if (direction === "right") newX += stepX

        newX = Math.max(0, newX)
        newY = Math.max(0, newY)

        setCursorPos({ x: newX, y: newY })

        let collidedId: string | null = null
        for (const [id, element] of Array.from(currentElements.entries())) {
            if (element.disabled || element.layer !== maxLayer) continue
            const ref = element.ref
            if (!ref || ref.width === 0) continue

            // AABB Collision Detection against cell area
            if (newX >= ref.x && newX < ref.x + ref.width &&
                newY >= ref.y && newY < ref.y + ref.height) {
                collidedId = id
                break
            }
        }

        setFocusedId(collidedId)

        if (collidedId) {
            const el = elements().get(collidedId)
            if (el && el.ref) {
                let parent: any = el.ref.parent
                while (parent) {
                    if (parent instanceof ScrollBoxRenderable || parent.constructor.name === "ScrollBoxRenderable") {
                        const sb = parent as ScrollBoxRenderable
                        const viewport = sb.viewport
                        if (viewport) {
                            const vTop = viewport.y
                            const vBottom = viewport.y + viewport.height
                            const elTop = el.ref.y
                            const elBottom = el.ref.y + el.ref.height

                            if (elTop < vTop) {
                                sb.scrollTo(sb.scrollTop - (vTop - elTop))
                            } else if (elBottom > vBottom) {
                                sb.scrollTo(sb.scrollTop + (elBottom - vBottom))
                            }
                        }
                        break
                    }
                    parent = parent.parent
                }
            }
        }

        setTimeout(() => renderer.requestRender(), 0)
    }

    useKeyboard((e) => {
        if (e.meta || e.option) {
            let handled = false
            const multiplier = e.shift ? 4 : 1
            if (e.name === "up") { navigate("up", multiplier); handled = true }
            if (e.name === "down") { navigate("down", multiplier); handled = true }
            if (e.name === "left") { navigate("left", multiplier); handled = true }
            if (e.name === "right") { navigate("right", multiplier); handled = true }

            if (handled) {
                e.preventDefault()
                return
            }
        }

        if (focusedId() || cursorPos()) {
            if (e.name === "escape") {
                setFocusedId(null)
                setCursorPos(null)
                e.preventDefault()
                e.stopPropagation()
            } else if (e.name === "return" && focusedId()) {
                const current = elements().get(focusedId()!)
                if (current && !current.disabled) {
                    current.onPress()
                }
                e.preventDefault()
                e.stopPropagation()
            }
        }
    })

    const state = {
        get focusedId() { return focusedId() },
        get elements() { return elements() },
        register,
        unregister,
        focus: setFocusedId
    }

    return (
        <SpatialContext.Provider value={state}>
            {props.children}
            <GlowCursor />
            <Show when={cursorPos()}>
                <box
                    position="absolute"
                    left={cursorPos()!.x}
                    top={cursorPos()!.y}
                    width={1}
                    height={1}
                    backgroundColor={theme.primary}
                >
                    <text fg={theme.background}>+</text>
                </box>
            </Show>
        </SpatialContext.Provider>
    )
}

function GlowCursor() {
    const ctx = useSpatial()
    const { theme } = useTheme()

    const current = () => {
        if (!ctx.focusedId) return null
        return ctx.elements.get(ctx.focusedId)
    }

    // Keep track of the active layout bounds
    const [bounds, setBounds] = createSignal({ x: 0, y: 0, width: 0, height: 0 })

    createEffect(() => {
        const el = current()
        if (!el || !el.ref) return

        let frameId: Timer
        const tick = () => {
            const node = el.ref
            if (node && typeof node.x === "number") {
                setBounds(prev => {
                    if (prev.x !== node.x || prev.y !== node.y || prev.width !== node.width || prev.height !== node.height) {
                        return { x: node.x, y: node.y, width: node.width, height: node.height }
                    }
                    return prev
                })
            }
            frameId = setTimeout(tick, 1000 / 30) // 30fps checks
        }
        tick()

        onCleanup(() => {
            clearTimeout(frameId)
        })
    })

    const isVisible = () => current() && bounds().width > 0

    return (
        <box
            position="absolute"
            left={isVisible() ? bounds().x - 1 : 0}
            top={isVisible() ? bounds().y - 1 : 0}
            width={isVisible() ? bounds().width + 2 : 0}
            height={isVisible() ? bounds().height + 2 : 0}
            borderStyle="rounded"
            borderColor="#3b82f6" // Glow color
            border={isVisible() ? true : false}
            // Forward clicks that this overlay intercepts to the actual element
            onMouseUp={() => {
                const el = current()
                if (el) el.onPress()
            }}
        />
    )
}

export function useSpatial() {
    const ctx = useContext(SpatialContext)
    if (!ctx) throw new Error("useSpatial must be used within a SpatialProvider")
    return ctx
}

export function Focusable(props: {
    id: string
    onPress: () => void
    disabled?: boolean
    children: (focused: () => boolean) => JSX.Element
}) {
    const spatial = useSpatial()
    const { theme } = useTheme()
    const layer = useContext(SpatialLayerContext) || 0
    let ref: BoxRenderable | undefined

    onCleanup(() => {
        if (ref) spatial.unregister(props.id, ref)
    })

    createEffect(() => {
        // Update registration if disabled state changes
        if (!ref) return
        spatial.register({
            id: props.id,
            ref,
            onPress: props.onPress,
            disabled: props.disabled,
            layer
        })
    })

    const isFocused = () => spatial.focusedId === props.id

    return (
        <box
            ref={(r) => {
                if (r) {
                    ref = r as BoxRenderable
                    // Initial registration when the ref is resolved
                    spatial.register({
                        id: props.id,
                        ref,
                        onPress: props.onPress,
                        disabled: props.disabled,
                        layer
                    })
                }
            }}
        >
            {props.children(isFocused)}
        </box>
    )
}
