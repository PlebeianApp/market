/**
 * Regression guard for the private-claim read degradation
 * (`fetchPrivateAuctionClaimForMarker`), review 2026-09-18 N1.
 *
 * The applesauce adapter REJECTS on a subscription error, where the NDK helper
 * it replaced resolved. The read path must map that rejection onto the existing
 * `unavailable` result the UI handles — `reason: 'relay_error'` — instead of
 * throwing out of the query.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { applesauceIo } from '@/lib/nostr/io'
import { AUCTION_CLAIM_SUBJECT } from '@/lib/auctions/privateAuctionClaimMessage'
import { ORDER_MESSAGE_TYPE } from '@/lib/schemas/order'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { fetchPrivateAuctionClaimForMarker } from '../auctions'

const SELLER_PK = 'a'.repeat(64)
const BUYER_PK = 'b'.repeat(64)
const AUCTION_EVENT_ID = 'c'.repeat(64)
const SETTLEMENT_EVENT_ID = 'd'.repeat(64)

const realGetUser = applesauceIo.getUser
const realFetchEvents = applesauceIo.fetchEvents

afterEach(() => {
	applesauceIo.getUser = realGetUser
	applesauceIo.fetchEvents = realFetchEvents
})

/** A structurally valid kind-16 auction-claim public marker. */
const makeMarker = (): NostrEventLike => ({
	id: 'e'.repeat(64),
	pubkey: BUYER_PK,
	kind: 16,
	created_at: 1_700_000_000,
	content: '',
	tags: [
		['p', SELLER_PK],
		['subject', AUCTION_CLAIM_SUBJECT],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', 'order-1'],
		['amount', '50000'],
		['a', `30408:${SELLER_PK}:d-tag`],
		['e', AUCTION_EVENT_ID],
		['e', SETTLEMENT_EVENT_ID, '', 'settlement'],
	],
})

describe('fetchPrivateAuctionClaimForMarker degradation', () => {
	test('a relay error resolves to unavailable/relay_error instead of throwing', async () => {
		// The active signer is the marker's seller, so the read proceeds to the
		// relay fetch — which then rejects.
		applesauceIo.getUser = (async () => ({ pubkey: SELLER_PK })) as unknown as typeof applesauceIo.getUser
		applesauceIo.fetchEvents = (async () => {
			throw new Error('relay down')
		}) as unknown as typeof applesauceIo.fetchEvents

		const result = await fetchPrivateAuctionClaimForMarker(makeMarker())

		expect(result).toEqual({ status: 'unavailable', reason: 'relay_error' })
	})
})
