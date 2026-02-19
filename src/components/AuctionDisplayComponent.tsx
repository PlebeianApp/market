import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getCoordsFromATag } from '@/lib/utils/coords'
import { auctionByATagQueryOptions, getAuctionEndAt, getAuctionImages, getAuctionSummary, getAuctionTitle } from '@/queries/auctions'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

interface AuctionDisplayComponentProps {
	auctionCoords: string
	index: number
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving: boolean
}

export function AuctionDisplayComponent({
	auctionCoords,
	index,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
}: AuctionDisplayComponentProps) {
	const coords = getCoordsFromATag(auctionCoords)

	const { data: auction } = useQuery({
		...auctionByATagQueryOptions(coords.pubkey, coords.identifier),
		enabled: coords.kind === 30408 && !!coords.pubkey && !!coords.identifier,
	})

	const title = auction ? getAuctionTitle(auction) : 'Loading...'
	const summary = auction ? getAuctionSummary(auction) : 'No summary available'
	const images = auction ? getAuctionImages(auction) : []
	const imageUrl = images.length > 0 ? images[0][1] : null
	const endAt = auction ? getAuctionEndAt(auction) : 0
	const endAtLabel = endAt ? new Date(endAt * 1000).toLocaleString() : 'No end date'

	return (
		<Card className="p-4">
			<div className="flex items-center gap-4">
				<div className="w-16 h-16 bg-gray-200 rounded-md overflow-hidden flex-shrink-0">
					{imageUrl ? (
						<img src={imageUrl} alt={title} className="w-full h-full object-cover" />
					) : (
						<div className="w-full h-full bg-gray-300 flex items-center justify-center text-gray-500 text-xs">No Image</div>
					)}
				</div>

				<div className="flex-1 min-w-0">
					<h3 className="font-semibold text-sm truncate">{title}</h3>
					<p className="text-xs text-gray-600 mt-1 line-clamp-2">{summary}</p>
					<p className="text-xs text-gray-500 mt-1">Ends: {endAtLabel}</p>
					<p className="text-xs text-gray-400 mt-1">ID: {coords.identifier}</p>
				</div>

				<div className="flex flex-col gap-1">
					{onMoveUp && (
						<Button variant="outline" size="sm" onClick={onMoveUp} disabled={!canMoveUp || isReordering} className="h-8 w-8 p-0">
							<ChevronUp className="h-4 w-4" />
						</Button>
					)}
					{onMoveDown && (
						<Button variant="outline" size="sm" onClick={onMoveDown} disabled={!canMoveDown || isReordering} className="h-8 w-8 p-0">
							<ChevronDown className="h-4 w-4" />
						</Button>
					)}
					<Button variant="destructive" size="sm" onClick={onRemove} disabled={isRemoving} className="h-8 w-8 p-0">
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</Card>
	)
}
