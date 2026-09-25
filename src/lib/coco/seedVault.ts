export const COCO_SEED_VAULT_DATABASE_NAME = 'plebeian-market-coco-v2-seed-vault-v1'
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
		const request = indexedDB.open(COCO_SEED_VAULT_DATABASE_NAME, 1)
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME, { keyPath: 'scope' })
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco seed vault open failed'))
	})
}

export interface CocoSeedVaultVerification {
	roundTripVerified: boolean
	keyExtractable: boolean
	ciphertextCommitment: string
}

export const hasCocoSeedVaultRecord = async (scope: string): Promise<boolean> => {
	const database = await openVault()
	try {
		return Boolean(await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(scope)))
	} finally {
		database.close()
	}
}

const digest = async (value: ArrayBuffer): Promise<string> => {
	const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', value))
	return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Verifies persistence and non-extractability without returning seed or key material. */
export const verifyCocoSeedVaultRoundTrip = async (scope: string): Promise<Readonly<CocoSeedVaultVerification>> => {
	const first = await loadOrCreateCocoSeed(scope)
	const second = await loadOrCreateCocoSeed(scope)
	let difference = first.length ^ second.length
	for (let index = 0; index < Math.max(first.length, second.length); index++) difference |= (first[index] ?? 0) ^ (second[index] ?? 0)
	first.fill(0)
	second.fill(0)

	const database = await openVault()
	try {
		const row = (await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(scope))) as
			| CocoSeedVaultRow
			| undefined
		if (!row || row.version !== 1 || !(row.wrappingKey instanceof CryptoKey)) throw new Error('Coco seed vault record is unavailable')
		if (row.wrappingKey.algorithm.name !== 'AES-GCM' || !row.wrappingKey.usages.includes('decrypt')) {
			throw new Error('Coco seed vault wrapping key has an invalid contract')
		}
		return Object.freeze({
			roundTripVerified: difference === 0,
			keyExtractable: row.wrappingKey.extractable,
			ciphertextCommitment: await digest(row.ciphertext),
		})
	} finally {
		database.close()
	}
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
