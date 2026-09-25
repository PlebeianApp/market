import { assertMigrationControlRecordShape, type MigrationControlStore } from './store'
import { MigrationSafetyError, type MigrationControlRecord } from './model'

const DATABASE_VERSION = 1
const CONTROL_STORE = 'migrationControl'

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

function cloneRecord(record: MigrationControlRecord): Readonly<MigrationControlRecord> {
	return Object.freeze(structuredClone(record))
}

export class IndexedDbMigrationControlStore implements MigrationControlStore {
	private databasePromise: Promise<IDBDatabase> | null = null

	constructor(private readonly databaseName = 'plebeian-market-coco-v2-migration-control') {}

	async get(namespace: string): Promise<Readonly<MigrationControlRecord> | null> {
		const database = await this.open()
		const transaction = database.transaction(CONTROL_STORE, 'readonly')
		const result = await requestResult(transaction.objectStore(CONTROL_STORE).get(namespace))
		await transactionComplete(transaction)
		if (!result) return null
		assertMigrationControlRecordShape(result)
		return cloneRecord(result as MigrationControlRecord)
	}

	async create(record: Readonly<MigrationControlRecord>): Promise<Readonly<MigrationControlRecord>> {
		assertMigrationControlRecordShape(record)
		const database = await this.open()
		const transaction = database.transaction(CONTROL_STORE, 'readwrite')
		try {
			await requestResult(transaction.objectStore(CONTROL_STORE).add(structuredClone(record)))
			await transactionComplete(transaction)
			return cloneRecord(record)
		} catch (error) {
			try {
				transaction.abort()
			} catch {
				// The transaction may already have completed or aborted.
			}
			throw new MigrationSafetyError('STORAGE_FAILURE', `failed to create migration control record: ${errorMessage(error)}`)
		}
	}

	async transact(
		namespace: string,
		mutator: (current: Readonly<MigrationControlRecord>) => Readonly<MigrationControlRecord>,
	): Promise<Readonly<MigrationControlRecord>> {
		const database = await this.open()
		const transaction = database.transaction(CONTROL_STORE, 'readwrite')
		const objectStore = transaction.objectStore(CONTROL_STORE)
		try {
			const stored = (await requestResult(objectStore.get(namespace))) as MigrationControlRecord | undefined
			if (!stored) throw new MigrationSafetyError('STORAGE_FAILURE', 'control record does not exist')
			assertMigrationControlRecordShape(stored)
			const next = structuredClone(mutator(cloneRecord(stored)))
			if (next.namespace !== namespace) throw new MigrationSafetyError('STORAGE_FAILURE', 'transaction changed record namespace')
			assertMigrationControlRecordShape(next)
			await requestResult(objectStore.put(next))
			await transactionComplete(transaction)
			return cloneRecord(next)
		} catch (error) {
			try {
				transaction.abort()
			} catch {
				// The transaction may already have completed or aborted.
			}
			if (error instanceof MigrationSafetyError) throw error
			throw new MigrationSafetyError('STORAGE_FAILURE', `migration control transaction failed: ${errorMessage(error)}`)
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
				const request = indexedDB.open(this.databaseName, DATABASE_VERSION)
				request.onupgradeneeded = () => {
					const database = request.result
					if (!database.objectStoreNames.contains(CONTROL_STORE)) {
						database.createObjectStore(CONTROL_STORE, { keyPath: 'namespace' })
					}
				}
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject(request.error ?? new Error('failed to open migration database'))
			})
		}
		return this.databasePromise
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
