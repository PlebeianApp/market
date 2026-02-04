import { authStore } from '@/lib/stores/auth'

/**
 * Get a user-scoped storage key.
 * @param prefix The base key prefix
 * @returns The full storage key, or null if user not authenticated
 */
function getUserScopedKey(prefix: string): string | null {
	const pubkey = authStore.state.user?.pubkey
	if (!pubkey) return null
	return `${prefix}_${pubkey.slice(0, 8)}`
}

/**
 * Load JSON data from user-scoped localStorage.
 * @param prefix The base key prefix
 * @param defaultValue Default value if not found or parse fails
 */
export function loadUserData<T>(prefix: string, defaultValue: T): T {
	try {
		const key = getUserScopedKey(prefix)
		if (!key) return defaultValue

		const stored = localStorage.getItem(key)
		return stored ? JSON.parse(stored) : defaultValue
	} catch {
		return defaultValue
	}
}

/**
 * Save JSON data to user-scoped localStorage.
 * @param prefix The base key prefix
 * @param data The data to save
 */
export function saveUserData<T>(prefix: string, data: T): void {
	try {
		const key = getUserScopedKey(prefix)
		if (!key) return

		localStorage.setItem(key, JSON.stringify(data))
	} catch (e) {
		console.error(`[wallet/storage] Failed to save ${prefix}:`, e)
	}
}

/**
 * Remove user-scoped data from localStorage.
 * @param prefix The base key prefix
 */
export function removeUserData(prefix: string): void {
	try {
		const key = getUserScopedKey(prefix)
		if (!key) return

		localStorage.removeItem(key)
	} catch {
		// Silently ignore removal errors
	}
}
