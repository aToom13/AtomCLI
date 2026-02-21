/**
 * Antigravity account storage.
 * Stores OAuth refresh tokens and account metadata.
 */

import fs from "fs"
import path from "path"
import os from "os"

export interface AntigravityAccount {
    email?: string
    refreshToken: string
    projectId?: string
    addedAt: number
    lastUsed: number
}

export interface AntigravityAccountStore {
    version: number
    accounts: AntigravityAccount[]
    activeIndex: number
}

const STORE_FILENAME = "antigravity-accounts.json"

// Write lock to prevent concurrent file access
let writeLock: Promise<void> = Promise.resolve()

function getStorePath(): string {
    const configDir = path.join(os.homedir(), ".config", "atomcli")
    return path.join(configDir, STORE_FILENAME)
}

export async function loadAccounts(): Promise<AntigravityAccountStore | null> {
    try {
        const storePath = getStorePath()
        await fs.promises.access(storePath)
        const content = await fs.promises.readFile(storePath, "utf8")
        return JSON.parse(content) as AntigravityAccountStore
    } catch {
        return null
    }
}

export async function saveAccounts(store: AntigravityAccountStore): Promise<void> {
    const storePath = getStorePath()
    const dir = path.dirname(storePath)

    // Serialize writes to prevent lost updates from concurrent access
    const prev = writeLock
    writeLock = (async () => {
        await prev
        await fs.promises.mkdir(dir, { recursive: true })
        await fs.promises.writeFile(storePath, JSON.stringify(store, null, 2))
    })()
    await writeLock
}

export async function addAccount(
    refreshToken: string,
    email?: string,
    projectId?: string
): Promise<void> {
    const store = (await loadAccounts()) || { version: 1, accounts: [], activeIndex: 0 }

    const now = Date.now()

    // Check if account already exists by email or refreshToken hash
    const existingIndex = email
        ? store.accounts.findIndex((a) => a.email === email)
        : store.accounts.findIndex((a) => a.refreshToken === refreshToken)

    if (existingIndex >= 0) {
        // Update existing account
        store.accounts[existingIndex] = {
            ...store.accounts[existingIndex],
            refreshToken,
            projectId: projectId || store.accounts[existingIndex].projectId,
            lastUsed: now,
        }
    } else {
        // Add new account
        store.accounts.push({
            email,
            refreshToken,
            projectId,
            addedAt: now,
            lastUsed: now,
        })
    }

    await saveAccounts(store)
}

export async function getActiveAccount(): Promise<AntigravityAccount | null> {
    const store = await loadAccounts()
    if (!store || store.accounts.length === 0) {
        return null
    }

    const index = Math.min(store.activeIndex, store.accounts.length - 1)
    return store.accounts[index] || null
}

export async function rotateAccount(): Promise<AntigravityAccount | null> {
    const store = await loadAccounts()
    if (!store || store.accounts.length <= 1) {
        return null
    }

    store.activeIndex = (store.activeIndex + 1) % store.accounts.length
    await saveAccounts(store)

    return store.accounts[store.activeIndex] || null
}

export async function clearAccounts(): Promise<void> {
    const storePath = getStorePath()
    try {
        await fs.promises.unlink(storePath)
    } catch {
        // File doesn't exist, ignore
    }
}
