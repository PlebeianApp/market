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

interface UseAuctionBidFundingOptions {
	previousBidAmount: number
	publishBid: (bidData: AuctionBidFormData) => Promise<string>
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
])

const AUCTION_BID_FUNDING_ALLOWED_TRANSITIONS: Record<AuctionBidFundingLifecycleState, ReadonlySet<AuctionBidFundingLifecycleState>> = {
	idle: new Set(['funding_session_created', 'invoice_unpaid_or_expired_reclaimable', 'bid_publish_attempted', 'funding_canceled']),
	funding_session_created: new Set(['invoice_created', 'invoice_unpaid_or_expired_reclaimable', 'funding_canceled']),
	invoice_created: new Set(['payment_acknowledged', 'invoice_unpaid_or_expired_reclaimable', 'funding_canceled']),
	payment_acknowledged: new Set(['minting_started', 'invoice_paid_mint_failed_reclaimable']),
	minting_started: new Set(['ecash_minted', 'invoice_paid_mint_failed_reclaimable']),
	ecash_minted: new Set(['ecash_minted_pending_rules_ack', 'bid_publish_attempted', 'invoice_paid_mint_failed_reclaimable']),
	ecash_minted_pending_rules_ack: new Set(['bid_publish_attempted', 'funding_session_created']),
	bid_publish_attempted: new Set(['bid_published', 'mint_succeeded_bid_publish_failed_reclaimable']),
	bid_published: new Set(['funding_session_created']),
	invoice_unpaid_or_expired_reclaimable: new Set(['funding_session_created']),
	invoice_paid_mint_failed_reclaimable: new Set(['funding_session_created']),
	mint_succeeded_bid_publish_failed_reclaimable: new Set(['bid_publish_attempted', 'funding_session_created']),
	funding_canceled: new Set(['funding_session_created']),
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

export function useAuctionBidFunding({
	previousBidAmount,
	publishBid,
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

	const submitPreparedBid = useCallback(
		async (bidData: AuctionBidFormData) => {
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_publish_attempted'))
			try {
				const bidEventId = await publishBid(bidData)
				setPublishedBidEventId(bidEventId)
				setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'bid_published'))
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
	 * Retry bid publish from the mint_succeeded_bid_publish_failed_reclaimable
	 * state. Uses the preserved pendingBidSubmission so the user doesn't need
	 * to re-enter the bid amount or reselect mints.
	 */
	const retryBidPublish = useCallback(async () => {
		if (!pendingBidSubmission) return
		await submitPreparedBid(pendingBidSubmission)
	}, [pendingBidSubmission, submitPreparedBid])

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
		if (shouldCancelFundingOnModalClose(bidFundingLifecycleState)) {
			setBidFundingLifecycleState((currentState) => resolveAuctionBidFundingTransition(currentState, 'funding_canceled'))
		}
		setIsDepositOpen(false)
		if (!shouldPreservePendingBidSubmissionOnModalClose(bidFundingLifecycleState)) {
			setPendingBidSubmission(null)
		}
	}, [bidFundingLifecycleState])

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
		handleFundingFailed,
		handleDepositModalClose,
		resumeBidAfterRulesAck,
		retryBidPublish,
		publishedBidEventId,
	}
}
