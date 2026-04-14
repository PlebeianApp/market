import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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

interface AuctionBidderProps {
	auction: NDKEvent
	currentUserPubkey?: string
	onBidSuccess?: () => void
}

export function AuctionBidder({ auction, currentUserPubkey, onBidSuccess }: AuctionBidderProps) {
	const queryClient = useQueryClient()
	const bidMutation = usePublishAuctionBidMutation()

	// Derive auction state from helpers
	const auctionId = auction.id
	const startTime = getAuctionStartAt(auction)
	const endTime = getAuctionEndAt(auction)
	const startingBid = getAuctionStartingBid(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const escrowPubkey = getAuctionEscrowPubkey(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const trustedMints = getAuctionMints(auction)
	const auctionDTag = getAuctionId(auction)

	// Coordinates for the bid
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

	// Local state for input
	const [bidAmountInput, setBidAmountInput] = useState<string>('')

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
	const isDisabledInput = isEnded || isOwnAuction || bidMutation.isPending
	const isDisabledBid = isDisabledInput || !Number.isFinite(parsedBidAmount) || parsedBidAmount < minBid

	// Button text logic
	const buttonText = useMemo(() => {
		if (isOwnAuction) return 'Your Auction'
		if (isEnded) return 'Auction Ended'
		if (bidMutation.isPending) return 'Submitting...'
		return 'Place Bid'
	}, [isOwnAuction, isEnded, bidMutation.isPending])

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
		} catch {
			// Error toast is handled by mutation onError.
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex gap-2 items-center w-full max-w-md">
				<Input
					type="number"
					min={minBid}
					step={Math.max(1, bidIncrement)}
					value={bidAmountInput}
					onChange={(e) => setBidAmountInput(e.target.value)}
					placeholder={`Min: ${minBid.toLocaleString()}`}
					className="bg-white text-black w-full"
					disabled={isDisabledInput}
				/>
				<Button
					onClick={handleSubmitBid}
					disabled={isDisabledBid}
					variant={isOwnAuction ? 'secondary' : 'primary'}
					className="whitespace-nowrap"
				>
					{buttonText}
				</Button>
			</div>
			<div className="text-xs text-white/80">Minimum allowed bid: {minBid.toLocaleString()} sats</div>
		</div>
	)
}
