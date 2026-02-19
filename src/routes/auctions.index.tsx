import { AuctionCard } from '@/components/AuctionCard'
import { ItemGrid } from '@/components/ItemGrid'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { uiStore } from '@/lib/stores/ui'
import { uiActions } from '@/lib/stores/ui'
import { auctionsQueryOptions, filterNSFWAuctions } from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Loader2 } from 'lucide-react'

export const Route = createFileRoute('/auctions/')({
	component: AuctionsRoute,
})

function AuctionsRoute() {
	const { isAuthenticated } = useStore(authStore)
	const { showNSFWContent } = useStore(uiStore)
	const auctionsQuery = useQuery({
		...auctionsQueryOptions(400),
		refetchInterval: (query) => (query.state.data?.length ? 30_000 : 3_000),
	})

	const auctions = filterNSFWAuctions((auctionsQuery.data ?? []) as NDKEvent[], showNSFWContent)

	const handleCreateAuction = () => {
		if (isAuthenticated) {
			uiActions.openDrawer('createAuction')
		} else {
			uiActions.openDialog('login')
		}
	}

	if (auctionsQuery.isLoading && auctions.length === 0) {
		return (
			<div className="max-w-screen-xl mx-auto px-4 py-8">
				<div className="flex flex-col items-center justify-center py-16 min-h-[60vh]">
					<Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
					<p className="text-sm text-gray-500">Loading auctions...</p>
				</div>
			</div>
		)
	}

	if (auctionsQuery.isError) {
		return (
			<div className="max-w-screen-xl mx-auto px-4 py-8">
				<div className="flex flex-col items-center justify-center py-16 text-center gap-4">
					<h2 className="text-xl font-semibold">Unable to load auctions</h2>
					<p className="text-muted-foreground max-w-md">
						{auctionsQuery.error instanceof Error ? auctionsQuery.error.message : 'There was a problem loading auctions. Please try again.'}
					</p>
					<Button variant="secondary" onClick={() => auctionsQuery.refetch()}>
						Retry
					</Button>
				</div>
			</div>
		)
	}

	if (auctions.length === 0) {
		return (
			<div className="max-w-screen-xl mx-auto px-4 py-8">
				<div className="flex flex-col items-center justify-center py-16 text-center gap-2 min-h-[40vh]">
					<h2 className="text-xl font-semibold">No auctions found</h2>
					<p className="text-muted-foreground">Check back soon for live listings.</p>
				</div>
			</div>
		)
	}

	return (
		<div className="max-w-screen-xl mx-auto px-4 py-8">
			<div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<h1 className="text-2xl font-heading">Auctions</h1>
				<div className="flex items-center gap-2">
					<p className="text-sm text-muted-foreground">Live and ending-soon auctions settled with Cashu.</p>
					<Button variant="secondary" size="sm" onClick={handleCreateAuction}>
						Create Auction
					</Button>
				</div>
			</div>

			<ItemGrid className="gap-4 sm:gap-8">
				{auctions.map((auction) => (
					<AuctionCard key={auction.id} auction={auction} />
				))}
			</ItemGrid>
		</div>
	)
}
