import { cartActions, useCart } from '@/lib/stores/cart'
import { ndkActions } from '@/lib/stores/ndk'
import { uiActions } from '@/lib/stores/ui'
import { getProductImages, getProductPrice, getProductStock, getProductTitle, getProductVisibility } from '@/queries/products'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { Link, useLocation } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PriceDisplay } from './PriceDisplay'
import { Button } from './ui/button'
import { ZapButton } from './ZapButton'

export function ProductCard({ product }: { product: NDKEvent }) {
	const title = getProductTitle(product)
	const images = getProductImages(product)
	const price = getProductPrice(product)
	const stock = getProductStock(product)
	const visibilityTag = getProductVisibility(product)
	const visibility = visibilityTag?.[1] || 'on-sale'
	const [isOwnProduct, setIsOwnProduct] = useState(false)
	const [currentUserPubkey, setCurrentUserPubkey] = useState<string | null>(null)
	const [isAddingToCart, setIsAddingToCart] = useState(false)
	const [showConfirmation, setShowConfirmation] = useState(false)
	const location = useLocation()
	const cart = useCart()

	// Check if current user is the seller of this product
	useEffect(() => {
		const checkIfOwnProduct = async () => {
			const user = await ndkActions.getUser()
			if (user?.pubkey) {
				setCurrentUserPubkey(user.pubkey)
				setIsOwnProduct(user.pubkey === product.pubkey)
			}
		}
		checkIfOwnProduct()
	}, [product.pubkey])

	// Check if product is already in cart
	const isInCart = !!cart.cart.products[product.id]
	const cartQuantity = isInCart ? cart.cart.products[product.id]?.amount || 0 : 0

	const handleAddToCart = async () => {
		if (isOwnProduct || visibility === 'hidden') return // Don't allow adding own products or hidden products to cart

		setIsAddingToCart(true)
		try {
			const userPubkey = await ndkActions.getUser()
			if (!userPubkey) return
			await cartActions.addProduct(userPubkey.pubkey, product)
			setShowConfirmation(true)
			setTimeout(() => setShowConfirmation(false), 1200)
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
		<div className="border border-zinc-800 rounded-lg bg-white shadow-sm flex flex-col w-full max-w-full overflow-hidden" data-testid="product-card">
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
					{price && <PriceDisplay priceValue={parseFloat(price[1])} originalCurrency={price[2] || 'SATS'} />}

					{/* Stock/Pre-order indicator - right aligned */}
					{visibility === 'pre-order' ? (
						<div className="bg-blue-100 text-blue-800 font-medium px-4 py-1 rounded-full text-xs">Pre-order</div>
					) : stock !== undefined ? (
						<div className="bg-[var(--light-gray)] font-medium px-4 py-1 rounded-full text-xs">{stock[1]} in stock</div>
					) : null}
				</div>

				{/* Add a flex spacer to push the button to the bottom */}
				<div className="flex-grow"></div>

				{/* Add to cart button */}
				<div className="flex gap-2">
					<div className="flex-grow transition-all duration-300 ease-in-out">
						{isInCart ? (
							<div className="flex gap-2 w-full">
								{/* Show current quantity */}
								<div className="flex items-center justify-center px-2 h-10 bg-pink-100 text-pink-800 border-2 border-pink-300 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out">
									{cartQuantity}
								</div>
								{/* Add more button */}
								<Button
									className="py-3 px-4 rounded-lg flex-grow font-medium transition-all duration-200 ease-in-out bg-black text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
									onClick={handleAddToCart}
									disabled={isAddingToCart || visibility === 'hidden'}
								>
									{isAddingToCart ? (
										'Adding...'
									) : showConfirmation ? (
										<>
											<Check className="w-4 h-4 mr-2" /> Added
										</>
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
								onClick={handleAddToCart}
								disabled={isOwnProduct || isAddingToCart || visibility === 'hidden'}
							>
								{isOwnProduct ? (
									'Your Product'
								) : visibility === 'hidden' ? (
									'Not Available'
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
					<ZapButton event={product} />
				</div>
			</div>
		</div>
	)
}
