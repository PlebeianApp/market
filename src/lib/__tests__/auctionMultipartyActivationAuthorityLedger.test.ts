import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { base64urlnopad } from '@scure/base'
import { HDKey } from '@scure/bip32'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import type { NostrEventLike } from '../nostr/eventLike'
import {
	AUCTION_MULTIPARTY_ACTIVATION_KIND,
	AUCTION_MULTIPARTY_ENTITLEMENT_BASIS,
	AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND,
	AUCTION_MULTIPARTY_ROOT_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT,
} from '../auction/multipartyAuthorization'
import { buildMultipartyAuthorizationReadyBundle, type MultipartyAuthorizationReadyBundle } from '../auction/multipartyAuthorizationBundle'
import { buildPayoutXpubPopMessage } from '../auction/multipartyAuthorizationCrypto'
import {
	AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_NAME,
	AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_VERSION,
	AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME,
	assertDurableMultipartyActivationAuthorityDecision,
	createMultipartyActivationAuthorityLedger,
	isDurableMultipartyActivationAuthorityDecision,
} from '../auction/multipartyActivationAuthorityLedger'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY, compileSourceSchedule } from '../auction/multipartySchedule'

const CREATED_AT = 1_800_000_000
const START_AT = CREATED_AT + 100
const MAX_END_AT = CREATED_AT + 3_600
const MINT = 'https://mint-a.example'

const fixedSecret = (lastByte: number): Uint8Array => {
	const secret = new Uint8Array(32)
	secret[31] = lastByte
	return secret
}

const SELLER_NOSTR_SK = fixedSecret(1)
const VALIDATOR_NOSTR_SK = fixedSecret(2)

const SELLER = getPublicKey(SELLER_NOSTR_SK)
const VALIDATOR = getPublicKey(VALIDATOR_NOSTR_SK)

const SELLER_PAYOUT = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x11))

const VALIDATOR_PAYOUT = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x22))

const requirePrivateKey = (node: HDKey): Uint8Array => {
	const privateKey = node.privateKey

	if (!privateKey) {
		throw new Error('test fixture lacks private key')
	}

	return privateKey
}

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const sortedPair = (left: string, right: string): readonly [string, string] => (left <= right ? [left, right] : [right, left])

const signEvent = (secretKey: Uint8Array, kind: number, tags: string[][], createdAt = CREATED_AT): NostrEventLike =>
	finalizeEvent(
		{
			kind,
			created_at: createdAt,
			tags,
			content: '',
		},
		secretKey,
	)

const makeCapability = (): NostrEventLike => {
	const payoutXpub = VALIDATOR_PAYOUT.publicExtendedKey

	const pop = bytesToHex(
		schnorr.sign(buildPayoutXpubPopMessage(VALIDATOR, payoutXpub), requirePrivateKey(VALIDATOR_PAYOUT), new Uint8Array(32)),
	)

	return signEvent(VALIDATOR_NOSTR_SK, AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND, [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_xpub', payoutXpub],
		['payout_xpub_pop', pop],
		['mint', MINT],
		['valid_from', String(START_AT - 10)],
		['expires_at', String(MAX_END_AT + 10)],
	])
}

const buildFixture = () => {
	const capability = makeCapability()

	const offer = signEvent(VALIDATOR_NOSTR_SK, AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND, [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_capability', capability.id],
		['allocation_bps', '0'],
		['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
		['service_contract', AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT],
		['mint', MINT],
		['valid_from', String(START_AT - 10)],
		['expires_at', String(MAX_END_AT + 10)],
	])

	const schedule = compileSourceSchedule([
		{
			role: 'validator',
			recipient_pubkey: VALIDATOR,
			payout_capability_event_id: capability.id,
			allocation_bps: 0,
			validator_offer_event_id: offer.id,
		},
	])

	const root = signEvent(SELLER_NOSTR_SK, AUCTION_MULTIPARTY_ROOT_KIND, [
		['d', 'c4b-demo'],
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_schedule_commitment', schedule.schedule_commitment],
		['payout_schedule', `b64u:${base64urlnopad.encode(schedule.canonical_bytes)}`],
		['start_at', String(START_AT)],
		['max_end_at', String(MAX_END_AT)],
		['p2pk_xpub', SELLER_PAYOUT.publicExtendedKey],
		['mint', MINT],
		['auditors', VALIDATOR],
		['auditor_quorum', '1'],
	])

	const coordinate = `${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:c4b-demo`

	const acceptance = signEvent(VALIDATOR_NOSTR_SK, AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND, [
		['e', root.id],
		['a', coordinate],
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_schedule_commitment', schedule.schedule_commitment],
		['schedule_index', '0'],
		['payout_capability', capability.id],
		['validator_offer', offer.id],
		['allocation_bps', '0'],
		['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
		['expires_at', String(MAX_END_AT + 10)],
	])

	const ready = (activationOffset: number): MultipartyAuthorizationReadyBundle => {
		const activation = signEvent(
			SELLER_NOSTR_SK,
			AUCTION_MULTIPARTY_ACTIVATION_KIND,
			[
				['e', root.id],
				['a', coordinate],
				['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
				['payout_schedule_commitment', schedule.schedule_commitment],
				['mint', MINT],
				['acceptance', '0', acceptance.id],
			],
			CREATED_AT + 20 + activationOffset,
		)

		return buildMultipartyAuthorizationReadyBundle({
			root,
			capabilities: [capability],
			offers: [offer],
			acceptances: [acceptance],
			activation,
		})
	}

	return {
		root,
		ready,
	}
}

const expectRejectedCode = async (expectedCode: string, operation: () => Promise<unknown>): Promise<void> => {
	try {
		await operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect((error as { code?: string }).code).toBe(expectedCode)
	}
}

const expectCode = (expectedCode: string, operation: () => unknown): void => {
	try {
		operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect((error as { code?: string }).code).toBe(expectedCode)
	}
}

const ensureEmptyAuthorityDatabase = async (factory: IDBFactory): Promise<void> => {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = factory.open(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_NAME, AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_VERSION)

		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME)) {
				request.result.createObjectStore(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME, {
					keyPath: 'root_event_id',
				})
			}
		}

		request.onerror = () => reject(request.error ?? new Error('fixture database open failed'))

		request.onsuccess = () => resolve(request.result)
	})

	database.close()
}

