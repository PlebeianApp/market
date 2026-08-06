import { describe, expect, test } from 'bun:test'
import {
	canTransitionAuctionBidFundingState,
	isAuctionBidFundingReclaimableState,
	shouldCancelFundingOnModalClose,
	shouldPreservePendingBidSubmissionOnModalClose,
	type AuctionBidFundingLifecycleState,
} from '@/hooks/useAuctionBidFunding'

describe('auction bid funding modal close lifecycle', () => {
	test.each<AuctionBidFundingLifecycleState>(['payment_acknowledged', 'minting_started', 'ecash_minted', 'bid_publish_attempted'])(
		'does not mark %s as canceled on close',
		(state) => {
			expect(shouldCancelFundingOnModalClose(state)).toBe(false)
		},
	)

	test.each<AuctionBidFundingLifecycleState>([
		'payment_acknowledged',
		'minting_started',
		'ecash_minted',
		'bid_publish_attempted',
		'mint_succeeded_bid_publish_failed_reclaimable',
	])('preserves pending bid submission for %s on close', (state) => {
		expect(shouldPreservePendingBidSubmissionOnModalClose(state)).toBe(true)
	})

	test.each<AuctionBidFundingLifecycleState>(['idle', 'funding_session_created', 'invoice_created'])(
		'marks %s as canceled on close',
		(state) => {
			expect(shouldCancelFundingOnModalClose(state)).toBe(true)
		},
	)
})

describe('auction bid funding state machine integrity', () => {
	test('models invoice timeout/unpaid as reclaimable terminal state', () => {
		expect(canTransitionAuctionBidFundingState('idle', 'funding_session_created')).toBe(true)
		expect(canTransitionAuctionBidFundingState('funding_session_created', 'invoice_created')).toBe(true)
		expect(canTransitionAuctionBidFundingState('invoice_created', 'invoice_unpaid_or_expired_reclaimable')).toBe(true)
		expect(isAuctionBidFundingReclaimableState('invoice_unpaid_or_expired_reclaimable')).toBe(true)
	})

	test('models invoice-paid-but-mint-failed as reclaimable terminal state', () => {
		expect(canTransitionAuctionBidFundingState('invoice_created', 'payment_acknowledged')).toBe(true)
		expect(canTransitionAuctionBidFundingState('payment_acknowledged', 'minting_started')).toBe(true)
		expect(canTransitionAuctionBidFundingState('minting_started', 'invoice_paid_mint_failed_reclaimable')).toBe(true)
		expect(isAuctionBidFundingReclaimableState('invoice_paid_mint_failed_reclaimable')).toBe(true)
	})

	test('models mint-success-but-publish-failed, then user-confirmed retry', () => {
		expect(canTransitionAuctionBidFundingState('minting_started', 'ecash_minted')).toBe(true)
		expect(canTransitionAuctionBidFundingState('ecash_minted', 'bid_publish_attempted')).toBe(true)
		expect(canTransitionAuctionBidFundingState('bid_publish_attempted', 'mint_succeeded_bid_publish_failed_reclaimable')).toBe(true)
		expect(isAuctionBidFundingReclaimableState('mint_succeeded_bid_publish_failed_reclaimable')).toBe(true)

		// User confirms retry from the reclaimable publish-failed state.
		expect(canTransitionAuctionBidFundingState('mint_succeeded_bid_publish_failed_reclaimable', 'bid_publish_attempted')).toBe(true)
		expect(canTransitionAuctionBidFundingState('bid_publish_attempted', 'bid_published')).toBe(true)
	})

	test('publish-failed reclaimable state preserves pending bid on modal close', () => {
		expect(shouldCancelFundingOnModalClose('mint_succeeded_bid_publish_failed_reclaimable')).toBe(false)
		expect(shouldPreservePendingBidSubmissionOnModalClose('mint_succeeded_bid_publish_failed_reclaimable')).toBe(true)
	})

	test('rejects invalid transition that skips payment acknowledgment', () => {
		expect(canTransitionAuctionBidFundingState('invoice_created', 'ecash_minted')).toBe(false)
	})

	test('rejects invalid transition from idle directly to settled state', () => {
		expect(canTransitionAuctionBidFundingState('idle', 'bid_published')).toBe(false)
	})

	test.each<AuctionBidFundingLifecycleState>([
		'invoice_unpaid_or_expired_reclaimable',
		'invoice_paid_mint_failed_reclaimable',
		'mint_succeeded_bid_publish_failed_reclaimable',
	])('%s is reclaimable', (state) => {
		expect(isAuctionBidFundingReclaimableState(state)).toBe(true)
	})

	test.each<AuctionBidFundingLifecycleState>(['idle', 'funding_session_created', 'invoice_created', 'payment_acknowledged', 'bid_published'])(
		'%s is not reclaimable',
		(state) => {
			expect(isAuctionBidFundingReclaimableState(state)).toBe(false)
		},
	)
})
