// src/components/auction/LatestBidsContainer.tsx
import { getBidAmount, getBidMint, getBidStatus, useStreamingAuctionBids } from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { cn } from '@/lib/utils'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import { formatSats, getMintHostname } from '@/lib/wallet'
import { Badge } from './ui/badge'
import type { ReactNode } from 'react'
import { UserCard } from './UserCard'
import { Check, Landmark } from 'lucide-react'

function TechnicalDataRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
			<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
			<div className="mt-1 break-all text-sm font-medium text-zinc-900">{value}</div>
		</div>
	)
}

interface Props {
	auctionRootEventId: string
	auctionCoordinates: string
	className?: string
}

function formatBidRecordedAt(bidEvent: NDKEvent): string {
	return bidEvent.created_at ? new Date(bidEvent.created_at * 1000).toLocaleString() : 'Unknown time'
}

function BidMintRow({ mint }: { mint: string }) {
	return (
		<div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
			<div className="relative flex h-6 cursor-default items-center px-2">
				<Landmark className="size-4 text-primary" />
				<span className="absolute -bottom-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-pink-500 text-[9px] font-bold leading-none text-white">
					<Check className="h-2 w-2 text-white stroke-[3]" />
				</span>
			</div>
			<p>Mint: {mint ? getMintHostname(mint) : 'N/A'}</p>
		</div>
	)
}

function BidEventDetails({ bidEvent }: { bidEvent: NDKEvent }) {
	const locktime = bidEvent.tags.find((tag) => tag[0] === 'locktime')?.[1]
	const bidKeyScheme = bidEvent.tags.find((tag) => tag[0] === 'key_scheme')?.[1] || 'hd_p2pk'

	return (
		<Accordion type="single" collapsible className="rounded-xl border border-zinc-200 bg-white px-4">
			<AccordionItem value={`bid-${bidEvent.id}`} className="border-none">
				<AccordionTrigger className="py-4 text-sm font-semibold text-zinc-900 hover:no-underline">Bid event details</AccordionTrigger>
				<AccordionContent className="space-y-3 pb-4">
					<TechnicalDataRow label="Bidder pubkey" value={bidEvent.pubkey} />
					<TechnicalDataRow label="Mint" value={getBidMint(bidEvent) || 'N/A'} />
					<TechnicalDataRow label="Key scheme" value={bidKeyScheme} />
					<TechnicalDataRow label="Locktime" value={locktime ? new Date(parseInt(locktime, 10) * 1000).toLocaleString() : 'N/A'} />
					<TechnicalDataRow label="Bid event ID" value={bidEvent.id} />
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	)
}

export function AuctionBidsContainer({ auctionRootEventId, auctionCoordinates, className }: Props) {
	const { bids } = useStreamingAuctionBids(auctionRootEventId, 500, auctionCoordinates)

	const topBid = bids.reduce<NDKEvent | null>((best, bid) => {
		if (!best) return bid

		const amountDiff = getBidAmount(bid) - getBidAmount(best)
		if (amountDiff > 0) return bid
		if (amountDiff < 0) return best

		const createdAtDiff = (bid.created_at ?? 0) - (best.created_at ?? 0)
		if (createdAtDiff < 0) return bid
		if (createdAtDiff > 0) return best

		return bid.id.localeCompare(best.id) < 0 ? bid : best
	}, null)

	const latestBids = [...bids]
		.filter((bid) => bid.id !== topBid?.id)
		.sort((a, b) => {
			const createdAtDiff = (b.created_at || 0) - (a.created_at || 0)
			if (createdAtDiff !== 0) return createdAtDiff
			return b.id.localeCompare(a.id)
		})

	return bids.length === 0 ? (
		<div className={cn('rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6 text-sm text-zinc-500', className)}>
			No bids yet. The latest bids will appear here once bidders lock funds.
		</div>
	) : (
		<div className="space-y-4">
			{topBid && (
				<div className="flex flex-col gap-4 rounded-xl border-2 border-secondary bg-secondary/10 px-4 py-4 shadow-sm">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-secondary">Top bid</p>
							<p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{formatSats(getBidAmount(topBid))} sats</p>
							<p className="mt-1 text-sm text-zinc-600">Recorded {formatBidRecordedAt(topBid)}</p>
						</div>
						<Badge variant="outline" className="border-secondary bg-white text-secondary">
							{getBidStatus(topBid)}
						</Badge>
					</div>

					<UserCard pubkey={topBid.pubkey} size="md" />
					<BidMintRow mint={getBidMint(topBid)} />
					<BidEventDetails bidEvent={topBid} />
				</div>
			)}

			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500">Latest bids</h3>
					<p className="text-xs text-zinc-500">
						{latestBids.length} more bid{latestBids.length === 1 ? '' : 's'}
					</p>
				</div>

				<div className={cn('max-h-[500px] space-y-3 overflow-y-auto pr-1', className)}>
					{latestBids.length === 0 ? (
						<div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-4 text-sm text-zinc-500">
							No other bids yet.
						</div>
					) : (
						latestBids.map((bidEvent) => (
							<div
								key={bidEvent.id}
								className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
							>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<p className="text-xl font-semibold tracking-tight text-zinc-950">{formatSats(getBidAmount(bidEvent))} sats</p>
										<p className="mt-1 text-sm text-zinc-500">Recorded {formatBidRecordedAt(bidEvent)}</p>
									</div>
									<Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700">
										{getBidStatus(bidEvent)}
									</Badge>
								</div>

								<UserCard pubkey={bidEvent.pubkey} size="sm" />
								<BidMintRow mint={getBidMint(bidEvent)} />
								<BidEventDetails bidEvent={bidEvent} />
							</div>
						))
					)}
				</div>
			</div>
		</div>
	)
}
