import type { JSX } from "solid-js"
import { createContext, createSignal, onCleanup, useContext, createEffect } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "tui-spatial" })

export namespace SpatialGeometry {
    export interface Bounds {
        x: number
        y: number
        width: number
        height: number
    }

    export function bounds(node: any): Bounds {
        return {
            x: typeof node?.screenX === "number" ? node.screenX : (node?.x ?? 0),
            y: typeof node?.screenY === "number" ? node.screenY : (node?.y ?? 0),
            width: node?.width ?? 0,
            height: node?.height ?? 0,
        }
    }

    export function contains(bounds: Bounds, point: { x: number; y: number }) {
        return (
            point.x >= bounds.x &&
            point.x < bounds.x + bounds.width &&
            point.y >= bounds.y &&
            point.y < bounds.y + bounds.height
        )
    }
}

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
    return <SpatialLayerContext.Provider value={parentLayer + 1}>{props.children}</SpatialLayerContext.Provider>
}

export function SpatialProvider(props: { children: JSX.Element }) {
    const [focusedId, setFocusedId] = createSignal<string | null>(null)
    const [elements, setElements] = createSignal<Map<string, FocusableElement>>(new Map())
    const [cursorPos, setCursorPos] = createSignal<{ x: number; y: number } | null>(null)
    const renderer = useRenderer()

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
            if (!node || (typeof node.screenX !== "number" && typeof node.x !== "number")) return null
            const bounds = SpatialGeometry.bounds(node)
            return { ...bounds, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
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
                startEl = Array.from(currentElements.values()).find(
                    (e) => !e.disabled && e.layer === maxLayer && e.ref?.width > 0,
                )
            }
            if (startEl && startEl.ref) {
                const bounds = SpatialGeometry.bounds(startEl.ref)
                currentPos = { x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) }
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
            const bounds = SpatialGeometry.bounds(ref)

            // AABB Collision Detection against cell area
            if (SpatialGeometry.contains(bounds, { x: newX, y: newY })) {
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
                            const viewportBounds = SpatialGeometry.bounds(viewport)
                            const vTop = viewportBounds.y
                            const vBottom = viewportBounds.y + viewportBounds.height
                            const bounds = SpatialGeometry.bounds(el.ref)
                            const elTop = bounds.y
                            const elBottom = bounds.y + bounds.height

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
            if (e.name === "up") {
                navigate("up", multiplier)
                handled = true
            }
            if (e.name === "down") {
                navigate("down", multiplier)
                handled = true
            }
            if (e.name === "left") {
                navigate("left", multiplier)
                handled = true
            }
            if (e.name === "right") {
                navigate("right", multiplier)
                handled = true
            }

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
        get focusedId() {
            return focusedId()
        },
        get elements() {
            return elements()
        },
        register,
        unregister,
        focus: setFocusedId,
    }

    return <SpatialContext.Provider value={state}>{props.children}</SpatialContext.Provider>
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
            layer,
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
                        layer,
                    })
                }
            }}
        >
            {props.children(isFocused)}
        </box>
    )
}
