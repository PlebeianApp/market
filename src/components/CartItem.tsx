import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useProductTitle, useProductPrice, useProductImages, useProductStock } from '@/queries/products'
import { Skeleton } from '@/components/ui/skeleton'
import { ShippingSelector } from '@/components/ShippingSelector'
import { cartActions, cartStore } from '@/lib/stores/cart'

interface CartItemProps {
	productId: string
	amount: number
	onQuantityChange: (productId: string, newAmount: number) => void
	onRemove: (productId: string) => void
	hideShipping?: boolean
}

export default function CartItem({ productId, amount, onQuantityChange, onRemove, hideShipping = false }: CartItemProps) {
	const [quantity, setQuantity] = useState(amount)
	const [showShipping, setShowShipping] = useState(false)

	// Fetch product data
	const { data: title, isLoading: isTitleLoading } = useProductTitle(productId)
	const { data: priceTag, isLoading: isPriceLoading } = useProductPrice(productId)
	const { data: images, isLoading: isImagesLoading } = useProductImages(productId)
	const { data: stockTag, isLoading: isStockLoading } = useProductStock(productId)

	const isLoading = isTitleLoading || isPriceLoading || isImagesLoading || isStockLoading

	// Parse data
	const price = priceTag ? parseFloat(priceTag[1]) : 0
	const currency = priceTag ? priceTag[2] : 'USD'
	const stockQuantity = stockTag ? parseInt(stockTag[1]) : 0
	const subtotal = price * amount

	// Get current shipping method
	const currentShippingId = cartActions.getShippingMethod(productId)
	const hasShipping = Boolean(currentShippingId)

	// Handle quantity input change
	const handleQuantityChange = (value: string) => {
		const newQuantity = parseInt(value)
		if (!isNaN(newQuantity)) {
			setQuantity(newQuantity)
		}
	}

	// Handle quantity blur to update cart
	const handleQuantityBlur = () => {
		if (quantity !== amount) {
			onQuantityChange(productId, quantity)
		}
	}

	// Handle immediate button-based quantity changes
	const handleIncrementClick = () => {
		const newAmount = Math.min(amount + 1, stockQuantity)
		if (newAmount !== amount) {
			onQuantityChange(productId, newAmount)
		}
	}

	const handleDecrementClick = () => {
		const newAmount = Math.max(1, amount - 1)
		if (newAmount !== amount) {
			onQuantityChange(productId, newAmount)
		}
	}

	// Update local state when prop changes
	useEffect(() => {
		setQuantity(amount)
	}, [amount])

	// Get shipping cost from the cart state
	const getShippingCost = () => {
		const cart = cartStore.state.cart
		const product = cart.products[productId]
		return product?.shippingCost || 0
	}

	if (isLoading) {
		return (
			<li className="flex gap-4 pb-4 border-b border-gray-300 [.bg-gray-100_&]:border-white">
				<Skeleton className="h-20 w-20 rounded-md" />
				<div className="flex flex-1 flex-col justify-between">
					<div>
						<Skeleton className="h-5 w-24 mb-1" />
						<Skeleton className="h-4 w-16" />
					</div>
					<div className="flex items-center justify-between mt-2">
						<div className="flex items-center space-x-2">
							<Skeleton className="h-8 w-8 rounded" />
							<Skeleton className="h-8 w-12 rounded" />
							<Skeleton className="h-8 w-8 rounded" />
						</div>
					</div>
				</div>
				<Skeleton className="h-5 w-16 self-center" />
			</li>
		)
	}

	return (
		<li className="flex flex-col py-4 border-b border-gray-300 [.bg-gray-100_&]:border-white">
			<div className="flex items-start space-x-4">
				{/* Product Image */}
				{images && images.length > 0 ? (
					<div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border">
						<img src={images[0][1]} alt={title || 'Product image'} className="h-full w-full object-cover object-center" />
					</div>
				) : (
					<div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border bg-gray-100 flex items-center justify-center text-gray-400">
						No image
					</div>
				)}

				{/* Product Details */}
				<div className="flex flex-1 flex-col justify-between">
					<div>
						<h3 className="text-base font-medium">{title || 'Untitled Product'}</h3>
						<p className="mt-1 text-sm text-muted-foreground">
							{currency.toLowerCase() === 'sats' || currency.toLowerCase() === 'sat'
								? `${Math.round(price).toLocaleString()} sats`
								: `${Math.round(price * 100).toLocaleString()} sats (${price.toFixed(2)} ${currency})`}
						</p>
					</div>

					{/* Quantity Controls */}
					<div className="flex items-center justify-between mt-2">
						<div className="flex items-center space-x-2">
							<Button variant="outline" size="icon" className="h-8 w-8" onClick={handleDecrementClick} disabled={amount <= 1}>
								<Minus size={14} />
							</Button>

							<Input
								type="number"
								className="w-12 h-8 text-center p-0"
								value={quantity}
								onChange={(e) => handleQuantityChange(e.target.value)}
								onBlur={handleQuantityBlur}
								min={1}
								max={stockQuantity}
							/>

							<Button variant="outline" size="icon" className="h-8 w-8" onClick={handleIncrementClick} disabled={amount >= stockQuantity}>
								<Plus size={14} />
							</Button>
						</div>

						{/* Delete Button */}
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
							onClick={() => onRemove(productId)}
						>
							<Trash2 size={16} />
						</Button>
					</div>
				</div>

				{/* Product Total */}
				<div className="flex items-center">
					<p className="text-sm font-medium">
						{subtotal.toFixed(2)} {currency}
					</p>
				</div>
			</div>

			{/* Shipping Section - only show if not hidden */}
			{!hideShipping && (
				<div className="ml-24 flex flex-col gap-2">
					<button
						className={`text-sm ${
							!hasShipping ? 'text-red-600 hover:text-red-800 font-medium' : 'text-blue-600 hover:text-blue-800'
						} text-left w-fit flex items-center gap-2`}
						onClick={() => setShowShipping(!showShipping)}
					>
						{!hasShipping && <span className="i-warning w-4 h-4" />}
						{showShipping ? 'Hide shipping options' : hasShipping ? 'Change shipping' : 'Select shipping (required)'}
					</button>

					{showShipping && (
						<div className={`flex flex-col gap-2 ${!hasShipping ? 'border-l-2 border-red-200 pl-2' : ''}`}>
							<ShippingSelector
								productId={productId}
								className="w-full max-w-xs"
								onSelect={() => {}} // No-op since we handle selection inside ShippingSelector
							/>

							{getShippingCost() > 0 && (
								<div className="text-sm text-muted-foreground">
									Shipping cost: {getShippingCost()} {currency}
								</div>
							)}
						</div>
					)}

					{!showShipping && currentShippingId && getShippingCost() > 0 && (
						<div className="text-sm text-muted-foreground">
							Shipping: {getShippingCost()} {currency}
						</div>
					)}
				</div>
			)}
		</li>
	)
}
