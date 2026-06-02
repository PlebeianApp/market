import { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	getProductImages,
	getProductPrice,
	getProductStock,
	getProductTitle,
	getProductVisibility,
	isNSFWProduct,
	isProductInStock,
} from '@/queries/products'
import { PriceDisplay } from '@/components/PriceDisplay'
import { UserCard } from '@/components/UserCard'
import React from 'react'

export interface CMSProductCardProps {
	product: NDKEvent
	showPrice?: boolean
	showVendor?: boolean
	showDescriptionSnippet?: boolean
	className?: string
	onAddToCart?: (product: NDKEvent) => void
}

export const CMSProductCard: React.FC<CMSProductCardProps> = ({
	product,
	showPrice = true,
	showVendor = true,
	showDescriptionSnippet = true,
	className = '',
	onAddToCart,
}) => {
	// Extract product data using the same helper functions as ProductCard
	const title = getProductTitle(product)
	const images = getProductImages(product)
	const price = getProductPrice(product)
	const stockTag = getProductStock(product)
	const stockQuantity = stockTag ? parseInt(stockTag[1]) : undefined
	const visibilityTag = getProductVisibility(product)
	const visibility = visibilityTag?.[1] || 'on-sale'
	const isNSFW = isNSFWProduct(product)

	// Use the same logic as ProductCard for stock status
	const isOutOfStock = visibility !== 'pre-order' && (stockQuantity === undefined || stockQuantity === 0)
	const isPreOrder = visibility === 'pre-order'
	const isInStock = isProductInStock(product)

	// Format price display using the same PriceDisplay component as ProductCard
	const renderPrice = () => {
		if (!price) return null
		return <PriceDisplay priceValue={parseFloat(price[1])} originalCurrency={price[2] || 'SATS'} />
	}

	return (
		<div
			className={`flex flex-col border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow ${className}`}
			style={{ maxWidth: '320px', minWidth: '200px' }}
		>
			{/* Image Container */}
			<div className="relative aspect-square">
				{images && images.length > 0 ? (
					<img src={images[0][1]} alt={title} className="w-full h-full object-cover" />
				) : (
					<div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">No Image</div>
				)}

				{/* NSFW badge */}
				{isNSFW && (
					<div className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded">NSFW</div>
				)}

				{/* Stock Status Badge - now at bottom left */}
				<div className="absolute bottom-2 left-2">
					{isPreOrder ? (
						<span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-full">
							Pre-order
						</span>
					) : isOutOfStock ? (
						<span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-full">
							Sold out
						</span>
					) : stockQuantity !== undefined ? (
						<span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-full">
							{stockQuantity} in stock
						</span>
					) : null}
				</div>
			</div>

			{/* Content */}
			<div className="p-3 flex flex-col flex-1">
				{/* Vendor - using UserCard component */}
				{showVendor && (
					<div className="mb-2">
						<UserCard pubkey={product.pubkey} size="xs" subtitle="none" onPress="profile" />
					</div>
				)}

				{/* Product Title */}
				<h3 className="font-semibold mb-2 line-clamp-2">
					<a href={`/product/${product.id}`} className="hover:text-primary">
						{title}
					</a>
				</h3>

				{/* Short Description */}
				{showDescriptionSnippet && product.content && (
					<p className="text-sm text-muted-foreground mb-3 line-clamp-3">{product.content.substring(0, 100)}...</p>
				)}

				{/* Pricing section with Add to Cart button */}
				<div className="flex items-center justify-between mt-auto pt-2">
					{showPrice && price && <div>{renderPrice()}</div>}

					{/* Add to Cart Icon Button */}
					{onAddToCart && (
						<button
							className="p-1 rounded-full border border-input hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								onAddToCart(product)
							}}
							disabled={!isInStock}
							aria-label="Add to cart"
						>
							<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
								<path
									fillRule="evenodd"
									d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
									clipRule="evenodd"
								/>
							</svg>
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
