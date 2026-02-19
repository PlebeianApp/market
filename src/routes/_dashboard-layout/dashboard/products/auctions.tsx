import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authStore } from '@/lib/stores/auth'
import { uiActions } from '@/lib/stores/ui'
import { useDeleteAuctionMutation } from '@/publish/auctions'
import {
	auctionsByPubkeyQueryOptions,
	getAuctionEndAt,
	getAuctionId,
	getAuctionImages,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionSummary,
	getAuctionTitle,
	useAuctionBidStats,
} from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Clock, Copy, Gavel, Trash } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

type AuctionOrder = 'newest' | 'oldest' | 'ending-soon' | 'ending-latest'

function formatAuctionStatus(startAt: number, endAt: number, now: number): string {
	if (endAt > 0 && now >= endAt) return 'Ended'
	if (startAt > 0 && now < startAt) return 'Scheduled'
	return 'Live'
}

function AuctionBasicInfo({ auction }: { auction: NDKEvent }) {
	const summary = getAuctionSummary(auction) || auction.content || 'No description'
	const images = getAuctionImages(auction)
	const startingBid = getAuctionStartingBid(auction)
	const startAt = getAuctionStartAt(auction)
	const endAt = getAuctionEndAt(auction)
	const now = Math.floor(Date.now() / 1000)
	const status = formatAuctionStatus(startAt, endAt, now)
	const { data: bidStats } = useAuctionBidStats(auction.id, startingBid)
	const currentBid = bidStats?.currentPrice ?? startingBid
	const bidsCount = bidStats?.count ?? 0

	return (
		<div className="block p-4 bg-gray-50 border-t">
			<div className="space-y-3">
				{images.length > 0 && (
					<div className="w-full h-32 bg-gray-200 rounded-md overflow-hidden">
						<img src={images[0][1]} alt="Auction image" className="w-full h-full object-cover" />
					</div>
				)}
				<div>
					<p className="text-sm text-gray-600 mb-1">Summary:</p>
					<p className="text-sm">{summary}</p>
				</div>
				<div className="grid grid-cols-2 gap-2 text-sm">
					<p className="text-gray-600">
						Status:{' '}
						<span
							className={`font-medium ${status === 'Live' ? 'text-green-600' : status === 'Scheduled' ? 'text-blue-600' : 'text-zinc-600'}`}
						>
							{status}
						</span>
					</p>
					<p className="text-gray-600">
						Bids: <span className="font-medium">{bidsCount}</span>
					</p>
					<p className="text-gray-600">
						Starting bid: <span className="font-medium">{startingBid.toLocaleString()} sats</span>
					</p>
					<p className="text-gray-600">
						Current bid: <span className="font-medium">{currentBid.toLocaleString()} sats</span>
					</p>
					<p className="text-gray-600 col-span-2">
						Ends: <span className="font-medium">{endAt ? new Date(endAt * 1000).toLocaleString() : 'N/A'}</span>
					</p>
				</div>
			</div>
		</div>
	)
}

