import type { ComponentProps, ReactNode } from 'react'
import { getProductDescription, getProductId, getProductImages, getProductTitle, type ProductReadEvent } from '@sdk/commerce/discovery'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { cn } from '../utils/cn'

export interface ProductDisplayViewProps extends Omit<ComponentProps<'div'>, 'children'> {
	product: ProductReadEvent | null
	productId: string
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

/** SDK-backed product summary row; fetching and editor actions remain with the host. */
export function ProductDisplayView({
	product,
	productId,
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
}: ProductDisplayViewProps) {
	const title = product ? getProductTitle(product) : isLoading ? 'Loading...' : 'Untitled Product'
	const description = product ? getProductDescription(product) || 'No description available' : 'No description available'
	const imageUrl = getProductImages(product)[0]?.[1]
	const imageAlt = title === 'Loading...' ? 'Product image' : title

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
				<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p>
				<p className="mt-1 text-xs text-muted-foreground">ID: {productId || (product ? getProductId(product) : '')}</p>
			</div>

			<div className="flex flex-col gap-1">
				{onMoveUp && (
					<button
						type="button"
						onClick={onMoveUp}
						disabled={!canMoveUp || isReordering}
						aria-label={`Move product ${index + 1} up`}
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
						aria-label={`Move product ${index + 1} down`}
						className="flex size-8 items-center justify-center rounded-md border bg-background text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
					>
						<ChevronDown className="size-4" aria-hidden="true" />
					</button>
				)}
				<button
					type="button"
					onClick={onRemove}
					disabled={isRemoving}
					aria-label={`Remove product ${index + 1}`}
					className="flex size-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Trash2 className="size-4" aria-hidden="true" />
				</button>
			</div>
		</div>
	)
}
