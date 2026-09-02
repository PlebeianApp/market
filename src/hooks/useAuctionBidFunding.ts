import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { AuctionBidLockedButUnpublishedError, AuctionBidPublishFailedError, type AuctionBidFormData } from '@/publish/auctions'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

export type AuctionBidFundingLifecycleState =
	| 'idle'
	| 'funding_session_created'
	| 'invoice_created'
	| 'payment_acknowledged'
	| 'minting_started'
	| 'ecash_minted'
	| 'ecash_minted_pending_rules_ack'
	| 'bid_publish_attempted'
	| 'bid_published'
	| 'invoice_unpaid_or_expired_reclaimable'
	| 'invoice_paid_mint_failed_reclaimable'
	| 'mint_succeeded_bid_publish_failed_reclaimable'
	| 'funding_canceled'

export type AuctionBidFundingFailureReason = 'invoice_unpaid_or_expired_reclaimable' | 'invoice_paid_mint_failed_reclaimable'

/**
 * #12: ADR-0008 state mapping. The ADR lists a full payment/bid state model
 * (see ADR-0008 §"Payment and Bid State Model"). Most ADR states map 1:1 to
 * lifecycle states with identical names; only the two non-obvious mappings
 * below need explicit documentation.
 *
 * Direct 1:1 mappings (not listed in the object):
 *   ADR "Funding session created"      → funding_session_created
 *   ADR "Invoice created"              → invoice_created
 *   ADR "Invoice paid" / "Wallet ack"  → payment_acknowledged
 *   ADR "E-cash minting attempted"     → minting_started
 *   ADR "E-cash minted"                → ecash_minted
 *   ADR "Invoice expired or unpaid"    → invoice_unpaid_or_expired_reclaimable
 *   ADR "Bid published"                → bid_published
 *   ADR "Bid publish attempted"        → bid_publish_attempted
 *   ADR "Funding failed, reclaimable"  → invoice_paid_mint_failed_reclaimable
 *                                         / mint_succeeded_bid_publish_failed_reclaimable
 *
 * Non-obvious mappings (listed in the object below):
 *   ADR "Bid lock conversion attempted" → bid_publish_attempted
 *     Lock conversion is folded into the publish attempt — we don't split it
 *     into a separate user-visible state because it's an atomic UX step.
 *   ADR "Bid lock conversion complete"  → ['bid_published', 'mint_succeeded_bid_publish_failed_reclaimable']
 *     Two terminal outcomes: success (bid_published) or publish failure with
 *     reclaimable funds (mint_succeeded_bid_publish_failed_reclaimable).
 *
 * ADR states without a dedicated lifecycle state:
 *   "Bid requested"        — represented by the initial `idle` state
 *   "Mint target resolved" — handled inside startFundingForBid() before
 *                            transitioning to funding_session_created
 *   "Invoice payment attempted" — external Lightning payment; no client state
 *                            between invoice_created and payment_acknowledged
 *   "Bid funding failed"   — generic; covered by the specific reclaimable states
 */
export const AUCTION_BID_FUNDING_ADR_STATE_MAPPING = {
	bid_lock_conversion_attempted: 'bid_publish_attempted',
	bid_lock_conversion_complete: ['bid_published', 'mint_succeeded_bid_publish_failed_reclaimable'],
} as const

/**
 * States from which a user's locked e-cash can be reclaimed.
 *
 * This list deliberately mixes two categories:
 *
 * - **Failure states** (`invoice_unpaid_or_expired_reclaimable`,
 *   `invoice_paid_mint_failed_reclaimable`,
 *   `mint_succeeded_bid_publish_failed_reclaimable`) — the funding attempt
 *   errored and the user must recover.
 * - **Pending state** (`ecash_minted_pending_rules_ack`) — the funding
 *   succeeded and e-cash is minted, but the bid is paused awaiting the
 *   rules acknowledgement. It is NOT a failure, but it IS reclaimable if the
 *   user abandons the bid, so it belongs in this set for the reclaim path.
 *
 * `isAuctionBidFundingReclaimableState` gates the reclaim UI/flow on this
 * set, so both the "failed and recover" and "paused but abandonable" cases
 * funnel into the same recovery entry point.
 */
export const AUCTION_BID_FUNDING_RECLAIMABLE_STATES: readonly AuctionBidFundingLifecycleState[] = [
	'invoice_unpaid_or_expired_reclaimable',
	'invoice_paid_mint_failed_reclaimable',
	'ecash_minted_pending_rules_ack',
	'mint_succeeded_bid_publish_failed_reclaimable',
]

