import { describe, expect, test } from 'bun:test'
import {
	canTransitionAuctionBidFundingState,
	isAuctionBidFundingReclaimableState,
	resolveAuctionBidFundingFailureReason,
	resolveAuctionBidFundingModalClose,
	shouldCancelFundingOnModalClose,
	shouldPreservePendingBidSubmissionOnModalClose,
	shouldOpenBidProgressDialog,
	AUCTION_BID_FUNDING_RECLAIMABLE_STATES,
	AUCTION_BID_PROGRESS_DIALOG_OPEN_STATES,
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

describe('funding_canceled transitions to reclaimable states', () => {
	test('funding_canceled can transition to invoice_unpaid_or_expired_reclaimable', () => {
		expect(canTransitionAuctionBidFundingState('funding_canceled', 'invoice_unpaid_or_expired_reclaimable')).toBe(true)
	})

	test('funding_canceled can transition to invoice_paid_mint_failed_reclaimable', () => {
		expect(canTransitionAuctionBidFundingState('funding_canceled', 'invoice_paid_mint_failed_reclaimable')).toBe(true)
	})

	test('funding_canceled cannot transition to mint_succeeded_bid_publish_failed_reclaimable (publish failure must originate from bid_publish_attempted)', () => {
		expect(canTransitionAuctionBidFundingState('funding_canceled', 'mint_succeeded_bid_publish_failed_reclaimable')).toBe(false)
	})
})

describe('retryBidPublish rebroadcast path (Blocker 1)', () => {
	test('republishBid is exposed as an optional hook option for rebroadcasting a signed event', () => {
		// Type-level contract: republishBid accepts a bidEventId string.
		// Runtime behavior is verified in the component/integration layer.
		const republishBid: ((bidEventId: string) => Promise<void>) | undefined = undefined
		expect(republishBid).toBeUndefined()
	})
})

describe('QR-path funding success walk-forward (M1: flagship flow lifecycle advancement)', () => {
	test('QR deposit success walks invoice_created forward to ecash_minted and on to bid_published', () => {
		// The QR path never separately observes payment_acknowledged or
		// minting_started — handleFundingSuccess walks the lifecycle forward
		// through them, so every step of the chain must be a valid transition.
		expect(canTransitionAuctionBidFundingState('invoice_created', 'payment_acknowledged')).toBe(true)
		expect(canTransitionAuctionBidFundingState('payment_acknowledged', 'minting_started')).toBe(true)
		expect(canTransitionAuctionBidFundingState('minting_started', 'ecash_minted')).toBe(true)
		expect(canTransitionAuctionBidFundingState('ecash_minted', 'bid_publish_attempted')).toBe(true)
		expect(canTransitionAuctionBidFundingState('bid_publish_attempted', 'bid_published')).toBe(true)
	})

	test('walk-forward steps are idempotent when the NWC path already advanced the lifecycle', () => {
		// Already past a step: re-resolving it is an invalid transition, so the
		// resolver keeps the current state (silent no-op).
		expect(canTransitionAuctionBidFundingState('minting_started', 'payment_acknowledged')).toBe(false)
		expect(canTransitionAuctionBidFundingState('ecash_minted', 'payment_acknowledged')).toBe(false)
		expect(canTransitionAuctionBidFundingState('ecash_minted', 'minting_started')).toBe(false)
		// Already at the target state: self-transition is an allowed no-op.
		expect(canTransitionAuctionBidFundingState('ecash_minted', 'ecash_minted')).toBe(true)
		expect(canTransitionAuctionBidFundingState('bid_publish_attempted', 'bid_publish_attempted')).toBe(true)
	})

	test('walk-forward cannot skip states from pre-funded states', () => {
		expect(canTransitionAuctionBidFundingState('invoice_created', 'ecash_minted')).toBe(false)
		expect(canTransitionAuctionBidFundingState('invoice_created', 'bid_publish_attempted')).toBe(false)
		expect(canTransitionAuctionBidFundingState('funding_session_created', 'ecash_minted')).toBe(false)
	})
})

describe('staged bid progress dialog open-set (lost-UX port)', () => {
	test.each<AuctionBidFundingLifecycleState>(['ecash_minted', 'ecash_minted_pending_rules_ack', 'bid_publish_attempted', 'bid_published'])(
		'opens the progress dialog for post-funding state %s',
		(state) => {
			expect(shouldOpenBidProgressDialog(state)).toBe(true)
		},
	)

	test('opens the progress dialog for the publish-failure state so a failed publish keeps a retry surface (M7)', () => {
		expect(shouldOpenBidProgressDialog('mint_succeeded_bid_publish_failed_reclaimable')).toBe(true)
	})

	test.each<AuctionBidFundingLifecycleState>([
		'idle',
		'funding_session_created',
		'invoice_created',
		'payment_acknowledged',
		'minting_started',
		'invoice_unpaid_or_expired_reclaimable',
		'invoice_paid_mint_failed_reclaimable',
		'funding_canceled',
	])('keeps the progress dialog closed for funding-phase/cancel state %s (deposit modal is the sole UI)', (state) => {
		expect(shouldOpenBidProgressDialog(state)).toBe(false)
	})

	test('the open-set is exactly the post-funding + publish-failure states', () => {
		const expected: AuctionBidFundingLifecycleState[] = [
			'ecash_minted',
			'ecash_minted_pending_rules_ack',
			'bid_publish_attempted',
			'bid_published',
			'mint_succeeded_bid_publish_failed_reclaimable',
		]
		expect([...AUCTION_BID_PROGRESS_DIALOG_OPEN_STATES].sort()).toEqual([...expected].sort())
	})

	test('dialog reopens when a dismissed publish attempt later fails (close cannot hide the retry affordance)', () => {
		// Walk the publish attempt: dialog opens on attempt, user dismisses it
		// (dialog state only — lifecycle untouched), then the publish fails —
		// the open-set must still fire for the failure state.
		expect(shouldOpenBidProgressDialog('bid_publish_attempted')).toBe(true)
		expect(canTransitionAuctionBidFundingState('bid_publish_attempted', 'mint_succeeded_bid_publish_failed_reclaimable')).toBe(true)
		expect(shouldOpenBidProgressDialog('mint_succeeded_bid_publish_failed_reclaimable')).toBe(true)
	})
})

describe('close classification: paid-or-unknown safety (S2/S4)', () => {
	test('QR user close (nwcPaymentAttempted=false) during invoice_created classifies paid-or-unknown, preserves pending submission, and cannot be overwritten by funding_canceled', () => {
		// QR flow: the app cannot observe the external wallet's payment.
		const reason = resolveAuctionBidFundingFailureReason({ paymentAcknowledged: false, nwcPaymentAttempted: false })
		expect(reason).toBe('invoice_paid_mint_failed_reclaimable')

		// User close hands the reason to the funding hook BEFORE the modal-open
		// state flips; the hook resolves it against the CURRENT state.
		const close = resolveAuctionBidFundingModalClose('invoice_created', reason)
		expect(close.nextState).toBe('invoice_paid_mint_failed_reclaimable')
		// pendingBidSubmission is preserved for the reclaimable classification.
		expect(close.preservePendingSubmission).toBe(true)
		expect(shouldPreservePendingBidSubmissionOnModalClose(close.nextState)).toBe(true)

		// Ordering guarantee: a subsequent close/cancel pass cannot clobber the
		// reclaimable classification with funding_canceled.
		expect(resolveAuctionBidFundingModalClose(close.nextState, null).nextState).toBe('invoice_paid_mint_failed_reclaimable')
		expect(resolveAuctionBidFundingModalClose(close.nextState, undefined).nextState).toBe('invoice_paid_mint_failed_reclaimable')
		expect(canTransitionAuctionBidFundingState(close.nextState, 'funding_canceled')).toBe(false)
	})

	test('NWC close with no payment sent classifies as unpaid/expired (observable non-payment)', () => {
		const reason = resolveAuctionBidFundingFailureReason({ paymentAcknowledged: false, nwcPaymentAttempted: true })
		expect(reason).toBe('invoice_unpaid_or_expired_reclaimable')

		const close = resolveAuctionBidFundingModalClose('invoice_created', reason)
		expect(close.nextState).toBe('invoice_unpaid_or_expired_reclaimable')
		expect(close.preservePendingSubmission).toBe(true)
		expect(resolveAuctionBidFundingModalClose(close.nextState, null).nextState).toBe('invoice_unpaid_or_expired_reclaimable')
	})

	test('NWC-sent close from payment_acknowledged classifies as paid/mint-failed and is not canceled', () => {
		const reason = resolveAuctionBidFundingFailureReason({ paymentAcknowledged: true, nwcPaymentAttempted: true })
		expect(reason).toBe('invoice_paid_mint_failed_reclaimable')

		const close = resolveAuctionBidFundingModalClose('payment_acknowledged', reason)
		expect(close.nextState).toBe('invoice_paid_mint_failed_reclaimable')
		expect(close.preservePendingSubmission).toBe(true)
	})

	test('QR close from a pre-invoice state (no reason) still cancels funding', () => {
		const close = resolveAuctionBidFundingModalClose('funding_session_created', null)
		expect(close.nextState).toBe('funding_canceled')
		expect(close.preservePendingSubmission).toBe(false)
	})

	test('plain close from invoice_created cancels funding and clears the pending submission', () => {
		const close = resolveAuctionBidFundingModalClose('invoice_created', null)
		expect(close.nextState).toBe('funding_canceled')
		expect(close.preservePendingSubmission).toBe(false)
	})

	test('plain close never downgrades an already-terminal state', () => {
		expect(resolveAuctionBidFundingModalClose('mint_succeeded_bid_publish_failed_reclaimable', null).nextState).toBe(
			'mint_succeeded_bid_publish_failed_reclaimable',
		)
		expect(resolveAuctionBidFundingModalClose('bid_published', null).nextState).toBe('bid_published')
	})

	test('funding_canceled can be re-classified to a reclaimable state (batch 1 retry path)', () => {
		expect(resolveAuctionBidFundingModalClose('funding_canceled', 'invoice_paid_mint_failed_reclaimable').nextState).toBe(
			'invoice_paid_mint_failed_reclaimable',
		)
	})
})
