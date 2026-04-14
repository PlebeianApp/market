import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group' // Ensure this exists, or use a div with flex
import { usePublishAuctionBidMutation } from '@/publish/auctions'
import {
	getAuctionEndAt,
	getAuctionStartAt,
	getAuctionBidIncrement,
	getAuctionStartingBid,
	getAuctionEscrowPubkey,
	getAuctionP2pkXpub,
	getAuctionMints,
	getAuctionId,
	useAuctionBidStats,
} from '@/queries/auctions'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { toast } from 'sonner'
import { useMemo, useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuctionCountdown } from './AuctionCountdown'
import { Pencil, Plus, Minus, X, CircleX } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'

interface AuctionBidderProps {
	auction: NDKEvent
	currentUserPubkey?: string
	onBidSuccess?: () => void
}

export function AuctionBidder({ auction, currentUserPubkey, onBidSuccess }: AuctionBidderProps) {
	const queryClient = useQueryClient()
	const bidMutation = usePublishAuctionBidMutation()

	// Derive auction state
	const auctionId = auction.id
	const startTime = getAuctionStartAt(auction)
	const endTime = getAuctionEndAt(auction)
	const startingBid = getAuctionStartingBid(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const escrowPubkey = getAuctionEscrowPubkey(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const trustedMints = getAuctionMints(auction)
	const auctionDTag = getAuctionId(auction)

	const auctionCoordinates = auctionDTag && auction ? `30408:${auction.pubkey}:${auctionDTag}` : ''

	const endAt = getAuctionEndAt(auction)
	const countdown = useAuctionCountdown(endAt, { showSeconds: true })
	const ended = countdown.isEnded

	const { data: bidStats } = useAuctionBidStats(auctionId, startingBid, auctionCoordinates)
	const currentPrice = bidStats?.currentPrice ?? startingBid
	const minBid = Math.max(startingBid, currentPrice + Math.max(1, bidIncrement))

	const currentTime = Date.now() / 1000
	const isEnded = endTime <= currentTime
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
	const isDisabledInput = isEnded || isOwnAuction || bidMutation.isPending
	const isDisabledBid = isDisabledInput || !Number.isFinite(parsedBidAmount) || parsedBidAmount < minBid

	// Button text logic
	const buttonText = useMemo(() => {
		if (isOwnAuction) return 'Your Auction'
		if (isEnded) return 'Auction Ended'
		if (bidMutation.isPending) return 'Submitting...'
		return 'Place Bid'
	}, [isOwnAuction, isEnded, bidMutation.isPending])

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
			await bidMutation.mutateAsync({
				auctionEventId: auction.id,
				auctionCoordinates,
				amount: parsedAmount,
				auctionEndAt: endAt,
				sellerPubkey: auction.pubkey,
				escrowPubkey: escrowPubkey || auction.pubkey,
				p2pkXpub,
				mint: trustedMints[0],
			})
			queryClient.invalidateQueries({ queryKey: ['auction', auction.id] })
			queryClient.invalidateQueries({ queryKey: ['auctionBids', auction.id] })
			toast.success('Bid placed successfully')
			setBidAmountInput(String(minBid))
			setIsEditing(false)
			onBidSuccess?.()
		} catch {
			// Error handled by mutation
		}
	}

	return (
		<div className="flex flex-col gap-3 w-full max-w-md">
			{/* Main Action Area */}
			<div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
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
							<CircleX onClick={handleEditToggle} className="size-4" />
						</InputGroupAddon>
					</InputGroup>
				) : (
					// QUICK ACTION MODE: Button Group
					<ButtonGroup className="w-full sm:w-auto">
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleQuickAdd(bidIncrement)}
							tooltip="Minimum Bid Increment"
							disabled={isDisabledInput}
							className="flex-1 sm:flex-none"
						>
							<Plus className="h-3 w-3 mr-1" /> {bidIncrement} sats
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleQuickAdd(bidIncrement * 2)}
							tooltip="2x Minimum Bid Increment"
							disabled={isDisabledInput}
							className="flex-1 sm:flex-none"
						>
							<Plus className="h-3 w-3 mr-1" /> {bidIncrement * 2} sats
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleQuickMultiply(2)}
							tooltip="2x Current Bid"
							disabled={isDisabledInput}
							className="flex-1 sm:flex-none"
						>
							<X className="size-3 mr-1" /> 2
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleEditToggle}
							tooltip="Customize Bid Amount"
							disabled={isDisabledInput}
							className="flex-1 sm:flex-none"
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
			<div className="text-xs text-white/80 pl-1">Minimum allowed bid: {minBid.toLocaleString()} sats</div>
		</div>
	)
}
