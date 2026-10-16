export type BrowserConsoleEvent = {
  id: number
  timestamp: number
  pageId: string
  type: string
  text: string
  url?: string
  line?: number
  column?: number
}

export type BrowserNetworkEvent = {
  id: number
  timestamp: number
  pageId: string
  method: string
  status?: number
  url: string
  error?: string
  resourceType: string
  duration?: number
}

export type BrowserDialogEvent = {
  id: number
  timestamp: number
  pageId: string
  type: string
  message: string
  defaultValue: string
  action: "accepted" | "dismissed"
}

export type BrowserEventFilters = {
  since?: number
  limit?: number
  urlPattern?: string
}

export const MAX_BROWSER_EVENTS = 1_000
export const DEFAULT_BROWSER_EVENT_LIMIT = 50

export function eventMatches(event: { id: number; url?: string }, filters?: BrowserEventFilters) {
  if (filters?.since !== undefined && event.id <= filters.since) return false
  if (filters?.urlPattern) {
    try {
      if (!new RegExp(filters.urlPattern, "i").test(event.url ?? "")) return false
    } catch {
      if (!(event.url ?? "").toLowerCase().includes(filters.urlPattern.toLowerCase())) return false
    }
  }
  return true
}

export function eventLimit(limit?: number) {
  return Math.max(1, Math.min(limit ?? DEFAULT_BROWSER_EVENT_LIMIT, 500))
}

export function appendBounded<T>(events: T[], event: T, max = MAX_BROWSER_EVENTS) {
  events.push(event)
  if (events.length > max) events.splice(0, events.length - max)
}
