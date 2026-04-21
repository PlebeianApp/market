import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { usePublishAuctionBidMutation } from '@/publish/auctions'
import {
	getAuctionEndAt,
	getAuctionBidIncrement,
	getAuctionStartingBid,
	getAuctionP2pkXpub,
	getAuctionMints,
	getAuctionId,
	useAuctionBids,
	getAuctionEffectiveEndAt,
	getAuctionRootEventId,
	getAuctionPathIssuer,
	getAuctionMaxEndAt,
	getAuctionCurrentPriceFromBids,
} from '@/queries/auctions'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { toast } from 'sonner'
import { useMemo, useState, useEffect } from 'react'
import { useAuctionCountdown } from './AuctionCountdown'
import { Pencil, Plus, Minus, X, CircleX, TheaterIcon } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import { cn } from '@/lib/utils'
import { TooltipToggleGroupItem } from './shared/TooltipToggleGroupItem'

interface AuctionBidderProps {
	auction: NDKEvent
	currentUserPubkey?: string
	onBidSuccess?: () => void
	compact?: boolean
}

export function AuctionBidder({ auction, currentUserPubkey, onBidSuccess, compact = false }: AuctionBidderProps) {
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
	const bidsQuery = useAuctionBids(auctionRootEventId || auctionId, 500, auctionCoordinates)
	const bids = bidsQuery.data ?? []
	const endAt = getAuctionEndAt(auction)
	const effectiveEndAt = getAuctionEffectiveEndAt(auction, bids) || endAt
	const countdown = useAuctionCountdown(effectiveEndAt, { showSeconds: true })
	const ended = countdown.isEnded

	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const minBid = Math.max(startingBid, currentPrice + Math.max(1, bidIncrement))

	const isOwnAuction = currentUserPubkey === auction.pubkey

	// State for input and view mode
	const [bidAmountInput, setBidAmountInput] = useState<string>('')
	const [isEditing, setIsEditing] = useState(false)

	// Parse the input safely
	const parsedBidAmount = useMemo(() => {
		const val = parseInt(bidAmountInput || '0', 10)
		return Number.isFinite(val) ? val : NaN
	}, [bidAmountInput])

	// Initialize input to min bid on mount or when min changes
	useEffect(() => {
		setBidAmountInput(String(minBid))
	}, [minBid])

	// Disable logic
	const isDisabledInput = ended || isOwnAuction || bidMutation.isPending
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
		if (bidMutation.isPending) return 'Submitting...'
		const selectedValue = getSelectedValue()
		if (selectedValue === 'edit' || selectedValue === 'mult2') return 'Bid ' + parsedBidAmount.toLocaleString() + ' sats'
		return 'Place Bid'
	}, [isOwnAuction, ended, bidMutation.isPending, parsedBidAmount])

	const handleSubmitBid = async () => {
		if (!auction || !auctionCoordinates || ended || isOwnAuction) return

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
			await bidMutation.mutateAsync({
				auctionEventId: auctionRootEventId || auction.id,
				auctionCoordinates,
				amount: parsedAmount,
				auctionEffectiveEndAt: effectiveEndAt,
				auctionLocktimeAt: getAuctionMaxEndAt(auction) || effectiveEndAt,
				sellerPubkey: auction.pubkey,
				pathIssuerPubkey,
				p2pkXpub,
				mint: trustedMints[0],
			})
			toast.success('Bid placed successfully')
			setIsEditing(false)
			onBidSuccess?.()
		} catch {
			// Error handled by mutation
		}
	}

	if (ended) {
		return (
			<div className="flex flex-col gap-3 w-full max-w-md">
				<Button disabled variant={isOwnAuction ? 'secondary' : 'primary'} className="whitespace-nowrap w-full sm:w-auto">
					{buttonText}
				</Button>

				<div className="text-xs text-foreground/80 pl-1">Final bid was: {currentPrice.toLocaleString()} sats</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-3 w-full max-w-md">
			{/* Main Action Area */}
			<div className={cn('flex flex-col sm:flex-row gap-2 items-stretch sm:items-center', compact && 'w-full flex-row')}>
				{isEditing ? (
					// EDIT MODE: Input Field
					<InputGroup>
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
						className={cn('w-full sm:w-auto', compact && 'sm:w-full')}
					>
						<TooltipToggleGroupItem
							value="inc1"
							variant="outline"
							size="sm"
							tooltip="Minimum Bid Increment"
							disabled={isDisabledInput}
							className={cn('cursor-pointer flex-1', compact ? 'flex-1' : 'flex-1 sm:flex-none')}
						>
							{compact ? 'Min bid' : minBid.toLocaleString() + ' sats'}
						</TooltipToggleGroupItem>
						{!compact && (
							<>
								<TooltipToggleGroupItem
									value="inc2"
									variant="outline"
									size="sm"
									tooltip="2x Minimum Bid Increment"
									disabled={isDisabledInput}
									className="flex-1 sm:flex-none cursor-pointer"
								>
									{(minBid + bidIncrement).toLocaleString()} sats
								</TooltipToggleGroupItem>
								<TooltipToggleGroupItem
									value="mult2"
									variant="outline"
									size="sm"
									tooltip="2x Current Bid"
									disabled={isDisabledInput}
									className="flex-none cursor-pointer"
								>
									<X className="size-3 mr-1" /> 2
								</TooltipToggleGroupItem>
							</>
						)}
						<TooltipToggleGroupItem
							value="edit"
							variant="outline"
							size="sm"
							onClick={() => setIsEditing(true) /* Enforce on-click behavior */}
							tooltip={getSelectedValue() === 'edit' ? 'Custom Bid: ' + bidAmountInput.toLocaleString() + ' SATS' : 'Customize Bid Amount'}
							disabled={isDisabledInput}
							className="flex-none cursor-pointer"
							title="Customize bid"
						>
							<Pencil className="h-3 w-3" />
						</TooltipToggleGroupItem>
					</ToggleGroup>
				)}

				{/* Place Bid Button */}
				<Button
					onClick={handleSubmitBid}
					disabled={isDisabledBid}
					variant={isOwnAuction ? 'secondary' : 'primary'}
					className="whitespace-nowrap w-full sm:w-auto"
				>
					{buttonText}
				</Button>
			</div>

			{/* Minimum Bid Info */}
			<div className="text-xs text-foreground/80 pl-1">Minimum allowed bid: {minBid.toLocaleString()} sats</div>
		</div>
	)
}
