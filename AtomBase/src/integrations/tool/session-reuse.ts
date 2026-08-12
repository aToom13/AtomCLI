/**
 * Sub-agent session reuse guard.
 *
 * A caller-controlled sessionId must only continue a session created by that
 * same parent — otherwise a sub-agent could be resumed inside an unrelated
 * session's context (cross-session context leak). Extracted as a pure function
 * so the security rule is unit-testable without the full Session module.
 */
export namespace SessionReuse {
  export function isAllowed(
    session: { id?: string; parentID?: string } | null | undefined,
    parentSessionID: string,
  ): boolean {
    return session !== null && session !== undefined && session.parentID === parentSessionID
  }
}
