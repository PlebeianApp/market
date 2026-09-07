import { describe, expect, test } from 'bun:test'
import { parseBidEvent } from '../schemas/auction/bidEvent'
import type { NostrEventLike } from '../nostr/eventLike'
import { AUCTION_BID_KIND } from '../auction/constants'

const BIDDER_PK = 'b'.repeat(64)
const SELLER_PK = 'a'.repeat(64)
const ROOT_EVENT_ID = '1'.repeat(64)
const BID_EVENT_ID = '2'.repeat(64)
const CHILD_PK = '02' + 'd'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)
const PROOF_Y = '02' + 'f'.repeat(64)

const buildBidEvent = (amount: string): NostrEventLike =>
	({
		id: BID_EVENT_ID,
		kind: AUCTION_BID_KIND,
		pubkey: BIDDER_PK,
		created_at: 1_500,
		content: '',
		tags: [
			['e', ROOT_EVENT_ID],
			['a', `30408:${SELLER_PK}:auction-test`],
			['p', SELLER_PK],
			['amount', amount, 'SAT'],
			['currency', 'SAT'],
			['mint', 'https://mint.test'],
			['locktime', '5700'],
			['refund_pubkey', REFUND_PK],
			['child_pubkey', CHILD_PK],
			['lock_secret', 'lock-secret-1'],
			['proof_y', PROOF_Y],
			['created_for_end_at', '2000'],
			['bid_nonce', 'nonce-1'],
			['key_scheme', 'hd_p2pk'],
			['status', 'locked'],
		],
	}) as NostrEventLike

describe('parseBidEvent amount parsing', () => {
	test('accepts a canonical integer amount', () => {
		const result = parseBidEvent(buildBidEvent('100'))

		expect(result.ok).toBe(true)
		expect(result.ok && result.value.amount).toBe(100)
	})

	test('rejects a malformed amount instead of truncating it', () => {
		const result = parseBidEvent(buildBidEvent('100abc'))

		expect(result.ok).toBe(false)
	})

	test('rejects non-canonical numeric representations', () => {
		for (const amount of ['1e308', '0x64', ' 100abc ', '-100']) {
			expect(parseBidEvent(buildBidEvent(amount)).ok).toBe(false)
		}
	})
})

// =============================================================================
// DLEQ proof (ADR-0011) parsing tests
// =============================================================================

const DLEQ_PROOF = {
	id: '00deadbeef',
	amount: 100,
	C: PROOF_Y, // compressed secp256k1 pubkey hex (66 chars, 02/03 prefix)
	e: 'aa',
	s: 'bb',
	r: 'cc',
}

const dleqTag = (proof: unknown = DLEQ_PROOF): string[] => ['dleq_proof', JSON.stringify(proof)]

