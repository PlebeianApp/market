import { describe, expect, test } from 'bun:test'
import { finalizeEvent, type VerifiedEvent } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1, devUser2 } from '@/lib/fixtures'
import { getSettlementDescriptor, getAuctionFulfillmentAuthority } from '@/lib/auction/settlementDescriptor'
import { getAuctionClaimPublicMarkerFields } from '@/lib/auctions/privateAuctionClaimMessage'
import { getAuctionOrderClassification, isAuctionOrder } from '@/queries/orders'
import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent, parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { assertAuctionOrderFixtureValid, buildAuctionClaimOrderTags, buildAuctionOrderFixture } from './index'

/**
 * Cross-event validation for the auction order fixture.
 *
 * The fixture feeds the auction order-detail E2E specs. Synthetic relay data is
 * fine, but it must be *production-valid*: green E2E on impossible relay data
 * only proves the UI reacts to events no real client would ever publish. These
 * tests push every seeded event through the same parsers production uses and
 * assert the cross-event relationships (closed auction, winning bid -> verdict,
 * path release -> real bid id, settlement -> reserve + winning bid).
 */
/** Single shared build: the fixture is deterministic for a given `now`. */
const now = Math.floor(Date.now() / 1000)
const fixture = buildAuctionOrderFixture({ now })

describe('auction order fixture is production-valid', () => {
	test('the kind-30408 listing parses and is CLOSED, not still open', () => {
		const parsed = parseAuctionEvent(fixture.auctionEvent)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return

		const auction = parsed.value
		expect(auction.endAt).toBeLessThan(now)
		expect(auction.startAt).toBeLessThan(auction.endAt)
		expect(auction.reserve).toBeGreaterThan(0)
	})

	test('the winning kind-1023 bid parses against the real auction root', () => {
		const parsedAuction = parseAuctionEvent(fixture.auctionEvent)
		const parsed = parseBidEvent(fixture.bidEvent)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok || !parsedAuction.ok) return

		const bid = parsed.value
		expect(bid.auctionRootEventId).toBe(fixture.auctionEvent.id)
		expect(bid.auctionCoordinate).toBe(fixture.itemTagValue)
		// The winning bid must be >= the reserve, otherwise the seeded
		// settlement claims a win no client would accept.
		expect(bid.amount).toBeGreaterThanOrEqual(parsedAuction.value.reserve)
	})

	test('the auditor verdict parses and names the real bid event id', () => {
		const parsed = parseValidatorVerdictEvent(fixture.verdictEvent)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.value.bidEventId).toBe(fixture.bidEvent.id)
	})

	test('the kind-1025 path release parses and references the real bid event id', () => {
		const parsed = parsePathReleaseEvent(fixture.pathReleaseEvent)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return

		const release = parsed.value
		expect(release.bidEventId).toBe(fixture.bidEvent.id)
		expect(release.auctionCoordinate).toBe(fixture.itemTagValue)
		// A placeholder bid reference ("bid_event_id_placeholder") is exactly
		// what this fixture used to seed; the real id is a 64-hex event id.
		expect(release.bidEventId).toMatch(/^[0-9a-f]{64}$/)
	})

	test('the kind-1024 settlement parses, carries close_at and pays the winning bid', () => {
		const parsed = parseSettlementEvent(fixture.settlementEvent)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return

		const settlement = parsed.value
		expect(settlement.status).toBe('settled')
		expect(settlement.closeAt).toBeGreaterThan(0)
		expect(settlement.finalAmount).toBeGreaterThanOrEqual(fixture.amount)
		expect(settlement.winningBidId).toBe(fixture.bidEvent.id)
	})

	test('the fixture advertises the settlement amount the claim order must declare', () => {
		expect(fixture.amount).toBeGreaterThanOrEqual(1000)
		expect(fixture.itemTagValue.startsWith('30408:')).toBe(true)
	})
})

/**
 * The publish-time gate (`assertAuctionOrderFixtureValid`) is what makes the
 * fixture safe to seed: it runs the SAME cross-event validators production
 * runs, so a fixture that cannot represent a real relay history throws while
 * being built instead of quietly seeding data no client would ever publish.
 */
describe('auction order fixture publish-time gate', () => {
	test('accepts the fixture it just built', () => {
		expect(() => assertAuctionOrderFixtureValid(fixture)).not.toThrow()
	})

	test('rejects an auction that is still open at validation time', () => {
		// Same events, evaluated at a clock before the auction closed: a
		// settlement cannot exist for an auction that is still running.
		const tampered = { ...fixture, now: now - 3600 }
		expect(() => assertAuctionOrderFixtureValid(tampered)).toThrow(/still open/)
	})

	test('rejects a settlement that pays less than the reserve', () => {
		const tampered = {
			...fixture,
			settlementEvent: {
				...fixture.settlementEvent,
				tags: fixture.settlementEvent.tags.map((tag) => (tag[0] === 'final_amount' ? ['final_amount', '500', ...tag.slice(2)] : tag)),
			},
		}
		expect(() => assertAuctionOrderFixtureValid(tampered)).toThrow(/below the reserve/)
	})
})

