import { describe, expect, test } from 'bun:test'
import {
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
