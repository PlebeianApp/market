import { isMultipartyAuthorizationReadyBundle, type MultipartyAuthorizationReadyBundle } from './multipartyAuthorizationBundle'
import {
	reconcileMultipartyActivationAuthorityRecord,
	type MultipartyActivationAuthorityRecordV1,
	type MultipartyActivationAuthorityReconciliation,
} from './multipartyActivationAuthorityState'

export const AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_NAME = 'plebeian_market_auction_multiparty_authority_v1'

export const AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_VERSION = 1

export const AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME = 'activation_authority'

const ROOT_EVENT_ID_KEY_PATH = 'root_event_id'

export class AuctionMultipartyActivationAuthorityLedgerError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyActivationAuthorityLedgerError'
		this.code = code
	}
}

const ledgerError = (code: string): AuctionMultipartyActivationAuthorityLedgerError =>
	new AuctionMultipartyActivationAuthorityLedgerError(code)

export interface MultipartyActivationAuthorityIndexedDBFactory {
	open(name: string, version?: number): IDBOpenDBRequest
}

export interface MultipartyActivationAuthorityLedgerOptions {
	/**
	 * Omit in production to use the browser global.
	 * Supplying a factory is useful for isolated test/runtime environments.
	 * `null` explicitly means persistence is unavailable and fails closed.
	 */
	readonly indexedDB?: MultipartyActivationAuthorityIndexedDBFactory | null
}

const DURABLE_MULTIPARTY_ACTIVATION_AUTHORITY: unique symbol = Symbol('auction-multiparty-durable-activation-authority')

const durableActivationAuthorityDecisions = new WeakSet<object>()

export interface DurableMultipartyActivationAuthorityDecision {
	readonly [DURABLE_MULTIPARTY_ACTIVATION_AUTHORITY]: true
	readonly status: 'activation_authority_clear' | 'activation_conflict'
	readonly changed: boolean
	readonly record: MultipartyActivationAuthorityRecordV1
}

const makeDurableDecision = (reconciliation: MultipartyActivationAuthorityReconciliation): DurableMultipartyActivationAuthorityDecision => {
	const decision: DurableMultipartyActivationAuthorityDecision = {
		[DURABLE_MULTIPARTY_ACTIVATION_AUTHORITY]: true,
		status: reconciliation.status === 'activation_conflict' ? 'activation_conflict' : 'activation_authority_clear',
		changed: reconciliation.changed,
		record: reconciliation.record,
	}

	durableActivationAuthorityDecisions.add(decision)

	return Object.freeze(decision)
}

export const isDurableMultipartyActivationAuthorityDecision = (value: unknown): value is DurableMultipartyActivationAuthorityDecision =>
	typeof value === 'object' && value !== null && durableActivationAuthorityDecisions.has(value)

export const assertDurableMultipartyActivationAuthorityDecision = (
	value: unknown,
): asserts value is DurableMultipartyActivationAuthorityDecision => {
	if (!isDurableMultipartyActivationAuthorityDecision(value)) {
		throw ledgerError('activation_authority_decision_provenance_invalid')
	}
}

export interface MultipartyActivationAuthorityLedger {
	/**
	 * Reconcile one genuine C3 authorization-ready activation observation.
	 *
	 * SECURITY BOUNDARY:
	 * A returned decision means the IndexedDB transaction containing the
	 * observation has completed. `activation_authority_clear` is NOT a
	 * complete funding decision; later gates must still establish the full
	 * auction/root, mint, Cashu and wallet requirements.
	 */
	observe(bundle: MultipartyAuthorizationReadyBundle): Promise<DurableMultipartyActivationAuthorityDecision>

	close(): Promise<void>
}

const getDefaultIndexedDB = (): MultipartyActivationAuthorityIndexedDBFactory | null =>
	typeof globalThis.indexedDB === 'undefined' ? null : globalThis.indexedDB

const normalizeFailure = (value: unknown, fallbackCode: string): Error => (value instanceof Error ? value : ledgerError(fallbackCode))

/**
 * Durable exact-root activation-authority ledger.
 *
 * Records are intentionally app-global rather than user-scoped: activation
 * equivocation is a fact about one exact signed root event, independent of
 * which local Nostr account observed it.
 *
 * There is intentionally no delete/clear API. Losing sticky conflict evidence
 * would reopen NEW-funding authority after an already-observed equivocation.
 */
