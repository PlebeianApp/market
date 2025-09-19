import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { collectionQueryOptions, getCollectionTitle, getCollectionSummary, getCollectionImages } from '@/queries/collections'
import { getCoordsFromATag } from '@/lib/utils/coords'

interface CollectionDisplayComponentProps {
	collectionCoords: string
	index: number
	onMoveUp: () => void
	onMoveDown: () => void
	onRemove: () => void
	canMoveUp: boolean
	canMoveDown: boolean
	isReordering: boolean
	isRemoving: boolean
}

export function CollectionDisplayComponent({
	collectionCoords,
	index,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
}: CollectionDisplayComponentProps) {
	// Parse coordinates to get collection ID
	const coords = getCoordsFromATag(collectionCoords)
	const collectionId = coords.identifier

	// Fetch collection data
	const { data: collection } = useQuery({
		...collectionQueryOptions(collectionId),
		enabled: !!collectionId,
	})

	// Get collection info
	const title = collection ? getCollectionTitle(collection) : 'Loading...'
	const description = collection ? getCollectionSummary(collection) : 'No description available'
	const images = collection ? getCollectionImages(collection) : []
	const imageUrl = images.length > 0 ? images[0][1] : null

	return (
		<Card className="p-4">
			<div className="flex items-center gap-4">
				{/* Collection Image */}
				<div className="w-16 h-16 bg-gray-200 rounded-md overflow-hidden flex-shrink-0">
					{imageUrl ? (
						<img src={imageUrl} alt={title} className="w-full h-full object-cover" />
					) : (
						<div className="w-full h-full bg-gray-300 flex items-center justify-center text-gray-500 text-xs">No Image</div>
					)}
				</div>

				{/* Collection Info */}
				<div className="flex-1 min-w-0">
					<h3 className="font-semibold text-sm truncate">{title}</h3>
					<p className="text-xs text-gray-600 mt-1 line-clamp-2">{description}</p>
					<p className="text-xs text-gray-400 mt-1">ID: {collectionId}</p>
				</div>

				{/* Action Buttons */}
				<div className="flex flex-col gap-1">
					<Button variant="outline" size="sm" onClick={onMoveUp} disabled={!canMoveUp || isReordering} className="h-8 w-8 p-0">
						<ChevronUp className="h-4 w-4" />
					</Button>
					<Button variant="outline" size="sm" onClick={onMoveDown} disabled={!canMoveDown || isReordering} className="h-8 w-8 p-0">
						<ChevronDown className="h-4 w-4" />
					</Button>
					<Button variant="destructive" size="sm" onClick={onRemove} disabled={isRemoving} className="h-8 w-8 p-0">
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</Card>
	)
}