function AuctionListItem({
	auction,
	isExpanded,
	onToggleExpanded,
	onDelete,
	onCopyId,
	isDeleting,
}: {
	auction: NDKEvent
	isExpanded: boolean
	onToggleExpanded: () => void
	onDelete: () => void
	onCopyId: () => void
	isDeleting: boolean
}) {
	const startAt = getAuctionStartAt(auction)
	const endAt = getAuctionEndAt(auction)
	const now = Math.floor(Date.now() / 1000)
	const status = formatAuctionStatus(startAt, endAt, now)
	const images = getAuctionImages(auction)
	const thumbnailUrl = images.length > 0 ? images[0][1] : null

	const triggerContent = (
		<div className="flex items-center gap-3">
			{thumbnailUrl ? (
				<img src={thumbnailUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
			) : (
				<div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0">
					<Gavel className="w-5 h-5 text-gray-400" />
				</div>
			)}
			<div className="min-w-0">
				<p className="font-semibold truncate">{getAuctionTitle(auction)}</p>
				<p className="text-xs text-muted-foreground truncate">
					{status} • {endAt ? new Date(endAt * 1000).toLocaleString() : 'No end'}
				</p>
			</div>
		</div>
	)

	const actions = (
		<>
			<Button
				variant="ghost"
				size="sm"
				onClick={(e) => {
					e.stopPropagation()
					onCopyId()
				}}
				aria-label={`Copy event id for ${getAuctionTitle(auction)}`}
			>
				<Copy className="w-4 h-4" />
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={(e) => {
					e.stopPropagation()
					onDelete()
				}}
				aria-label={`Delete ${getAuctionTitle(auction)}`}
				disabled={isDeleting}
			>
				{isDeleting ? (
					<div className="animate-spin h-4 w-4 border-2 border-destructive border-t-transparent rounded-full" />
				) : (
					<Trash className="w-4 h-4 text-destructive" />
				)}
			</Button>
		</>
	)

	return (
		<DashboardListItem
			isOpen={isExpanded}
			onOpenChange={onToggleExpanded}
			triggerContent={triggerContent}
			actions={actions}
			isDeleting={isDeleting}
			icon={false}
		>
			<AuctionBasicInfo auction={auction} />
		</DashboardListItem>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/auctions')({
	component: AuctionsOverviewComponent,
})

function AuctionsOverviewComponent() {
	useDashboardTitle('My Auctions')
	const { user, isAuthenticated } = useStore(authStore)
	const [expandedAuction, setExpandedAuction] = useState<string | null>(null)
	const [orderBy, setOrderBy] = useState<AuctionOrder>('newest')
	const deleteMutation = useDeleteAuctionMutation()
	const [animationParent] = useAutoAnimate()

	const {
		data: auctions,
		isLoading,
		error,
	} = useQuery({
		...auctionsByPubkeyQueryOptions(user?.pubkey ?? ''),
		enabled: !!user?.pubkey && isAuthenticated,
	})

	const sortedAuctions = useMemo(() => {
		if (!auctions) return []
		const now = Math.floor(Date.now() / 1000)
		return [...auctions].sort((a, b) => {
			if (orderBy === 'newest') return (b.created_at || 0) - (a.created_at || 0)
			if (orderBy === 'oldest') return (a.created_at || 0) - (b.created_at || 0)

			const aEnd = getAuctionEndAt(a) || now
			const bEnd = getAuctionEndAt(b) || now
			if (orderBy === 'ending-soon') return aEnd - bEnd
			return bEnd - aEnd
		})
	}, [auctions, orderBy])

	const handleDeleteAuction = (auction: NDKEvent) => {
		const auctionDTag = getAuctionId(auction)
		if (!auctionDTag) return

		if (confirm(`Delete auction "${getAuctionTitle(auction)}"?`)) {
			deleteMutation.mutate(auctionDTag)
		}
	}

	const handleCopyAuctionId = async (auction: NDKEvent) => {
		try {
			await navigator.clipboard.writeText(auction.id)
			toast.success('Auction event ID copied')
		} catch (error) {
			console.error('Failed to copy auction id:', error)
			toast.error('Failed to copy auction id')
		}
	}

	const handleCreateAuction = () => {
		uiActions.openDrawer('createAuction')
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to manage your auctions.</p>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">My Auctions</h1>
				<div className="flex items-center gap-4">
					<Select value={orderBy} onValueChange={(value) => setOrderBy(value as AuctionOrder)}>
						<SelectTrigger className="w-56">
							<SelectValue placeholder="Order By" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="newest">Newest First</SelectItem>
							<SelectItem value="oldest">Oldest First</SelectItem>
							<SelectItem value="ending-soon">Ending Soon</SelectItem>
							<SelectItem value="ending-latest">Ending Latest</SelectItem>
						</SelectContent>
					</Select>
					<Button
						onClick={handleCreateAuction}
						className="bg-neutral-800 hover:bg-neutral-700 text-white flex items-center gap-2 px-4 py-2 text-sm font-semibold"
					>
						<Gavel className="w-4 h-4" />
						Add An Auction
					</Button>
				</div>
			</div>

			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden space-y-4">
					<Select value={orderBy} onValueChange={(value) => setOrderBy(value as AuctionOrder)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Order By" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="newest">Newest First</SelectItem>
							<SelectItem value="oldest">Oldest First</SelectItem>
							<SelectItem value="ending-soon">Ending Soon</SelectItem>
							<SelectItem value="ending-latest">Ending Latest</SelectItem>
						</SelectContent>
					</Select>
					<Button
						onClick={handleCreateAuction}
						data-testid="add-auction-button-mobile"
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<Gavel className="w-4 h-4" /> Add An Auction
					</Button>
				</div>

				<div>
					{isLoading && (
						<div className="text-center py-8 text-gray-500">
							<Clock className="animate-spin h-6 w-6 mx-auto mb-2" />
							Loading auctions...
						</div>
					)}

					{error && (
						<div className="text-center py-8 text-red-500">
							Failed to load your auctions: {error instanceof Error ? error.message : 'Unknown error'}
						</div>
					)}

					{!isLoading && !error && sortedAuctions.length === 0 && (
						<div className="text-center py-12 border rounded-lg">
							<Gavel className="h-10 w-10 mx-auto mb-3 text-gray-400" />
							<h3 className="text-lg font-medium mb-1">No auctions yet</h3>
							<p className="text-muted-foreground mb-4">Click the "Add An Auction" button to create your first one.</p>
							<Button onClick={handleCreateAuction} className="bg-neutral-800 hover:bg-neutral-700 text-white">
								Add An Auction
							</Button>
						</div>
					)}

					{!isLoading && !error && sortedAuctions.length > 0 && (
						<ul ref={animationParent} className="flex flex-col gap-4 mt-4">
							{sortedAuctions.map((auction) => (
								<li key={auction.id}>
									<AuctionListItem
										auction={auction}
										isExpanded={expandedAuction === auction.id}
										onToggleExpanded={() => setExpandedAuction((prev) => (prev === auction.id ? null : auction.id))}
										onDelete={() => handleDeleteAuction(auction)}
										onCopyId={() => handleCopyAuctionId(auction)}
										isDeleting={deleteMutation.isPending && deleteMutation.variables === getAuctionId(auction)}
									/>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	)
}
