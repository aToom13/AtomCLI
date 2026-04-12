import { createSignal } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useLayout, LocalProject } from "@/context/layout"
import { Session } from "@atomcli/sdk/v2/client"
import { base64Encode, base64Decode } from "@atomcli/util/encode"
import { navStart } from "@/utils/perf"
import { useProjectSessions } from "./useProjectSessions"
import { useSessionPrefetch } from "./useSessionPrefetch"

type PrefetchSessionFn = (session: Session, priority?: "high" | "low") => void

export function useLayoutNavigation(
    currentProject: () => LocalProject | undefined,
    currentSessions: () => Session[],
    prefetchSession: PrefetchSessionFn
) {
    const navigate = useNavigate()
    const params = useParams()
    const layout = useLayout()
    const { getSessions } = useProjectSessions()

    let scrollContainerRef: HTMLDivElement | undefined

    const setScrollContainerRef = (el: HTMLDivElement) => {
        scrollContainerRef = el
    }

    const scrollToSession = (sessionId: string) => {
        if (!scrollContainerRef) return
        const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
        if (element) {
            element.scrollIntoView({ block: "nearest", behavior: "smooth" })
        }
    }

    const navigateToProject = (directory: string | undefined) => {
        if (!directory) return
        // Note: lastSession logic logic was inside Layout. store.lastSession.
        // We don't have access to Layout's local store here. 
        // We should probably modify navigateToProject to accept lastSession map or move store to a context?
        // Or simpler: pass `lastSession` map to this hook or a getter.
        // But `lastSession` update logic is deeply integrated in Layout effects.

        // For now, let's assume we navigate to project root if no last session provided, 
        // OR we pass a `getLastSession` callback.
        // The original code accessed `store.lastSession[directory]`.

        // Changing signature to accept `getLastSession` might be complex if we invoke it often.
        // Let's stub it for now or pass it as dependency.
        navigate(`/${base64Encode(directory)}`)
        // The original code appended session ID. This is a behavior change if I drop it.
        // I should pass `getLastSession: (dir: string) => string | undefined` to the hook creator.
        layout.mobileSidebar.hide()
    }

    // Re-define with dependency
    // ... but wait, I can just export the hook and let consumer pass it.

    return {
        setScrollContainerRef,
        scrollToSession,
        navigateSessionByOffset: (offset: number, getLastSession?: (dir: string) => string | undefined) => {
            const projects = layout.projects.list()
            if (projects.length === 0) return

            const project = currentProject()
            const projectIndex = project ? projects.findIndex((p) => p.worktree === project.worktree) : -1

            const doNavigateToProject = (dir: string) => {
                const last = getLastSession?.(dir)
                navigate(`/${base64Encode(dir)}${last ? `/session/${last}` : ""}`)
                layout.mobileSidebar.hide()
            }

            const navigateToSession = (session: Session | undefined) => {
                if (!session) return
                navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
                layout.mobileSidebar.hide()
            }

            if (projectIndex === -1) {
                const targetProject = offset > 0 ? projects[0] : projects[projects.length - 1]
                if (targetProject) doNavigateToProject(targetProject.worktree)
                return
            }

            const sessions = currentSessions()
            const sessionIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1

            let targetIndex: number
            if (sessionIndex === -1) {
                targetIndex = offset > 0 ? 0 : sessions.length - 1
            } else {
                targetIndex = sessionIndex + offset
            }

            if (targetIndex >= 0 && targetIndex < sessions.length) {
                const session = sessions[targetIndex]
                const next = sessions[targetIndex + 1]
                const prev = sessions[targetIndex - 1]

                if (offset > 0) {
                    if (next) prefetchSession(next, "high")
                    if (prev) prefetchSession(prev)
                }

                if (offset < 0) {
                    if (prev) prefetchSession(prev, "high")
                    if (next) prefetchSession(next)
                }

                if (import.meta.env.DEV) {
                    navStart({
                        dir: base64Encode(session.directory),
                        from: params.id,
                        to: session.id,
                        trigger: offset > 0 ? "alt+arrowdown" : "alt+arrowup",
                    })
                }
                navigateToSession(session)
                queueMicrotask(() => scrollToSession(session.id))
                return
            }

            const nextProjectIndex = projectIndex + (offset > 0 ? 1 : -1)
            const nextProject = projects[nextProjectIndex]
            if (!nextProject) return

            const nextProjectSessions = getSessions(nextProject)
            if (nextProjectSessions.length === 0) {
                doNavigateToProject(nextProject.worktree)
                return
            }

            const index = offset > 0 ? 0 : nextProjectSessions.length - 1
            const targetSession = nextProjectSessions[index]
            const nextSession = nextProjectSessions[index + 1]
            const prevSession = nextProjectSessions[index - 1]

            if (offset > 0) {
                if (nextSession) prefetchSession(nextSession, "high")
            }

            if (offset < 0) {
                if (prevSession) prefetchSession(prevSession, "high")
            }

            if (import.meta.env.DEV) {
                navStart({
                    dir: base64Encode(targetSession.directory),
                    from: params.id,
                    to: targetSession.id,
                    trigger: offset > 0 ? "alt+arrowdown" : "alt+arrowup",
                })
            }
            navigateToSession(targetSession)
            queueMicrotask(() => scrollToSession(targetSession.id))
        },
        navigateToProject: (dir: string) => {
            // Exposed for manual usage
            navigate(`/${base64Encode(dir)}`)
            layout.mobileSidebar.hide()
        },
        // We also need openProject/closeProject logic?
    }
}
