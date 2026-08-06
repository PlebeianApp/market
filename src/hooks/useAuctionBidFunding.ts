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
	| 'bid_publish_attempted'
	| 'bid_published'
	| 'invoice_unpaid_or_expired_reclaimable'
	| 'invoice_paid_mint_failed_reclaimable'
	| 'mint_succeeded_bid_publish_failed_reclaimable'
	| 'funding_canceled'

export type AuctionBidFundingFailureReason = 'invoice_unpaid_or_expired_reclaimable' | 'invoice_paid_mint_failed_reclaimable'

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
}

const TERMINAL_FUNDING_STATES: AuctionBidFundingLifecycleState[] = [
	'bid_published',
	'invoice_unpaid_or_expired_reclaimable',
	'invoice_paid_mint_failed_reclaimable',
	'mint_succeeded_bid_publish_failed_reclaimable',
]

export function useAuctionBidFunding({ previousBidAmount, publishBid, onBidSuccess }: UseAuctionBidFundingOptions) {
	const [isDepositOpen, setIsDepositOpen] = useState(false)
	const [depositAmount, setDepositAmount] = useState(0)
	const [preferredDepositMint, setPreferredDepositMint] = useState<string | undefined>(undefined)
	const [pendingBidSubmission, setPendingBidSubmission] = useState<AuctionBidFormData | null>(null)
	const [bidFundingLifecycleState, setBidFundingLifecycleState] = useState<AuctionBidFundingLifecycleState>('idle')

	const transitionFundingState = useCallback((nextState: AuctionBidFundingLifecycleState) => {
		setBidFundingLifecycleState(nextState)
	}, [])

	const submitPreparedBid = useCallback(
		async (bidData: AuctionBidFormData) => {
			transitionFundingState('bid_publish_attempted')
			try {
				await publishBid(bidData)
				transitionFundingState('bid_published')
				toast.success('Bid placed successfully')
				setPendingBidSubmission(null)
				setIsDepositOpen(false)
				onBidSuccess?.()
				return true
			} catch (error) {
				transitionFundingState('mint_succeeded_bid_publish_failed_reclaimable')
				const errorMessage = error instanceof Error ? error.message : String(error)
				toast.error(`Funding completed, but bid publishing failed: ${errorMessage}`)
				return false
			}
		},
		[onBidSuccess, publishBid, transitionFundingState],
	)

	const startFundingForBid = useCallback(
		({ bidData, hasInsufficientBidFunds, depositMint, deltaAmount, mintError, selectedMint, canFund }: StartFundingForBidInput) => {
			if (hasInsufficientBidFunds) {
				if (!depositMint) {
					toast.error(mintError || 'No suitable mint available for bidding.')
					transitionFundingState('invoice_unpaid_or_expired_reclaimable')
					return null
				}

				transitionFundingState('funding_session_created')
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
		[transitionFundingState],
	)

	const handleFundingSuccess = useCallback(() => {
		if (!pendingBidSubmission) return

		void (async () => {
			transitionFundingState('ecash_minted')

			try {
				await nip60Actions.refresh()
			} catch {
				// Best-effort refresh; we still evaluate from current wallet state below.
			}

			const fundingMintCandidates = pendingBidSubmission.mintCandidates
			if (!fundingMintCandidates.length) {
				transitionFundingState('invoice_paid_mint_failed_reclaimable')
				toast.error('Invoice was paid, but no funding mint was selected for bid locking. Please retry the bid submission.')
				return
			}

			const latestNip60State = nip60Store.state
			const requiredDelta = Math.max(0, pendingBidSubmission.amount - previousBidAmount)
			const fundableMint = fundingMintCandidates.find((mintUrl) => (latestNip60State.mintBalances[mintUrl] ?? 0) >= requiredDelta)

			if (!fundableMint) {
				transitionFundingState('invoice_paid_mint_failed_reclaimable')
				toast.error('Invoice was paid, but minted funds are not yet spendable on any accepted mint. Please retry once minting completes.')
				return
			}

			const orderedMintCandidates = [fundableMint, ...fundingMintCandidates.filter((mintUrl) => mintUrl !== fundableMint)]
			await submitPreparedBid({ ...pendingBidSubmission, mintCandidates: orderedMintCandidates })
		})()
	}, [pendingBidSubmission, previousBidAmount, submitPreparedBid, transitionFundingState])

	const handleInvoiceCreated = useCallback(() => {
		transitionFundingState('invoice_created')
	}, [transitionFundingState])

	const handlePaymentAcknowledged = useCallback(() => {
		transitionFundingState('payment_acknowledged')
	}, [transitionFundingState])

	const handleMintingStarted = useCallback(() => {
		transitionFundingState('minting_started')
	}, [transitionFundingState])

	const handleFundingFailed = useCallback(
		(reason: AuctionBidFundingFailureReason) => {
			transitionFundingState(reason)
		},
		[transitionFundingState],
	)

	const handleDepositModalClose = useCallback(() => {
		if (!TERMINAL_FUNDING_STATES.includes(bidFundingLifecycleState)) {
			transitionFundingState('funding_canceled')
		}
		setIsDepositOpen(false)
		setPendingBidSubmission(null)
	}, [bidFundingLifecycleState, transitionFundingState])

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
	}
}
