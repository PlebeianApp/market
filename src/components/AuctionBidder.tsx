import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DepositLightningModal } from '@/feature/wallet/components/DepositLightningModal'
import { usePublishAuctionBidMutation, type AuctionBidFormData } from '@/publish/auctions'
import {
	getAuctionBiddingCutoffAt,
	getAuctionEndAt,
	getAuctionBidIncrement,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionP2pkXpub,
	getAuctionMints,
	getAuctionId,
	useAuctionBids,
	getAuctionRootEventId,
	getAuctionSettlementGrace,
	getAuctionCurrentPriceFromBids,
	getBidAmount,
} from '@/queries/auctions'
import { computeAuctionBidFloor, getAuctionMinBidCurve } from '@/lib/auctionSettlement'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { toast } from 'sonner'
import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useAuctionCountdown } from './AuctionCountdown'
import { Pencil, Plus, Minus, X, CircleX, TheaterIcon } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import { cn } from '@/lib/utils'
import { TooltipToggleGroupItem } from './shared/TooltipToggleGroupItem'
import { useStore } from '@tanstack/react-store'
import { nip60Store } from '@/lib/stores/nip60'
import { authStore } from '@/lib/stores/auth'
import { uiActions } from '@/lib/stores/ui'
import { normalizeMintUrl } from '@/lib/wallet'
import { resolveAuctionMintSelection, type AvailableMint, type MintSelectionResult } from '@/lib/auctionMintSelection'

const AUCTION_RULES_ACK_VERSION = 'v1'

interface AuctionBidderProps {
	auction: NDKEvent
	/** Pre-fetched bids from a parent. Skip the internal bid subscription when provided. */
	bids?: NDKEvent[]
	currentUserPubkey?: string
	onBidSuccess?: () => void
	compact?: boolean
}

export function useAuctionMintSelection(trustedMints: string[], bidAmount: number, previousBidAmount: number = 0) {
	const nip60State = useStore(nip60Store)
	const [manualMint, setManualMint] = useState<string | null>(null)

	const deltaAmount = Math.max(0, bidAmount - previousBidAmount)

	const result = useMemo<MintSelectionResult>(
		() =>
			resolveAuctionMintSelection({
				trustedMints,
				walletMints: nip60State.mints ?? [],
				mintBalances: nip60State.mintBalances ?? {},
				bidAmount,
				previousBidAmount,
			}),
		[trustedMints, nip60State.mints, nip60State.mintBalances, bidAmount, previousBidAmount],
	)

	const manualMintValid = manualMint ? result.availableMints.some((m) => m.mintUrl === manualMint) : false

	const selectedMint = manualMintValid ? manualMint : result.selectedMint
	const walletMintSet = new Set((nip60State.mints ?? []).map(normalizeMintUrl))
	const unfundedWalletMint = result.unfundedTrustedMints.find((mint) => walletMintSet.has(normalizeMintUrl(mint))) ?? null
	const depositMint = manualMintValid
		? manualMint
		: (result.insufficientBalanceMints[0]?.mintUrl ?? result.availableMints[0]?.mintUrl ?? unfundedWalletMint)

	const setSelectedMint = useCallback((mintUrl: string | null) => {
		setManualMint(mintUrl)
	}, [])

	const eligibleMints = result.eligibleMints

	return {
		selectedMint,
		depositMint,
		availableMints: result.availableMints,
		eligibleMints,
		insufficientBalanceMints: result.insufficientBalanceMints,
		mintError: result.error,
		setSelectedMint,
		showMintSelector: result.availableMints.filter((m) => m.balance > 0).length > 1,
		canFund: selectedMint
			? (result.availableMints.find((m) => m.mintUrl === selectedMint)?.balance ?? 0) >= deltaAmount
			: eligibleMints.length > 0,
		deltaAmount,
	}
}

