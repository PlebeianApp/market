/**
 * operation-store.ts — the wallet host's durable operation memory, in the visitor's own browser.
 *
 * ## Why this exists, and where its boundary is
 *
 * ADR-0010 makes Coco's durable operation state the authority for in-flight monetary operations and their
 * recovery material, and the wallet *host* records its own command lifecycle (the immutable command, the step
 * plan, the revision) through an injected `WalletOperationStore`. In tests the reference store
 * (`memory.ts`, `MemoryWalletOperationStore`) is correct but not durable: a reload loses it. A wallet that
 * cannot survive a reload cannot honestly claim the §2 rule that its facts are durable *before* a remote
 * boundary, so the browser path needs a store that really persists. This is it.
 *
 * It holds exactly the host's own record shape and nothing else: no proof, no token, no seed, no key. The
 * monetary authority is Coco's `ProofRepository`; this store is the host's bookkeeping, joined to Coco by the
 * command id (which is also Coco's operation id). Duplicating anything bearer here would be the "another
 * spendable-proof authority" the ADR forbids.
 *
 * ## Why it is written structurally
 *
 * Like `seed-store.ts` and `lock-authority-store.ts`, the IndexedDB surfaces are declared structurally rather
 * than taken from the DOM's `lib`. That keeps this module free of DOM types, so it loads in `bun`, a worker or
 * a page unchanged - and the browser's real `IDBFactory` satisfies the shape as-is.
 *
 * ## The compare-and-set rule
 *
 * The store interface demands that `compareAndSet` atomically reject any revision other than `expectedRevision`.
 * In this store that is honoured twice over: the store serialises its mutating calls in order (one tab cannot
 * interleave two writers across an `await`), and the IndexedDB backend performs the read-validate-write inside
 * **one** `readwrite` transaction, so a second tab writing the same command cannot slip between the read and the
 * write. A stale revision still fails closed by name (`WalletStaleWriterError`), and a changed immutable
 * identity fails closed with `WalletCommandConflictError`.
 */

import { WalletCommandConflictError, WalletStaleWriterError } from './errors'
import type { IndexedDbFactoryLike, IndexedDbRequestLike, IndexedDbStoreLike, KeyValueAreaLike } from './seed-store'
import type { WalletAccount, WalletOperationRecord, WalletOperationStore } from './types'

/** One database, one object store: the host's operation records. */
const DB_NAME = 'plebeian-wallet'
const STORE_NAME = 'wallet-operations'
const LOCAL_KEY = 'plebeian.wallet.operations.v1'

export type OperationStoreLocation = 'indexeddb' | 'localstorage' | 'memory'

/** A deep copy, so no caller and no backend can share a mutable record with another. */
const copy = (record: WalletOperationRecord): WalletOperationRecord => ({
	...record,
	account: { ...record.account },
	money: { ...record.money },
	plan: [...record.plan],
	completedSteps: [...record.completedSteps],
})

const sameAccount = (left: WalletAccount, right: WalletAccount): boolean =>
	left.accountId === right.accountId && left.environmentId === right.environmentId

const samePlan = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((step, index) => step === right[index])

/** The command's immutable identity: every field that may never change across revisions. */
const sameImmutableIdentity = (left: WalletOperationRecord, right: WalletOperationRecord): boolean =>
	left.commandId === right.commandId &&
	left.applicationId === right.applicationId &&
	left.operationKind === right.operationKind &&
	sameAccount(left.account, right.account) &&
	left.money.mintUrl === right.money.mintUrl &&
	left.money.unit === right.money.unit &&
	left.money.amount === right.money.amount &&
	left.intentFingerprint === right.intentFingerprint &&
	samePlan(left.plan, right.plan) &&
	left.createdAt === right.createdAt

