// src/components/auction/LatestBidsContainer.tsx
import { getBidAmount, getBidMint, getBidStatus, useStreamingAuctionBids } from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { cn } from '@/lib/utils'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import { AvatarUser } from './AvatarUser'
import { formatSats } from '@/lib/wallet'
import { Badge } from './ui/badge'
import type { ReactNode } from 'react'
import { UserCard } from './UserCard'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
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

export function AuctionBidsContainer({ auctionRootEventId, auctionCoordinates, className }: Props) {
	const { bids } = useStreamingAuctionBids(auctionRootEventId, 500, auctionCoordinates)

	// Sort bids by amount (highest first) then by time
	const sortedBids = [...bids].sort((a, b) => {
		const amountDiff = getBidAmount(b) - getBidAmount(a)
		if (amountDiff !== 0) return amountDiff
		return (b.created_at || 0) - (a.created_at || 0)
	})

	return bids.length === 0 ? (
		<div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6 text-sm text-zinc-500">No bids yet.</div>
	) : (
		<div className="space-y-4">
			{sortedBids.map((bidEvent) => {
				const mint = getBidMint(bidEvent)
				const locktime = bidEvent.tags.find((tag) => tag[0] === 'locktime')?.[1]
				const bidKeyScheme = bidEvent.tags.find((tag) => tag[0] === 'key_scheme')?.[1] || 'hd_p2pk'
				return (
					<div key={bidEvent.id} className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-2xl font-semibold tracking-tight text-zinc-950">{formatSats(getBidAmount(bidEvent))}</p>
								<p className="mt-1 text-sm text-zinc-500">
									Recorded {bidEvent.created_at ? new Date(bidEvent.created_at * 1000).toLocaleString() : 'at an unknown time'}
								</p>
							</div>
							<Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700">
								{getBidStatus(bidEvent)}
							</Badge>
						</div>

						<UserCard pubkey={bidEvent.pubkey} />

						<div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
							<div className="relative flex items-center px-2 h-6 cursor-default">
								<Landmark className="size-4 text-primary" />
								<span className="absolute -bottom-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-pink-500 text-[9px] font-bold leading-none text-white">
									<Check className="h-2 w-2 text-white stroke-[3]" />
								</span>
							</div>
							<p>Mint: {mint.slice(8)}</p>
						</div>

						<Accordion type="single" collapsible className="mt-4 rounded-xl border border-zinc-200 bg-white px-4">
							<AccordionItem value={`bid-${bidEvent.id}`} className="border-none">
								<AccordionTrigger className="py-4 text-sm font-semibold text-zinc-900 hover:no-underline">
									Bid event details
								</AccordionTrigger>
								<AccordionContent className="space-y-3 pb-4">
									<TechnicalDataRow label="Bidder pubkey" value={bidEvent.pubkey} />
									<TechnicalDataRow label="Mint" value={getBidMint(bidEvent) || 'N/A'} />
									<TechnicalDataRow label="Key scheme" value={bidKeyScheme} />
									<TechnicalDataRow label="Locktime" value={locktime ? new Date(parseInt(locktime, 10) * 1000).toLocaleString() : 'N/A'} />
									<TechnicalDataRow label="Bid event ID" value={bidEvent.id} />
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					</div>
				)
			})}
		</div>
	)
}