/**
 * Reclaim / refund flow for reclaimable states:
 *
 * When a bid funding session ends in one of the reclaimable terminal states,
 * the user's sats are not lost — they remain as Cashu proofs at the mint,
 * locked under a P2PK timelock with a refund path. Recovery works as follows:
 *
 * 1. `invoice_unpaid_or_expired_reclaimable`: The Lightning invoice expired
 *    or was never paid. No funds were minted — nothing to reclaim. The user
 *    can simply start a new funding session.
 *
 * 2. `invoice_paid_mint_failed_reclaimable`: The invoice was paid but minting
 *    failed. Funds may be at the mint in a partially-minted state. The user
 *    can retry the funding session (transition back to funding_session_created
 *    is allowed), which re-attempts minting. If minting keeps failing, the
 *    pending token entry in nip60Store will eventually become eligible for
 *    reclaimToken() once the timelock expires.
 *
 * 3. `mint_succeeded_bid_publish_failed_reclaimable`: E-cash was minted but
 *    the bid event could not be published to relays. The proofs are in the
 *    user's wallet as a pending token. The user can retry publishing (transition
 *    back to bid_publish_attempted is allowed). If they abandon the bid, the
 *    funds are reclaimable via nip60Actions.reclaimToken() after the timelock.
 *
 * 4. `ecash_minted_pending_rules_ack`: E-cash was minted but the user hasn't
 *    acknowledged the auction rules yet. The funds are in the wallet as a
 *    pending token. If the user closes the modal, the pending bid is preserved
 *    (shouldPreservePendingBidSubmissionOnModalClose returns true). Once rules
 *    are acknowledged, publishing resumes. If abandoned, reclaimToken() recovers
 *    funds after the timelock.
 *
 * The actual reclaim implementation lives in nip60Actions.reclaimToken() in
 * src/lib/stores/nip60.ts. It:
 *   - Checks the timelock from the proof secret (not cached context)
 *   - Looks up the refund private key from BidderBidRecord or wallet.privkeys
 *   - Calls receiveTokenWithPrivkey() to sweep the locked proofs back
 *   - Marks the token as 'reclaimed' in pendingTokens
 * An auto-reclaim sweep runs periodically with exponential backoff; the user
 * can also manually trigger reclaim from the UI.
 */
const AUCTION_BID_FUNDING_RECLAIMABLE_STATE_SET = new Set<AuctionBidFundingLifecycleState>(AUCTION_BID_FUNDING_RECLAIMABLE_STATES)

export const isAuctionBidFundingReclaimableState = (state: AuctionBidFundingLifecycleState): boolean =>
	AUCTION_BID_FUNDING_RECLAIMABLE_STATE_SET.has(state)

interface StartFundingForBidInput {
	bidData: AuctionBidFormData
	hasInsufficientBidFunds: boolean
	depositMint: string | null
	deltaAmount: number
	mintError: string | null
	selectedMint: string | null
	canFund: boolean
}

export interface UseAuctionBidFundingOptions {
	previousBidAmount: number
	publishBid: (bidData: AuctionBidFormData) => Promise<string>
	/**
	 * #1235 Blocking 1: rebroadcast an already-built kind-1023 bid event by id.
	 *
	 * When a bid was funded (funds locked, recovery record persisted, event
	 * built and cached) but the relay broadcast failed, retrying the publish
	 * must NOT re-run `publishAuctionBid` — that would re-derive a fresh path,
	 * generate a fresh refund keypair, and re-lock funds at the mint
	 * (double-lock). Instead this callback rebroadcasts the exact persisted
	 * signed event: same event id, zero additional Cashu swap/lock.
	 *
	 * When unset, retry from `mint_succeeded_bid_publish_failed_reclaimable`
	 * never falls back to the full (re-locking) pipeline — it surfaces an
	 * error instead, because a retry must never double-lock the bidder.
	 */
	republishBid?: (bidEventId: string) => Promise<string>
	onBidSuccess?: () => void
	onPendingRulesAck?: () => void
	hasAcknowledgedRules: boolean
}

const TERMINAL_FUNDING_STATES: AuctionBidFundingLifecycleState[] = [
	'bid_published',
	'invoice_unpaid_or_expired_reclaimable',
	'invoice_paid_mint_failed_reclaimable',
	'mint_succeeded_bid_publish_failed_reclaimable',
]