/** Refuse a candidate the store may not hold: a proof, a token, a key, a seed. Bearer material is Coco's. */
const BEARER_FIELD = /^(proof|proofs|token|tokens|output|outputs|blinded|signature|signatures|seed|secret)$/i
function assertNoBearerMaterial(record: WalletOperationRecord): void {
	const fields = Object.keys(record as unknown as Record<string, unknown>)
	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index]!
		if (BEARER_FIELD.test(field)) {
			throw new Error(`refused-operation-record: this store holds no \`${field}\` - proofs, tokens and seeds live in Coco`)
		}
	}
}

/**
 * The one compare-and-set rule against a `current` record read back from storage: the revision must be exactly
 * the expected one, the immutable identity must be unchanged, and the next record must be exactly one revision
 * on. Returns the validated next record, or throws by name.
 */
function nextRevision(
	current: WalletOperationRecord | null,
	expectedRevision: number,
	next: WalletOperationRecord,
): WalletOperationRecord {
	if (current === null || current.revision !== expectedRevision) throw new WalletStaleWriterError(next.commandId)
	if (!sameImmutableIdentity(current, next)) throw new WalletCommandConflictError(next.commandId)
	if (next.revision !== expectedRevision + 1) throw new WalletStaleWriterError(next.commandId)
	return next
}

/** What every backend must do. `compareAndSet` reads, validates and writes as one step where the backend can. */
interface OperationBackend {
	readonly location: OperationStoreLocation
	all(): Promise<readonly WalletOperationRecord[]>
	read(commandId: string): Promise<WalletOperationRecord | null>
	write(record: WalletOperationRecord): Promise<void>
	createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }>
	compareAndSet(commandId: string, expectedRevision: number, next: WalletOperationRecord): Promise<WalletOperationRecord>
}

function memoryBackend(initial: readonly WalletOperationRecord[] = []): OperationBackend {
	const held = new Map<string, WalletOperationRecord>()
	for (let index = 0; index < initial.length; index += 1) {
		const record = initial[index]!
		held.set(record.commandId, copy(record))
	}
	return {
		location: 'memory',
		async all() {
			const out: WalletOperationRecord[] = []
			held.forEach((record) => out.push(copy(record)))
			return out
		},
		async read(commandId) {
			const record = held.get(commandId)
			return record === undefined ? null : copy(record)
		},
		async write(record) {
			assertNoBearerMaterial(record)
			held.set(record.commandId, copy(record))
		},
		async createOrGet(record) {
			assertNoBearerMaterial(record)
			const existing = held.get(record.commandId)
			if (existing !== undefined) return { record: copy(existing), created: false }
			const fresh = copy(record)
			held.set(record.commandId, fresh)
			return { record: copy(fresh), created: true }
		},
		async compareAndSet(commandId, expectedRevision, next) {
			const validated = nextRevision(held.get(commandId) ?? null, expectedRevision, next)
			assertNoBearerMaterial(validated)
			held.set(commandId, copy(validated))
			return copy(validated)
		},
	}
}

function localStorageBackend(area: KeyValueAreaLike): OperationBackend {
	const load = (): WalletOperationRecord[] => {
		const raw = area.getItem(LOCAL_KEY)
		if (raw === null) return []
		try {
			const parsed: unknown = JSON.parse(raw)
			return Array.isArray(parsed) ? (parsed as WalletOperationRecord[]) : []
		} catch {
			return []
		}
	}
	const writeAll = (records: readonly WalletOperationRecord[]): void => area.setItem(LOCAL_KEY, JSON.stringify(records))
	return {
		location: 'localstorage',
		async all() {
			return load().map(copy)
		},
		async read(commandId) {
			const found = load().find((record) => record.commandId === commandId)
			return found === undefined ? null : copy(found)
		},
		async write(record) {
			assertNoBearerMaterial(record)
			const kept = load().filter((existing) => existing.commandId !== record.commandId)
			kept.push(copy(record))
			writeAll(kept)
		},
		async createOrGet(record) {
			assertNoBearerMaterial(record)
			const held = load()
			const existing = held.find((candidate) => candidate.commandId === record.commandId)
			if (existing !== undefined) return { record: copy(existing), created: false }
			const fresh = copy(record)
			writeAll(held.concat([fresh]))
			return { record: copy(fresh), created: true }
		},
		async compareAndSet(commandId, expectedRevision, next) {
			const kept = load()
			const current = kept.find((record) => record.commandId === commandId) ?? null
			const validated = nextRevision(current, expectedRevision, next)
			assertNoBearerMaterial(validated)
			writeAll(kept.filter((record) => record.commandId !== commandId).concat([copy(validated)]))
			return copy(validated)
		},
	}
}

