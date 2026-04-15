import { AuctionCountdown, useAuctionCountdown } from '@/components/AuctionCountdown'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ndkActions } from '@/lib/stores/ndk'
import { usePublishAuctionBidMutation } from '@/publish/auctions'
import {
	getAuctionBidIncrement,
	getAuctionEndAt,
	getAuctionEscrowIdentityPubkey,
	getAuctionEscrowPubkey,
	getAuctionId,
	getAuctionImages,
	getAuctionKeyScheme,
	getAuctionMints,
	getAuctionP2pkXpub,
	getAuctionStartingBid,
	getAuctionTitle,
	useAuctionBidStats,
} from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

export function AuctionCard({ auction }: { auction: NDKEvent }) {
	const title = getAuctionTitle(auction)
	const images = getAuctionImages(auction)
	const endAt = getAuctionEndAt(auction)
	const startingBid = getAuctionStartingBid(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const acceptedMints = getAuctionMints(auction)
	const keyScheme = getAuctionKeyScheme(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const escrowPubkey = getAuctionEscrowPubkey(auction) || auction.pubkey
	const escrowIdentityPubkey = getAuctionEscrowIdentityPubkey(auction) || auction.pubkey
	const auctionDTag = getAuctionId(auction)
	const auctionCoordinates = auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
	const [bidAmountInput, setBidAmountInput] = useState('')
	const [isOwnAuction, setIsOwnAuction] = useState(false)
	const countdown = useAuctionCountdown(endAt, { showSeconds: true })
	const { data: bidStats } = useAuctionBidStats(auction.id, startingBid, auctionCoordinates)
	const bidMutation = usePublishAuctionBidMutation()

	const currentPrice = bidStats?.currentPrice ?? startingBid
	const bidsCount = bidStats?.count ?? 0
	const ended = countdown.isEnded
	const parsedBidAmount = parseInt(bidAmountInput || '0', 10)

	const minBid = useMemo(() => {
		const floorBid = currentPrice + Math.max(1, bidIncrement)
		return Math.max(startingBid, floorBid)
	}, [bidIncrement, currentPrice, startingBid])

	useEffect(() => {
		const checkIfOwnAuction = async () => {
			const user = await ndkActions.getUser()
			if (!user?.pubkey) return
			setIsOwnAuction(user.pubkey === auction.pubkey)
		}

		checkIfOwnAuction()
	}, [auction.pubkey])

	useEffect(() => {
		setBidAmountInput(String(minBid))
	}, [minBid])

	const handleSubmitBid = async () => {
		if (!auctionCoordinates || !auctionDTag || ended || isOwnAuction) return

		const parsedAmount = parseInt(bidAmountInput || '0', 10)
		if (!Number.isFinite(parsedAmount) || parsedAmount < minBid) return

		try {
			await bidMutation.mutateAsync({
				auctionEventId: auction.id,
				auctionCoordinates,
				amount: parsedAmount,
				auctionEndAt: endAt,
				sellerPubkey: auction.pubkey,
				escrowPubkey,
				escrowIdentityPubkey,
				p2pkXpub,
				mint: acceptedMints[0],
			})
		} catch {
			// Error toast is handled by mutation onError.
		}
	}

	return (
		<div className="border border-zinc-800 rounded-lg bg-white shadow-sm flex flex-col w-full max-w-full overflow-hidden hover:shadow-md transition-shadow duration-200">
			<div className="relative aspect-square overflow-hidden border-b border-zinc-800 block">
				{images.length > 0 ? (
					<img
						src={images[0][1]}
						alt={title}
						className="w-full h-full object-cover rounded-t-[calc(var(--radius)-1px)] hover:scale-105 transition-transform duration-200"
					/>
				) : (
					<div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 rounded-lg hover:bg-gray-200 transition-colors duration-200">
						No image
					</div>
				)}
				<div
					className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded ${ended ? 'bg-zinc-700 text-white' : 'bg-green-600 text-white'}`}
				>
					{ended ? 'ENDED' : 'LIVE'}
				</div>
			</div>

			<div className="p-2 flex flex-col gap-2 flex-grow">
				<h2 className="text-sm font-medium border-b border-[var(--light-gray)] pb-2 overflow-hidden text-ellipsis whitespace-nowrap">
					<Link to={`/auctions/${auction.id}`} className="hover:underline">
						{title}
					</Link>
				</h2>

				<div className="flex justify-between items-center">
					<div className="text-sm font-semibold">{currentPrice.toLocaleString()} sats</div>
					<div className="bg-[var(--light-gray)] font-medium px-4 py-1 rounded-full text-xs">{bidsCount} bids</div>
				</div>

				<div className="text-xs text-gray-600">
					<AuctionCountdown endAt={endAt} countdown={countdown} showSeconds variant="inline" className="w-full justify-between" />
				</div>

				<div className="flex-grow"></div>

				<div className="flex gap-2">
					<Input
						type="number"
						min={minBid}
						step={Math.max(1, bidIncrement)}
						value={bidAmountInput}
						onChange={(e) => setBidAmountInput(e.target.value)}
						className="h-10"
						disabled={ended || isOwnAuction || bidMutation.isPending}
					/>
					<Button
						className="py-3 px-4 rounded-lg font-medium bg-black text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
						onClick={() => void handleSubmitBid()}
						disabled={ended || isOwnAuction || bidMutation.isPending || !Number.isFinite(parsedBidAmount) || parsedBidAmount < minBid}
					>
						{isOwnAuction ? 'Your Auction' : ended ? 'Ended' : bidMutation.isPending ? 'Bidding...' : 'Bid'}
					</Button>
				</div>
				<div className="text-[11px] text-gray-500">Min bid: {minBid.toLocaleString()} sats</div>
			</div>
		</div>
	)
}
