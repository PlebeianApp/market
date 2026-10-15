import type { ComponentProps, ReactNode } from 'react'
import {
	getProductImages,
	getProductPrice,
	getProductStock,
	getProductTitle,
	getProductVisibility,
	isNSFWProduct,
	isProductInStock,
	type ProductReadEvent,
} from '@sdk/commerce/discovery'
import { UiImage } from '../provider/UiProvider'
import { cn } from '../utils/cn'

export type ProductCardViewEvent = ProductReadEvent & { id: string }

export interface ProductCardViewProps extends Omit<ComponentProps<'div'>, 'children'> {
	product: ProductCardViewEvent
	isOwnProduct: boolean
	isInCart: boolean
	cartQuantity: number
	isAddingToCart: boolean
	showConfirmation: boolean
	onAddToCart: () => void
	renderImage?: (imageUrl: string, title: string) => ReactNode
	renderPrice?: (priceTag: string[]) => ReactNode
	renderNotice?: ReactNode
	renderSecondaryAction?: ReactNode
}

/** Product presentation from SDK read data; app behavior is provided through props. */
export function ProductCardView({
	product,
	isOwnProduct,
	isInCart,
	cartQuantity,
	isAddingToCart,
	showConfirmation,
	onAddToCart,
	renderImage,
	renderPrice,
	renderNotice,
	renderSecondaryAction,
	className,
	...props
}: ProductCardViewProps) {
	const title = getProductTitle(product)
	const imageUrl = getProductImages(product)[0]?.[1]
	const priceTag = getProductPrice(product)
	const stockTag = getProductStock(product)
	const parsedStock = stockTag ? Number.parseInt(stockTag[1], 10) : undefined
	const stockQuantity = parsedStock !== undefined && Number.isFinite(parsedStock) ? parsedStock : undefined
	const visibility = getProductVisibility(product)?.[1] || 'on-sale'
	const isOutOfStock = visibility !== 'pre-order' && !isProductInStock(product)
	const isNsfw = isNSFWProduct(product)
	const cartAtLimit = stockQuantity !== undefined && cartQuantity >= stockQuantity

	const handleAddClick = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		onAddToCart()
	}

	return (
		<div className={cn('flex h-full w-full flex-col', className)} {...props}>
			<div className="relative block aspect-square overflow-hidden border-b border-zinc-800">
				{imageUrl ? (
					(renderImage?.(imageUrl, title) ?? (
						<UiImage
							src={imageUrl}
							alt={title}
							className="h-full w-full rounded-t-[calc(var(--radius)-1px)] object-cover transition-transform duration-200 hover:scale-105"
						/>
					))
				) : (
					<div className="flex h-full w-full items-center justify-center rounded-lg bg-gray-100 text-gray-400 transition-colors duration-200 hover:bg-gray-200">
						No image
					</div>
				)}
				{isNsfw && <div className="absolute top-2 left-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">NSFW</div>}
				{renderNotice}
			</div>

			<div className="flex flex-grow flex-col gap-2 p-2">
				<h2 className="overflow-hidden truncate whitespace-nowrap border-b border-[var(--light-gray)] pb-2 text-sm font-medium">{title}</h2>

				<div className="flex items-center justify-between">
					{priceTag &&
						(renderPrice?.(priceTag) ?? (
							<span>
								{priceTag[1]} {priceTag[2] || 'SATS'}
							</span>
						))}
					{visibility === 'pre-order' ? (
						<div className="rounded-full bg-blue-100 px-4 py-1 text-xs font-medium text-blue-800">Pre-order</div>
					) : isOutOfStock ? (
						<div className="rounded-full bg-red-100 px-4 py-1 text-xs font-medium text-red-800">Out of stock</div>
					) : stockQuantity !== undefined ? (
						<div className="rounded-full bg-[var(--light-gray)] px-4 py-1 text-xs font-medium">{stockQuantity} in stock</div>
					) : null}
				</div>

				<div className="flex-grow" />

				<div className="flex gap-2">
					<div className="flex-grow transition-all duration-300 ease-in-out">
						{isOwnProduct ? (
							<button
								type="button"
								disabled
								className="w-full rounded-lg bg-black px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
							>
								Your Product
							</button>
						) : isInCart ? (
							<div className="flex w-full gap-2">
								<div className="flex h-10 items-center justify-center rounded-lg border-2 border-pink-300 bg-pink-100 px-2 text-sm font-medium text-pink-800">
									{cartQuantity}
								</div>
								<button
									type="button"
									onClick={handleAddClick}
									disabled={isAddingToCart || visibility === 'hidden' || cartAtLimit}
									className="flex-grow rounded-lg bg-black px-4 py-3 font-medium text-white transition-all duration-200 ease-in-out disabled:cursor-not-allowed disabled:bg-gray-400"
								>
									{isAddingToCart ? 'Adding...' : showConfirmation ? 'Added' : cartAtLimit ? 'Max' : 'Add'}
								</button>
							</div>
						) : (
							<button
								type="button"
								onClick={handleAddClick}
								disabled={isOwnProduct || isAddingToCart || visibility === 'hidden' || isOutOfStock}
								className={cn(
									'w-full rounded-lg bg-black px-4 py-3 font-medium text-white transition-all duration-300 disabled:cursor-not-allowed disabled:bg-gray-400',
									isAddingToCart && 'scale-95 opacity-75',
								)}
							>
								{visibility === 'hidden'
									? 'Not Available'
									: isOutOfStock
										? 'Out of Stock'
										: showConfirmation
											? 'Added!'
											: isAddingToCart
												? 'Adding...'
												: visibility === 'pre-order'
													? 'Pre-order'
													: 'Add to Cart'}
							</button>
						)}
					</div>
					{renderSecondaryAction}
				</div>
			</div>
		</div>
	)
}
