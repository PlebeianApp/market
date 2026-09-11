import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { getAuctionCoordinatesFromOrder, getAuctionOrderAuthority, isAuctionOrder } from '@/queries/orders'
import { describeOrderSettlementStatus } from '@/components/orders/orderSettlementStatusView'
import type { SettlementDescriptor } from '@/lib/auction/settlementDescriptor'

// Mock NDKEvent for testing
const createMockOrderEvent = (tags: string[][]): NDKEvent => {
	return {
		tags,
		pubkey: 'test-pubkey',
		created_at: Math.floor(Date.now() / 1000),
		kind: 16,
		content: '',
	} as NDKEvent
}

describe('auctionOrders utilities', () => {
	describe('getAuctionCoordinatesFromOrder', () => {
		test('returns null for non-auction orders', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['item', '30402:seller-pubkey:product-id', '1'],
			])

			expect(getAuctionCoordinatesFromOrder(order)).toBeNull()
		})

		test('returns auction coordinates for valid auction orders', () => {
			const auctionCoords = '30408:seller-pubkey:auction-id'
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', auctionCoords],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(getAuctionCoordinatesFromOrder(order)).toBe(auctionCoords)
		})

		test('returns null for malformed auction coordinates', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', 'invalid-coords'],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(getAuctionCoordinatesFromOrder(order)).toBeNull()
		})

		test('works with OrderWithRelatedEvents object', () => {
			const auctionCoords = '30408:seller-pubkey:auction-id'
			const orderEvent = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', auctionCoords],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			const orderWithRelatedEvents = {
				order: orderEvent,
				paymentRequests: [],
				paymentReceipts: [],
				statusUpdates: [],
				shippingUpdates: [],
				generalMessages: [],
			}

			expect(getAuctionCoordinatesFromOrder(orderWithRelatedEvents)).toBe(auctionCoords)
		})

		test('returns null for malformed auction coordinates with wrong kind', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', '304080:seller-pubkey:not-an-auction'], // Wrong kind
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(getAuctionCoordinatesFromOrder(order)).toBeNull()
		})
	})

	describe('isAuctionOrder', () => {
		test('returns false for non-auction orders', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['item', '30402:seller-pubkey:product-id', '1'],
			])

			expect(isAuctionOrder(order)).toBe(false)
		})

		test('returns true for valid auction orders', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', '30408:seller-pubkey:auction-id'],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(isAuctionOrder(order)).toBe(true)
		})

		test('returns false for malformed auction orders', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', 'invalid-coords'],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(isAuctionOrder(order)).toBe(false)
		})

		test('works with OrderWithRelatedEvents object', () => {
			const orderEvent = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', '30408:seller-pubkey:auction-id'],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			const orderWithRelatedEvents = {
				order: orderEvent,
				paymentRequests: [],
				paymentReceipts: [],
				statusUpdates: [],
				shippingUpdates: [],
				generalMessages: [],
			}

			expect(isAuctionOrder(orderWithRelatedEvents)).toBe(true)
		})
	})
})

const makeDescriptor = (overrides: Partial<SettlementDescriptor> = {}): SettlementDescriptor => ({
	role: 'non-participant',
	phase: 'settled',
	title: 'Auction Settled',
	message: 'This auction has been settled.',
	tone: 'completed',
	icon: 'check',
	cta: null,
	bidAmount: 0,
	verifiedBadge: 'settlement',
	...overrides,
})

