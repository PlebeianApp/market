import type { CocoAuctionAccountIdentity, CocoAuctionBusinessStatus, CocoAuctionReference } from './types'

export type CocoAuctionLifecycleKind = 'winner-release' | 'winner-receive' | 'loser-refund'

export interface CocoAuctionLifecycleRecord {
	schemaVersion: 1
	commandId: string
	kind: CocoAuctionLifecycleKind
	operationId: string
	intentFingerprint: string
	account: CocoAuctionAccountIdentity
	auction: CocoAuctionReference
	bidEventId: string
	sendOperationId: string
	pathReleaseEventId?: string
	mintUrl?: string
	unit?: 'sat'
	amount?: number
	conditionFingerprint?: string
	status: CocoAuctionBusinessStatus
	publicationCreatedAt?: number
	publicationEventId?: string
	revision: number
	createdAt: number
	updatedAt: number
}

export interface CocoAuctionLifecycleRepository {
	createOrGet(record: CocoAuctionLifecycleRecord): Promise<{ record: CocoAuctionLifecycleRecord; created: boolean }>
	get(commandId: string): Promise<CocoAuctionLifecycleRecord | null>
	update(
		commandId: string,
		mutate: (current: CocoAuctionLifecycleRecord) => CocoAuctionLifecycleRecord,
	): Promise<CocoAuctionLifecycleRecord>
}

const clone = <T>(value: T): T => structuredClone(value)

const assertIdentityUnchanged = (current: CocoAuctionLifecycleRecord, next: CocoAuctionLifecycleRecord): void => {
	if (
		next.commandId !== current.commandId ||
		next.kind !== current.kind ||
		next.operationId !== current.operationId ||
		next.intentFingerprint !== current.intentFingerprint
	) {
		throw new Error('Coco Auction lifecycle command identity is immutable')
	}
}

export class MemoryCocoAuctionLifecycleRepository implements CocoAuctionLifecycleRepository {
	private readonly records = new Map<string, CocoAuctionLifecycleRecord>()

	async createOrGet(record: CocoAuctionLifecycleRecord): Promise<{ record: CocoAuctionLifecycleRecord; created: boolean }> {
		const existing = this.records.get(record.commandId)
		if (existing) return { record: clone(existing), created: false }
		this.records.set(record.commandId, clone(record))
		return { record: clone(record), created: true }
	}

	async get(commandId: string): Promise<CocoAuctionLifecycleRecord | null> {
		const record = this.records.get(commandId)
		return record ? clone(record) : null
	}

	async update(
		commandId: string,
		mutate: (current: CocoAuctionLifecycleRecord) => CocoAuctionLifecycleRecord,
	): Promise<CocoAuctionLifecycleRecord> {
		const current = this.records.get(commandId)
		if (!current) throw new Error('Coco Auction lifecycle command does not exist')
		const next = mutate(clone(current))
		assertIdentityUnchanged(current, next)
		this.records.set(commandId, clone(next))
		return clone(next)
	}
}

const DB_NAME = 'plebeian-market-coco-v2-auction-commands-v1'
const STORE_NAME = 'lifecycle'

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco Auction lifecycle database request failed'))
	})

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error ?? new Error('Coco Auction lifecycle database transaction failed'))
		transaction.onabort = () => reject(transaction.error ?? new Error('Coco Auction lifecycle database transaction aborted'))
	})

const openDatabase = (): Promise<IDBDatabase> => {
	if (!globalThis.indexedDB) throw new Error('IndexedDB is required for durable Coco Auction commands')
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 2)
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains('commands')) request.result.createObjectStore('commands', { keyPath: 'commandId' })
			if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'commandId' })
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco Auction lifecycle database open failed'))
	})
}

export class IndexedDbCocoAuctionLifecycleRepository implements CocoAuctionLifecycleRepository {
	async createOrGet(record: CocoAuctionLifecycleRecord): Promise<{ record: CocoAuctionLifecycleRecord; created: boolean }> {
		const database = await openDatabase()
		try {
			const transaction = database.transaction(STORE_NAME, 'readwrite')
			const done = transactionDone(transaction)
			const store = transaction.objectStore(STORE_NAME)
			const existing = (await requestResult(store.get(record.commandId))) as CocoAuctionLifecycleRecord | undefined
			if (existing) {
				await done
				return { record: existing, created: false }
			}
			store.add(record)
			await done
			return { record, created: true }
		} finally {
			database.close()
		}
	}

	async get(commandId: string): Promise<CocoAuctionLifecycleRecord | null> {
		const database = await openDatabase()
		try {
			const value = await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(commandId))
			return (value as CocoAuctionLifecycleRecord | undefined) ?? null
		} finally {
			database.close()
		}
	}

	async update(
		commandId: string,
		mutate: (current: CocoAuctionLifecycleRecord) => CocoAuctionLifecycleRecord,
	): Promise<CocoAuctionLifecycleRecord> {
		const database = await openDatabase()
		try {
			const transaction = database.transaction(STORE_NAME, 'readwrite')
			const done = transactionDone(transaction)
			const store = transaction.objectStore(STORE_NAME)
			const current = (await requestResult(store.get(commandId))) as CocoAuctionLifecycleRecord | undefined
			if (!current) {
				transaction.abort()
				await done.catch(() => undefined)
				throw new Error('Coco Auction lifecycle command does not exist')
			}
			const next = mutate(current)
			assertIdentityUnchanged(current, next)
			store.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}
}
