import { AuctionCountdown } from '@/components/AuctionCountdown'
import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authStore } from '@/lib/stores/auth'
import { uiActions } from '@/lib/stores/ui'
import { useDeleteAuctionMutation } from '@/publish/auctions'
import {
	auctionsByPubkeyQueryOptions,
	getAuctionBidIncrement,
	getAuctionBidCountFromBids,
	getAuctionCurrency,
	getAuctionCurrentPriceFromBids,
	getAuctionEffectiveEndAt,
	getAuctionEndAt,
	getAuctionPathIssuer,
	getAuctionId,
	getAuctionImages,
	getAuctionKeyScheme,
	getAuctionMints,
	getAuctionReserve,
	getAuctionRootEventId,
	getAuctionSchema,
	getAuctionSettlementPolicy,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionSummary,
	getAuctionTitle,
	getAuctionType,
	useAuctionBids,
} from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Clock, Copy, ExternalLink, Gavel, Pencil, Shield, Trash } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

type AuctionOrder = 'newest' | 'oldest' | 'ending-soon' | 'ending-latest'

function formatAuctionStatus(startAt: number, endAt: number, now: number): string {
	if (endAt > 0 && now >= endAt) return 'Ended'
	if (startAt > 0 && now < startAt) return 'Scheduled'
	return 'Live'
}

const formatMaybeDate = (timestamp: number): string => {
	if (!timestamp) return 'N/A'
	return new Date(timestamp * 1000).toLocaleString()
}

const shortenHex = (value: string, left: number = 12, right: number = 10): string => {
	if (!value) return 'N/A'
	if (value.length <= left + right + 1) return value
	return `${value.slice(0, left)}...${value.slice(-right)}`
}

const getAuctionCoordinates = (auction: NDKEvent): string => {
	const auctionDTag = getAuctionId(auction)
	return auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
}

