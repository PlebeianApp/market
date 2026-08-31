import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import type { AuctionBidFormData } from '@/publish/auctions'
import { useCallback, useState } from 'react'
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
 * #12: ADR-0004 state mapping. The ADR lists a full payment/bid state model
 * (see ADR-0004 §"Payment and Bid State Model"). Most ADR states map 1:1 to
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

interface UseAuctionBidFundingOptions {
	previousBidAmount: number
	publishBid: (bidData: AuctionBidFormData) => Promise<unknown>
	onBidSuccess?: () => void
	onPendingRulesAck?: () => void
	hasAcknowledgedRules: boolean
	/**
	 * #12 (Blocker 1): Rebroadcast an already-signed kind-1023 bid event by id.
	 *
	 * When a bid was successfully signed and published once (so
	 * `publishedBidEventId` is set) but a subsequent relay broadcast
	 * failed (e.g. transient relay outage on retry), retrying the publish
	 * must NOT re-run `publishAuctionBid` — that would re-lock funds and
	 * re-sign a new event, double-charging the bidder. Instead, this
	 * callback fetches the original signed event by id and rebroadcasts it
	 * verbatim. Falls back to `publishBid` (full re-submit) when unset or
	 * when no event id was captured.
	 */
	republishBid?: (bidEventId: string) => Promise<void>
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
	'invoice_paid_mint_failed_reclaimable',
	'invoice_unpaid_or_expired_reclaimable',
])

const AUCTION_BID_FUNDING_ALLOWED_TRANSITIONS: Record<AuctionBidFundingLifecycleState, ReadonlySet<AuctionBidFundingLifecycleState>> = {
	idle: new Set(['funding_session_created', 'invoice_unpaid_or_expired_reclaimable', 'bid_publish_attempted', 'funding_canceled']),
	funding_session_created: new Set(['invoice_created', 'invoice_unpaid_or_expired_reclaimable', 'funding_canceled']),
	invoice_created: new Set([
		'payment_acknowledged',
		// Paid-or-unknown close/error classification (QR path): the app cannot
		// observe an external wallet's payment, so a failure while an invoice is
		// outstanding leans toward "paid but mint failed" instead of stranding a
		// paid user's sats behind an "unpaid" claim. payment_acknowledged is
		// implied-but-unobserved here, hence the direct edge.
		'invoice_unpaid_or_expired_reclaimable',
		'invoice_paid_mint_failed_reclaimable',
		'funding_canceled',
	]),
	payment_acknowledged: new Set(['minting_started', 'invoice_paid_mint_failed_reclaimable']),
	minting_started: new Set(['ecash_minted', 'invoice_paid_mint_failed_reclaimable']),
	ecash_minted: new Set(['ecash_minted_pending_rules_ack', 'bid_publish_attempted', 'invoice_paid_mint_failed_reclaimable']),
	ecash_minted_pending_rules_ack: new Set(['bid_publish_attempted', 'funding_session_created']),
	bid_publish_attempted: new Set(['bid_published', 'mint_succeeded_bid_publish_failed_reclaimable']),
	bid_published: new Set(['funding_session_created']),
	invoice_unpaid_or_expired_reclaimable: new Set(['funding_session_created']),
	invoice_paid_mint_failed_reclaimable: new Set(['funding_session_created']),
	mint_succeeded_bid_publish_failed_reclaimable: new Set(['bid_publish_attempted', 'funding_session_created']),
	funding_canceled: new Set(['funding_session_created', 'invoice_unpaid_or_expired_reclaimable', 'invoice_paid_mint_failed_reclaimable']),
}

export const canTransitionAuctionBidFundingState = (from: AuctionBidFundingLifecycleState, to: AuctionBidFundingLifecycleState): boolean =>
	from === to || AUCTION_BID_FUNDING_ALLOWED_TRANSITIONS[from].has(to)

const resolveAuctionBidFundingTransition = (
	currentState: AuctionBidFundingLifecycleState,
	nextState: AuctionBidFundingLifecycleState,
): AuctionBidFundingLifecycleState => (canTransitionAuctionBidFundingState(currentState, nextState) ? nextState : currentState)

