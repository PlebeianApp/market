import { cartActions, useCart } from '@/lib/stores/cart'
import { Media } from '@/components/Media'
import { uiActions } from '@/lib/stores/ui'
import { productQueryOptions } from '@/queries/products'
import { getProductStock, getProductVisibility, isProductInStock } from '@sdk/commerce/discovery'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PriceDisplay } from './PriceDisplay'
import { useAuth } from '@/lib/stores/auth'
import { ZapButton } from './social/ZapButton'
import { cn } from '@/lib/utils'
import { getItemTestLabelCoordinate } from '@/lib/utils/testLabelFilters'
import { TestListingNotice } from './TestListingNotice'
import { ProductCardView } from '@ui/components/ProductCardView'

export interface ProductCardProps extends React.HTMLAttributes<HTMLDivElement> {
	product: NDKEvent
}

export function ProductCard({ product, className }: ProductCardProps) {
	const stockTag = getProductStock(product)
	const parsedStockQuantity = stockTag ? Number.parseInt(stockTag[1], 10) : undefined
	const stockQuantity = parsedStockQuantity !== undefined && Number.isFinite(parsedStockQuantity) ? parsedStockQuantity : undefined
	const visibility = getProductVisibility(product)?.[1] || 'on-sale'
	const isOutOfStock = visibility !== 'pre-order' && !isProductInStock(product)
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

	return (
		<Link
			to={`/products/${product.id}`}
			onClick={handleProductClick}
			className={cn(
				'border border-zinc-800 rounded-lg bg-white shadow-sm flex flex-col w-full max-w-full overflow-hidden hover:shadow-md transition-shadow duration-200 cursor-pointer',
				className,
			)}
			data-testid="product-card"
		>
			<ProductCardView
				product={product}
				isOwnProduct={isOwnProduct}
				isInCart={isInCart}
				cartQuantity={cartQuantity}
				isAddingToCart={isAddingToCart}
				showConfirmation={showConfirmation}
				onAddToCart={handleAddToCart}
				renderImage={(src, alt) => (
					<Media
						src={src}
						alt={alt}
						className="h-full w-full rounded-t-[calc(var(--radius)-1px)] object-cover transition-transform duration-200 hover:scale-105"
					/>
				)}
				renderPrice={(priceTag) => <PriceDisplay priceValue={Number.parseFloat(priceTag[1])} originalCurrency={priceTag[2] || 'SATS'} />}
				renderNotice={
					testLabelCoordinate ? (
						<TestListingNotice coordinate={testLabelCoordinate} variant="icon" className="absolute top-2 right-2" />
					) : null
				}
				renderSecondaryAction={<ZapButton event={product} />}
			/>
		</Link>
	)
}
