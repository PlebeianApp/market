import { AuctionCard } from '@/components/AuctionCard'
import { ItemGrid } from '@/components/ItemGrid'
import { cn } from '@/lib/utils'
import { getAuctionRootEventId } from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { Loader2 } from 'lucide-react'

interface AuctionSectionGridProps {
	title: string
	auctions: NDKEvent[]
	bidsByAuctionId?: Map<string, NDKEvent[]>
	loading?: boolean
	emptyMessage?: string
	className?: string
}

export function AuctionSectionGrid({
	title,
	auctions,
	bidsByAuctionId,
	loading = false,
	emptyMessage,
	className,
}: AuctionSectionGridProps) {
	if (!loading && auctions.length === 0) return null

	return (
		<div className={cn('w-full max-w-full overflow-hidden', className)}>
			<div className="mb-4">
				<h2 className="text-xl sm:text-2xl font-heading text-center sm:text-left">{title}</h2>
			</div>

			{loading ? (
				<div className="flex items-center justify-center py-8">
					<Loader2 className="w-6 h-6 animate-spin text-primary" />
				</div>
			) : auctions.length > 0 ? (
				<ItemGrid className="gap-4 sm:gap-8">
					{auctions.map((auction) => (
						<AuctionCard key={auction.id} auction={auction} bids={bidsByAuctionId?.get(getAuctionRootEventId(auction) || auction.id)} />
					))}
				</ItemGrid>
			) : emptyMessage ? (
				<p className="text-sm text-muted-foreground text-center py-4">{emptyMessage}</p>
			) : null}
		</div>
	)
}
