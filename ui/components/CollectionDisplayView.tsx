import type { ComponentProps, ReactNode } from 'react'
import {
	getCollectionId,
	getCollectionImages,
	getCollectionSummary,
	getCollectionTitle,
	type CollectionReadEvent,
} from '@sdk/commerce/collections'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { cn } from '../utils/cn'

export interface CollectionDisplayViewProps extends Omit<ComponentProps<'div'>, 'children'> {
	collection: CollectionReadEvent | null
	collectionId: string
	index: number
	isLoading: boolean
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving: boolean
	renderImage?: (imageUrl: string, title: string) => ReactNode
}

/** SDK-backed collection summary row; fetching and editor actions remain with the host. */
export function CollectionDisplayView({
	collection,
	collectionId,
	index,
	isLoading,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
	renderImage,
	className,
	...props
}: CollectionDisplayViewProps) {
	const title = collection ? getCollectionTitle(collection) : isLoading ? 'Loading...' : 'Untitled Collection'
	const summary = collection ? getCollectionSummary(collection) || 'No summary available.' : 'No summary available.'
	const imageUrl = getCollectionImages(collection)[0]?.[1]
	const imageAlt = title === 'Loading...' ? 'Collection image' : title

	return (
		<div
			className={cn('flex items-center gap-4 rounded-lg border bg-card p-4 text-card-foreground', className)}
			data-index={index}
			{...props}
		>
			<div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
				{imageUrl ? (
					(renderImage?.(imageUrl, imageAlt) ?? <img src={imageUrl} alt={imageAlt} loading="lazy" className="h-full w-full object-cover" />)
				) : (
					<div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No image</div>
				)}
			</div>

			<div className="min-w-0 flex-1">
				<h3 className="truncate text-sm font-semibold">{title}</h3>
				<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{summary}</p>
				<p className="mt-1 text-xs text-muted-foreground">ID: {collectionId || (collection ? getCollectionId(collection) : '')}</p>
			</div>

			<div className="flex flex-col gap-1">
				{onMoveUp && (
					<button
						type="button"
						onClick={onMoveUp}
						disabled={!canMoveUp || isReordering}
						aria-label={`Move collection ${index + 1} up`}
						className="flex size-8 items-center justify-center rounded-md border bg-background text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
					>
						<ChevronUp className="size-4" aria-hidden="true" />
					</button>
				)}
				{onMoveDown && (
					<button
						type="button"
						onClick={onMoveDown}
						disabled={!canMoveDown || isReordering}
						aria-label={`Move collection ${index + 1} down`}
						className="flex size-8 items-center justify-center rounded-md border bg-background text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
					>
						<ChevronDown className="size-4" aria-hidden="true" />
					</button>
				)}
				<button
					type="button"
					onClick={onRemove}
					disabled={isRemoving}
					aria-label={`Remove collection ${index + 1}`}
					className="flex size-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Trash2 className="size-4" aria-hidden="true" />
				</button>
			</div>
		</div>
	)
}
