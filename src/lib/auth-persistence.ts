/**
 * Auth state persistence using IndexedDB and sessionStorage
 * - IndexedDB: Stores authentication state permanently (when "stay logged in" is checked)
 * - sessionStorage: Stores authentication state for the current browser session only
 */

const DB_NAME = 'plebeian-market-auth'
const DB_VERSION = 1
const STORE_NAME = 'auth-state'
const AUTH_STATE_KEY = 'current-auth-state'
const SESSION_AUTH_KEY = 'session-auth-state'

export type AuthMethod = 'extension' | 'nip46' | 'private-key' | 'encrypted-private-key'

export interface PersistedAuthState {
	method: AuthMethod
	pubkey: string
	timestamp: number
	// Additional data specific to the auth method
	bunkerUrl?: string // For NIP-46
	localSignerKey?: string // For NIP-46
	encryptedKey?: string // For encrypted private key
}

/**
 * Opens or creates the IndexedDB database
 */
async function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)

		request.onerror = () => reject(request.error)
		request.onsuccess = () => resolve(request.result)

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME)
			}
		}
	})
}

/**
 * Saves the current auth state to IndexedDB (permanent storage)
 */
export async function saveAuthState(state: PersistedAuthState): Promise<void> {
	try {
		const db = await openDB()
		const transaction = db.transaction([STORE_NAME], 'readwrite')
		const store = transaction.objectStore(STORE_NAME)

		return new Promise((resolve, reject) => {
			const request = store.put(state, AUTH_STATE_KEY)
			request.onsuccess = () => resolve()
			request.onerror = () => reject(request.error)
		})
	} catch (error) {
		console.error('Failed to save auth state to IndexedDB:', error)
		throw error
	}
}

/**
 * Saves the current auth state to sessionStorage (session-only storage)
 * This data will be cleared when the browser is closed
 */
export function saveSessionAuthState(state: PersistedAuthState): void {
	try {
		sessionStorage.setItem(SESSION_AUTH_KEY, JSON.stringify(state))
	} catch (error) {
		console.error('Failed to save auth state to sessionStorage:', error)
	}
}

/**
 * Retrieves the auth state from sessionStorage (session-only storage)
 */
export function getSessionAuthState(): PersistedAuthState | null {
	try {
		const stored = sessionStorage.getItem(SESSION_AUTH_KEY)
		return stored ? JSON.parse(stored) : null
	} catch (error) {
		console.error('Failed to get auth state from sessionStorage:', error)
		return null
	}
}

/**
 * Retrieves the auth state from IndexedDB (permanent storage)
 */
export async function getAuthState(): Promise<PersistedAuthState | null> {
	try {
		const db = await openDB()
		const transaction = db.transaction([STORE_NAME], 'readonly')
		const store = transaction.objectStore(STORE_NAME)

		return new Promise((resolve, reject) => {
			const request = store.get(AUTH_STATE_KEY)
			request.onsuccess = () => resolve(request.result || null)
			request.onerror = () => reject(request.error)
		})
	} catch (error) {
		console.error('Failed to get auth state from IndexedDB:', error)
		return null
	}
}

/**
 * Clears the auth state from sessionStorage
 */
export function clearSessionAuthState(): void {
	try {
		sessionStorage.removeItem(SESSION_AUTH_KEY)
	} catch (error) {
		console.error('Failed to clear auth state from sessionStorage:', error)
	}
}

/**
 * Clears the auth state from IndexedDB
 */
export async function clearAuthState(): Promise<void> {
	try {
		const db = await openDB()
		const transaction = db.transaction([STORE_NAME], 'readwrite')
		const store = transaction.objectStore(STORE_NAME)

		return new Promise((resolve, reject) => {
			const request = store.delete(AUTH_STATE_KEY)
			request.onsuccess = () => resolve()
			request.onerror = () => reject(request.error)
		})
	} catch (error) {
		console.error('Failed to clear auth state from IndexedDB:', error)
		throw error
	}
}

/**
 * Clears all auth state from both IndexedDB and sessionStorage
 */
export async function clearAllAuthState(): Promise<void> {
	clearSessionAuthState()
	await clearAuthState()
}