export const shouldCancelFundingOnModalClose = (state: AuctionBidFundingLifecycleState): boolean =>
	!CLOSE_NO_CANCEL_FUNDING_STATES.has(state)

export const shouldPreservePendingBidSubmissionOnModalClose = (state: AuctionBidFundingLifecycleState): boolean =>
	CLOSE_PRESERVE_PENDING_SUBMISSION_STATES.has(state)

/**
 * Lifecycle states in which the staged bid progress dialog is (or becomes)
 * open.
 *
 * Ported from the lost full-UX lineage (AuctionBidder's `POST_FUNDING_STATES`):
 * the dialog opens only AFTER funding is complete — i.e. once e-cash has been
 * minted and the flow is in the publish/validation phase. During the funding
 * stage (invoice_created, payment_acknowledged, …) the DepositLightningModal
 * is the sole UI — showing both simultaneously causes interference and
 * duplicate dialogs.
 *
 * The set deliberately includes:
 *
 * - `ecash_minted` / `ecash_minted_pending_rules_ack`: the deposit modal is
 *   closed as funding completes (see `handleFundingSuccess`), so the progress
 *   dialog must take over immediately — otherwise no modal is visible during
 *   the lock+sign+publish leg. The rules-ack variant stacks the rules dialog
 *   on top until the user acknowledges.
 * - `mint_succeeded_bid_publish_failed_reclaimable`: a failed publish keeps a
 *   retry surface — even if the user dismissed the dialog during the publish
 *   attempt, it reopens with the "Retry publish" affordance (fixes M7's
 *   close-then-fail dead end).
 *
 * The dialog never auto-closes: the user dismisses it explicitly via the
 * Done/Cancel button after a terminal outcome (confirmed, rejected, or
 * failed). Closing the dialog does NOT touch the funding lifecycle.
 */
export const AUCTION_BID_PROGRESS_DIALOG_OPEN_STATES: readonly AuctionBidFundingLifecycleState[] = [
	'ecash_minted',
	'ecash_minted_pending_rules_ack',
	'bid_publish_attempted',
	'bid_published',
	'mint_succeeded_bid_publish_failed_reclaimable',
]

const AUCTION_BID_PROGRESS_DIALOG_OPEN_STATE_SET = new Set<AuctionBidFundingLifecycleState>(AUCTION_BID_PROGRESS_DIALOG_OPEN_STATES)

export const shouldOpenBidProgressDialog = (state: AuctionBidFundingLifecycleState): boolean =>
	AUCTION_BID_PROGRESS_DIALOG_OPEN_STATE_SET.has(state)

/**
 * Paid-or-unknown failure classification (S2/S4).
 *
 * Used by BOTH deposit-failure paths (the modal's error effect and the modal's
 * user-close path):
 *
 * - NWC: `paymentAcknowledged` tells us whether the invoice was actually
 *   sent/paid, so an NWC failure with no payment sent is genuinely "unpaid".
 * - QR: we can't observe the external wallet's payment, so lean toward
 *   "paid but mint failed" rather than stranding a paid user's sats at the
 *   mint behind an "invoice unpaid/expired" message that implies nothing
 *   was paid.
 */
export const resolveAuctionBidFundingFailureReason = ({
	paymentAcknowledged,
	nwcPaymentAttempted,
}: {
	paymentAcknowledged: boolean
	nwcPaymentAttempted: boolean
}): AuctionBidFundingFailureReason =>
	paymentAcknowledged || !nwcPaymentAttempted ? 'invoice_paid_mint_failed_reclaimable' : 'invoice_unpaid_or_expired_reclaimable'

export interface AuctionBidFundingModalCloseResolution {
	/** Lifecycle state after the close: classified failure reason applied, then the funding_canceled fallback. */
	nextState: AuctionBidFundingLifecycleState
	/** Whether the preserved pending bid submission must survive this close. */
	preservePendingSubmission: boolean
}