describe('orderSettlementStatusView', () => {
	test('null descriptor (auction not ended) maps to Awaiting Settlement', () => {
		expect(describeOrderSettlementStatus(null)).toBe('Awaiting Settlement')
	})

	test('verifying badge maps to Validating… regardless of phase', () => {
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'settlement-window-open', verifiedBadge: 'verifying' }))).toBe(
			'Validating…',
		)
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'settled', verifiedBadge: 'verifying' }))).toBe('Validating…')
	})

	test('settled phase maps to Settled', () => {
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'settled' }))).toBe('Settled')
	})

	test('reserve-not-met phase maps to Reserve Not Met', () => {
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'reserve-not-met', verifiedBadge: 'none' }))).toBe('Reserve Not Met')
	})

	test('cancelled phase maps to Cancelled', () => {
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'cancelled', verifiedBadge: 'none' }))).toBe('Cancelled')
	})

	test('closed phase maps to Settlement Event Observed', () => {
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'closed', verifiedBadge: 'none' }))).toBe('Settlement Event Observed')
	})

	test('pre-settlement phase with settlement evidence maps to Settlement Event Observed', () => {
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'settlement-window-open', verifiedBadge: 'settlement' }))).toBe(
			'Settlement Event Observed',
		)
		expect(
			describeOrderSettlementStatus(makeDescriptor({ phase: 'settlement-window-open', verifiedBadge: 'settlement-pending-redemption' })),
		).toBe('Settlement Event Observed')
	})

	test('pre-settlement phase with path-release badge maps to Path Release Observed', () => {
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'settlement-window-open', verifiedBadge: 'path-release' }))).toBe(
			'Path Release Observed',
		)
	})

	test('pre-settlement phase with no evidence maps to Awaiting Settlement', () => {
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'settlement-window-open', verifiedBadge: 'none' }))).toBe(
			'Awaiting Settlement',
		)
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'bidding-open', verifiedBadge: 'none' }))).toBe('Awaiting Settlement')
	})

	test('griefed-no-fallback phase maps to Griefed (No Fallback)', () => {
		// Terminal grief is derived from validator quorum (ADR-0004) and must be
		// representable without a path release — it is not a seller cancellation.
		expect(describeOrderSettlementStatus(makeDescriptor({ phase: 'griefed-no-fallback', verifiedBadge: 'none' }))).toBe(
			'Griefed (No Fallback)',
		)
	})
})

// Canonical auction-claim marker tags, shaped exactly as
// getAuctionClaimPublicMarkerFields() expects to parse them.
const SELLER_PK = 'b'.repeat(64)
const BUYER_PK = 'a'.repeat(64)
const AUCTION_EVENT_ID = 'c'.repeat(64)
const SETTLEMENT_EVENT_ID = 'd'.repeat(64)
const AUCTION_COORDS = `30408:${SELLER_PK}:e2e-auction-test`

const claimMarkerTags = (): string[][] => [
	['p', SELLER_PK],
	['subject', 'auction-claim'],
	['type', '1'],
	['order', 'order-1'],
	['amount', '1000'],
	['a', AUCTION_COORDS],
	['e', AUCTION_EVENT_ID],
	['e', SETTLEMENT_EVENT_ID, '', 'settlement'],
]

const orderEventWith = (tags: string[][]): NDKEvent =>
	({
		tags,
		pubkey: BUYER_PK,
		created_at: Math.floor(Date.now() / 1000),
		kind: 16,
		content: '',
	}) as unknown as NDKEvent

describe('getAuctionOrderAuthority', () => {
	test('plain auction coordinate is NOT authority without a canonical claim marker', () => {
		const authority = getAuctionOrderAuthority(orderEventWith([['a', AUCTION_COORDS]]))
		expect(authority.coordinates).toBe(AUCTION_COORDS)
		expect(authority.claimMarkerFields).toBeNull()
		expect(authority.hasCanonicalClaim).toBe(false)
	})

	test('canonical claim marker grants authority', () => {
		const authority = getAuctionOrderAuthority(orderEventWith(claimMarkerTags()))
		expect(authority.hasCanonicalClaim).toBe(true)
		expect(authority.claimMarkerFields?.orderId).toBe('order-1')
		expect(authority.claimMarkerFields?.settlementEventId).toBe(SETTLEMENT_EVENT_ID)
	})

	test('a non-auction order has neither coordinates nor authority', () => {
		const authority = getAuctionOrderAuthority(orderEventWith([['amount', '1000']]))
		expect(authority.coordinates).toBeNull()
		expect(authority.hasCanonicalClaim).toBe(false)
	})

	test('a claim marker naming a different seller than the coordinate grants no authority', () => {
		const mismatched = claimMarkerTags().map((tag) => (tag[0] === 'p' ? ['p', 'e'.repeat(64)] : tag))
		const authority = getAuctionOrderAuthority(orderEventWith(mismatched))
		expect(authority.claimMarkerFields).toBeNull()
		expect(authority.hasCanonicalClaim).toBe(false)
	})
})
