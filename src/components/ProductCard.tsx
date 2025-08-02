import { cartActions } from '@/lib/stores/cart'
import { ndkActions } from '@/lib/stores/ndk'
import { uiActions } from '@/lib/stores/ui'
import { getProductImages, getProductPrice, getProductStock, getProductTitle } from '@/queries/products'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { Link, useLocation } from '@tanstack/react-router'
import { Button } from './ui/button'
import { ZapButton } from './ZapButton'
import { useEffect, useState } from 'react'

export function ProductCard({ product }: { product: NDKEvent }) {
	const title = getProductTitle(product)
	const images = getProductImages(product)
	const price = getProductPrice(product)
	const stock = getProductStock(product)
	const [isOwnProduct, setIsOwnProduct] = useState(false)
	const [currentUserPubkey, setCurrentUserPubkey] = useState<string | null>(null)
	const location = useLocation()

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

	const handleAddToCart = async () => {
		if (isOwnProduct) return // Don't allow adding own products to cart

		const userPubkey = await ndkActions.getUser()
		if (!userPubkey) return
		cartActions.addProduct(userPubkey.pubkey, product)
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
						className="btn-black py-3 px-4 rounded-lg flex-grow font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
						onClick={handleAddToCart}
						disabled={isOwnProduct}
					>
						{isOwnProduct ? 'Your Product' : 'Add to Cart'}
					</Button>
					<ZapButton event={product} />
				</div>
			</div>
		</div>
	)
}