/**
 * Resolve a deposit-modal close against the funding lifecycle.
 *
 * Ported from the lost full-UX lineage so closing cannot race or double-fire:
 * the (optional) failure classification is applied against the CURRENT state
 * inside a functional state updater, and the `funding_canceled` fallback is
 * only considered AFTER classification — so a reclaimable terminal state can
 * never be clobbered by funding_canceled.
 *
 * A close that carries a failure reason (error/close/timeout classification)
 * always preserves the pending bid submission; a plain close falls back to
 * the state-based CLOSE_PRESERVE_PENDING_SUBMISSION_STATES rule.
 */
export const resolveAuctionBidFundingModalClose = (
	currentState: AuctionBidFundingLifecycleState,
	reason?: AuctionBidFundingFailureReason | null,
): AuctionBidFundingModalCloseResolution => {
	const classifiedState = reason ? resolveAuctionBidFundingTransition(currentState, reason) : currentState
	const nextState = shouldCancelFundingOnModalClose(classifiedState)
		? resolveAuctionBidFundingTransition(classifiedState, 'funding_canceled')
		: classifiedState
	return {
		nextState,
		preservePendingSubmission: reason != null || shouldPreservePendingBidSubmissionOnModalClose(classifiedState),
	}
}

export function useAuctionBidFunding({
	previousBidAmount,
	publishBid,
	onBidSuccess,
	onPendingRulesAck,
	hasAcknowledgedRules,
	republishBid,
}: UseAuctionBidFundingOptions) {
	const [isDepositOpen, setIsDepositOpen] = useState(false)
	const [depositAmount, setDepositAmount] = useState(0)
	const [preferredDepositMint, setPreferredDepositMint] = useState<string | undefined>(undefined)
	const [pendingBidSubmission, setPendingBidSubmission] = useState<AuctionBidFormData | null>(null)
	const [pendingRulesAckBidData, setPendingRulesAckBidData] = useState<AuctionBidFormData | null>(null)
	const [bidFundingLifecycleState, setBidFundingLifecycleState] = useState<AuctionBidFundingLifecycleState>('idle')
	// #12 (Blocker 1): id of the kind-1023 bid event that was already signed
	// and published for the current `pendingBidSubmission`. Set only AFTER the
	// publish succeeds, so `retryBidPublish` can rebroadcast the exact same
	// signed event instead of re-running `publishAuctionBid` (which would
	// re-lock funds and re-sign a new event — double-charging the bidder).
	const [publishedBidEventId, setPublishedBidEventId] = useState<string | null>(null)

	const submitPreparedBid = useCallback(
		async (bidData: AuctionBidFormData) => {
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_publish_attempted'))
			try {
				const publishResult = await publishBid(bidData)
				// Capture the published event id (if the publish path returned one)
				// so a later retry can rebroadcast this exact signed event instead
				// of re-running the full lock+sign pipeline. `publishBid` is wired
				// to `bidMutation.mutateAsync` in AuctionBidder, whose mutationFn
				// resolves to `publishAuctionBid`'s return value — the bid event id.
				if (typeof publishResult === 'string' && publishResult) {
					setPublishedBidEventId(publishResult)
				}
				setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_published'))
				// No success toast here: the staged bid progress dialog ("Bid
				// successfully placed!") is the success surface — a duplicate toast
				// was never part of the staged UX.
				setPendingBidSubmission(null)
				setIsDepositOpen(false)
				onBidSuccess?.()
				return true
			} catch (error) {
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
			// New funding session — clear any captured publish id from a previous
			// leg. Without this, a later retry in a NEW bid session could try to
			// rebroadcast the PREVIOUS leg's event (stale cross-leg leak), which
			// would silently announce an old bid instead of the new one.
			setPublishedBidEventId(null)
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
			// For QR-scan deposits, payment_acknowledged and minting_started are not
			// separately observable (only the final mint 'success' event fires), so
			// the lifecycle may still be at invoice_created when the deposit
			// confirms. Walk forward through the unobservable intermediate states so
			// the transition is valid regardless of which pre-mint state we last
			// observed. Each step is a silent no-op if the state already moved on
			// (invalid transitions keep the current state; self-transitions are
			// allowed), so this is safe and idempotent on the NWC path too, where the
			// modal's payment effect may already have advanced the lifecycle.
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'payment_acknowledged'))
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'minting_started'))
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'ecash_minted'))

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
	 * #12 (Blocker 1): Retry bid publish from the
	 * mint_succeeded_bid_publish_failed_reclaimable state.
	 *
	 * Two retry paths:
	 *
	 * - **Idempotent rebroadcast (preferred):** if the bid was already
	 *   signed and published once (captured in `publishedBidEventId`) and a
	 *   `republishBid` callback is wired, rebroadcast the exact signed
	 *   kind-1023 event by id. This is a relay-only rebroadcast — no
	 *   re-lock, no re-sign, no new event id. This is the correct path
	 *   when the original publish broadcast threw after the event was
	 *   signed (e.g. relay timeout) OR when a prior successful publish
	 *   needs to be re-announced to relays that missed it.
	 *
	 * - **Full re-submit (fallback):** when no event id was captured (the
	 *   publish threw before signing completed, so there's nothing to
	 *   rebroadcast) or no `republishBid` callback is wired, fall back to
	 *   `submitPreparedBid`, which re-runs `publishAuctionBid` (re-lock +
	 *   re-sign). This only happens when there's genuinely no signed event
	 *   to rebroadcast.
	 *
	 * The rebroadcast path is what makes this idempotent: retrying a
	 * completed-but-not-broadcast publish never double-charges the bidder.
	 */
	const retryBidPublish = useCallback(async () => {
		if (!pendingBidSubmission) return
		if (publishedBidEventId && republishBid) {
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_publish_attempted'))
			try {
				await republishBid(publishedBidEventId)
				setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_published'))
				setPendingBidSubmission(null)
				setIsDepositOpen(false)
				setPublishedBidEventId(null)
				onBidSuccess?.()
			} catch (error) {
				setBidFundingLifecycleState((currentState) =>
					resolveAuctionBidFundingTransition(currentState, 'mint_succeeded_bid_publish_failed_reclaimable'),
				)
				const errorMessage = error instanceof Error ? error.message : String(error)
				toast.error(`Bid rebroadcast failed: ${errorMessage}`)
			}
			return
		}
		await submitPreparedBid(pendingBidSubmission)
	}, [pendingBidSubmission, publishedBidEventId, republishBid, submitPreparedBid, onBidSuccess])

	const handleInvoiceCreated = useCallback(() => {
		setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'invoice_created'))
	}, [])

	const handlePaymentAcknowledged = useCallback(() => {
		setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'payment_acknowledged'))
	}, [])

	const handleMintingStarted = useCallback(() => {
		setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'minting_started'))
	}, [])

	const handleFundingFailed = useCallback((reason: AuctionBidFundingFailureReason) => {
		setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, reason))
	}, [])

	const handleDepositModalClose = useCallback(
		(reason?: AuctionBidFundingFailureReason | null) => {
			// Apply the (optional) close classification BEFORE the modal-open state
			// flips, against the CURRENT lifecycle state inside a functional updater,
			// so a reclaimable classification can never be clobbered by the
			// funding_canceled fallback and closing cannot race or double-fire.
			setBidFundingLifecycleState((current) => resolveAuctionBidFundingModalClose(current, reason).nextState)
			setIsDepositOpen(false)
			setPendingBidSubmission((current) =>
				resolveAuctionBidFundingModalClose(bidFundingLifecycleState, reason).preservePendingSubmission ? current : null,
			)
		},
		[bidFundingLifecycleState],
	)

	return {
		bidFundingLifecycleState,
		isDepositOpen,
		depositAmount,
		preferredDepositMint,
		startFundingForBid,
		submitPreparedBid,
		handleFundingSuccess,
		handleInvoiceCreated,
		handlePaymentAcknowledged,
		handleMintingStarted,
		handleFundingFailed,
		handleDepositModalClose,
		resumeBidAfterRulesAck,
		retryBidPublish,
		publishedBidEventId,
	}
}