export function AuctionBidder({ auction, bids: bidsProp, currentUserPubkey, onBidSuccess, compact = false }: AuctionBidderProps) {
	const bidMutation = usePublishAuctionBidMutation()
	const { status: nip60Status } = useStore(nip60Store)
	const { isAuthenticated, user } = useStore(authStore)

	// Derive auction state
	const auctionId = auction.id
	const startingBid = getAuctionStartingBid(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const trustedMints = getAuctionMints(auction)
	const auctionDTag = getAuctionId(auction)

	const auctionCoordinates = auctionDTag && auction ? `30408:${auction.pubkey}:${auctionDTag}` : ''

	const auctionRootEventId = getAuctionRootEventId(auction)
	const shouldFetchBids = bidsProp === undefined
	const bidsQuery = useAuctionBids(
		shouldFetchBids ? auctionRootEventId || auctionId : '',
		500,
		shouldFetchBids ? auctionCoordinates : undefined,
	)
	const bids = bidsProp ?? bidsQuery.data ?? []
	const endAt = getAuctionEndAt(auction)
	const startAt = getAuctionStartAt(auction)
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const countdown = useAuctionCountdown(biddingCutoffAt, { showSeconds: true })
	const ended = countdown.isEnded
	// Lower-bound gate: bidding is closed until start_at elapses. Using the
	// countdown's ticking `now` keeps this reactive — the UI flips from
	// "Not started yet" to "Place Bid" the moment start_at passes.
	const notStarted = startAt > 0 && countdown.now < startAt

	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const signedInBidderPubkey = isAuthenticated ? user?.pubkey || currentUserPubkey || '' : ''
	const hasSignedInBidder = !!signedInBidderPubkey
	const isNip60Ready = nip60Status === 'ready'
	const isNip60Loading = nip60Status === 'idle' || nip60Status === 'initializing'
	const previousBidAmount = useMemo(() => {
		if (!signedInBidderPubkey) return 0
		const myBids = bids.filter((b) => b.pubkey === signedInBidderPubkey)
		if (!myBids.length) return 0
		return Math.max(...myBids.map(getBidAmount))
	}, [bids, signedInBidderPubkey])
	// AUCTIONS.md §6.1 — bidder-side live floor. Display the floor at
	// `client_now` (no inflation). The CVM server is more lenient by
	// `BID_FLOOR_TIME_GRACE_SECONDS = 5`, so a click at the displayed
	// price is always accepted within the GRACE window. Recomputes
	// every tick via `useAuctionCountdown.now`, so the bidder watches
	// the floor rise in real time once the curve window opens.

	// Ref to store the last computed curve floor value
	const lastCurveFloorRef = useRef<number>(0)

	const curveFloor = useMemo(() => {
		// Only update the curve floor if the auction hasn't ended
		// This prevents the minBid value from changing after the auction ends
		if (ended) {
			// Return the last computed value when auction is ended
			return lastCurveFloorRef.current
		}

		const computedFloor = computeAuctionBidFloor(auction, currentPrice, countdown.now)
		// Store the computed value for use when auction ends
		lastCurveFloorRef.current = computedFloor
		return computedFloor
	}, [auction, currentPrice, countdown.now, ended])

	const flatFloor = Math.max(startingBid, currentPrice + Math.max(1, bidIncrement))
	const minBid = Math.max(flatFloor, curveFloor)
	const inCurveWindow = countdown.now > endAt && countdown.now < biddingCutoffAt
	const auctionCurve = useMemo(() => getAuctionMinBidCurve(auction), [auction])

	const isOwnAuction = signedInBidderPubkey === auction.pubkey
	const auctionRulesBidderPubkey = signedInBidderPubkey || currentUserPubkey || ''
	const auctionRulesAuctionIdentity = auctionRootEventId || auction.id
	const auctionRulesAckKey =
		hasSignedInBidder && auctionRulesBidderPubkey && auctionRulesAuctionIdentity
			? `auction-rules-ack:${AUCTION_RULES_ACK_VERSION}:${auctionRulesBidderPubkey}:${auctionRulesAuctionIdentity}`
			: null

	// State for input and view mode
	const [bidAmountInput, setBidAmountInput] = useState<string>('')
	const [isEditing, setIsEditing] = useState(false)
	const [isDepositOpen, setIsDepositOpen] = useState(false)
	const [depositAmount, setDepositAmount] = useState(0)
	const [preferredDepositMint, setPreferredDepositMint] = useState<string | undefined>(undefined)
	const [isRulesDialogOpen, setIsRulesDialogOpen] = useState(false)
	const [hasAcknowledgedAuctionRules, setHasAcknowledgedAuctionRules] = useState(false)

	// Parse the input safely
	const parsedBidAmount = useMemo(() => {
		const val = parseInt(bidAmountInput || '0', 10)
		return Number.isFinite(val) ? val : NaN
	}, [bidAmountInput])

	const { selectedMint, depositMint, availableMints, showMintSelector, mintError, setSelectedMint, canFund, deltaAmount } =
		useAuctionMintSelection(trustedMints, Number.isFinite(parsedBidAmount) ? parsedBidAmount : 0, previousBidAmount)

	const hasInsufficientBidFunds =
		hasSignedInBidder &&
		isNip60Ready &&
		!ended &&
		!notStarted &&
		!isOwnAuction &&
		Number.isFinite(parsedBidAmount) &&
		parsedBidAmount >= minBid &&
		deltaAmount > 0 &&
		!canFund

	// Initialize input to min bid on mount or when min changes
	useEffect(() => {
		setBidAmountInput(String(minBid))
	}, [minBid])

	useEffect(() => {
		if (!auctionRulesAckKey || typeof window === 'undefined') {
			setHasAcknowledgedAuctionRules(false)
			return
		}

		try {
			setHasAcknowledgedAuctionRules(window.localStorage.getItem(auctionRulesAckKey) === 'true')
		} catch {
			setHasAcknowledgedAuctionRules(false)
		}
	}, [auctionRulesAckKey])

	// Disable logic
	const isDisabledInput = ended || notStarted || isOwnAuction || bidMutation.isPending
	const isDisabledBid = isDisabledInput || !Number.isFinite(parsedBidAmount) || parsedBidAmount < minBid

	// Determine which toggle is active based on current input
	const getSelectedValue = () => {
		// Check for invalid result
		if (!Number.isFinite(parsedBidAmount)) return ''

		if (parsedBidAmount === currentPrice + bidIncrement) return 'inc1'

		// Only return these values as selected if the options are showing.
		if (!compact) {
			if (parsedBidAmount === currentPrice + bidIncrement * 2) return 'inc2'
			if (parsedBidAmount === Math.max(currentPrice * 2, minBid)) return 'mult2'
		}

		// For custom values, the "edit" is selected (when shown).
		return 'edit'
	}

	// Button text logic
	const buttonText = useMemo(() => {
		if (isOwnAuction) return 'Your Auction'
		if (ended) return 'Auction Ended'
		if (notStarted) return 'Bidding not started'
		if (bidMutation.isPending) return 'Submitting...'
		if (!hasSignedInBidder) return 'Sign in to bid'
		const selectedValue = getSelectedValue()
		if (compact || selectedValue === 'edit' || selectedValue === 'mult2') return 'Bid ' + parsedBidAmount.toLocaleString() + ' sats'
		return 'Place Bid'
	}, [isOwnAuction, ended, notStarted, bidMutation.isPending, hasSignedInBidder, compact, parsedBidAmount])

	const prepareBidSubmission = (): AuctionBidFormData | null => {
		if (!auction || !auctionCoordinates || ended || notStarted || isOwnAuction) return null

		const parsedAmount = parseInt(bidAmountInput || '0', 10)
		if (!Number.isFinite(parsedAmount) || parsedAmount < minBid) {
			toast.error(`Bid must be at least ${minBid.toLocaleString()} sats`)
			return null
		}

		if (!hasSignedInBidder) {
			uiActions.openDialog('login')
			return null
		}

		if (isNip60Loading) {
			toast.info('Wallet is still loading. Try again in a moment.')
			return null
		}

		if (hasInsufficientBidFunds) {
			if (!depositMint) {
				toast.error(mintError || 'No suitable mint available for bidding.')
				return null
			}

			setDepositAmount(Math.ceil(deltaAmount))
			setPreferredDepositMint(depositMint)
			setIsDepositOpen(true)
			return null
		}

		// Under `cashu_p2pk_bidder_path_v1` the bidder generates the
		// derivation path locally and never consults a "path issuer"
		// oracle - that was the v1 CVM-coordinator scheme. The only
		// auction tag the bidder actually needs is `p2pk_xpub`; if
		// it's absent the auction isn't biddable.
		if (!p2pkXpub) {
			toast.error('This auction is missing a p2pk_xpub and cannot accept bids.')
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

		return {
			auctionEventId: auctionRootEventId || auction.id,
			auctionCoordinates,
			amount: parsedAmount,
			auctionStartAt: startAt,
			auctionEffectiveEndAt: biddingCutoffAt,
			auctionLocktimeAt: biddingCutoffAt,
			settlementGraceSeconds: getAuctionSettlementGrace(auction),
			sellerPubkey: auction.pubkey,
			p2pkXpub,
			mintCandidates: selectedMint ? [selectedMint, ...trustedMints.filter((m) => m !== selectedMint)] : trustedMints,
		}
	}

	const submitPreparedBid = async (bidData: AuctionBidFormData) => {
		try {
			await bidMutation.mutateAsync(bidData)
			toast.success('Bid placed successfully')
			setIsEditing(false)
			onBidSuccess?.()
		} catch {
			// Error handled by mutation
		}
	}

	const handleSubmitBid = async () => {
		const bidData = prepareBidSubmission()
		if (!bidData) return

		if (!hasAcknowledgedAuctionRules) {
			setIsRulesDialogOpen(true)
			return
		}

		await submitPreparedBid(bidData)
	}

	const handleRulesDialogOpenChange = (open: boolean) => {
		setIsRulesDialogOpen(open)
	}

	const handleConfirmRules = () => {
		if (auctionRulesAckKey) {
			try {
				if (typeof window !== 'undefined') {
					window.localStorage.setItem(auctionRulesAckKey, 'true')
				}
			} catch {
				// Local persistence failed; keep the acknowledgment in memory for this mounted session.
			}
		}

		setHasAcknowledgedAuctionRules(true)
		setIsRulesDialogOpen(false)
		toast.info('Auction rules reviewed. Check the current bid amount before placing your bid.')
	}

	return (
		<div className="flex flex-col gap-2 w-full">
			<DepositLightningModal
				open={isDepositOpen}
				onClose={() => setIsDepositOpen(false)}
				initialAmount={depositAmount}
				preferredMint={preferredDepositMint}
			/>
			<Dialog open={isRulesDialogOpen} onOpenChange={handleRulesDialogOpenChange}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Review auction rules before bidding</DialogTitle>
						<DialogDescription>
							Auction bids use Cashu e-cash with P2PK locks. Review what can happen to your funds before placing bids in this auction.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3 py-2 text-sm text-muted-foreground">
						<ul className="list-disc space-y-2 pl-5">
							<li>
								Your bid may lock Cashu e-cash to an auction-derived P2PK key, with a refund path that only opens after the auction and
								settlement window.
							</li>
							<li>
								The lock is designed so the seller cannot redeem the bid from public relay data alone before settlement; settlement requires
								the bid-specific path secret.
							</li>
							<li>
								If you win, settlement may require you to reveal or transfer the bid's path secret so the seller can redeem the funds.
							</li>
							<li>
								If the winning bid is not settled before the settlement window closes, it may be invalidated or move to the refund/fallback
								path.
							</li>
							<li>If you lose, or settlement does not complete, your funds may only become refundable after the refund window opens.</li>
							<li>
								This auction still relies on trusted parties: Cashu mints custody the bitcoin behind e-cash, validators/auditors and relay
								data affect what the app shows, and bidders/sellers must complete settlement and delivery honestly.
							</li>
						</ul>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => handleRulesDialogOpenChange(false)} disabled={bidMutation.isPending}>
							Cancel
						</Button>
						<Button onClick={handleConfirmRules} disabled={bidMutation.isPending}>
							I understand these rules
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{/* Anti-snipe curve banner — visible only when we're inside
			    `(end_at, max_end_at]` AND the auction has a non-`none` curve.
			    Tells the bidder why the floor is higher than they'd expect
			    from the flat `currentPrice + bidIncrement`. AUCTIONS.md §6.1. */}
			{!ended && inCurveWindow && auctionCurve.shape !== 'none' && (
				<div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
					<p className="font-semibold">Anti-snipe window — minimum bid rising</p>
					<p className="mt-0.5 text-amber-700">
						Flat bidding has ended. Bids are still accepted until auction end, but the floor ramps up{' '}
						<span className="font-semibold">{auctionCurve.shape}</span>ly to {auctionCurve.peakMultiplier}× by then. Floor right now:{' '}
						<span className="font-semibold">{minBid.toLocaleString()} sats</span>.
					</p>
				</div>
			)}

			{!compact && showMintSelector && (
				<div className="flex items-center gap-2">
					<span className="text-xs text-foreground/60 whitespace-nowrap">Mint:</span>
					<ToggleGroup
						type="single"
						value={selectedMint ?? ''}
						onValueChange={(val) => {
							if (val) setSelectedMint(val)
						}}
						className="flex flex-wrap gap-1"
					>
						{availableMints
							.filter((m) => m.balance > 0)
							.map((m) => (
								<TooltipToggleGroupItem
									key={m.mintUrl}
									value={m.mintUrl}
									variant="outline"
									size="sm"
									tooltip={`${m.mintUrl} — ${m.balance.toLocaleString()} sats`}
									disabled={isDisabledInput || !m.hasSufficientBalance}
									className={cn('cursor-pointer flex text-xs', !m.hasSufficientBalance && 'opacity-60')}
								>
									{m.hostname} <span className="text-foreground/50">({m.balance.toLocaleString()})</span>
								</TooltipToggleGroupItem>
							))}
					</ToggleGroup>
				</div>
			)}
			{/* Main Action Area */}
			<div className={cn('flex flex-col sm:flex-row gap-2 items-stretch sm:items-center')}>
				{!compact &&
					(isEditing ? (
						// EDIT MODE: Input Field
						<InputGroup className="grow w-auto">
							<InputGroupInput
								type="number"
								min={minBid}
								step={Math.max(1, bidIncrement)}
								value={bidAmountInput}
								onChange={(e) => setBidAmountInput(e.target.value)}
								placeholder={`Min: ${minBid.toLocaleString()}`}
								disabled={isDisabledInput}
								autoFocus
							/>
							<InputGroupAddon align="inline-end">
								<CircleX onClick={() => setIsEditing(false)} className="size-4 cursor-pointer" />
							</InputGroupAddon>
						</InputGroup>
					) : (
						// QUICK ACTION MODE: Toggle Group
						<ToggleGroup
							type="single"
							value={getSelectedValue()}
							onValueChange={(val) => {
								if (!val) return
								if (val === 'inc1') {
									setBidAmountInput(String(currentPrice + bidIncrement))
								} else if (val === 'inc2') {
									setBidAmountInput(String(currentPrice + bidIncrement * 2))
								} else if (val === 'mult2') {
									setBidAmountInput(String(Math.max(currentPrice * 2, minBid)))
								} else if (val === 'edit') {
									setIsEditing(true)
								}
							}}
							className={cn('flex w-auto')}
						>
							<TooltipToggleGroupItem
								value="inc1"
								variant="outline"
								size="sm"
								tooltip="Minimum Bid Increment"
								disabled={isDisabledInput}
								className={cn('cursor-pointer flex')}
							>
								{minBid.toLocaleString()} sats
							</TooltipToggleGroupItem>

							<TooltipToggleGroupItem
								value="inc2"
								variant="outline"
								size="sm"
								tooltip="2x Minimum Bid Increment"
								disabled={isDisabledInput}
								className="flex cursor-pointer"
							>
								{(minBid + bidIncrement).toLocaleString()} sats
							</TooltipToggleGroupItem>
							<TooltipToggleGroupItem
								value="mult2"
								variant="outline"
								size="sm"
								tooltip="2x Current Bid"
								disabled={isDisabledInput}
								className="flex cursor-pointer"
							>
								<X className="size-3 mr-1" /> 2
							</TooltipToggleGroupItem>
							<TooltipToggleGroupItem
								value="edit"
								variant="outline"
								size="sm"
								onClick={() => setIsEditing(true) /* Enforce on-click behavior */}
								tooltip={
									getSelectedValue() === 'edit' ? 'Custom Bid: ' + bidAmountInput.toLocaleString() + ' SATS' : 'Customize Bid Amount'
								}
								disabled={isDisabledInput}
								className="flex cursor-pointer"
								title="Customize bid"
							>
								<Pencil className="h-3 w-3" />
							</TooltipToggleGroupItem>
						</ToggleGroup>
					))}

				{/* Place Bid Button */}
				<Button
					onClick={handleSubmitBid}
					disabled={isDisabledBid}
					variant={ended ? 'ghost' : isOwnAuction ? 'secondary' : 'default'}
					className={cn('whitespace-nowrap flex grow')}
				>
					{buttonText}
				</Button>
			</div>

			{/* Minimum Bid Info */}
			{!compact && !ended && <div className="text-xs text-foreground/80 pl-1">Minimum allowed bid: {minBid.toLocaleString()} sats</div>}
			{hasAcknowledgedAuctionRules && hasSignedInBidder && !isOwnAuction && (
				<Button
					type="button"
					variant="link"
					size="sm"
					onClick={() => setIsRulesDialogOpen(true)}
					className="h-auto justify-start p-0 text-xs text-muted-foreground"
				>
					Review auction rules
				</Button>
			)}
		</div>
	)
}
