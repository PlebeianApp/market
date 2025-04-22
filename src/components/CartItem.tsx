import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useProductTitle, useProductPrice, useProductImages } from '@/queries/products'
import { Skeleton } from '@/components/ui/skeleton'

interface CartItemProps {
	productId: string
	amount: number
	stockQuantity: number
	onQuantityChange: (productId: string, newAmount: number) => void
	onRemove: (productId: string) => void
}

export default function CartItem({ productId, amount, stockQuantity, onQuantityChange, onRemove }: CartItemProps) {
	const [quantity, setQuantity] = useState(amount)

	// Fetch product data
	const { data: title, isLoading: isTitleLoading } = useProductTitle(productId)
	const { data: priceTag, isLoading: isPriceLoading } = useProductPrice(productId)
	const { data: images, isLoading: isImagesLoading } = useProductImages(productId)

	const isLoading = isTitleLoading || isPriceLoading || isImagesLoading

	// Calculate subtotal
	const price = priceTag ? parseFloat(priceTag[1]) : 0
	const currency = priceTag ? priceTag[2] : 'USD'
	const subtotal = price * amount

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

	// Update local state when prop changes
	useEffect(() => {
		setQuantity(amount)
	}, [amount])

	if (isLoading) {
		return (
			<li className="flex gap-4 pb-4 border-b">
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
		<li className="flex gap-4 pb-4 border-b">
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
						{price} {currency}
					</p>
				</div>

				{/* Quantity Controls */}
				<div className="flex items-center justify-between mt-2">
					<div className="flex items-center space-x-2">
						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8"
							onClick={() => onQuantityChange(productId, Math.max(1, amount - 1))}
							disabled={amount <= 1}
						>
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

						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8"
							onClick={() => onQuantityChange(productId, Math.min(amount + 1, stockQuantity))}
							disabled={amount >= stockQuantity}
						>
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
		</li>
	)
}