function AuctionBasicInfo({ auction }: { auction: NDKEvent }) {
	const summary = getAuctionSummary(auction) || auction.content || 'No description'
	const images = getAuctionImages(auction)
	const startingBid = getAuctionStartingBid(auction)
	const auctionDTag = getAuctionId(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = getAuctionCoordinates(auction)
	const startAt = getAuctionStartAt(auction)
	const endAt = getAuctionEndAt(auction)
	const bidsQuery = useAuctionBids(auctionRootEventId || auction.id, 500, auctionCoordinates)
	const bids = bidsQuery.data ?? []
	const effectiveEndAt = getAuctionEffectiveEndAt(auction, bids) || endAt
	const now = Math.floor(Date.now() / 1000)
	const status = formatAuctionStatus(startAt, effectiveEndAt, now)
	const currentBid = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const bidsCount = getAuctionBidCountFromBids(auction, bids)
	const reserve = getAuctionReserve(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const auctionType = getAuctionType(auction)
	const currency = getAuctionCurrency(auction)
	const pathIssuer = getAuctionPathIssuer(auction)
	const keyScheme = getAuctionKeyScheme(auction)
	const settlementPolicy = getAuctionSettlementPolicy(auction)
	const schema = getAuctionSchema(auction)
	const trustedMints = getAuctionMints(auction)
	const publicAuctionPath = `/auctions/${auction.id}`

	const copyText = async (label: string, value: string) => {
		try {
			await navigator.clipboard.writeText(value)
			toast.success(`${label} copied`)
		} catch (error) {
			console.error(`Failed to copy ${label.toLowerCase()}:`, error)
			toast.error(`Failed to copy ${label.toLowerCase()}`)
		}
	}

	return (
		<div className="block p-4 bg-gray-50 border-t">
			<div className="space-y-4">
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
					<p className="text-gray-600">
						Bid increment: <span className="font-medium">{bidIncrement.toLocaleString()} sats</span>
					</p>
					<p className="text-gray-600">
						Reserve: <span className="font-medium">{reserve.toLocaleString()} sats</span>
					</p>
					<p className="text-gray-600">
						Type: <span className="font-medium capitalize">{auctionType}</span>
					</p>
					<p className="text-gray-600">
						Currency: <span className="font-medium">{currency}</span>
					</p>
					<p className="text-gray-600 col-span-2">
						Starts: <span className="font-medium">{formatMaybeDate(startAt)}</span>
					</p>
					<p className="text-gray-600 col-span-2">
						Ends: <span className="font-medium">{formatMaybeDate(effectiveEndAt)}</span>
					</p>
					<div className="col-span-2">
						<AuctionCountdown endAt={effectiveEndAt} showSeconds variant="inline" className="max-w-full" />
					</div>
				</div>

				<div className="p-3 rounded-md border bg-white space-y-2">
					<p className="text-sm font-semibold flex items-center gap-2">
						<Shield className="w-4 h-4" />
						Settlement & Locking
					</p>
					<p className="text-xs text-gray-600">
						Path issuer: <span className="font-medium text-foreground">{shortenHex(pathIssuer) || 'N/A'}</span>
					</p>
					<p className="text-xs text-gray-600">
						Key scheme: <span className="font-medium text-foreground">{keyScheme}</span>
					</p>
					<p className="text-xs text-gray-600">
						Settlement policy: <span className="font-medium text-foreground">{settlementPolicy || 'N/A'}</span>
					</p>
					<p className="text-xs text-gray-600">
						Schema: <span className="font-medium text-foreground">{schema || 'N/A'}</span>
					</p>
					<div className="text-xs text-gray-600">
						Trusted mints:
						{trustedMints.length > 0 ? (
							<ul className="mt-1 list-disc pl-4 space-y-0.5">
								{trustedMints.map((mint) => (
									<li key={mint} className="break-all">
										{mint}
									</li>
								))}
							</ul>
						) : (
							<span className="font-medium text-foreground ml-1">N/A</span>
						)}
					</div>
				</div>

				<div className="grid gap-2 text-xs text-gray-600">
					<p className="break-all">
						Event id: <span className="font-medium text-foreground">{auction.id}</span>
					</p>
					<p className="break-all">
						Coordinate: <span className="font-medium text-foreground">{auctionCoordinates || 'N/A'}</span>
					</p>
					<p className="break-all">
						d tag: <span className="font-medium text-foreground">{auctionDTag || 'N/A'}</span>
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2 pt-1">
					<Link to={publicAuctionPath}>
						<Button variant="outline" size="sm" className="gap-2">
							<ExternalLink className="w-3.5 h-3.5" />
							View Public Auction
						</Button>
					</Link>
					<Button variant="ghost" size="sm" onClick={() => copyText('Event ID', auction.id)}>
						Copy Event ID
					</Button>
					{auctionCoordinates && (
						<Button variant="ghost" size="sm" onClick={() => copyText('Auction Coordinate', auctionCoordinates)}>
							Copy Coordinate
						</Button>
					)}
				</div>
			</div>
		</div>
	)
}

function AuctionListItem({
	auction,
	isExpanded,
	onToggleExpanded,
	onManage,
	onDelete,
	onCopyId,
	onCopyUrl,
	isDeleting,
}: {
	auction: NDKEvent
	isExpanded: boolean
	onToggleExpanded: () => void
	onManage: () => void
	onDelete: () => void
	onCopyId: () => void
	onCopyUrl: () => void
	isDeleting: boolean
}) {
	const startAt = getAuctionStartAt(auction)
	const endAt = getAuctionEndAt(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = getAuctionCoordinates(auction)
	const bidsQuery = useAuctionBids(auctionRootEventId || auction.id, 500, auctionCoordinates)
	const bids = bidsQuery.data ?? []
	const effectiveEndAt = getAuctionEffectiveEndAt(auction, bids) || endAt
	const now = Math.floor(Date.now() / 1000)
	const status = formatAuctionStatus(startAt, effectiveEndAt, now)
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
				<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>{status}</span>
					<AuctionCountdown endAt={effectiveEndAt} showSeconds variant="inline" className="px-2 py-1 text-[10px]" />
				</div>
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
					onCopyUrl()
				}}
				aria-label={`Copy public auction URL for ${getAuctionTitle(auction)}`}
			>
				<ExternalLink className="w-4 h-4" />
			</Button>
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
					onManage()
				}}
				aria-label={`Manage ${getAuctionTitle(auction)}`}
			>
				<Pencil className="w-4 h-4" />
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
	const { user, isAuthenticated } = useStore(authStore)
	const navigate = useNavigate()
	const matchRoute = useMatchRoute()
	const [expandedAuction, setExpandedAuction] = useState<string | null>(null)
	const [orderBy, setOrderBy] = useState<AuctionOrder>('newest')
	const deleteMutation = useDeleteAuctionMutation()
	const [animationParent] = useAutoAnimate()

	const isOnChildRoute = matchRoute({
		to: '/dashboard/products/auctions/$auctionId',
		fuzzy: true,
	})

	useDashboardTitle(isOnChildRoute ? 'Auction Details' : 'Auctions')

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

	const handleCopyAuctionUrl = async (auction: NDKEvent) => {
		try {
			const url = `${window.location.origin}/auctions/${auction.id}`
			await navigator.clipboard.writeText(url)
			toast.success('Auction URL copied')
		} catch (error) {
			console.error('Failed to copy auction URL:', error)
			toast.error('Failed to copy auction URL')
		}
	}

	const handleCreateAuction = () => {
		uiActions.openDrawer('createAuction')
	}

	const handleManageAuction = (auctionEventId: string) => {
		navigate({
			to: '/dashboard/products/auctions/$auctionId',
			params: { auctionId: auctionEventId },
		})
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to manage your auctions.</p>
			</div>
		)
	}

	if (isOnChildRoute) {
		return <Outlet />
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Auctions</h1>
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
					<Link to="/auctions">
						<Button variant="outline" className="gap-2">
							<ExternalLink className="w-4 h-4" />
							View Public Auctions
						</Button>
					</Link>
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
										onManage={() => handleManageAuction(auction.id)}
										onDelete={() => handleDeleteAuction(auction)}
										onCopyId={() => handleCopyAuctionId(auction)}
										onCopyUrl={() => handleCopyAuctionUrl(auction)}
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
