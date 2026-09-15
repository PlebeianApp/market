import { describe, expect, test } from 'bun:test'
import {
	AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_MAX_EVENT_IDS,
	AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_RECORD_VERSION,
	AuctionMultipartyActivationAuthorityStateError,
	parseMultipartyActivationAuthorityRecord,
	reconcileMultipartyActivationAuthorityRecord,
} from '../auction/multipartyActivationAuthorityState'

const A = '11'.repeat(32)
const B = '22'.repeat(32)
const C = '33'.repeat(32)
const ROOT = 'aa'.repeat(32)
const OTHER_ROOT = 'bb'.repeat(32)

const expectCode = (expectedCode: string, operation: () => unknown): void => {
	try {
		operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyActivationAuthorityStateError)
		expect((error as AuctionMultipartyActivationAuthorityStateError).code).toBe(expectedCode)
	}
}

describe('Auction Multiparty Gate C4a activation authority state', () => {
	test('first qualifying activation creates single-activation durable candidate', () => {
		const result = reconcileMultipartyActivationAuthorityRecord({
			current: null,
			root_event_id: ROOT,
			activation_event_id: A,
		})

		expect(result.status).toBe('single_activation')
		expect(result.changed).toBe(true)
		expect(result.record).toEqual({
			version: 1,
			root_event_id: ROOT,
			activation_event_ids: [A],
		})
	})

	test('exact activation replay is idempotent', () => {
		const first = reconcileMultipartyActivationAuthorityRecord({
			current: null,
			root_event_id: ROOT,
			activation_event_id: A,
		})

		const replay = reconcileMultipartyActivationAuthorityRecord({
			current: first.record,
			root_event_id: ROOT,
			activation_event_id: A,
		})

		expect(replay.status).toBe('single_activation')
		expect(replay.changed).toBe(false)
		expect(replay.record).toEqual(first.record)
	})

	test('second distinct activation creates sticky conflict', () => {
		const first = reconcileMultipartyActivationAuthorityRecord({
			current: null,
			root_event_id: ROOT,
			activation_event_id: A,
		})

		const conflict = reconcileMultipartyActivationAuthorityRecord({
			current: first.record,
			root_event_id: ROOT,
			activation_event_id: B,
		})

		expect(conflict.status).toBe('activation_conflict')
		expect(conflict.changed).toBe(true)
		expect(conflict.record.activation_event_ids).toEqual([A, B])
	})

	test('conflict evidence is canonical regardless of first observation order', () => {
		const fromA = reconcileMultipartyActivationAuthorityRecord({
			current: reconcileMultipartyActivationAuthorityRecord({
				current: null,
				root_event_id: ROOT,
				activation_event_id: A,
			}).record,
			root_event_id: ROOT,
			activation_event_id: B,
		})

		const fromB = reconcileMultipartyActivationAuthorityRecord({
			current: reconcileMultipartyActivationAuthorityRecord({
				current: null,
				root_event_id: ROOT,
				activation_event_id: B,
			}).record,
			root_event_id: ROOT,
			activation_event_id: A,
		})

		expect(fromA.record).toEqual(fromB.record)
		expect(fromA.record.activation_event_ids).toEqual([A, B])
	})

	test('established conflict cannot be cleared or replaced by later observations', () => {
		const conflict = {
			version: 1,
			root_event_id: ROOT,
			activation_event_ids: [A, B],
		}

		const later = reconcileMultipartyActivationAuthorityRecord({
			current: conflict,
			root_event_id: ROOT,
			activation_event_id: C,
		})

		expect(later.status).toBe('activation_conflict')
		expect(later.changed).toBe(false)
		expect(later.record.activation_event_ids).toEqual([A, B])
	})

	test('stored record for another exact root fails closed', () => {
		expectCode('activation_authority_root_mismatch', () =>
			reconcileMultipartyActivationAuthorityRecord({
				current: {
					version: 1,
					root_event_id: OTHER_ROOT,
					activation_event_ids: [A],
				},
				root_event_id: ROOT,
				activation_event_id: A,
			}),
		)
	})

	test('malformed persisted records fail closed', () => {
		expectCode('activation_authority_record_version_invalid', () =>
			parseMultipartyActivationAuthorityRecord({
				version: 2,
				root_event_id: ROOT,
				activation_event_ids: [A],
			}),
		)

		expectCode('activation_authority_duplicate_activation_event_id', () =>
			parseMultipartyActivationAuthorityRecord({
				version: 1,
				root_event_id: ROOT,
				activation_event_ids: [A, A],
			}),
		)

		expectCode('activation_authority_event_ids_noncanonical', () =>
			parseMultipartyActivationAuthorityRecord({
				version: 1,
				root_event_id: ROOT,
				activation_event_ids: [B, A],
			}),
		)

		expectCode('activation_authority_event_ids_invalid', () =>
			parseMultipartyActivationAuthorityRecord({
				version: 1,
				root_event_id: ROOT,
				activation_event_ids: [A, B, C],
			}),
		)

		expectCode('activation_authority_record_shape_invalid', () =>
			parseMultipartyActivationAuthorityRecord({
				version: 1,
				root_event_id: ROOT,
				activation_event_ids: [A],
				extra: true,
			}),
		)
	})

	test('observation identifiers must be canonical lowercase event ids', () => {
		expectCode('activation_authority_root_event_id_invalid', () =>
			reconcileMultipartyActivationAuthorityRecord({
				current: null,
				root_event_id: ROOT.toUpperCase(),
				activation_event_id: A,
			}),
		)

		expectCode('activation_authority_activation_event_id_invalid', () =>
			reconcileMultipartyActivationAuthorityRecord({
				current: null,
				root_event_id: ROOT,
				activation_event_id: 'not-an-event-id',
			}),
		)
	})

	test('normalized authority state is deeply immutable and bounded', () => {
		expect(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_RECORD_VERSION).toBe(1)

		expect(AUCTION_MULTIPARTY_ACTIVATION_AUTHORITY_MAX_EVENT_IDS).toBe(2)

		const parsed = parseMultipartyActivationAuthorityRecord({
			version: 1,
			root_event_id: ROOT,
			activation_event_ids: [A, B],
		})

		expect(Object.isFrozen(parsed)).toBe(true)
		expect(Object.isFrozen(parsed.activation_event_ids)).toBe(true)
	})
})
