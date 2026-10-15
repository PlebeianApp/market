import { Media } from '@/components/Media'
import { useQuery } from '@tanstack/react-query'
import { collectionQueryOptions } from '@/queries/collections'
import { getCoordsFromATag } from '@/lib/utils/coords'
import { CollectionDisplayView } from '@ui/components/CollectionDisplayView'

interface CollectionDisplayComponentProps {
	collectionCoords: string
	index: number
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
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
	const { data: collection, isLoading } = useQuery({
		...collectionQueryOptions(collectionId),
		enabled: !!collectionId,
	})

	return (
		<CollectionDisplayView
			collection={collection ?? null}
			collectionId={collectionId}
			index={index}
			isLoading={isLoading}
			onMoveUp={onMoveUp}
			onMoveDown={onMoveDown}
			onRemove={onRemove}
			canMoveUp={canMoveUp}
			canMoveDown={canMoveDown}
			isReordering={isReordering}
			isRemoving={isRemoving}
			renderImage={(url, title) => <Media src={url} alt={title} className="h-full w-full object-cover" />}
		/>
	)
}
