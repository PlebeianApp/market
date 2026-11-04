import type { KeyValueStoragePort } from '@sdk/core/ports/storage'

/** Process-local storage. Operational state only (caches, cursors); it does not survive restarts. */
export function createMemoryKeyValueStorage(): KeyValueStoragePort {
	const entries = new Map<string, string>()
	return {
		get: async (key) => entries.get(key) ?? null,
		set: async (key, value) => {
			entries.set(key, value)
		},
		remove: async (key) => {
			entries.delete(key)
		},
	}
}

export const MAX_STORAGE_KEY_LENGTH = 256
export const MAX_STORAGE_VALUE_BYTES = 64_000

/** Prefixes every key with the extension id so extensions cannot read or overwrite each other's data. */
export function createNamespacedStorage(base: KeyValueStoragePort, extensionId: string): KeyValueStoragePort {
	const prefix = `ext:${extensionId}:`
	const keyFor = (key: string) => {
		if (typeof key !== 'string' || key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH) throw new Error('Invalid storage key')
		return `${prefix}${key}`
	}
	return {
		get: (key) => base.get(keyFor(key)),
		set: (key, value) => {
			if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_STORAGE_VALUE_BYTES) {
				return Promise.reject(new Error('Storage value exceeds the size limit'))
			}
			return base.set(keyFor(key), value)
		},
		remove: (key) => base.remove(keyFor(key)),
	}
}
