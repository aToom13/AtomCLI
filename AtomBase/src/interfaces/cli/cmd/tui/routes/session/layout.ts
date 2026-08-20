export namespace SessionLayout {
  export const MIN_CHAT_WIDTH = 32

  export type VerticalMode = "tight" | "compact" | "normal"

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
  }

  export function mode(terminalWidth: number): "compact" | "normal" | "wide" {
    if (terminalWidth < 72) return "compact"
    if (terminalWidth < 120) return "normal"
    return "wide"
  }

  export function verticalMode(terminalHeight: number): VerticalMode {
    if (terminalHeight < 18) return "tight"
    if (terminalHeight < 30) return "compact"
    return "normal"
  }

  export function chainExpandedHeight(terminalHeight: number, contentRows: number) {
    const density = verticalMode(terminalHeight)
    const cap =
      density === "normal"
        ? Math.max(7, Math.min(20, Math.floor(terminalHeight * 0.45)))
        : Math.max(2, Math.min(8, Math.floor(terminalHeight * 0.28)))
    // Normal mode has one row of padding on both sides; every mode also
    // consumes one row for the expanded panel's bottom border.
    const chromeRows = density === "normal" ? 3 : 1
    const minimum = density === "normal" ? Math.min(7, cap) : Math.min(2, cap)
    return clamp(contentRows + chromeRows, minimum, cap)
  }

  export function chainListViewportRows(terminalHeight: number, expandedHeight: number) {
    const chromeRows = verticalMode(terminalHeight) === "normal" ? 3 : 1
    return Math.max(1, expandedHeight - chromeRows)
  }

  export function chainNeedsScrollbar(terminalHeight: number, expandedHeight: number, contentRows: number) {
    return contentRows > chainListViewportRows(terminalHeight, expandedHeight)
  }

  /** ScrollBox applies flexDirection to its root, where the scrollbar lives. */
  export const chainScrollContentOptions = { flexDirection: "column" as const }

  /** Avoid rendering task numbers twice when a generated name is already enumerated. */
  export function chainStepLabel(name: string) {
    return name.replace(/^\s*\d+[.)]\s+/, "").trim()
  }

  /**
   * Keep each task-plan entry on one terminal row. The row also contains its
   * numeric prefix, status icon, and optional badges; those must be reserved
   * before truncating the task name or a long label silently consumes another
   * viewport row and hides later tasks behind the scrollbar.
   */
  export function chainStepNameWidth(listWidth: number, index: number, badgeWidth = 0) {
    const horizontalPadding = 3
    const selectionPrefix = 2
    const numberedStatusPrefix = String(index + 1).length + 5
    return Math.max(8, listWidth - horizontalPadding - selectionPrefix - numberedStatusPrefix - badgeWidth)
  }

  export function fileTreeWidth(terminalWidth: number, expanded: boolean) {
    if (!expanded || terminalWidth < MIN_CHAT_WIDTH + 22) return 3
    return clamp(Math.floor(terminalWidth * 0.22), 18, 28)
  }

  export function inspectorWidth(terminalWidth: number, visible: boolean, inline: boolean) {
    if (!visible) return 0
    const desired = clamp(Math.floor(terminalWidth * 0.24), 30, 42)
    if (!inline) return Math.min(desired, Math.max(1, terminalWidth - 2))
    return desired
  }

  export function agentPanelWidth(terminalWidth: number, occupiedWidth: number, visible: boolean) {
    if (!visible) return 0
    const desired =
      terminalWidth < 90 ? 22 : terminalWidth < 120 ? 28 : terminalWidth < 150 ? 36 : terminalWidth < 180 ? 46 : 54
    const available = terminalWidth - occupiedWidth - MIN_CHAT_WIDTH - 4
    return available >= 18 ? Math.min(desired, available) : 0
  }

  export function codePanelWidth(terminalWidth: number, occupiedWidth: number, visible: boolean) {
    if (!visible) return 0
    const desired = clamp(Math.floor(terminalWidth * 0.36), 24, 56)
    const available = terminalWidth - occupiedWidth - MIN_CHAT_WIDTH - 4
    return available >= 20 ? Math.min(desired, available) : 0
  }

  export function chatWidth(terminalWidth: number, ...occupiedWidths: number[]) {
    return Math.max(1, terminalWidth - occupiedWidths.reduce((sum, width) => sum + width, 0) - 4)
  }
}