const FUNDED_IN_FLIGHT_FUNDING_STATES: AuctionBidFundingLifecycleState[] = [
	'payment_acknowledged',
	'minting_started',
	'ecash_minted',
	'ecash_minted_pending_rules_ack',
	'bid_publish_attempted',
]

const CLOSE_NO_CANCEL_FUNDING_STATES = new Set<AuctionBidFundingLifecycleState>([
	...TERMINAL_FUNDING_STATES,
	...FUNDED_IN_FLIGHT_FUNDING_STATES,
])

const CLOSE_PRESERVE_PENDING_SUBMISSION_STATES = new Set<AuctionBidFundingLifecycleState>([
	...FUNDED_IN_FLIGHT_FUNDING_STATES,
	'mint_succeeded_bid_publish_failed_reclaimable',
	// #1235 Blocking 2: closing the deposit modal from a state in which a
	// payment may have been made must preserve the session — the two invoice
	// reclaimable states are reachable exactly on those paths (QR-payer
	// close classification + deposit-error classification).
	'invoice_unpaid_or_expired_reclaimable',
	'invoice_paid_mint_failed_reclaimable',
])

const AUCTION_BID_FUNDING_ALLOWED_TRANSITIONS: Record<AuctionBidFundingLifecycleState, ReadonlySet<AuctionBidFundingLifecycleState>> = {
	idle: new Set<AuctionBidFundingLifecycleState>([
		'funding_session_created',
		'invoice_unpaid_or_expired_reclaimable',
		'bid_publish_attempted',
		'funding_canceled',
	]),
	funding_session_created: new Set<AuctionBidFundingLifecycleState>([
		'invoice_created',
		'invoice_unpaid_or_expired_reclaimable',
		'funding_canceled',
	]),
	invoice_created: new Set<AuctionBidFundingLifecycleState>([
		'payment_acknowledged',
		'invoice_unpaid_or_expired_reclaimable',
		// #1235 Blocking 2: a QR payer's payment is unobservable by the app, so
		// a paid-or-unknown classification while the deposit is pending must be
		// able to land in the reclaimable state directly from invoice_created.
		'invoice_paid_mint_failed_reclaimable',
		'funding_canceled',
	]),
	payment_acknowledged: new Set<AuctionBidFundingLifecycleState>(['minting_started', 'invoice_paid_mint_failed_reclaimable']),
	minting_started: new Set<AuctionBidFundingLifecycleState>(['ecash_minted', 'invoice_paid_mint_failed_reclaimable']),
	ecash_minted: new Set<AuctionBidFundingLifecycleState>([
		'ecash_minted_pending_rules_ack',
		'bid_publish_attempted',
		'invoice_paid_mint_failed_reclaimable',
	]),
	ecash_minted_pending_rules_ack: new Set<AuctionBidFundingLifecycleState>(['bid_publish_attempted', 'funding_session_created']),
	bid_publish_attempted: new Set<AuctionBidFundingLifecycleState>(['bid_published', 'mint_succeeded_bid_publish_failed_reclaimable']),
	bid_published: new Set<AuctionBidFundingLifecycleState>(['funding_session_created']),
	invoice_unpaid_or_expired_reclaimable: new Set<AuctionBidFundingLifecycleState>(['funding_session_created']),
	invoice_paid_mint_failed_reclaimable: new Set<AuctionBidFundingLifecycleState>(['funding_session_created']),
	mint_succeeded_bid_publish_failed_reclaimable: new Set<AuctionBidFundingLifecycleState>([
		'bid_publish_attempted',
		'funding_session_created',
	]),
	funding_canceled: new Set<AuctionBidFundingLifecycleState>([
		'funding_session_created',
		// #1235 Blocking 2: defense in depth for close-ordering races — if the
		// deposit store's paid-or-unknown classification arrives after
		// handleDepositModalClose already canceled the session, the lifecycle
		// must still be able to land in a reclaimable state instead of
		// stranding a paid user's sats behind "canceled".
		'invoice_unpaid_or_expired_reclaimable',
		'invoice_paid_mint_failed_reclaimable',
	]),
}

export const canTransitionAuctionBidFundingState = (from: AuctionBidFundingLifecycleState, to: AuctionBidFundingLifecycleState): boolean =>
	from === to || AUCTION_BID_FUNDING_ALLOWED_TRANSITIONS[from].has(to)

