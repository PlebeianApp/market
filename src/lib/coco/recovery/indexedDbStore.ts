import { MigrationSafetyError } from '../migration/model'
import { createRecoveryMetadata, type RecoveryMetadata, type RecoveryMetadataStore } from './metadata'

const STORE_NAME = 'recoveryMetadata'
const NAMESPACE_INDEX = 'walletNamespace'

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
	})
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
		transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
	})
}

export class IndexedDbRecoveryMetadataStore implements RecoveryMetadataStore {
	private databasePromise: Promise<IDBDatabase> | null = null

	constructor(private readonly databaseName = 'plebeian-market-coco-v2-recovery-metadata') {}

	async get(walletNamespace: string, id: string): Promise<Readonly<RecoveryMetadata> | null> {
		const database = await this.open()
		const transaction = database.transaction(STORE_NAME, 'readonly')
		const result = await requestResult(transaction.objectStore(STORE_NAME).get([walletNamespace, id]))
		await transactionComplete(transaction)
		return result ? createRecoveryMetadata(result) : null
	}

	async list(walletNamespace: string): Promise<readonly Readonly<RecoveryMetadata>[]> {
		const database = await this.open()
		const transaction = database.transaction(STORE_NAME, 'readonly')
		const results = await requestResult(transaction.objectStore(STORE_NAME).index(NAMESPACE_INDEX).getAll(walletNamespace))
		await transactionComplete(transaction)
		return Object.freeze(results.map((result) => createRecoveryMetadata(result)))
	}

	async put(metadata: Readonly<RecoveryMetadata>): Promise<void> {
		const normalized = createRecoveryMetadata(metadata)
		const database = await this.open()
		const transaction = database.transaction(STORE_NAME, 'readwrite')
		try {
			await requestResult(transaction.objectStore(STORE_NAME).put(structuredClone(normalized)))
			await transactionComplete(transaction)
		} catch (error) {
			try {
				transaction.abort()
			} catch {
				// The transaction may already have completed or aborted.
			}
			throw new MigrationSafetyError(
				'STORAGE_FAILURE',
				`failed to persist recovery metadata: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	close(): void {
		void this.databasePromise?.then((database) => database.close())
		this.databasePromise = null
	}

	private open(): Promise<IDBDatabase> {
		if (!this.databasePromise) {
			this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
				if (typeof indexedDB === 'undefined') {
					reject(new MigrationSafetyError('STORAGE_FAILURE', 'IndexedDB is unavailable'))
					return
				}
				const request = indexedDB.open(this.databaseName, 1)
				request.onupgradeneeded = () => {
					const database = request.result
					if (!database.objectStoreNames.contains(STORE_NAME)) {
						const store = database.createObjectStore(STORE_NAME, { keyPath: ['walletNamespace', 'id'] })
						store.createIndex(NAMESPACE_INDEX, 'walletNamespace', { unique: false })
					}
				}
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject(request.error ?? new Error('failed to open recovery metadata database'))
			})
		}
		return this.databasePromise
	}
}
