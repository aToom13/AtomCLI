import { useGlobalSync } from "@/context/global-sync"
import { LocalProject } from "@/context/layout"
import { sortSessions } from "../utils"

export function useProjectSessions() {
    const globalSync = useGlobalSync()

    const getSessions = (project: LocalProject | undefined) => {
        if (!project) return []
        const dirs = [project.worktree, ...(project.sandboxes ?? [])]
        const stores = dirs.map((dir) => globalSync.child(dir)[0])
        const sessions = stores
            .flatMap((store) => store.session.filter((session) => session.directory === store.path.directory))
            .toSorted(sortSessions)
        return sessions.filter((s) => !s.parentID)
    }

    return { getSessions }
}
