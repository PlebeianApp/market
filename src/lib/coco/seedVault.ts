const DB_NAME = 'plebeian-market-coco-v2-seed-vault-v1'
const STORE_NAME = 'seeds'

interface CocoSeedVaultRow {
	version: 1
	scope: string
	wrappingKey: CryptoKey
	iv: ArrayBuffer
	ciphertext: ArrayBuffer
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco seed vault request failed'))
	})

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error ?? new Error('Coco seed vault transaction failed'))
		transaction.onabort = () => reject(transaction.error ?? new Error('Coco seed vault transaction aborted'))
	})

const openVault = (): Promise<IDBDatabase> => {
	if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
		throw new Error('Secure browser storage is required for the Coco wallet seed')
	}
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1)
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME, { keyPath: 'scope' })
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco seed vault open failed'))
	})
}

const decryptSeed = async (row: CocoSeedVaultRow): Promise<Uint8Array> => {
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, row.wrappingKey, row.ciphertext)
	const seed = new Uint8Array(plaintext)
	if (seed.length !== 64) throw new Error('Coco seed vault record is invalid')
	return seed
}

/**
 * Loads the account-scoped wallet seed without ever serializing it to localStorage.
 * The AES key is non-extractable and the plaintext exists only for the sealed Coco runtime.
 */
export const loadOrCreateCocoSeed = async (scope: string): Promise<Uint8Array> => {
	if (!scope || scope.trim() !== scope) throw new Error('Coco seed scope is required and exact')
	const database = await openVault()
	try {
		const existing = (await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(scope))) as
			| CocoSeedVaultRow
			| undefined
		if (existing) return decryptSeed(existing)

		const wrappingKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
		const seed = crypto.getRandomValues(new Uint8Array(64))
		const iv = crypto.getRandomValues(new Uint8Array(12))
		const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, seed)

		const transaction = database.transaction(STORE_NAME, 'readwrite')
		const done = transactionDone(transaction)
		const store = transaction.objectStore(STORE_NAME)
		const raced = (await requestResult(store.get(scope))) as CocoSeedVaultRow | undefined
		if (raced) {
			await done
			return decryptSeed(raced)
		}
		store.add({ version: 1, scope, wrappingKey, iv: iv.buffer, ciphertext } satisfies CocoSeedVaultRow)
		await done
		return seed
	} finally {
		database.close()
	}
}
