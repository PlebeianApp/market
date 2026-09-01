import { describe, expect, test } from 'bun:test'
import {
	canTransitionAuctionBidFundingState,
	isAuctionBidFundingReclaimableState,
	isDepositPendingOrAwaitingConfirmation,
	resolveAuctionBidFundingTransition,
	resolveDepositModalCloseLifecycleState,
	shouldCancelFundingOnModalClose,
	shouldPreservePendingBidSubmissionOnDepositModalClose,
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

	// #1235 Blocking 2: a payment may have been made in invoice_created (a
	// QR payer is unobservable by the app), so closing from there is only a
	// cancel when NO deposit is in flight. With a deposit pending, the close
	// must land in a reclaimable state — see the dedicated close-semantics
	// describe blocks below.
	test.each<AuctionBidFundingLifecycleState>(['idle', 'funding_session_created'])('marks %s as canceled on close', (state) => {
		expect(shouldCancelFundingOnModalClose(state)).toBe(true)
	})

	test('invoice_created cancels on close only when no deposit is in flight', () => {
		// Pure close predicate still classifies invoice_created as cancelable…
		expect(shouldCancelFundingOnModalClose('invoice_created')).toBe(true)
		// …but the close handler routes a pending deposit to the reclaimable
		// failure state instead of funding_canceled.
		expect(resolveDepositModalCloseLifecycleState('invoice_created', 'pending')).toBe('invoice_paid_mint_failed_reclaimable')
		expect(resolveDepositModalCloseLifecycleState('invoice_created', 'awaiting_confirmation_retry')).toBe(
			'invoice_paid_mint_failed_reclaimable',
		)
		expect(resolveDepositModalCloseLifecycleState('invoice_created', 'idle')).toBe('funding_canceled')
	})
})