/** IndexedDB, structurally typed so this module stays free of the DOM's lib (the pattern `seed-store.ts` sets). */
function indexedDbBackend(factory: () => IndexedDbFactoryLike): OperationBackend {
	type Transaction = {
		readonly error?: unknown
		objectStore(name: string): IndexedDbStoreLike
		oncomplete: ((event?: unknown) => void) | null
		onerror: ((event?: unknown) => void) | null
		onabort: ((event?: unknown) => void) | null
	}
	const open = (): Promise<{
		readonly objectStoreNames: { contains(name: string): boolean }
		createObjectStore(name: string): unknown
		transaction(name: string, mode?: string): Transaction
		close(): void
	}> =>
		new Promise((resolve, reject) => {
			const request = factory().open(DB_NAME, 1) as unknown as IndexedDbRequestLike<{
				readonly objectStoreNames: { contains(name: string): boolean }
				createObjectStore(name: string): unknown
				transaction(name: string, mode?: string): Transaction
				close(): void
			}> & { onupgradeneeded: ((event?: unknown) => void) | null }
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
			}
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error ?? new Error('indexeddb refused to open'))
		})

	const withStore = async <T>(mode: 'readonly' | 'readwrite', run: (store: IndexedDbStoreLike) => IndexedDbRequestLike<unknown>): Promise<T> => {
		const db = await open()
		try {
			return await new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(STORE_NAME, mode)
				const request = run(transaction.objectStore(STORE_NAME))
				request.onsuccess = () => resolve(request.result as T)
				request.onerror = () => reject(request.error ?? new Error('indexeddb refused the request'))
			})
		} finally {
			db.close()
		}
	}

	return {
		location: 'indexeddb',
		async all() {
			// `getAll` is the whole store; a backend without it answers nothing rather than guessing.
			return await withStore<readonly WalletOperationRecord[]>('readonly', (store) => {
				const getAll = (store as unknown as { getAll?: () => IndexedDbRequestLike<unknown> }).getAll
				return getAll === undefined ? { result: [] as unknown, error: null } : getAll.call(store)
			})
		},
		async read(commandId) {
			const found = await withStore<WalletOperationRecord | undefined>('readonly', (store) => store.get(commandId))
			return found === undefined ? null : found
		},
		async write(record) {
			assertNoBearerMaterial(record)
			await withStore<unknown>('readwrite', (store) => store.put(copy(record), record.commandId))
		},
		async createOrGet(record) {
			assertNoBearerMaterial(record)
			const db = await open()
			try {
				return await new Promise<{ record: WalletOperationRecord; created: boolean }>((resolve, reject) => {
					const transaction = db.transaction(STORE_NAME, 'readwrite')
					const store = transaction.objectStore(STORE_NAME)
					let result: { record: WalletOperationRecord; created: boolean } | null = null
					transaction.oncomplete = () => {
						if (result === null) {
							reject(new Error('indexeddb completed create-or-get without a result'))
							return
						}
						resolve({ record: copy(result.record), created: result.created })
					}
					transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb create-or-get transaction failed'))
					transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb create-or-get transaction aborted'))
					const read = store.get(record.commandId)
					read.onsuccess = () => {
						const existing = read.result as WalletOperationRecord | undefined
						if (existing !== undefined) {
							result = { record: copy(existing), created: false }
							return
						}
						const fresh = copy(record)
						const write = store.put(fresh, fresh.commandId)
						write.onsuccess = () => {
							result = { record: copy(fresh), created: true }
						}
						write.onerror = () => reject(write.error ?? new Error('indexeddb refused the create-or-get write'))
					}
					read.onerror = () => reject(read.error ?? new Error('indexeddb refused the create-or-get read'))
				})
			} finally {
				db.close()
			}
		},
		async compareAndSet(commandId, expectedRevision, next) {
			assertNoBearerMaterial(next)
			const db = await open()
			try {
				// ONE readwrite transaction: the read, the validate and the write cannot be split by another tab.
				return await new Promise<WalletOperationRecord>((resolve, reject) => {
					const transaction = db.transaction(STORE_NAME, 'readwrite')
					const store = transaction.objectStore(STORE_NAME)
					const read = store.get(commandId)
					read.onsuccess = () => {
						let validated: WalletOperationRecord
						try {
							validated = nextRevision((read.result ?? null) as WalletOperationRecord | null, expectedRevision, next)
						} catch (error) {
							reject(error)
							return
						}
						const write = store.put(copy(validated), commandId)
						write.onsuccess = () => resolve(copy(validated))
						write.onerror = () => reject(write.error ?? new Error('indexeddb refused the write'))
					}
					read.onerror = () => reject(read.error ?? new Error('indexeddb refused the read'))
				})
			} finally {
				db.close()
			}
		},
	}
}

