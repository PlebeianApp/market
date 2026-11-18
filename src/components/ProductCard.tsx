import { cartActions, useCart } from '@/lib/stores/cart'
import { Media } from '@/components/Media'
import { ndkActions } from '@/lib/stores/ndk'
import { uiActions } from '@/lib/stores/ui'
import {
	getProductImages,
	getProductPrice,
	getProductStock,
	getProductTitle,
	getProductVisibility,
	isNSFWProduct,
	productQueryOptions,
} from '@/queries/products'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PriceDisplay } from './PriceDisplay'
import { Button } from './ui/button'
import { authStore, useAuth } from '@/lib/stores/auth'
import { ZapButton } from './social/ZapButton'
import { cn } from '@/lib/utils'
import { getItemTestLabelCoordinate } from '@/lib/utils/testLabelFilters'
import { TestListingNotice } from './TestListingNotice'

export interface ProductCardProps extends React.HTMLAttributes<HTMLDivElement> {
	product: NDKEvent
	appearance?: 'marketplace' | 'storefront'
}

export function ProductCard({ product, className, appearance = 'marketplace' }: ProductCardProps) {
	const isStorefront = appearance === 'storefront'
	const title = getProductTitle(product)
	const images = getProductImages(product)
	const price = getProductPrice(product)
	const stockTag = getProductStock(product)
	const stockQuantity = stockTag ? parseInt(stockTag[1]) : undefined
	const visibilityTag = getProductVisibility(product)
	const visibility = visibilityTag?.[1] || 'on-sale'
	const isNSFW = isNSFWProduct(product)
	// Out of stock if stock is explicitly 0 or undefined (no stock tag), but not for pre-order items
	const isOutOfStock = visibility !== 'pre-order' && (stockQuantity === undefined || stockQuantity === 0)
	const [isAddingToCart, setIsAddingToCart] = useState(false)
	const [showConfirmation, setShowConfirmation] = useState(false)
	const location = useLocation()
	const cart = useCart()
	const queryClient = useQueryClient()
	const { user, isAuthenticated } = useAuth()

	const isOwnProduct = isAuthenticated && user?.pubkey === product.author.pubkey

	// ADR-0009: coordinate used by the test-listing indicator. Cards normally
	// only carry test-labeled items when the viewer revealed them or is on the
	// seller's profile, so the marker explains what they are looking at.
	const testLabelCoordinate = getItemTestLabelCoordinate(product)

	// Check if product is already in cart
	const isInCart = !!cart.cart.products[product.id]
	const cartQuantity = isInCart ? cart.cart.products[product.id]?.amount || 0 : 0

	const handleAddToCart = async () => {
		if (isOwnProduct || visibility === 'hidden' || isOutOfStock) return // Don't allow adding own products, hidden products, or out of stock items

		// Check if adding would exceed available stock
		if (stockQuantity !== undefined && cartQuantity >= stockQuantity) return

		setIsAddingToCart(true)
		try {
			await cartActions.addProduct(product)
			setShowConfirmation(true)
			setTimeout(() => setShowConfirmation(false), 1200)
		} finally {
			setIsAddingToCart(false)
		}
	}

	const handleProductClick = () => {
		// Seed the product details cache so the product page can render immediately on navigation.
		queryClient.setQueryData(productQueryOptions(product.id).queryKey, product)

		// Store the current path as the source path
		// This will also store it as originalResultsPath if not already set
		uiActions.setProductSourcePath(location.pathname)
	}

	const handleButtonClick = (e: React.MouseEvent, action: () => void) => {
		e.preventDefault()
		e.stopPropagation()
		action()
	}

	return (
		<Link
			to={`/products/${product.id}`}
			onClick={handleProductClick}
			className={cn(
				'flex flex-col w-full max-w-full overflow-hidden transition-shadow duration-200 cursor-pointer',
				isStorefront
					? 'group rounded-none bg-transparent text-foreground'
					: 'border border-zinc-800 rounded-lg bg-white shadow-sm hover:shadow-md',
				className,
			)}
			data-testid="product-card"
			data-appearance={appearance}
		>
			{/* Square aspect ratio container for image */}
			<div
				className={cn('relative aspect-square overflow-hidden block', isStorefront ? 'rounded-2xl bg-muted' : 'border-b border-zinc-800')}
			>
				{images && images.length > 0 ? (
					<Media
						src={images[0][1]}
						alt={title}
						className={cn(
							'w-full h-full object-cover hover:scale-105 transition-transform duration-200',
							!isStorefront && 'rounded-t-[calc(var(--radius)-1px)]',
						)}
					/>
				) : (
					<div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 rounded-lg hover:bg-gray-200 transition-colors duration-200">
						No image
					</div>
				)}
				{/* NSFW badge */}
				{isNSFW && <div className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">NSFW</div>}
				{/* ADR-0009 test-listing marker (icon-only: card clicks navigate) */}
				{testLabelCoordinate && <TestListingNotice coordinate={testLabelCoordinate} variant="icon" className="absolute top-2 right-2" />}
			</div>

			<div className={cn('flex flex-col gap-2 flex-grow', isStorefront ? 'py-5' : 'p-2')}>
				{/* Product title */}
				<h2
					className={cn(
						'font-medium overflow-hidden text-ellipsis',
						isStorefront ? 'text-lg leading-snug' : 'text-sm border-b border-[var(--light-gray)] pb-2 whitespace-nowrap',
					)}
				>
					{title}
				</h2>

				{/* Pricing section */}
				<div className="flex justify-between items-center">
					{price && <PriceDisplay priceValue={parseFloat(price[1])} originalCurrency={price[2] || 'SATS'} />}

					{/* Stock/Pre-order indicator - right aligned */}
					{visibility === 'pre-order' ? (
						<div className="bg-blue-100 text-blue-800 font-medium px-4 py-1 rounded-full text-xs">Pre-order</div>
					) : isOutOfStock ? (
						<div className="bg-red-100 text-red-800 font-medium px-4 py-1 rounded-full text-xs">Out of stock</div>
					) : stockQuantity !== undefined ? (
						<div className="bg-[var(--light-gray)] font-medium px-4 py-1 rounded-full text-xs">{stockQuantity} in stock</div>
					) : null}
				</div>

				{/* Add a flex spacer to push the button to the bottom */}
				<div className="flex-grow"></div>

				{/* Add to cart button */}
				<div className="flex gap-2">
					<div className="flex-grow transition-all duration-300 ease-in-out">
						{isOwnProduct ? (
							<Button
								className="py-3 px-4 rounded-lg w-full font-medium transition-all duration-300 bg-black text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
								disabled={true}
							>
								Your Product
							</Button>
						) : isInCart ? (
							<div className="flex gap-2 w-full">
								{/* Show current quantity */}
								<div className="flex items-center justify-center px-2 h-10 bg-pink-100 text-pink-800 border-2 border-pink-300 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out">
									{cartQuantity}
								</div>
								{/* Add more button */}
								<Button
									className="py-3 px-4 rounded-lg flex-grow font-medium transition-all duration-200 ease-in-out bg-black text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
									onClick={(e) => handleButtonClick(e, handleAddToCart)}
									disabled={isAddingToCart || visibility === 'hidden' || (stockQuantity !== undefined && cartQuantity >= stockQuantity)}
								>
									{isAddingToCart ? (
										'Adding...'
									) : showConfirmation ? (
										<>
											<Check className="w-4 h-4 mr-2" /> Added
										</>
									) : stockQuantity !== undefined && cartQuantity >= stockQuantity ? (
										'Max'
									) : (
										'Add'
									)}
								</Button>
							</div>
						) : (
							<Button
								className={`py-3 px-4 rounded-lg w-full font-medium transition-all duration-300 bg-black text-white disabled:bg-gray-400 disabled:cursor-not-allowed ${
									isAddingToCart ? 'opacity-75 scale-95' : ''
								}`}
								onClick={(e) => handleButtonClick(e, handleAddToCart)}
								disabled={isOwnProduct || isAddingToCart || visibility === 'hidden' || isOutOfStock}
							>
								{visibility === 'hidden' ? (
									'Not Available'
								) : isOutOfStock ? (
									'Out of Stock'
								) : showConfirmation ? (
									<>
										<Check className="w-4 h-4 mr-2" /> Added!
									</>
								) : isAddingToCart ? (
									'Adding...'
								) : visibility === 'pre-order' ? (
									'Pre-order'
								) : (
									'Add to Cart'
								)}
							</Button>
						)}
					</div>
					<div>
						<ZapButton event={product} />
					</div>
				</div>
			</div>
		</Link>
	)
}
