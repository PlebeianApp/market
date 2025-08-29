import { useState, useEffect } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ZapButton } from '@/components/ZapButton'
import { useNDK } from '@/lib/stores/ndk'
import { useCart } from '@/lib/stores/cart'
import { useUI } from '@/lib/stores/ui'
import { getProductTitle, getProductImages, getProductPrice, getProductStock } from '@/queries/products'
import { NDKEvent } from '@nostr-dev-kit/ndk'

export function ProductCard({ product }: { product: NDKEvent }) {
	const ndk = useNDK()
	const cart = useCart()
	const { uiActions } = useUI()
	const title = getProductTitle(product)
	const images = getProductImages(product)
	const price = getProductPrice(product)
	const stock = getProductStock(product)
	const [isOwnProduct, setIsOwnProduct] = useState(false)
	const [currentUserPubkey, setCurrentUserPubkey] = useState<string | null>(null)
	const [isAddingToCart, setIsAddingToCart] = useState(false)
	const [showConfirmation, setShowConfirmation] = useState(false)
	const location = useLocation()

	// Check if current user is the seller of this product
	useEffect(() => {
		const checkIfOwnProduct = async () => {
			const user = await ndk.getUser()
			if (user?.pubkey) {
				setCurrentUserPubkey(user.pubkey)
				setIsOwnProduct(user.pubkey === product.pubkey)
			}
		}
		checkIfOwnProduct()
	}, [product.pubkey])

	const handleAddToCart = async () => {
		if (isOwnProduct) return // Don't allow adding own products to cart

		setIsAddingToCart(true)

		try {
			const userPubkey = await ndk.getUser()
			if (!userPubkey) return
			cart.addProduct(userPubkey.pubkey, product)

			// Show confirmation animation
			setShowConfirmation(true)
			setTimeout(() => setShowConfirmation(false), 1500) // Hide after 1.5 seconds
		} finally {
			setIsAddingToCart(false)
		}
	}

	const handleProductClick = () => {
		// Store the current path as the source path
		// This will also store it as originalResultsPath if not already set
		uiActions.setProductSourcePath(location.pathname)
	}

	return (
		<div className="border border-zinc-800 rounded-lg bg-white shadow-md flex flex-col" data-testid="product-card">
			{/* Square aspect ratio container for image */}
			<Link
				to={`/products/${product.id}`}
				className="relative aspect-square overflow-hidden border-b border-zinc-800 block"
				onClick={handleProductClick}
			>
				{images && images.length > 0 ? (
					<img
						src={images[0][1]}
						alt={title}
						className="w-full h-full object-cover rounded-t-[calc(var(--radius)-1px)] hover:scale-105 transition-transform duration-200"
					/>
				) : (
					<div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 rounded-lg hover:bg-gray-200 transition-colors duration-200">
						No image
					</div>
				)}
			</Link>

			<div className="p-2 flex flex-col gap-2 flex-grow">
				{/* Product title */}
				<Link to={`/products/${product.id}`} onClick={handleProductClick}>
					<h2 className="text-sm font-medium border-b border-[var(--light-gray)] pb-2 overflow-hidden text-ellipsis whitespace-nowrap">
						{title}
					</h2>
				</Link>

				{/* Pricing section */}
				<div className="flex justify-between items-center">
					<div className="flex flex-col gap-1">
						{price && (
							<p className="text-xs text-gray-500">
								{price[1]} {price[2]}
							</p>
						)}
						{/* Sats price - more prominent */}
						<p className="text-sm font-medium">{price ? Math.round(parseFloat(price[1]) * 220).toLocaleString() : '0'} Sats</p>
					</div>

					{/* Stock indicator - right aligned */}
					{stock !== undefined && (
						<div className="bg-[var(--light-gray)] font-medium px-4 py-1 rounded-full text-xs">{stock[1]} in stock</div>
					)}
				</div>

				{/* Add a flex spacer to push the button to the bottom */}
				<div className="flex-grow"></div>

				{/* Add to cart button */}
				<div className="flex gap-2">
					<Button
						variant={isOwnProduct ? 'own-product' : 'primary'}
						className={`py-3 px-4 rounded-lg flex-grow font-medium transition-all duration-300 ${
							isAddingToCart ? 'opacity-75 scale-95' : ''
						}`}
						onClick={handleAddToCart}
						disabled={isOwnProduct || isAddingToCart}
					>
						{isOwnProduct ? 'Your Product' : showConfirmation ? '✓ Added!' : isAddingToCart ? 'Adding...' : 'Add to Cart'}
					</Button>
					<ZapButton event={product} />
				</div>
			</div>
		</div>
	)
}
