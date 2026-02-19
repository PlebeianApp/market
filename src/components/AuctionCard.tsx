import { getAuctionEndAt, getAuctionImages, getAuctionStartingBid, getAuctionTitle, useAuctionBidStats } from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useEffect, useState } from 'react'

function formatAuctionCountdown(secondsRemaining: number): string {
	if (secondsRemaining <= 0) return 'Ended'
	const days = Math.floor(secondsRemaining / 86400)
	const hours = Math.floor((secondsRemaining % 86400) / 3600)
	const minutes = Math.floor((secondsRemaining % 3600) / 60)
	const seconds = secondsRemaining % 60

	if (days > 0) return `${days}d ${hours}h`
	if (hours > 0) return `${hours}h ${minutes}m`
	return `${minutes}m ${seconds}s`
}

export function AuctionCard({ auction }: { auction: NDKEvent }) {
	const title = getAuctionTitle(auction)
	const images = getAuctionImages(auction)
	const endAt = getAuctionEndAt(auction)
	const startingBid = getAuctionStartingBid(auction)
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
	const secondsRemaining = Math.max(0, endAt - now)
	const { data: bidStats } = useAuctionBidStats(auction.id, startingBid)

	useEffect(() => {
		const timer = window.setInterval(() => {
			setNow(Math.floor(Date.now() / 1000))
		}, 1000)
		return () => window.clearInterval(timer)
	}, [])

	const currentPrice = bidStats?.currentPrice ?? startingBid
	const bidsCount = bidStats?.count ?? 0
	const endDateLabel = endAt ? new Date(endAt * 1000).toLocaleString() : 'N/A'
	const ended = endAt > 0 ? now >= endAt : false

	return (
		<div className="border border-zinc-800 rounded-lg bg-white shadow-sm flex flex-col w-full max-w-full overflow-hidden">
			<div className="relative aspect-square overflow-hidden border-b border-zinc-800 block">
				{images.length > 0 ? (
					<img src={images[0][1]} alt={title} className="w-full h-full object-cover rounded-t-[calc(var(--radius)-1px)]" />
				) : (
					<div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 rounded-lg">No image</div>
				)}
				<div
					className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded ${ended ? 'bg-zinc-700 text-white' : 'bg-green-600 text-white'}`}
				>
					{ended ? 'ENDED' : 'LIVE'}
				</div>
			</div>

			<div className="p-2 flex flex-col gap-2 flex-grow">
				<h2 className="text-sm font-medium border-b border-[var(--light-gray)] pb-2 overflow-hidden text-ellipsis whitespace-nowrap">
					{title}
				</h2>

				<div className="grid grid-cols-2 gap-2 text-xs">
					<div className="bg-zinc-50 rounded p-2 border">
						<p className="text-zinc-500">Current price</p>
						<p className="font-semibold">{currentPrice.toLocaleString()} sats</p>
					</div>
					<div className="bg-zinc-50 rounded p-2 border">
						<p className="text-zinc-500">Bids</p>
						<p className="font-semibold">{bidsCount}</p>
					</div>
					<div className="bg-zinc-50 rounded p-2 border col-span-2">
						<p className="text-zinc-500">End time</p>
						<p className="font-semibold">{endDateLabel}</p>
					</div>
					<div className={`rounded p-2 border col-span-2 ${ended ? 'bg-zinc-100' : 'bg-amber-50 border-amber-200'}`}>
						<p className="text-zinc-500">Countdown</p>
						<p className="font-semibold">{formatAuctionCountdown(secondsRemaining)}</p>
					</div>
				</div>
			</div>
		</div>
	)
}