export const createMultipartyActivationAuthorityLedger = (
	options: MultipartyActivationAuthorityLedgerOptions = {},
): MultipartyActivationAuthorityLedger => {
	let databasePromise: Promise<IDBDatabase> | null = null

	const resolveFactory = (): MultipartyActivationAuthorityIndexedDBFactory => {
		const factory = options.indexedDB === undefined ? getDefaultIndexedDB() : options.indexedDB

		if (factory === null) {
			throw ledgerError('activation_authority_indexeddb_unavailable')
		}

		return factory
	}

	const openDatabase = (): Promise<IDBDatabase> => {
		if (databasePromise) {
			return databasePromise
		}

		const factory = resolveFactory()

		databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
			const request = factory.open(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_NAME, AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_VERSION)

			let settled = false
			let upgradeFailure: Error | null = null

			const rejectOpen = (error: Error): void => {
				if (settled) return
				settled = true
				databasePromise = null
				reject(error)
			}

			request.onupgradeneeded = () => {
				const database = request.result

				if (!database.objectStoreNames.contains(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME)) {
					database.createObjectStore(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME, {
						keyPath: ROOT_EVENT_ID_KEY_PATH,
					})
					return
				}

				const transaction = request.transaction

				if (!transaction) {
					upgradeFailure = ledgerError('activation_authority_database_schema_invalid')
					return
				}

				const store = transaction.objectStore(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME)

				if (store.keyPath !== ROOT_EVENT_ID_KEY_PATH) {
					upgradeFailure = ledgerError('activation_authority_database_schema_invalid')
					transaction.abort()
				}
			}

			request.onerror = () => {
				rejectOpen(upgradeFailure ?? ledgerError('activation_authority_database_open_failed'))
			}

			request.onblocked = () => {
				rejectOpen(ledgerError('activation_authority_database_open_blocked'))
			}

			request.onsuccess = () => {
				const database = request.result

				if (settled) {
					database.close()
					return
				}

				if (upgradeFailure) {
					database.close()
					rejectOpen(upgradeFailure)
					return
				}

				if (!database.objectStoreNames.contains(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME)) {
					database.close()
					rejectOpen(ledgerError('activation_authority_database_schema_invalid'))
					return
				}

				try {
					const schemaTransaction = database.transaction(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME, 'readonly')

					const schemaStore = schemaTransaction.objectStore(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME)

					if (schemaStore.keyPath !== ROOT_EVENT_ID_KEY_PATH) {
						database.close()
						rejectOpen(ledgerError('activation_authority_database_schema_invalid'))
						return
					}
				} catch {
					database.close()
					rejectOpen(ledgerError('activation_authority_database_schema_invalid'))
					return
				}

				database.onversionchange = () => {
					database.close()
					databasePromise = null
				}

				settled = true
				resolve(database)
			}
		})

		return databasePromise
	}

	const reconcileCommitted = (
		database: IDBDatabase,
		rootEventId: string,
		activationEventId: string,
	): Promise<DurableMultipartyActivationAuthorityDecision> =>
		new Promise((resolve, reject) => {
			let transaction: IDBTransaction

			try {
				transaction = database.transaction(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME, 'readwrite')
			} catch {
				reject(ledgerError('activation_authority_transaction_start_failed'))
				return
			}

			const store = transaction.objectStore(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME)

			let reconciliation: MultipartyActivationAuthorityReconciliation | null = null

			let failure: unknown = null
			let finished = false

			transaction.onerror = () => {
				if (failure === null) {
					failure = ledgerError('activation_authority_transaction_failed')
				}
			}

			transaction.onabort = () => {
				if (finished) return
				finished = true

				reject(normalizeFailure(failure, 'activation_authority_transaction_aborted'))
			}

			transaction.oncomplete = () => {
				if (finished) return
				finished = true

				if (failure !== null) {
					reject(normalizeFailure(failure, 'activation_authority_transaction_failed'))
					return
				}

				if (reconciliation === null) {
					reject(ledgerError('activation_authority_transaction_incomplete'))
					return
				}

				// The durable provenance object is created ONLY after the
				// readwrite transaction completion boundary.
				resolve(makeDurableDecision(reconciliation))
			}

			let readRequest: IDBRequest<unknown>

			try {
				readRequest = store.get(rootEventId)
			} catch {
				failure = ledgerError('activation_authority_read_failed')

				try {
					transaction.abort()
				} catch {
					// onabort/onerror or the original failure remains
					// authoritative.
				}
				return
			}

			readRequest.onerror = () => {
				failure = ledgerError('activation_authority_read_failed')
			}

			readRequest.onsuccess = () => {
				const current = readRequest.result === undefined ? null : readRequest.result

				try {
					reconciliation = reconcileMultipartyActivationAuthorityRecord({
						current,
						root_event_id: rootEventId,
						activation_event_id: activationEventId,
					})
				} catch (error) {
					failure = error

					try {
						transaction.abort()
					} catch {
						// Preserve the domain validation failure.
					}
					return
				}

				if (!reconciliation.changed) {
					return
				}

				try {
					const writeRequest = store.put(reconciliation.record)

					writeRequest.onerror = () => {
						failure = ledgerError('activation_authority_write_failed')
					}
				} catch {
					failure = ledgerError('activation_authority_write_failed')

					try {
						transaction.abort()
					} catch {
						// Preserve the write failure.
					}
				}
			}
		})

	const observe = async (bundle: MultipartyAuthorizationReadyBundle): Promise<DurableMultipartyActivationAuthorityDecision> => {
		// Provenance is checked before opening or mutating storage.
		if (!isMultipartyAuthorizationReadyBundle(bundle)) {
			throw ledgerError('auth_bundle_provenance_invalid')
		}

		const rootEventId = bundle.relations.root_event_id
		const activationEventId = bundle.relations.activation_event_id

		const database = await openDatabase()

		return reconcileCommitted(database, rootEventId, activationEventId)
	}

	const close = async (): Promise<void> => {
		const current = databasePromise
		databasePromise = null

		if (!current) return

		try {
			const database = await current
			database.close()
		} catch {
			// A failed open already failed closed for callers. close() is
			// only lifecycle cleanup and must not manufacture authority.
		}
	}

	return Object.freeze({
		observe,
		close,
	})
}
