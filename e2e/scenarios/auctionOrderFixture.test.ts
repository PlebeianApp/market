import { describe, expect, test } from 'bun:test'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent, parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { buildAuctionOrderFixture } from './index'

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
describe('auction order fixture is production-valid', () => {
	const now = Math.floor(Date.now() / 1000)
	const fixture = buildAuctionOrderFixture({ now })

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
