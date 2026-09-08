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
