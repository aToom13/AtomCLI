import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  ParentProps,
  Show,
  untrack,
} from "solid-js"
import { useParams, A } from "@solidjs/router"
import { useLayout } from "@/context/layout"
import { base64Decode } from "@atomcli/util/encode"
import { ResizeHandle } from "@atomcli/ui/resize-handle"
import { Toast } from "@atomcli/ui/toast"
import { Mark } from "@atomcli/ui/logo"
import { createStore } from "solid-js/store"
import { useNotification } from "@/context/notification"

import { Sidebar } from "./layout/components/sidebar"
import { useAppUpdates } from "./layout/hooks/useAppUpdates"
import { useLayoutNotifications } from "./layout/hooks/useLayoutNotifications"
import { useProjectSessions } from "./layout/hooks/useProjectSessions"
import { useSessionPrefetch } from "./layout/hooks/useSessionPrefetch"
import { useLayoutActions } from "./layout/hooks/useLayoutActions"
import { useLayoutNavigation } from "./layout/hooks/useLayoutNavigation"
import { useLayoutCommands } from "./layout/hooks/useLayoutCommands"

export default function Layout(props: ParentProps) {
  const [store, setStore] = createStore({
    lastSession: {} as Record<string, string>,
  })

  // Viewport logic
  const xlQuery = window.matchMedia("(min-width: 1280px)")
  const [isLargeViewport, setIsLargeViewport] = createSignal(xlQuery.matches)
  const handleViewportChange = (e: MediaQueryListEvent) => setIsLargeViewport(e.matches)
  xlQuery.addEventListener("change", handleViewportChange)
  onCleanup(() => xlQuery.removeEventListener("change", handleViewportChange))

  const params = useParams()
  const layout = useLayout()
  const notification = useNotification()

  useAppUpdates()
  useLayoutNotifications()

  const { getSessions } = useProjectSessions()

  const currentProject = createMemo(() => {
    const directory = params.dir ? base64Decode(params.dir) : undefined
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })

  const currentSessions = createMemo(() => getSessions(currentProject()))

  const { prefetchSession } = useSessionPrefetch(currentSessions)

  const actions = useLayoutActions(() => store.lastSession)
  const navigation = useLayoutNavigation(currentProject, currentSessions, prefetchSession)

  useLayoutCommands({ actions, navigation, currentSessions })

  createEffect(() => {
    if (!params.dir || !params.id) return
    const directory = base64Decode(params.dir)
    const id = params.id
    setStore("lastSession", directory, id)
    notification.session.markViewed(id)
    const project = currentProject()
    untrack(() => layout.projects.expand(project?.worktree ?? directory))
    requestAnimationFrame(() => navigation.scrollToSession(id))
  })

  createEffect(() => {
    if (isLargeViewport()) {
      const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 48
      document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
    } else {
      document.documentElement.style.setProperty("--dialog-left-margin", "0px")
    }
  })

  return (
    <div class="relative flex-1 min-h-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <div class="flex-1 min-h-0 flex">
        <div
          classList={{
            "hidden xl:block": true,
            "relative shrink-0": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : "48px" }}
        >
          <div
            classList={{
              "@container w-full h-full pb-5 bg-background-base": true,
              "flex flex-col gap-5.5 items-start self-stretch justify-between": true,
              "border-r border-border-weak-base contain-strict": true,
            }}
          >
            <Sidebar actions={actions} prefetchSession={prefetchSession} containerRef={navigation.setScrollContainerRef} />
          </div>
          <Show when={layout.sidebar.opened()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.sidebar.width()}
              min={150}
              max={window.innerWidth * 0.3}
              collapseThreshold={80}
              onResize={layout.sidebar.resize}
              onCollapse={layout.sidebar.close}
            />
          </Show>
        </div>
        <div class="xl:hidden">
          <div
            classList={{
              "fixed inset-0 bg-black/50 z-40 transition-opacity duration-200": true,
              "opacity-100 pointer-events-auto": layout.mobileSidebar.opened(),
              "opacity-0 pointer-events-none": !layout.mobileSidebar.opened(),
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) layout.mobileSidebar.hide()
            }}
          />
          <div
            classList={{
              "@container fixed inset-y-0 left-0 z-50 w-72 bg-background-base border-r border-border-weak-base flex flex-col gap-5.5 items-start self-stretch justify-between pb-5 transition-transform duration-200 ease-out": true,
              "translate-x-0": layout.mobileSidebar.opened(),
              "-translate-x-full": !layout.mobileSidebar.opened(),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="border-b border-border-weak-base w-full h-12 ml-px flex items-center pl-1.75 shrink-0">
              <A
                href="/"
                class="shrink-0 h-8 flex items-center justify-start px-2 w-full"
                onClick={() => layout.mobileSidebar.hide()}
              >
                <Mark class="shrink-0" />
              </A>
            </div>
            <Sidebar mobile actions={actions} prefetchSession={prefetchSession} />
          </div>
        </div>

        <main class="size-full overflow-x-hidden flex flex-col items-start contain-strict">{props.children}</main>
      </div>
      <Toast.Region />
    </div>
  )
}