/**
 * The seeded order itself must be the canonical CLAIM order (R1/R4).
 *
 * A production-valid bid -> release -> settlement chain is necessary but not
 * sufficient: the order surface only reaches fulfillment when the claim order
 * binds to that settlement. These tests run the production descriptor over the
 * exact events `seedOrder('auction', …)` publishes, so a fixture that leaves
 * the order without a claim marker (no authority -> no Process button) fails
 * here instead of only in the browser.
 */
describe('seeded auction order reaches validated fulfillment authority', () => {
	const orderId = `claim-order-${now}`
	const claimOrder = finalizeEvent(
		{
			kind: ORDER_PROCESS_KIND,
			created_at: now,
			content: 'Auction claim',
			tags: buildAuctionClaimOrderTags(fixture, orderId),
		},
		hexToBytes(devUser2.sk),
	)

	const parsed = () => {
		const auction = parseAuctionEvent(fixture.auctionEvent)
		const bid = parseBidEvent(fixture.bidEvent)
		const verdict = parseValidatorVerdictEvent(fixture.verdictEvent)
		const release = parsePathReleaseEvent(fixture.pathReleaseEvent)
		const settlement = parseSettlementEvent(fixture.settlementEvent)
		if (!auction.ok || !bid.ok || !verdict.ok || !release.ok || !settlement.ok) {
			throw new Error('fixture events must parse — see the production-valid suite above')
		}
		return {
			auction: auction.value,
			bids: [bid.value],
			verdicts: [verdict.value],
			settlements: [settlement.value],
			pathReleases: [release.value],
		}
	}

	type DescriptorInput = Parameters<typeof getAuctionFulfillmentAuthority>[0]
	const inputWith = (claimOrders: VerifiedEvent[], currentUserPubkey: string): DescriptorInput =>
		({
			...parsed(),
			claimOrders,
			currentUserPubkey,
			now,
		}) as unknown as DescriptorInput

	test('the seeded order carries the production claim marker bound to the seeded settlement', () => {
		const marker = getAuctionClaimPublicMarkerFields({ pubkey: claimOrder.pubkey, tags: claimOrder.tags })
		expect(marker).not.toBeNull()
		expect(marker?.settlementEventId).toBe(fixture.settlementEvent.id)
		expect(marker?.auctionEventId).toBe(fixture.auctionEvent.id)
		expect(marker?.auctionCoordinates).toBe(fixture.itemTagValue)
		expect(marker?.sellerPubkey).toBe(fixture.auctionEvent.pubkey)
		expect(marker?.totalAmountSats).toBe(fixture.amount)
		// The broad presentation detector sees an auction order, and the
		// classification sees a marker — neither of which is authority on its own.
		// The classification helpers consume relay-shaped events; the fixture
		// builds nostr-tools events, so bridge the shape explicitly here rather
		// than widening the production signature.
		const asOrderEvent = (event: VerifiedEvent) => event as unknown as Parameters<typeof isAuctionOrder>[0]
		expect(isAuctionOrder(asOrderEvent(claimOrder))).toBe(true)
		const classification = getAuctionOrderClassification(asOrderEvent(claimOrder))
		expect(classification.hasClaimMarker).toBe(true)
	})

	test('seller view: the non-marker order grants NO fulfillment authority', async () => {
		const withoutMarker = finalizeEvent(
			{
				kind: ORDER_PROCESS_KIND,
				created_at: now,
				content: 'plain order',
				tags: [
					['p', devUser1.pk],
					['subject', `Order #${orderId}`],
					['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
					['order', orderId],
					['amount', String(fixture.amount)],
					['item', fixture.itemTagValue, '1'],
					['a', fixture.itemTagValue],
				],
			},
			hexToBytes(devUser2.sk),
		)
		const input = inputWith([withoutMarker], devUser1.pk)
		// The chain itself is settled — it is the missing claim that withholds authority.
		expect((await getSettlementDescriptor(input))?.phase).toBe('settled')
		expect(getAuctionFulfillmentAuthority(input).fulfillmentReady).toBe(false)
	})

	test('seller view: settlement + canonical claim is fulfillment-ready', async () => {
		const input = inputWith([claimOrder], devUser1.pk)
		expect((await getSettlementDescriptor(input))?.phase).toBe('settled')
		const authority = getAuctionFulfillmentAuthority(input)
		expect(authority.fulfillmentReady).toBe(true)
		expect(authority.claimOrderId).toBe(claimOrder.id)
		expect(authority.settlementEventId).toBe(fixture.settlementEvent.id)
	})

	test('buyer view: settlement + canonical claim is fulfillment-ready', async () => {
		const input = inputWith([claimOrder], devUser2.pk)
		expect((await getSettlementDescriptor(input))?.phase).toBe('settled')
		expect(getAuctionFulfillmentAuthority(input).fulfillmentReady).toBe(true)
	})

	test('a forged marker naming an unresolved settlement grants NO authority', async () => {
		const forged = finalizeEvent(
			{
				kind: ORDER_PROCESS_KIND,
				created_at: now,
				content: 'forged claim',
				tags: buildAuctionClaimOrderTags(fixture, orderId).map((tag) =>
					tag[0] === 'e' && tag[3] === 'settlement' ? ['e', 'f'.repeat(64), '', 'settlement'] : tag,
				),
			},
			hexToBytes(devUser2.sk),
		)
		const input = inputWith([forged], devUser1.pk)
		expect(getAuctionFulfillmentAuthority(input).fulfillmentReady).toBe(false)
	})
})
