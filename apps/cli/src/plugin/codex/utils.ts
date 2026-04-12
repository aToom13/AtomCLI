import { CLIENT_ID, ISSUER } from "./constants"

export interface PkceCodes {
    verifier: string
    challenge: string
}

export interface TokenResponse {
    id_token: string
    access_token: string
    refresh_token: string
    expires_in?: number
}

export interface IdTokenClaims {
    chatgpt_account_id?: string
    organizations?: Array<{ id: string }>
    email?: string
    "https://api.openai.com/auth"?: {
        chatgpt_account_id?: string
    }
}

export async function generatePKCE(): Promise<PkceCodes> {
    const verifier = generateRandomString(43)
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const hash = await crypto.subtle.digest("SHA-256", data)
    const challenge = base64UrlEncode(hash)
    return { verifier, challenge }
}

export function generateRandomString(length: number): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    const bytes = crypto.getRandomValues(new Uint8Array(length))
    return Array.from(bytes)
        .map((b) => chars[b % chars.length])
        .join("")
}

export function base64UrlEncode(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    const binary = String.fromCharCode(...bytes)
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function generateState(): string {
    return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
    const parts = token.split(".")
    if (parts.length !== 3) return undefined
    try {
        return JSON.parse(Buffer.from(parts[1], "base64url").toString())
    } catch {
        return undefined
    }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
    return (
        claims.chatgpt_account_id ||
        claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
        claims.organizations?.[0]?.id
    )
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
    if (tokens.id_token) {
        const claims = parseJwtClaims(tokens.id_token)
        const accountId = claims && extractAccountIdFromClaims(claims)
        if (accountId) return accountId
    }
    if (tokens.access_token) {
        const claims = parseJwtClaims(tokens.access_token)
        return claims ? extractAccountIdFromClaims(claims) : undefined
    }
    return undefined
}

export function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope: "openid profile email offline_access",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        state,
        originator: "atomcli",
    })
    return `${ISSUER}/oauth/authorize?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
    const response = await fetch(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: CLIENT_ID,
            code_verifier: pkce.verifier,
        }).toString(),
    })
    if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status}`)
    }
    return response.json()
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const response = await fetch(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: CLIENT_ID,
        }).toString(),
    })
    if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`)
    }
    return response.json()
}