const overwriteStoredRecord = async (factory: IDBFactory, value: unknown): Promise<void> => {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = factory.open(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_NAME, AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_VERSION)

		request.onerror = () => reject(request.error ?? new Error('fixture database open failed'))

		request.onsuccess = () => resolve(request.result)
	})

	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME, 'readwrite')

		const request = transaction.objectStore(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME).put(value)

		request.onerror = () => reject(request.error ?? new Error('fixture overwrite failed'))

		transaction.onerror = () => reject(transaction.error ?? new Error('fixture transaction failed'))

		transaction.onabort = () => reject(transaction.error ?? new Error('fixture transaction aborted'))

		transaction.oncomplete = () => resolve()
	})

	database.close()
}

describe('Auction Multiparty Gate C4b durable activation authority ledger', () => {
	test('first qualifying activation is committed before durable clear authority survives restart', async () => {
		const factory = new IDBFactory()
		const fixture = buildFixture()
		const activation = fixture.ready(0)

		const ledger = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		const first = await ledger.observe(activation)

		expect(first.status).toBe('activation_authority_clear')
		expect(first.changed).toBe(true)
		expect(first.record.root_event_id).toBe(fixture.root.id)
		expect(first.record.activation_event_ids).toEqual([activation.relations.activation_event_id])
		expect(isDurableMultipartyActivationAuthorityDecision(first)).toBe(true)
		expect(Object.isFrozen(first)).toBe(true)

		await ledger.close()

		const restarted = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		const replay = await restarted.observe(activation)

		expect(replay.status).toBe('activation_authority_clear')
		expect(replay.changed).toBe(false)
		expect(replay.record).toEqual(first.record)

		await restarted.close()
	})

	test('durable authority decision provenance cannot be forged or cloned', async () => {
		const factory = new IDBFactory()
		const fixture = buildFixture()
		const ledger = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		const genuine = await ledger.observe(fixture.ready(0))

		const forged = {
			status: 'activation_authority_clear' as const,
			changed: genuine.changed,
			record: genuine.record,
		}

		const requiresDurable = (_decision: typeof genuine): void => {}

		// @ts-expect-error structural lookalike lacks C4b provenance
		requiresDurable(forged)

		expect(isDurableMultipartyActivationAuthorityDecision(forged)).toBe(false)

		expectCode('activation_authority_decision_provenance_invalid', () => assertDurableMultipartyActivationAuthorityDecision(forged))

		const cloned = { ...genuine }

		expect(isDurableMultipartyActivationAuthorityDecision(cloned)).toBe(false)

		expectCode('activation_authority_decision_provenance_invalid', () => assertDurableMultipartyActivationAuthorityDecision(cloned))

		await ledger.close()
	})

	test('second distinct qualifying activation commits sticky conflict across restart and later observations', async () => {
		const factory = new IDBFactory()
		const fixture = buildFixture()

		const activationA = fixture.ready(0)
		const activationB = fixture.ready(1)
		const activationC = fixture.ready(2)

		const ledger = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		await ledger.observe(activationA)

		const conflict = await ledger.observe(activationB)

		expect(conflict.status).toBe('activation_conflict')
		expect(conflict.changed).toBe(true)
		expect(conflict.record.activation_event_ids).toEqual(
			sortedPair(activationA.relations.activation_event_id, activationB.relations.activation_event_id),
		)

		const conflictIds = conflict.record.activation_event_ids

		await ledger.close()

		const restarted = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		const onlyA = await restarted.observe(activationA)

		expect(onlyA.status).toBe('activation_conflict')
		expect(onlyA.changed).toBe(false)
		expect(onlyA.record.activation_event_ids).toEqual(conflictIds)

		const laterC = await restarted.observe(activationC)

		expect(laterC.status).toBe('activation_conflict')
		expect(laterC.changed).toBe(false)
		expect(laterC.record.activation_event_ids).toEqual(conflictIds)

		await restarted.close()
	})

	test('concurrent distinct observations serialize without losing activation conflict', async () => {
		const factory = new IDBFactory()
		const fixture = buildFixture()

		await ensureEmptyAuthorityDatabase(factory)

		const activationA = fixture.ready(0)
		const activationB = fixture.ready(1)

		const ledgerA = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		const ledgerB = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		await Promise.all([ledgerA.observe(activationA), ledgerB.observe(activationB)])

		await ledgerA.close()
		await ledgerB.close()

		const restarted = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		const result = await restarted.observe(activationA)

		expect(result.status).toBe('activation_conflict')
		expect(result.record.activation_event_ids).toEqual(
			sortedPair(activationA.relations.activation_event_id, activationB.relations.activation_event_id),
		)

		await restarted.close()
	})

	test('malformed persisted authority record fails closed', async () => {
		const factory = new IDBFactory()
		const fixture = buildFixture()
		const activation = fixture.ready(0)

		const ledger = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		await ledger.observe(activation)
		await ledger.close()

		await overwriteStoredRecord(factory, {
			version: 2,
			root_event_id: fixture.root.id,
			activation_event_ids: [activation.relations.activation_event_id],
		})

		const restarted = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		await expectRejectedCode('activation_authority_record_version_invalid', () => restarted.observe(activation))

		await restarted.close()
	})

	test('unavailable IndexedDB fails closed', async () => {
		const fixture = buildFixture()
		const ledger = createMultipartyActivationAuthorityLedger({
			indexedDB: null,
		})

		await expectRejectedCode('activation_authority_indexeddb_unavailable', () => ledger.observe(fixture.ready(0)))
	})

	test('write failure aborts without persisting or manufacturing durable clear authority', async () => {
		const factory = new IDBFactory()
		const fixture = buildFixture()
		const activation = fixture.ready(0)

		const ledger = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		const originalPutDescriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')

		if (!originalPutDescriptor) {
			throw new Error('fake-indexeddb put descriptor unavailable')
		}

		Object.defineProperty(IDBObjectStore.prototype, 'put', {
			...originalPutDescriptor,
			value() {
				throw new Error('forced C4b durable write failure')
			},
		})

		try {
			await expectRejectedCode('activation_authority_write_failed', () => ledger.observe(activation))
		} finally {
			Object.defineProperty(IDBObjectStore.prototype, 'put', originalPutDescriptor)
		}

		// The failed transaction must have committed nothing.
		// Therefore the exact same qualifying observation is still a
		// first observation after the storage fault is removed.
		const retry = await ledger.observe(activation)

		expect(retry.status).toBe('activation_authority_clear')
		expect(retry.changed).toBe(true)
		expect(retry.record.activation_event_ids).toEqual([activation.relations.activation_event_id])

		await ledger.close()
	})

	test('forged C3 authorization-ready object is rejected before persistence access', async () => {
		const fixture = buildFixture()
		const genuine = fixture.ready(0)

		const forged = {
			status: 'authorization_ready' as const,
			relations: genuine.relations,
		}

		const requiresReady = (_bundle: MultipartyAuthorizationReadyBundle): void => {}

		// @ts-expect-error structural lookalike lacks C3 provenance
		requiresReady(forged)

		const ledger = createMultipartyActivationAuthorityLedger({
			indexedDB: null,
		})

		await expectRejectedCode('auth_bundle_provenance_invalid', () =>
			ledger.observe(forged as unknown as MultipartyAuthorizationReadyBundle),
		)
	})

	test('incompatible IndexedDB schema fails closed', async () => {
		const factory = new IDBFactory()

		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = factory.open(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_NAME, AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_DB_VERSION)

			request.onupgradeneeded = () => {
				request.result.createObjectStore(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_STORE_NAME, {
					keyPath: 'wrong_key',
				})
			}

			request.onerror = () => reject(request.error ?? new Error('fixture schema open failed'))

			request.onsuccess = () => resolve(request.result)
		})

		database.close()

		const ledger = createMultipartyActivationAuthorityLedger({
			indexedDB: factory,
		})

		await expectRejectedCode('activation_authority_database_schema_invalid', () => ledger.observe(buildFixture().ready(0)))

		await ledger.close()
	})
})
