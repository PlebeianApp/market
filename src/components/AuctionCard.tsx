import { AuctionCountdown, useAuctionCountdown } from '@/components/AuctionCountdown'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getAuctionBidderStatus, type AuctionBidderStatusKind } from '@/lib/auctionBidderStatus'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { usePublishAuctionBidMutation } from '@/publish/auctions'
import {
	getAuctionBidIncrement,
	getAuctionBidCountFromBids,
	getAuctionCurrentPriceFromBids,
	getAuctionEffectiveEndAt,
	getAuctionEndAt,
	getAuctionId,
	getAuctionImages,
	getAuctionKeyScheme,
	getAuctionMaxEndAt,
	getAuctionMints,
	getAuctionP2pkXpub,
	getAuctionPathIssuer,
	getAuctionRootEventId,
	getAuctionSettlementGrace,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionTitle,
	useAuctionBids,
} from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useState } from 'react'
import { AuctionBidder } from './AuctionBidder'
import { cn } from '@/lib/utils'

const bidderStatusClassName = (status: AuctionBidderStatusKind): string => {
	switch (status) {
		case 'winning':
		case 'won':
			return 'bg-emerald-100 text-emerald-900 border-emerald-200'
		case 'outbid':
		case 'was_outbid':
			return 'bg-amber-100 text-amber-950 border-amber-200'
	}
}

export function AuctionCard({
	auction,
	bids: bidsProp,
	...props
}: { auction: NDKEvent; bids?: NDKEvent[] } & React.HTMLAttributes<HTMLDivElement>) {
	const { user: currentUser } = useStore(authStore)
	const title = getAuctionTitle(auction)
	const images = getAuctionImages(auction)
	const endAt = getAuctionEndAt(auction)
	const startingBid = getAuctionStartingBid(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const acceptedMints = getAuctionMints(auction)
	const keyScheme = getAuctionKeyScheme(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const pathIssuerPubkey = getAuctionPathIssuer(auction) || auction.pubkey
	const auctionDTag = getAuctionId(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
	const [bidAmountInput, setBidAmountInput] = useState('')
	const [isOwnAuction, setIsOwnAuction] = useState(false)
	// When a parent (the auctions list) supplies bids in bulk, skip the per-
	// card subscription. Empty-string args disable the underlying query.
	const shouldFetchBids = bidsProp === undefined
	const bidsQuery = useAuctionBids(
		shouldFetchBids ? auctionRootEventId || auction.id : '',
		500,
		shouldFetchBids ? auctionCoordinates : undefined,
	)
	const bids = bidsProp ?? bidsQuery.data ?? []
	const startAt = getAuctionStartAt(auction)
	const effectiveEndAt = getAuctionEffectiveEndAt(auction, bids) || endAt
	const countdown = useAuctionCountdown(effectiveEndAt, { showSeconds: true })
	const bidMutation = usePublishAuctionBidMutation()

	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const bidsCount = getAuctionBidCountFromBids(auction, bids)
	const ended = countdown.isEnded
	// Lower-bound gate: bids cannot be placed before start_at. Mirrors the
	// hard refusal in `publishAuctionBid` so users don't see a bid form for
	// auctions that haven't opened yet.
	const notStarted = startAt > 0 && countdown.now < startAt
	const parsedBidAmount = parseInt(bidAmountInput || '0', 10)
	const bidderStatus = useMemo(
		() =>
			getAuctionBidderStatus({
				currentUserPubkey: currentUser?.pubkey,
				auction,
				bids,
				isEnded: ended,
			}),
		[currentUser?.pubkey, auction, bids, ended],
	)

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
		if (!auctionCoordinates || !auctionDTag || ended || notStarted || isOwnAuction) return

		const parsedAmount = parseInt(bidAmountInput || '0', 10)
		if (!Number.isFinite(parsedAmount) || parsedAmount < minBid) return

		try {
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
				mint: acceptedMints[0],
			})
		} catch {
			// Error toast is handled by mutation onError.
		}
	}

	const className = props.className

	return (
		<div
			{...props}
			className={cn(
				'border border-primary rounded-lg bg-background shadow-sm flex flex-col w-full max-w-full overflow-hidden hover:shadow-md transition-shadow duration-200',
				className,
			)}
		>
			<Link to={`/auctions/${auction.id}`} className="relative aspect-square overflow-hidden border-b border-zinc-800 block">
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
					className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded ${
						ended ? 'bg-zinc-700 text-white' : notStarted ? 'bg-sky-600 text-white' : 'bg-green-600 text-white'
					}`}
				>
					{ended ? 'ENDED' : notStarted ? 'SCHEDULED' : 'LIVE'}
				</div>
			</Link>

			<div className="p-2 flex flex-col gap-2 flex-grow">
				<h2 className="text-sm font-medium border-b border-[var(--light-gray)] pb-2 overflow-hidden text-ellipsis whitespace-nowrap">
					<Link to={`/auctions/${auction.id}`} className="hover:underline">
						{title}
					</Link>
				</h2>

				<div className="flex flex-wrap justify-between items-center gap-2">
					<div className="text-sm font-semibold">{currentPrice.toLocaleString()} sats</div>
					<div className="flex items-center gap-2">
						{bidderStatus && (
							<div className={`border font-semibold px-3 py-1 rounded-full text-xs ${bidderStatusClassName(bidderStatus.status)}`}>
								{bidderStatus.label}
							</div>
						)}
						<div className="bg-[var(--light-gray)] font-medium px-4 py-1 rounded-full text-xs">
							{bidsCount} {bidsCount === 1 ? 'Bid' : 'Bids'}
						</div>
					</div>
				</div>

				<div className="text-xs text-gray-600">
					<AuctionCountdown auction={auction} bids={bids} className="w-full justify-between" compact />
				</div>

				<AuctionBidder auction={auction} bids={bids} compact />
			</div>
		</div>
	)
}