export const resolveAuctionBidFundingTransition = (
	currentState: AuctionBidFundingLifecycleState,
	nextState: AuctionBidFundingLifecycleState,
): AuctionBidFundingLifecycleState => (canTransitionAuctionBidFundingState(currentState, nextState) ? nextState : currentState)

export const shouldCancelFundingOnModalClose = (state: AuctionBidFundingLifecycleState): boolean =>
	!CLOSE_NO_CANCEL_FUNDING_STATES.has(state)

export const shouldPreservePendingBidSubmissionOnModalClose = (state: AuctionBidFundingLifecycleState): boolean =>
	CLOSE_PRESERVE_PENDING_SUBMISSION_STATES.has(state)

/**
 * Whether the nip60 deposit store still has a Lightning payment in flight —
 * `pending` (invoice shown, payment unobservable by the app) or
 * `awaiting_confirmation_retry` (paid-or-unknown, mint confirmation timed
 * out once and is retryable).
 */
export const isDepositPendingOrAwaitingConfirmation = (depositStatus: string | null | undefined): boolean =>
	depositStatus === 'pending' || depositStatus === 'awaiting_confirmation_retry'

/**
 * #1235 Blocking 2 — close/cancel must never erase paid-or-uncertain state.
 *
 * A QR payer's payment is unobservable by the app: closing the deposit modal
 * while the deposit is `pending` or `awaiting_confirmation_retry` means a
 * payment may have been made. The close must land the lifecycle in a
 * reclaimable state and preserve the session — NEVER `funding_canceled` with
 * a cleared `pendingBidSubmission` (which would claim "nothing was paid"
 * while the user's sats may already be at the mint).
 *
 * This resolves the lifecycle state for a deposit-modal close given the
 * deposit store's status at close time:
 *
 * - deposit still pending/awaiting-confirmation-retry → the reclaimable
 *   failure state (`invoice_paid_mint_failed_reclaimable`), preserving the
 *   pending submission;
 * - otherwise → the pre-existing close semantics: `funding_canceled` for
 *   cancelable states (idle / funding_session_created / invoice_created
 *   with no deposit in flight), current state otherwise.
 */
export const resolveDepositModalCloseLifecycleState = (
	currentState: AuctionBidFundingLifecycleState,
	depositStatus: string | null | undefined,
): AuctionBidFundingLifecycleState => {
	if (isDepositPendingOrAwaitingConfirmation(depositStatus)) {
		return resolveAuctionBidFundingTransition(currentState, 'invoice_paid_mint_failed_reclaimable')
	}
	if (shouldCancelFundingOnModalClose(currentState)) {
		return resolveAuctionBidFundingTransition(currentState, 'funding_canceled')
	}
	return currentState
}

/**
 * Whether a deposit-modal close must preserve `pendingBidSubmission`.
 *
 * A payment may have been made whenever the deposit is still
 * pending/awaiting-confirmation-retry — the session is preserved so the
 * funding can be retried or reclaimed without re-entering the bid.
 */
export const shouldPreservePendingBidSubmissionOnDepositModalClose = (
	state: AuctionBidFundingLifecycleState,
	depositStatus: string | null | undefined,
): boolean => isDepositPendingOrAwaitingConfirmation(depositStatus) || shouldPreservePendingBidSubmissionOnModalClose(state)

/**
 * #1235 Blocking 5 — cross-leg verdict leak.
 *
 * `publishedBidEventId` is session-scoped: it tracks the kind-1023 event id
 * produced by the CURRENT funding attempt only. The progress dialog binds
 * validator verdicts to it, so on a rebid the PREVIOUS leg's id must never
 * leak — `computeVerdictQuorum` bound to the stale id would render
 * "Bid successfully placed!" for the new, not-yet-published bid.
 *
 * `startFundingForBid` calls this at the top of every new funding session;
 * the id only becomes non-null again when THIS session's publish attempt
 * produces one (publish success, or a funded-but-unbroadcast failure whose
 * event id was captured for the idempotent retry).
 *
 * Takes the previous session's id purely to make the reset rule explicit
 * and unit-testable: whatever the previous leg published, a new session
 * starts with no published event id.
 */
export const nextPublishedBidEventIdOnSessionStart = (_previousSessionBidEventId: string | null): string | null => null

