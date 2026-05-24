import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { usePublishAuctionBidMutation } from '@/publish/auctions'
import {
	getAuctionEndAt,
	getAuctionBidIncrement,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionP2pkXpub,
	getAuctionMints,
	getAuctionId,
	useAuctionBids,
	getAuctionEffectiveEndAt,
	getAuctionRootEventId,
	getAuctionPathIssuer,
	getAuctionMaxEndAt,
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
import { resolveAuctionMintSelection, type AvailableMint, type MintSelectionResult } from '@/lib/auctionMintSelection'

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

	const manualMintCanFund = manualMint ? (result.availableMints.find((m) => m.mintUrl === manualMint)?.balance ?? 0 >= deltaAmount) : false

	const selectedMint = manualMintValid ? manualMint : result.selectedMint

	const setSelectedMint = useCallback((mintUrl: string | null) => {
		setManualMint(mintUrl)
	}, [])

	const eligibleMints = result.eligibleMints

	return {
		selectedMint,
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

	// Derive auction state
	const auctionId = auction.id
	const startingBid = getAuctionStartingBid(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const trustedMints = getAuctionMints(auction)
	const auctionDTag = getAuctionId(auction)
	const pathIssuerPubkey = getAuctionPathIssuer(auction)

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
	const effectiveEndAt = getAuctionEffectiveEndAt(auction, bids) || endAt
	const countdown = useAuctionCountdown(effectiveEndAt, { showSeconds: true })
	const ended = countdown.isEnded
	// Lower-bound gate: bidding is closed until start_at elapses. Using the
	// countdown's ticking `now` keeps this reactive — the UI flips from
	// "Not started yet" to "Place Bid" the moment start_at passes.
	const notStarted = startAt > 0 && countdown.now < startAt

	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const previousBidAmount = useMemo(() => {
		if (!currentUserPubkey) return 0
		const myBids = bids.filter((b) => b.pubkey === currentUserPubkey)
		if (!myBids.length) return 0
		return Math.max(...myBids.map(getBidAmount))
	}, [bids, currentUserPubkey])
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
	const inCurveWindow = countdown.now > endAt && countdown.now < (getAuctionMaxEndAt(auction) || endAt)
	const auctionCurve = useMemo(() => getAuctionMinBidCurve(auction), [auction])

	const isOwnAuction = currentUserPubkey === auction.pubkey

	// State for input and view mode
	const [bidAmountInput, setBidAmountInput] = useState<string>('')
	const [isEditing, setIsEditing] = useState(false)

	// Parse the input safely
	const parsedBidAmount = useMemo(() => {
		const val = parseInt(bidAmountInput || '0', 10)
		return Number.isFinite(val) ? val : NaN
	}, [bidAmountInput])

	const { selectedMint, availableMints, showMintSelector, mintError, setSelectedMint, canFund } = useAuctionMintSelection(
		trustedMints,
		Number.isFinite(parsedBidAmount) ? parsedBidAmount : 0,
		previousBidAmount,
	)

	// Initialize input to min bid on mount or when min changes
	useEffect(() => {
		setBidAmountInput(String(minBid))
	}, [minBid])

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
		const selectedValue = getSelectedValue()
		if (compact || selectedValue === 'edit' || selectedValue === 'mult2') return 'Bid ' + parsedBidAmount.toLocaleString() + ' sats'
		return 'Place Bid'
	}, [isOwnAuction, ended, notStarted, bidMutation.isPending, parsedBidAmount])

	const handleSubmitBid = async () => {
		if (!auction || !auctionCoordinates || ended || notStarted || isOwnAuction) return

		const parsedAmount = parseInt(bidAmountInput || '0', 10)
		if (!Number.isFinite(parsedAmount) || parsedAmount < minBid) {
			toast.error(`Bid must be at least ${minBid.toLocaleString()} sats`)
			return
		}

		try {
			if (!pathIssuerPubkey) {
				toast.error('This auction is missing a path_issuer pubkey and cannot accept bids.')
				return
			}
			if (!p2pkXpub) {
				toast.error('This auction is missing a p2pk_xpub and cannot accept bids.')
				return
			}
			if (!selectedMint) {
				toast.error(mintError || 'No suitable mint available for bidding.')
				return
			}
			if (!canFund) {
				toast.error('Insufficient balance on selected mint to cover the required delta.')
				return
			}
			await bidMutation.mutateAsync({
				auctionEventId: auctionRootEventId || auction.id,
				auctionCoordinates,
				amount: parsedAmount,
				auctionStartAt: startAt,
				auctionEffectiveEndAt: effectiveEndAt,
				auctionLocktimeAt: getAuctionMaxEndAt(auction),
				settlementGraceSeconds: getAuctionSettlementGrace(auction),
				sellerPubkey: auction.pubkey,
				pathIssuerPubkey,
				p2pkXpub,
				mintCandidates: selectedMint ? [selectedMint, ...trustedMints.filter((m) => m !== selectedMint)] : trustedMints,
			})
			toast.success('Bid placed successfully')
			setIsEditing(false)
			onBidSuccess?.()
		} catch {
			// Error handled by mutation
		}
	}

	return (
		<div className="flex flex-col gap-2 w-full">
			{/* Anti-snipe curve banner — visible only when we're inside
			    `(end_at, max_end_at]` AND the auction has a non-`none` curve.
			    Tells the bidder why the floor is higher than they'd expect
			    from the flat `currentPrice + bidIncrement`. AUCTIONS.md §6.1. */}
			{!ended && inCurveWindow && auctionCurve.shape !== 'none' && (
				<div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
					<p className="font-semibold">Anti-snipe window — minimum bid rising</p>
					<p className="mt-0.5 text-amber-700">
						The auction's nominal end has passed. Bids are still accepted until the absolute end, but the floor ramps up{' '}
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
		</div>
	)
}
