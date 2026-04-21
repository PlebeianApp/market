import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group' // Ensure this exists, or use a div with flex
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

	// State for input and view mode ('input' or 'quick')
	const [bidAmountInput, setBidAmountInput] = useState<string>('')
	const [isEditing, setIsEditing] = useState(false)

	// Parse the input safely
	const parsedBidAmount = useMemo(() => {
		const val = parseInt(bidAmountInput || '0', 10)
		return Number.isFinite(val) ? val : NaN
	}, [bidAmountInput])

	// Initialize input to min bid on mount or when min changes
	useEffect(() => {
		if (!isEditing) {
			setBidAmountInput(String(minBid))
		}
	}, [minBid, isEditing])

	// Disable logic
	const isDisabledInput = ended || isOwnAuction || bidMutation.isPending
	const isDisabledBid = isDisabledInput || !Number.isFinite(parsedBidAmount) || parsedBidAmount < minBid

	// Button text logic
	const buttonText = useMemo(() => {
		if (isOwnAuction) return 'Your Auction'
		if (ended) return 'Auction Ended'
		if (bidMutation.isPending) return 'Submitting...'
		return 'Place Bid'
	}, [isOwnAuction, ended, bidMutation.isPending])

	// Quick Action Handlers
	const handleQuickAdd = (amount: number) => {
		const newAmount = currentPrice + amount
		setBidAmountInput(String(newAmount))

		// Submit bid
		handleSubmitBid()
	}

	const handleQuickMultiply = (amount: number) => {
		// Provide fallback in case increment is higher than current price * amount
		const newAmount = Math.max(currentPrice * amount, minBid)
		setBidAmountInput(String(newAmount))

		// Submit bid
		handleSubmitBid()
	}

	const handleEditToggle = () => {
		setIsEditing(!isEditing)
		if (!isEditing) {
			// If switching to edit, ensure input has a value
			if (!bidAmountInput) setBidAmountInput(String(minBid))
		}
	}

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
							<CircleX onClick={handleEditToggle} className="size-4 cursor-pointer" />
						</InputGroupAddon>
					</InputGroup>
				) : (
					// QUICK ACTION MODE: Button Group
					<ButtonGroup className={cn('w-full sm:w-auto', compact && 'sm:w-full')}>
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleQuickAdd(bidIncrement)}
							tooltip="Minimum Bid Increment"
							disabled={isDisabledInput}
							className={cn('cursor-pointer flex-1', compact ? 'flex-1' : 'flex-1 sm:flex-none')}
						>
							{minBid.toLocaleString()} sats
						</Button>
						{!compact && (
							<>
								<Button
									variant="outline"
									size="sm"
									onClick={() => handleQuickAdd(bidIncrement * 2)}
									tooltip="2x Minimum Bid Increment"
									disabled={isDisabledInput}
									className="flex-1 sm:flex-none cursor-pointer"
								>
									{(minBid + bidIncrement).toLocaleString()} sats
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => handleQuickMultiply(2)}
									tooltip="2x Current Bid"
									disabled={isDisabledInput}
									className="flex-1 sm:flex-none cursor-pointer"
								>
									<X className="size-3 mr-1" /> 2
								</Button>
							</>
						)}
						<Button
							variant="outline"
							size="sm"
							onClick={handleEditToggle}
							tooltip="Customize Bid Amount"
							disabled={isDisabledInput}
							className="flex-none cursor-pointer"
							title="Customize bid"
						>
							<Pencil className="h-3 w-3" />
						</Button>
					</ButtonGroup>
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