/**
 * #1235 follow-up 3 — session-scoped "locked but unpublished" state.
 *
 * `AuctionBidLockedButUnpublishedError` is thrown when the bid's funds were
 * LOCKED at the mint but the leg never became safely publishable (event
 * finalization or the STRICT recovery-record write failed). The funding
 * lifecycle records the lock token id so `retryBidPublish` can refuse the
 * retry with a RECLAIM-ONLY message instead of falling back to the full
 * re-submit pipeline (which would re-lock the delta — double-lock).
 *
 * Like `publishedBidEventId`, this tracker is session-scoped: whatever the
 * previous session locked, a NEW session starts with no locked-unpublished
 * token — the previous leg's pending token stays reclaimable via the
 * wallet, but it must not block or steer the new session.
 */
export const nextLockedUnpublishedTokenIdOnSessionStart = (_previousSessionLockedUnpublishedTokenId: string | null): string | null => null

/**
 * #1235 follow-ups 1+2 — session-token guard on async completion writes.
 *
 * A funding session's async completions (`submitPreparedBid` /
 * `retryBidPublish` continuations) can settle long after the user has
 * started a NEW funding session: Cancel is never disabled mid-publish
 * (AuctionBidProgressDialog) and no new-bid entry point is gated on the
 * publish mutations being in flight. Without a guard, a stale
 * continuation's raw writes wipe the new session's `pendingBidSubmission`,
 * force-close its deposit modal, and re-pollute its `publishedBidEventId`
 * — the new session then dead-ends at `handleFundingSuccess`'s
 * `if (!pendingBidSubmission) return` and the bid is silently lost
 * (same cross-leg-leak class as Blocking 5).
 *
 * `startFundingForBid` bumps the funding-session token at the top of
 * every new session; async flows capture the token before each `await`
 * and gate EVERY post-await write — success, terminal, and catch paths
 * alike — on this predicate. A completion that no longer belongs to the
 * funding session that started it must not write anything.
 */
export const isSessionCurrent = (tokenAtStart: number, tokenNow: number): boolean => tokenAtStart === tokenNow

