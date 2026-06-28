/**
 * Storage persistence — prevents the browser from evicting our IndexedDB/SQLite data.
 *
 * Browsers may evict IndexedDB/Origin Private File System data under storage
 * pressure. Calling navigator.storage.persist() requests a durable-storage
 * guarantee, preventing eviction.
 *
 * STATUS: NOT YET CONNECTED — utility functions ready for wiring.
 */

export interface StorageInfo {
	usage: number
	quota: number
	percent: number
}

/**
 * Request persistent storage to prevent browser eviction of the relay database.
 *
 * Should be called after first user interaction (e.g., login, page focus)
 * because most browsers require a user gesture before granting persistence.
 *
 * @returns true if storage is (or was already) persistent
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !('storage' in navigator)) {
		console.warn('Storage API not available')
		return false
	}

	if (!navigator.storage?.persist) {
		console.warn('navigator.storage.persist not available')
		return false
	}

	// Already persistent?
	const isPersisted = await navigator.storage.persisted()
	if (isPersisted) {
		console.log('📦 Browser relay storage already persistent')
		return true
	}

	const granted = await navigator.storage.persist()
	console.log(granted ? '✅ Browser relay storage persisted' : '⚠️ Storage persistence denied')
	return granted
}

/**
 * Get the current storage usage and quota estimate.
 *
 * @returns usage in bytes, quota in bytes, and percentage used
 */
export async function getStorageEstimate(): Promise<StorageInfo> {
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
		return { usage: 0, quota: 0, percent: 0 }
	}

	const estimate = await navigator.storage.estimate()
	const usage = estimate.usage ?? 0
	const quota = estimate.quota ?? 0

	return {
		usage,
		quota,
		percent: quota > 0 ? (usage / quota) * 100 : 0,
	}
}