// #1235 Blocking 2 — close/cancel must never erase paid-or-uncertain state.
//
// A QR payer clicks Cancel/ESC/overlay while the deposit is pending or
// awaiting_confirmation_retry: a payment may have been made. The close path
// must land the lifecycle in a reclaimable state or preserve the session —
// NEVER funding_canceled with a cleared pendingBidSubmission.
describe('modal close from a state in which a payment may have been made (#1235 Blocking 2)', () => {
	test('exact sequence: close from invoice_created with a pending deposit lands reclaimable and preserves the session', () => {
		// Step 1 — the modal classifies paid-or-unknown BEFORE the parent
		// cancels the funding (handleClose → onFundingFailed → onClose).
		let state = resolveAuctionBidFundingTransition('invoice_created', 'invoice_paid_mint_failed_reclaimable')
		expect(state).toBe('invoice_paid_mint_failed_reclaimable')

		// Step 2 — handleDepositModalClose then routes the pending deposit to
		// the same reclaimable state (idempotent self-transition) instead of
		// funding_canceled, and preserves the pending submission.
		state = resolveDepositModalCloseLifecycleState(state, 'pending')
		expect(state).toBe('invoice_paid_mint_failed_reclaimable')
		expect(isAuctionBidFundingReclaimableState(state)).toBe(true)
		expect(shouldPreservePendingBidSubmissionOnDepositModalClose(state, 'pending')).toBe(true)
	})

	test('close from invoice_created with a pending deposit never lands in funding_canceled', () => {
		const state = resolveDepositModalCloseLifecycleState('invoice_created', 'pending')
		expect(state).not.toBe('funding_canceled')
		expect(isAuctionBidFundingReclaimableState(state)).toBe(true)
	})

	test('close from invoice_created with no deposit in flight still cancels and clears the submission', () => {
		const state = resolveDepositModalCloseLifecycleState('invoice_created', 'idle')
		expect(state).toBe('funding_canceled')
		expect(shouldPreservePendingBidSubmissionOnDepositModalClose('invoice_created', 'idle')).toBe(false)
	})

	test('close-ordering race: funding_canceled can be rescued into the reclaimable state', () => {
		// If the deposit store's paid-or-unknown classification arrives after
		// handleDepositModalClose already canceled the session, the table must
		// still allow landing in a reclaimable state.
		expect(canTransitionAuctionBidFundingState('funding_canceled', 'invoice_paid_mint_failed_reclaimable')).toBe(true)
		expect(canTransitionAuctionBidFundingState('funding_canceled', 'invoice_unpaid_or_expired_reclaimable')).toBe(true)
		const rescued = resolveAuctionBidFundingTransition('funding_canceled', 'invoice_paid_mint_failed_reclaimable')
		expect(rescued).toBe('invoice_paid_mint_failed_reclaimable')
		expect(isAuctionBidFundingReclaimableState(rescued)).toBe(true)
	})

	test('close from a funding_session_created with a deposit in flight preserves the session (reclaimable transition is not yet applicable)', () => {
		// No invoice has been acknowledged yet, so the lifecycle cannot claim
		// invoice_paid; the invariant allows preserving the session instead.
		const state = resolveDepositModalCloseLifecycleState('funding_session_created', 'pending')
		expect(state).toBe('funding_session_created')
		expect(shouldPreservePendingBidSubmissionOnDepositModalClose('funding_session_created', 'pending')).toBe(true)
	})

	test('invoice_created → invoice_paid_mint_failed_reclaimable is allowed (modal error/close classification)', () => {
		expect(canTransitionAuctionBidFundingState('invoice_created', 'invoice_paid_mint_failed_reclaimable')).toBe(true)
	})

	test('isDepositPendingOrAwaitingConfirmation recognizes exactly the in-flight deposit statuses', () => {
		expect(isDepositPendingOrAwaitingConfirmation('pending')).toBe(true)
		expect(isDepositPendingOrAwaitingConfirmation('awaiting_confirmation_retry')).toBe(true)
		expect(isDepositPendingOrAwaitingConfirmation('idle')).toBe(false)
		expect(isDepositPendingOrAwaitingConfirmation('success')).toBe(false)
		expect(isDepositPendingOrAwaitingConfirmation('error')).toBe(false)
		expect(isDepositPendingOrAwaitingConfirmation(null)).toBe(false)
		expect(isDepositPendingOrAwaitingConfirmation(undefined)).toBe(false)
	})
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

describe('state-transition integrity: retry and direct paths', () => {
	test('funding_canceled can retry to funding_session_created (retry after cancel)', () => {
		expect(canTransitionAuctionBidFundingState('funding_canceled', 'funding_session_created')).toBe(true)
	})

	test.each<AuctionBidFundingLifecycleState>([
		'invoice_unpaid_or_expired_reclaimable',
		'invoice_paid_mint_failed_reclaimable',
		'mint_succeeded_bid_publish_failed_reclaimable',
		'ecash_minted_pending_rules_ack',
	])('reclaimable state %s can retry to funding_session_created (retry from any failure)', (state) => {
		expect(canTransitionAuctionBidFundingState(state, 'funding_session_created')).toBe(true)
	})

	test('idle can directly transition to bid_publish_attempted (sufficient balance, no deposit needed)', () => {
		expect(canTransitionAuctionBidFundingState('idle', 'bid_publish_attempted')).toBe(true)
	})

	test('bid_published can start a new funding session (new bid after success)', () => {
		expect(canTransitionAuctionBidFundingState('bid_published', 'funding_session_created')).toBe(true)
	})

	test('funding_canceled is NOT reclaimable (canceled is distinct from failure)', () => {
		expect(isAuctionBidFundingReclaimableState('funding_canceled')).toBe(false)
	})

	test('mint_succeeded_bid_publish_failed_reclaimable can retry publish directly (skip funding_session_created)', () => {
		// Funds are already minted — retry should go straight back to bid_publish_attempted,
		// not all the way back to funding_session_created.
		expect(canTransitionAuctionBidFundingState('mint_succeeded_bid_publish_failed_reclaimable', 'bid_publish_attempted')).toBe(true)
	})
})

describe('state-transition integrity: cannot skip states', () => {
	test.each<[AuctionBidFundingLifecycleState, AuctionBidFundingLifecycleState]>([
		// idle cannot jump to funded or settled states
		['idle', 'bid_published'],
		['idle', 'ecash_minted'],
		['idle', 'payment_acknowledged'],
		['idle', 'minting_started'],
		['idle', 'invoice_created'],
		// funding_session_created cannot skip to funded/publish/settled states
		['funding_session_created', 'bid_published'],
		['funding_session_created', 'ecash_minted'],
		['funding_session_created', 'payment_acknowledged'],
		['funding_session_created', 'minting_started'],
		['funding_session_created', 'bid_publish_attempted'],
		// invoice_created cannot skip minting or publish
		['invoice_created', 'bid_published'],
		['invoice_created', 'ecash_minted'],
		['invoice_created', 'minting_started'],
		['invoice_created', 'bid_publish_attempted'],
		// payment_acknowledged cannot skip minting
		['payment_acknowledged', 'bid_published'],
		['payment_acknowledged', 'ecash_minted'],
		['payment_acknowledged', 'bid_publish_attempted'],
		// minting_started cannot skip to publish
		['minting_started', 'bid_published'],
		['minting_started', 'bid_publish_attempted'],
		// ecash_minted cannot skip to bid_published (must go through bid_publish_attempted)
		['ecash_minted', 'bid_published'],
	])('rejects invalid transition %s → %s (skips intermediate state)', (from, to) => {
		expect(canTransitionAuctionBidFundingState(from, to)).toBe(false)
	})
})

describe('canTransitionAuctionBidFundingState: self-transitions', () => {
	test.each<AuctionBidFundingLifecycleState>([
		'idle',
		'funding_session_created',
		'invoice_created',
		'payment_acknowledged',
		'minting_started',
		'ecash_minted',
		'ecash_minted_pending_rules_ack',
		'bid_publish_attempted',
		'bid_published',
		'invoice_unpaid_or_expired_reclaimable',
		'invoice_paid_mint_failed_reclaimable',
		'mint_succeeded_bid_publish_failed_reclaimable',
		'funding_canceled',
	])('allows self-transition %s → %s (no-op is safe)', (state) => {
		expect(canTransitionAuctionBidFundingState(state, state)).toBe(true)
	})
})

describe('modal close behavior: comprehensive state coverage', () => {
	test.each<AuctionBidFundingLifecycleState>([
		'payment_acknowledged',
		'minting_started',
		'ecash_minted',
		'ecash_minted_pending_rules_ack',
		'bid_publish_attempted',
		'bid_published',
		'invoice_unpaid_or_expired_reclaimable',
		'invoice_paid_mint_failed_reclaimable',
		'mint_succeeded_bid_publish_failed_reclaimable',
	])('does not cancel funding on modal close for %s', (state) => {
		expect(shouldCancelFundingOnModalClose(state)).toBe(false)
	})

	test.each<AuctionBidFundingLifecycleState>(['idle', 'funding_session_created', 'invoice_created', 'funding_canceled'])(
		'cancels funding on modal close for %s',
		(state) => {
			expect(shouldCancelFundingOnModalClose(state)).toBe(true)
		},
	)

	test.each<AuctionBidFundingLifecycleState>([
		'payment_acknowledged',
		'minting_started',
		'ecash_minted',
		'ecash_minted_pending_rules_ack',
		'bid_publish_attempted',
		'mint_succeeded_bid_publish_failed_reclaimable',
		// #1235 Blocking 2: the invoice reclaimable states are reachable
		// exactly when a payment may have been made (QR-payer close
		// classification + deposit-error classification) — the session is
		// preserved so the funding can be retried/reclaimed.
		'invoice_unpaid_or_expired_reclaimable',
		'invoice_paid_mint_failed_reclaimable',
	])('preserves pending bid submission for %s on close', (state) => {
		expect(shouldPreservePendingBidSubmissionOnModalClose(state)).toBe(true)
	})

	test.each<AuctionBidFundingLifecycleState>(['idle', 'funding_session_created', 'invoice_created', 'bid_published', 'funding_canceled'])(
		'does not preserve pending bid submission for %s on close',
		(state) => {
			expect(shouldPreservePendingBidSubmissionOnModalClose(state)).toBe(false)
		},
	)
})

describe('retryBidPublish state transitions', () => {
	test('can retry publish from mint_succeeded_bid_publish_failed_reclaimable to bid_publish_attempted', () => {
		expect(canTransitionAuctionBidFundingState('mint_succeeded_bid_publish_failed_reclaimable', 'bid_publish_attempted')).toBe(true)
	})

	test('retry path completes: bid_publish_attempted → bid_published on success', () => {
		expect(canTransitionAuctionBidFundingState('bid_publish_attempted', 'bid_published')).toBe(true)
	})

	test('retry path can fail again: bid_publish_attempted → mint_succeeded_bid_publish_failed_reclaimable', () => {
		expect(canTransitionAuctionBidFundingState('bid_publish_attempted', 'mint_succeeded_bid_publish_failed_reclaimable')).toBe(true)
	})
})