export function useAuctionBidFunding({
	previousBidAmount,
	publishBid,
	republishBid,
	onBidSuccess,
	onPendingRulesAck,
	hasAcknowledgedRules,
}: UseAuctionBidFundingOptions) {
	const [isDepositOpen, setIsDepositOpen] = useState(false)
	const [depositAmount, setDepositAmount] = useState(0)
	const [preferredDepositMint, setPreferredDepositMint] = useState<string | undefined>(undefined)
	const [pendingBidSubmission, setPendingBidSubmission] = useState<AuctionBidFormData | null>(null)
	const [pendingRulesAckBidData, setPendingRulesAckBidData] = useState<AuctionBidFormData | null>(null)
	const [bidFundingLifecycleState, setBidFundingLifecycleState] = useState<AuctionBidFundingLifecycleState>('idle')
	const [publishedBidEventId, setPublishedBidEventId] = useState<string | null>(null)
	// #1235 follow-up 3: lock token id of a leg that failed post-lock but
	// pre-publishable (see AuctionBidLockedButUnpublishedError) — non-null
	// means funds for THIS session's leg are known to be locked, so a retry
	// must be RECLAIM-ONLY, never a re-locking re-submit.
	const [lockedUnpublishedTokenId, setLockedUnpublishedTokenId] = useState<string | null>(null)
	// #1235 follow-ups 1+2: epoch token for the CURRENT funding session —
	// bumped at the top of every `startFundingForBid` call so async
	// continuations from older sessions can detect (and refuse) writing.
	const fundingSessionTokenRef = useRef(0)

	const submitPreparedBid = useCallback(
		async (bidData: AuctionBidFormData) => {
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_publish_attempted'))
			// #1235 follow-ups 1+2: capture the funding-session token BEFORE the
			// first await — every write below belongs to the session that started
			// this publish and must be dropped if a newer session has started by
			// the time the await settles (isSessionCurrent).
			const sessionTokenAtStart = fundingSessionTokenRef.current
			try {
				const bidEventId = await publishBid(bidData)
				if (!isSessionCurrent(sessionTokenAtStart, fundingSessionTokenRef.current)) return false
				setPublishedBidEventId(bidEventId)
				setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_published'))
				setPendingBidSubmission(null)
				setIsDepositOpen(false)
				onBidSuccess?.()
				return true
			} catch (error) {
				// #1235 follow-ups 1+2: a stale catch completion (a NEW funding
				// session started while this publish was in flight) must not write
				// anything — in particular it must not pollute the new session's
				// publishedBidEventId with this leg's id (Blocking 5 leak class)
				// nor land the new session in a failure state for a leg it never
				// started.
				if (!isSessionCurrent(sessionTokenAtStart, fundingSessionTokenRef.current)) return false
				// #1235 Blocking 1: when the relay broadcast failed AFTER the funds
				// were locked and the kind-1023 event was built and cached, the
				// publisher throws AuctionBidPublishFailedError carrying the event
				// id. Record it so retryBidPublish can rebroadcast the EXACT signed
				// event (same id, zero additional Cashu swap/lock) instead of
				// re-running the full lock pipeline.
				// #1235 follow-up 3: when the failure left the leg locked but NOT
				// safely publishable (event finalization / STRICT recovery-record
				// write failed), the publisher throws AuctionBidLockedButUnpublishedError
				// carrying the lock token id — record it so retryBidPublish takes the
				// RECLAIM-ONLY path instead of the full re-submit (double-lock).
				if (error instanceof AuctionBidPublishFailedError) {
					setPublishedBidEventId(error.bidEventId)
				} else if (error instanceof AuctionBidLockedButUnpublishedError) {
					setLockedUnpublishedTokenId(error.lockTokenId)
				}
				setBidFundingLifecycleState((currentState) =>
					resolveAuctionBidFundingTransition(currentState, 'mint_succeeded_bid_publish_failed_reclaimable'),
				)
				const errorMessage = error instanceof Error ? error.message : String(error)
				toast.error(`Funding completed, but bid publishing failed: ${errorMessage}`)
				return false
			}
		},
		[onBidSuccess, publishBid],
	)

	const startFundingForBid = useCallback(
		({ bidData, hasInsufficientBidFunds, depositMint, deltaAmount, mintError, selectedMint, canFund }: StartFundingForBidInput) => {
			// #1235 follow-ups 1+2: a new funding session starts a new epoch —
			// any async completion still in flight from a previous session is
			// now stale and must not write state when its awaits settle.
			fundingSessionTokenRef.current += 1
			// #1235 Blocking 5 — cross-leg verdict leak: a NEW funding session must
			// never inherit the PREVIOUS leg's published event id (see
			// nextPublishedBidEventIdOnSessionStart).
			setPublishedBidEventId((previousSessionBidEventId) => nextPublishedBidEventIdOnSessionStart(previousSessionBidEventId))
			// #1235 follow-up 3: the previous session's locked-unpublished leg
			// stays reclaimable via the wallet's pending token — a NEW session
			// starts with no locked-unpublished token (session-scoped state,
			// same rule as publishedBidEventId).
			setLockedUnpublishedTokenId((previousSessionLockedTokenId) =>
				nextLockedUnpublishedTokenIdOnSessionStart(previousSessionLockedTokenId),
			)
			if (hasInsufficientBidFunds) {
				if (!depositMint) {
					toast.error(mintError || 'No suitable mint available for bidding.')
					setBidFundingLifecycleState((currentState) =>
						resolveAuctionBidFundingTransition(currentState, 'invoice_unpaid_or_expired_reclaimable'),
					)
					return null
				}

				setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'funding_session_created'))
				setPendingBidSubmission(bidData)
				setDepositAmount(Math.ceil(deltaAmount))
				setPreferredDepositMint(depositMint)
				setIsDepositOpen(true)
				return null
			}

			if (!selectedMint) {
				toast.error(mintError || 'No suitable mint available for bidding.')
				return null
			}

			if (!canFund) {
				toast.error('Insufficient balance on selected mint to cover the required delta.')
				return null
			}

			return bidData
		},
		[],
	)

	const handleFundingSuccess = useCallback(() => {
		if (!pendingBidSubmission) return

		// Close the deposit modal immediately so the bid progress dialog
		// (which opens on the ecash_minted state transition below) is
		// visible without being obscured by the "Deposit Successful!"
		// screen. The progress dialog's stepper shows the funding stage
		// as completed, so the success screen in the modal is redundant.
		setIsDepositOpen(false)

		void (async () => {
			// Advance through the intermediate funding states to ecash_minted.
			// For QR-scan deposits, payment_acknowledged and minting_started are
			// not separately observable (only the final mint 'success' event), so
			// the lifecycle may still be at invoice_created when the deposit
			// confirms. Walk forward through the unobservable intermediate states
			// so the transition is valid regardless of which pre-mint state we
			// last observed. Each step is idempotent if the state already moved on.
			setBidFundingLifecycleState((s) => resolveAuctionBidFundingTransition(s, 'payment_acknowledged'))
			setBidFundingLifecycleState((s) => resolveAuctionBidFundingTransition(s, 'minting_started'))
			setBidFundingLifecycleState((s) => resolveAuctionBidFundingTransition(s, 'ecash_minted'))

			try {
				await nip60Actions.refresh()
			} catch {
				// Best-effort refresh; we still evaluate from current wallet state below.
			}

			const fundingMintCandidates = pendingBidSubmission.mintCandidates
			if (!fundingMintCandidates.length) {
				setBidFundingLifecycleState((currentState) =>
					resolveAuctionBidFundingTransition(currentState, 'invoice_paid_mint_failed_reclaimable'),
				)
				toast.error('Invoice was paid, but no funding mint was selected for bid locking. Please retry the bid submission.')
				return
			}

			const latestNip60State = nip60Store.state
			const requiredDelta = Math.max(0, pendingBidSubmission.amount - previousBidAmount)
			const fundableMint = fundingMintCandidates.find((mintUrl) => (latestNip60State.mintBalances[mintUrl] ?? 0) >= requiredDelta)

			if (!fundableMint) {
				setBidFundingLifecycleState((currentState) =>
					resolveAuctionBidFundingTransition(currentState, 'invoice_paid_mint_failed_reclaimable'),
				)
				toast.error('Invoice was paid, but minted funds are not yet spendable on any accepted mint. Please retry once minting completes.')
				return
			}

			const orderedMintCandidates = [fundableMint, ...fundingMintCandidates.filter((mintUrl) => mintUrl !== fundableMint)]
			const preparedBid = { ...pendingBidSubmission, mintCandidates: orderedMintCandidates }

			if (!hasAcknowledgedRules) {
				setPendingRulesAckBidData(preparedBid)
				setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'ecash_minted_pending_rules_ack'))
				onPendingRulesAck?.()
				return
			}

			await submitPreparedBid(preparedBid)
		})()
	}, [pendingBidSubmission, previousBidAmount, submitPreparedBid, hasAcknowledgedRules, onPendingRulesAck])

	const resumeBidAfterRulesAck = useCallback(async () => {
		if (!pendingRulesAckBidData) return
		const bidData = pendingRulesAckBidData
		setPendingRulesAckBidData(null)
		await submitPreparedBid(bidData)
	}, [pendingRulesAckBidData, submitPreparedBid])

	/**
	 * #1235 Blocking 1 — idempotent retry from
	 * `mint_succeeded_bid_publish_failed_reclaimable`.
	 *
	 * Three retry paths:
	 *
	 * - **Reclaim-only (#1235 follow-up 3, when the leg failed post-lock but
	 *   pre-publishable):** `AuctionBidLockedButUnpublishedError` recorded the
	 *   lock token id — funds are known to be locked but there is no
	 *   durably-recoverable publishable kind-1023. Retry must NEVER re-run
	 *   the pipeline (double-lock) and has nothing to rebroadcast: surface
	 *   the reclaim path instead.
	 *
	 * - **Idempotent rebroadcast (preferred, whenever the failed publish
	 *   produced an event id):** `republishBid` rebroadcasts the exact
	 *   persisted signed kind-1023 — same event id, ZERO additional Cashu
	 *   swap/lock. Relays that already have the event deduplicate; relays
	 *   that missed it ingest it. Retrying a funded-but-unbroadcast publish
	 *   never double-locks the bidder.
	 *
	 * - **No id captured and nothing known to be locked (publish failed
	 *   before the kind-1023 was built — nothing was locked for this leg
	 *   yet):** falls back to the full `submitPreparedBid` pipeline. When an
	 *   id IS known but no `republishBid` callback is wired, we surface an
	 *   error instead of falling back — a retry must never re-run the lock
	 *   pipeline on an already-locked leg.
	 *
	 * Uses the preserved pendingBidSubmission so the user doesn't need to
	 * re-enter the bid amount or reselect mints.
	 */
	const retryBidPublish = useCallback(async () => {
		if (!pendingBidSubmission) return
		// #1235 follow-up 3 — RECLAIM-ONLY path: this session's leg failed
		// post-lock but pre-publishable (event finalization or the STRICT
		// recovery-record write failed). Funds are known to be locked, so the
		// retry must NEVER fall back to the full re-submit pipeline (it would
		// re-derive a fresh path and re-lock the delta — double-lock) and
		// there is no publishable event to rebroadcast either.
		if (lockedUnpublishedTokenId) {
			toast.error(
				'Your bid funds are locked and reclaimable, but the bid could not be prepared for publishing. Retry is unavailable — reclaim your funds from the wallet once the refund timelock opens. No second lock was attempted.',
			)
			return
		}
		if (publishedBidEventId) {
			if (!republishBid) {
				toast.error('Bid publish retry is unavailable — your funds remain locked and reclaimable. No second lock was attempted.')
				return
			}
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_publish_attempted'))
			// #1235 follow-ups 1+2: capture the funding-session token BEFORE the
			// await — the rebroadcast continuation belongs to the session that
			// started this retry and must not write if a newer session has
			// started while the rebroadcast was in flight (a stale completion
			// here used to wipe the new session's pendingBidSubmission and
			// force-close its deposit modal).
			const sessionTokenAtStart = fundingSessionTokenRef.current
			try {
				await republishBid(publishedBidEventId)
				if (!isSessionCurrent(sessionTokenAtStart, fundingSessionTokenRef.current)) return
				setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_published'))
				setPendingBidSubmission(null)
				setIsDepositOpen(false)
				onBidSuccess?.()
			} catch (error) {
				// #1235 follow-ups 1+2: a stale catch must not write into the
				// newer session (no failure-state transition, no toast).
				if (!isSessionCurrent(sessionTokenAtStart, fundingSessionTokenRef.current)) return
				// #1235 follow-up 3: defensive — a republish callback wired to a
				// rebroadcast that ends up locked-but-unpublished must land in the
				// reclaim-only state, not be silently forgotten.
				if (error instanceof AuctionBidLockedButUnpublishedError) {
					setLockedUnpublishedTokenId(error.lockTokenId)
				}
				setBidFundingLifecycleState((currentState) =>
					resolveAuctionBidFundingTransition(currentState, 'mint_succeeded_bid_publish_failed_reclaimable'),
				)
				const errorMessage = error instanceof Error ? error.message : String(error)
				toast.error(`Funding completed, but bid publishing failed: ${errorMessage}`)
			}
			return
		}
		// No event id captured and nothing known to be locked — the failure
		// happened before the kind-1023 was built (pre-lock validation), so
		// nothing was locked for this leg yet: a full re-submit is safe
		// (no double-lock).
		await submitPreparedBid(pendingBidSubmission)
	}, [pendingBidSubmission, publishedBidEventId, lockedUnpublishedTokenId, republishBid, submitPreparedBid, onBidSuccess])

	const handleInvoiceCreated = useCallback(() => {
		setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'invoice_created'))
	}, [])

	const handlePaymentAcknowledged = useCallback(() => {
		setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'payment_acknowledged'))
	}, [])

	const handleFundingFailed = useCallback((reason: AuctionBidFundingFailureReason) => {
		setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, reason))
	}, [])

	const handleDepositModalClose = useCallback(() => {
		// #1235 Blocking 2 — read the deposit store's status at close time:
		// closing while a payment may have been made (pending /
		// awaiting_confirmation_retry) must land the lifecycle in a
		// reclaimable state with the session preserved, never funding_canceled
		// with a cleared pendingBidSubmission.
		const depositStatus = nip60Store.state.depositStatus
		setBidFundingLifecycleState((currentState) => resolveDepositModalCloseLifecycleState(currentState, depositStatus))
		setIsDepositOpen(false)
		if (!shouldPreservePendingBidSubmissionOnDepositModalClose(bidFundingLifecycleState, depositStatus)) {
			setPendingBidSubmission(null)
		}
	}, [bidFundingLifecycleState])

	return {
		bidFundingLifecycleState,
		isDepositOpen,
		depositAmount,
		preferredDepositMint,
		// #1235 follow-ups 1+2: exposed so the session-token guard's core
		// invariant — a stale async completion must not clear a newer session's
		// pending submission — is observable (and regression-tested) from
		// outside the hook. Additive to the return shape; no existing caller
		// is affected.
		pendingBidSubmission,
		startFundingForBid,
		submitPreparedBid,
		handleFundingSuccess,
		handleInvoiceCreated,
		handlePaymentAcknowledged,
		handleFundingFailed,
		handleDepositModalClose,
		resumeBidAfterRulesAck,
		retryBidPublish,
		publishedBidEventId,
		// #1235 follow-up 3: exposed so the UI (and tests) can distinguish a
		// reclaim-only failure (leg locked but never publishable — retry
		// refused, reclaim after the refund timelock) from a rebroadcastable
		// failure. Additive to the return shape; no existing consumer is
		// affected.
		lockedUnpublishedTokenId,
	}
}
