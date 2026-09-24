import type { CocoAuctionAccountIdentity, CocoAuctionBidProjection, CocoAuctionBusinessStatus, CocoAuctionReference } from './types'

export interface CocoAuctionCommandRecord {
	schemaVersion: 1
	commandId: string
	operationId: string
	intentFingerprint: string
	account: CocoAuctionAccountIdentity
	auction: CocoAuctionReference
	bidderPubkey: string
	sellerPubkey: string
	sellerPublicAuthority: string
	mintUrl: string
	unit: 'sat'
	grossAmount: number
	amount: number
	locktime: number
	createdForEndAt: number
	previousBidEventId?: string
	fee?: number
	recipientPublicAuthority?: string
	refundPublicAuthority?: string
	conditionFingerprint?: string
	commitmentFingerprint?: string
	status: CocoAuctionBusinessStatus
	/** Frozen before Coco EXECUTE so a crash cannot change the logical kind-1023. */
	publicationCreatedAt?: number
	publicationEventId?: string
	revision: number
	createdAt: number
	updatedAt: number
}

export interface CocoAuctionCommandRepository {
	createOrGet(record: CocoAuctionCommandRecord): Promise<{ record: CocoAuctionCommandRecord; created: boolean }>
	get(commandId: string): Promise<CocoAuctionCommandRecord | null>
	update(commandId: string, mutate: (current: CocoAuctionCommandRecord) => CocoAuctionCommandRecord): Promise<CocoAuctionCommandRecord>
}

const clone = <T>(value: T): T => structuredClone(value)

export class MemoryCocoAuctionCommandRepository implements CocoAuctionCommandRepository {
	private readonly records = new Map<string, CocoAuctionCommandRecord>()

	async createOrGet(record: CocoAuctionCommandRecord): Promise<{ record: CocoAuctionCommandRecord; created: boolean }> {
		const existing = this.records.get(record.commandId)
		if (existing) return { record: clone(existing), created: false }
		this.records.set(record.commandId, clone(record))
		return { record: clone(record), created: true }
	}

	async get(commandId: string): Promise<CocoAuctionCommandRecord | null> {
		const record = this.records.get(commandId)
		return record ? clone(record) : null
	}

	async update(
		commandId: string,
		mutate: (current: CocoAuctionCommandRecord) => CocoAuctionCommandRecord,
	): Promise<CocoAuctionCommandRecord> {
		const current = this.records.get(commandId)
		if (!current) throw new Error('Coco Auction command does not exist')
		const next = mutate(clone(current))
		if (
			next.commandId !== current.commandId ||
			next.operationId !== current.operationId ||
			next.intentFingerprint !== current.intentFingerprint
		) {
			throw new Error('Coco Auction command identity is immutable')
		}
		this.records.set(commandId, clone(next))
		return clone(next)
	}
}

const DB_NAME = 'plebeian-market-coco-v2-auction-commands-v1'
const STORE_NAME = 'commands'

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco Auction command database request failed'))
	})

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error ?? new Error('Coco Auction command database transaction failed'))
		transaction.onabort = () => reject(transaction.error ?? new Error('Coco Auction command database transaction aborted'))
	})

const openDatabase = (): Promise<IDBDatabase> => {
	if (!globalThis.indexedDB) throw new Error('IndexedDB is required for durable Coco Auction commands')
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 2)
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'commandId' })
			if (!request.result.objectStoreNames.contains('lifecycle')) request.result.createObjectStore('lifecycle', { keyPath: 'commandId' })
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Coco Auction command database open failed'))
	})
}

export class IndexedDbCocoAuctionCommandRepository implements CocoAuctionCommandRepository {
	async createOrGet(record: CocoAuctionCommandRecord): Promise<{ record: CocoAuctionCommandRecord; created: boolean }> {
		const database = await openDatabase()
		try {
			const transaction = database.transaction(STORE_NAME, 'readwrite')
			const done = transactionDone(transaction)
			const store = transaction.objectStore(STORE_NAME)
			const existing = (await requestResult(store.get(record.commandId))) as CocoAuctionCommandRecord | undefined
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

	async get(commandId: string): Promise<CocoAuctionCommandRecord | null> {
		const database = await openDatabase()
		try {
			const value = await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(commandId))
			return (value as CocoAuctionCommandRecord | undefined) ?? null
		} finally {
			database.close()
		}
	}

	async update(
		commandId: string,
		mutate: (current: CocoAuctionCommandRecord) => CocoAuctionCommandRecord,
	): Promise<CocoAuctionCommandRecord> {
		const database = await openDatabase()
		try {
			const transaction = database.transaction(STORE_NAME, 'readwrite')
			const done = transactionDone(transaction)
			const store = transaction.objectStore(STORE_NAME)
			const current = (await requestResult(store.get(commandId))) as CocoAuctionCommandRecord | undefined
			if (!current) {
				await done
				throw new Error('Coco Auction command does not exist')
			}
			const next = mutate(current)
			if (
				next.commandId !== current.commandId ||
				next.operationId !== current.operationId ||
				next.intentFingerprint !== current.intentFingerprint
			) {
				await done
				throw new Error('Coco Auction command identity is immutable')
			}
			store.put(next)
			await done
			return next
		} finally {
			database.close()
		}
	}
}

export const projectCocoAuctionCommand = (record: CocoAuctionCommandRecord): CocoAuctionBidProjection => {
	if (
		record.fee === undefined ||
		!record.recipientPublicAuthority ||
		!record.refundPublicAuthority ||
		!record.conditionFingerprint ||
		!record.commitmentFingerprint
	) {
		throw new Error('Coco Auction command has no complete non-bearer monetary projection')
	}
	return {
		commandId: record.commandId,
		operationId: record.operationId,
		account: record.account,
		auction: record.auction,
		bidderPubkey: record.bidderPubkey,
		sellerPubkey: record.sellerPubkey,
		sellerPublicAuthority: record.sellerPublicAuthority,
		mintUrl: record.mintUrl,
		unit: record.unit,
		grossAmount: record.grossAmount,
		amount: record.amount,
		fee: record.fee,
		locktime: record.locktime,
		recipientPublicAuthority: record.recipientPublicAuthority,
		refundPublicAuthority: record.refundPublicAuthority,
		conditionFingerprint: record.conditionFingerprint,
		commitmentFingerprint: record.commitmentFingerprint,
		status: record.status,
		publicationEventId: record.publicationEventId,
	}
}