/**
 * The store logic, over whichever backend answered. Its mutating calls are **serialised in order**, so even the
 * non-transactional backends (localStorage, memory) cannot interleave two compare-and-set writers across an
 * `await` within this tab.
 */
function storeOver(backend: OperationBackend): WalletOperationStore {
	let tail: Promise<unknown> = Promise.resolve()
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const run = tail.then(work, work)
		tail = run.then(
			() => undefined,
			() => undefined,
		)
		return run
	}
	return {
		createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
			return serial(() => backend.createOrGet(record)).then((result) => ({ record: copy(result.record), created: result.created }))
		},
		async get(commandId: string): Promise<WalletOperationRecord | null> {
			const record = await backend.read(commandId)
			return record === null ? null : copy(record)
		},
		async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
			return (await backend.all())
				.filter((record) => !account || sameAccount(record.account, account))
				.map(copy)
		},
		compareAndSet(commandId: string, expectedRevision: number, next: WalletOperationRecord): Promise<WalletOperationRecord> {
			return serial(() => backend.compareAndSet(commandId, expectedRevision, next)).then(copy)
		},
	}
}

/**
 * The browser store: IndexedDB where it exists, localStorage where it does not, memory otherwise (a browser that
 * withheld both, and tests). It picks its backend once, on construction, and says which through `location()`.
 */
export function createBrowserWalletOperationStore(
	options: { readonly indexedDB?: (() => IndexedDbFactoryLike) | null; readonly localStorage?: KeyValueAreaLike | null } = {},
): WalletOperationStore & { location(): OperationStoreLocation } {
	const platform = globalThis as unknown as { indexedDB?: unknown; localStorage?: unknown }
	const factory: (() => IndexedDbFactoryLike) | null =
		options.indexedDB === undefined
			? typeof platform.indexedDB !== 'undefined'
				? () => platform.indexedDB as IndexedDbFactoryLike
				: null
			: options.indexedDB
	const area: KeyValueAreaLike | null =
		options.localStorage === undefined
			? typeof platform.localStorage !== 'undefined' && platform.localStorage !== null
				? (platform.localStorage as KeyValueAreaLike)
				: null
			: options.localStorage
	const backend: OperationBackend =
		factory !== null ? indexedDbBackend(factory) : area !== null ? localStorageBackend(area) : memoryBackend()
	const store = storeOver(backend)
	return Object.assign(store, { location: () => backend.location })
}
