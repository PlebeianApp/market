import type { ReactNode } from 'react'
import { UiImage } from '../provider/UiProvider'
import { cn } from '../utils/cn'

export interface ProductSelectionItem {
	id: string
	title: string
	coordinates: string
	imageUrl?: string
}

export interface ProductSelectionListProps {
	items: readonly ProductSelectionItem[]
	selectedCoordinates: readonly string[]
	isLoading: boolean
	onToggle: (coordinates: string, selected: boolean) => void
	renderImage?: (imageUrl: string, title: string) => ReactNode
	className?: string
}

/** Product checklist UI; product fetching and collection-form updates stay with the host. */
export function ProductSelectionList({
	items,
	selectedCoordinates,
	isLoading,
	onToggle,
	renderImage,
	className,
}: ProductSelectionListProps) {
	if (isLoading) {
		return (
			<div className={cn('flex h-32 items-center justify-center text-muted-foreground', className)} role="status" aria-live="polite">
				Loading your products...
			</div>
		)
	}

	if (items.length === 0) {
		return (
			<div className={cn('flex h-32 flex-col items-center justify-center space-y-2 text-muted-foreground', className)} role="status">
				<div>No products found</div>
				<div className="text-sm">Create some products first to add them to collections</div>
			</div>
		)
	}

	return (
		<div className={cn('space-y-4', className)}>
			<p className="text-muted-foreground">Select products to include in this collection</p>
			<div className="space-y-3">
				{items.map((product) => {
					const isSelected = selectedCoordinates.includes(product.coordinates)
					const checkboxId = `product-${product.coordinates}`

					return (
						<div key={product.coordinates} className="flex items-center space-x-3 rounded-lg border p-3">
							<input
								id={checkboxId}
								type="checkbox"
								checked={isSelected}
								onChange={(event) => onToggle(product.coordinates, event.target.checked)}
								className="size-4 accent-primary"
							/>
							<label htmlFor={checkboxId} className="flex min-w-0 flex-1 cursor-pointer items-center space-x-3">
								{product.imageUrl &&
									(renderImage?.(product.imageUrl, product.title) ?? (
										<UiImage src={product.imageUrl} alt={product.title} className="size-10 rounded object-cover" />
									))}
								<span className="min-w-0 flex-1 truncate text-sm font-medium">{product.title}</span>
							</label>
						</div>
					)
				})}
			</div>

			{selectedCoordinates.length > 0 && (
				<div className="mt-4 text-sm text-muted-foreground">
					{selectedCoordinates.length} product{selectedCoordinates.length !== 1 ? 's' : ''} selected
				</div>
			)}
		</div>
	)
}