describe('parseBidEvent dleq_proof parsing (ADR-0011)', () => {
	test('parses a single dleq_proof tag into dleqProofs', () => {
		const base = buildBidEvent('100')
		const event: NostrEventLike = { ...base, tags: [...base.tags, dleqTag()] }
		const result = parseBidEvent(event)

		expect(result.ok).toBe(true)
		expect(result.ok && result.value.dleqProofs).toEqual([DLEQ_PROOF])
	})

	test('parses multiple dleq_proof tags in order (parallel to lock_secret/proof_y)', () => {
		const base = buildBidEvent('300')
		const tags = [
			...base.tags.filter((t) => t[0] !== 'lock_secret' && t[0] !== 'proof_y' && t[0] !== 'amount'),
			['amount', '300', 'SAT'],
			['lock_secret', 'lock-secret-1'],
			['proof_y', PROOF_Y],
			['lock_secret', 'lock-secret-2'],
			['proof_y', '02' + '1'.repeat(64)],
			['lock_secret', 'lock-secret-3'],
			['proof_y', '02' + '2'.repeat(64)],
			dleqTag({ id: '00deadbeef', amount: 100, C: PROOF_Y, e: 'aa', s: 'bb', r: 'cc' }),
			dleqTag({ id: '00deadbeef', amount: 100, C: '02' + '1'.repeat(64), e: 'aa', s: 'bb', r: 'cc' }),
			dleqTag({ id: '00deadbeef', amount: 100, C: '02' + '2'.repeat(64), e: 'aa', s: 'bb', r: 'cc' }),
		]
		const event: NostrEventLike = { ...base, tags }
		const result = parseBidEvent(event)

		expect(result.ok).toBe(true)
		expect(result.ok && result.value.dleqProofs).toHaveLength(3)
		expect(result.ok && (result.value.dleqProofs ?? []).map((p) => p.amount)).toEqual([100, 100, 100])
	})

	test('accepts a legacy pre-rollout bid with no dleq_proof tags (grandfathered)', () => {
		const result = parseBidEvent(buildBidEvent('100'))

		expect(result.ok).toBe(true)
		expect(result.ok && result.value.dleqProofs).toEqual([])
	})

	test('rejects malformed dleq_proof JSON', () => {
		const base = buildBidEvent('100')
		const event: NostrEventLike = { ...base, tags: [...base.tags, ['dleq_proof', 'not-json']] }
		const result = parseBidEvent(event)

		expect(result.ok).toBe(false)
	})

	test('rejects dleq_proof with a non-compressed C (bad prefix)', () => {
		const base = buildBidEvent('100')
		const event: NostrEventLike = {
			...base,
			tags: [...base.tags, dleqTag({ ...DLEQ_PROOF, C: '04' + 'a'.repeat(64) })],
		}
		const result = parseBidEvent(event)

		expect(result.ok).toBe(false)
	})

	test('rejects dleq_proof with non-hex e value', () => {
		const base = buildBidEvent('100')
		const event: NostrEventLike = { ...base, tags: [...base.tags, dleqTag({ ...DLEQ_PROOF, e: 'zz' })] }
		const result = parseBidEvent(event)

		expect(result.ok).toBe(false)
	})

	test('rejects dleq_proof with a zero or negative amount', () => {
		for (const amount of [0, -1, 1.5]) {
			const base = buildBidEvent('100')
			const event: NostrEventLike = { ...base, tags: [...base.tags, dleqTag({ ...DLEQ_PROOF, amount })] }
			expect(parseBidEvent(event).ok).toBe(false)
		}
	})

	test('rejects dleq_proof with a non-hex keyset id', () => {
		const base = buildBidEvent('100')
		const event: NostrEventLike = { ...base, tags: [...base.tags, dleqTag({ ...DLEQ_PROOF, id: 'not-hex!!' })] }
		const result = parseBidEvent(event)

		expect(result.ok).toBe(false)
	})

	test('triple-parallel refine: rejects when dleq_proof count != lock_secret count', () => {
		// Two lock_secret/proof_y pairs but only ONE dleq_proof → parallel-array violation.
		const base = buildBidEvent('200')
		const tags = [
			...base.tags.filter((t) => t[0] !== 'lock_secret' && t[0] !== 'proof_y' && t[0] !== 'amount'),
			['amount', '200', 'SAT'],
			['lock_secret', 'lock-secret-1'],
			['proof_y', PROOF_Y],
			['lock_secret', 'lock-secret-2'],
			['proof_y', '02' + '1'.repeat(64)],
			dleqTag(),
		]
		const event: NostrEventLike = { ...base, tags }
		const result = parseBidEvent(event)

		expect(result.ok).toBe(false)
	})

	test('triple-parallel refine: accepts matching lock_secret/proof_y/dleq_proof counts', () => {
		const base = buildBidEvent('200')
		const tags = [
			...base.tags.filter((t) => t[0] !== 'lock_secret' && t[0] !== 'proof_y' && t[0] !== 'amount'),
			['amount', '200', 'SAT'],
			['lock_secret', 'lock-secret-1'],
			['proof_y', PROOF_Y],
			['lock_secret', 'lock-secret-2'],
			['proof_y', '02' + '1'.repeat(64)],
			dleqTag({ id: '00deadbeef', amount: 100, C: PROOF_Y, e: 'aa', s: 'bb', r: 'cc' }),
			dleqTag({ id: '00deadbeef', amount: 100, C: '02' + '1'.repeat(64), e: 'aa', s: 'bb', r: 'cc' }),
		]
		const event: NostrEventLike = { ...base, tags }
		const result = parseBidEvent(event)

		expect(result.ok).toBe(true)
		expect(result.ok && result.value.dleqProofs).toHaveLength(2)
	})
})
