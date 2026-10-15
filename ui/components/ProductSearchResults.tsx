import type { ComponentProps, ReactNode } from 'react'
import { getProductId, getProductImages, getProductPubkey, getProductTitle, type ProductReadEvent } from '@sdk/commerce/discovery'
import { cn } from '../utils/cn'

export type ProductSearchResultEvent = ProductReadEvent & { id: string }

export interface ProductSearchResultsProps<TProduct extends ProductSearchResultEvent = ProductSearchResultEvent> extends Omit<
	ComponentProps<'div'>,
	'onSelect'
> {
	products: readonly TProduct[]
	isLoading: boolean
	onSelect: (product: TProduct) => void
	onShowAll: () => void
	renderImage?: (imageUrl: string, title: string) => ReactNode
	renderSeller?: (pubkey: string) => ReactNode
}

/** Present already-fetched product results; query, cache, and navigation stay with the host. */
export function ProductSearchResults<TProduct extends ProductSearchResultEvent = ProductSearchResultEvent>({
	products,
	isLoading,
	onSelect,
	onShowAll,
	renderImage,
	renderSeller,
	className,
	...props
}: ProductSearchResultsProps<TProduct>) {
	return (
		<div className={cn('flex w-full flex-col gap-2 rounded-lg bg-[#1c1c1c] p-2 shadow-lg', className)} {...props}>
			{products.length === 0 ? (
				<div className="p-4 text-center text-white" role="status" aria-live="polite">
					{isLoading ? 'Searching...' : 'No products found'}
				</div>
			) : (
				<ul className="max-h-[320px] divide-y divide-white/10 overflow-y-auto" aria-label="Product search results">
					{products.map((product) => {
						const title = getProductTitle(product)
						const productId = getProductId(product)
						const imageUrl = getProductImages(product)[0]?.[1]
						const sellerPubkey = getProductPubkey(product)

						return (
							<li key={product.id}>
								<button
									type="button"
									aria-label={`Open ${title}`}
									onClick={() => onSelect(product)}
									className="flex w-full items-center gap-3 rounded p-2 text-left hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									{imageUrl ? (
										(renderImage?.(imageUrl, title) ?? (
											<img src={imageUrl} alt="" loading="lazy" className="size-8 shrink-0 rounded object-cover" />
										))
									) : (
										<span aria-hidden="true" className="size-8 shrink-0 rounded bg-white/10" />
									)}
									<span className="flex min-w-0 flex-1 items-center gap-2">
										<span className="truncate text-sm text-white">{title || productId || product.id}</span>
										{sellerPubkey && renderSeller && (
											<span className="flex shrink-0 items-center gap-2">
												<span className="text-xs text-gray-400">by</span>
												{renderSeller(sellerPubkey)}
											</span>
										)}
									</span>
									<span aria-hidden="true" className="i-external-link size-4 shrink-0 text-secondary" />
								</button>
							</li>
						)
					})}
				</ul>
			)}
			<div className="pt-1">
				<button
					type="button"
					onClick={onShowAll}
					className="w-full py-2 text-center text-xs font-medium text-secondary transition-colors hover:text-white"
				>
					Show search results in page
				</button>
			</div>
		</div>
	)
}
