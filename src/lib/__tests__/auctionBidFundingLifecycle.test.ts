import { describe, expect, test } from 'bun:test'
import {
	canTransitionAuctionBidFundingState,
	isAuctionBidFundingReclaimableState,
	shouldCancelFundingOnModalClose,
	shouldPreservePendingBidSubmissionOnModalClose,
	AUCTION_BID_FUNDING_RECLAIMABLE_STATES,
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

	test.each<AuctionBidFundingLifecycleState>([
		'idle',
		'funding_session_created',
		'invoice_created',
		'payment_acknowledged',
		'bid_published',
	])('%s is not reclaimable', (state) => {
		expect(isAuctionBidFundingReclaimableState(state)).toBe(false)
	})
})

describe('rules-ack gating on funded bid path', () => {
	test('ecash_minted_pending_rules_ack is a valid lifecycle state', () => {
		expect(AUCTION_BID_FUNDING_RECLAIMABLE_STATES).toContain('ecash_minted_pending_rules_ack')
	})

	test('can transition from ecash_minted to ecash_minted_pending_rules_ack', () => {
		expect(canTransitionAuctionBidFundingState('ecash_minted', 'ecash_minted_pending_rules_ack')).toBe(true)
	})

	test('can transition from ecash_minted_pending_rules_ack to bid_publish_attempted (resume after ack)', () => {
		expect(canTransitionAuctionBidFundingState('ecash_minted_pending_rules_ack', 'bid_publish_attempted')).toBe(true)
	})

	test('ecash_minted_pending_rules_ack is reclaimable (funds are minted, bid not yet published)', () => {
		expect(isAuctionBidFundingReclaimableState('ecash_minted_pending_rules_ack')).toBe(true)
	})

	test('ecash_minted_pending_rules_ack preserves pending bid submission on modal close', () => {
		expect(shouldPreservePendingBidSubmissionOnModalClose('ecash_minted_pending_rules_ack')).toBe(true)
	})

	test('ecash_minted_pending_rules_ack does not cancel funding on modal close', () => {
		expect(shouldCancelFundingOnModalClose('ecash_minted_pending_rules_ack')).toBe(false)
	})

	test('funding success with unacknowledged rules does not publish bid — stays in pending rules-ack state', () => {
		// The state machine must not allow skipping from ecash_minted_pending_rules_ack
		// directly to bid_published — it must go through bid_publish_attempted.
		expect(canTransitionAuctionBidFundingState('ecash_minted_pending_rules_ack', 'bid_published')).toBe(false)
	})

	test('funding success with acknowledged rules publishes bid — transitions through bid_publish_attempted', () => {
		// After rules ack, the pending state transitions to bid_publish_attempted,
		// which then transitions to bid_published on success.
		expect(canTransitionAuctionBidFundingState('ecash_minted_pending_rules_ack', 'bid_publish_attempted')).toBe(true)
		expect(canTransitionAuctionBidFundingState('bid_publish_attempted', 'bid_published')).toBe(true)
	})
})
