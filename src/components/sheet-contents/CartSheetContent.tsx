import { Button } from '@/components/ui/button'
import { SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'

export default function CartSheetContent() {
	const { cart } = useStore(cartStore)

	const [quantities, setQuantities] = useState<Record<string, number>>({})
	const [parent, enableAnimations] = useAutoAnimate()

	useEffect(() => {
		enableAnimations(true)
	}, [parent, enableAnimations])

	// Get calculated values from cart store
	const totalItems = cartActions.calculateTotalItems()
	const amountsByCurrency = cartActions.calculateAmountsByCurrency()
	const userPubkey = cartActions.getUserPubkey()

	// Handle quantity change for a product
	const handleQuantityChange = (productId: string, value: string) => {
		const newQuantity = parseInt(value)
		if (!isNaN(newQuantity)) {
			setQuantities({ ...quantities, [productId]: newQuantity })
		}
	}

	// Handle blur event to update the cart when input loses focus
	const handleQuantityBlur = (productId: string) => {
		const newQuantity = quantities[productId]
		if (newQuantity !== undefined && userPubkey) {
			// Update the quantity in the cart
			cartActions.handleProductUpdate('setAmount', userPubkey, productId, newQuantity)
			// Reset stored quantity
			setQuantities((prev) => {
				const next = { ...prev }
				delete next[productId]
				return next
			})
		}
	}

	if (Object.keys(cart.products).length === 0) {
		return (
			<SheetContent side="right">
				<div className="flex flex-col items-center justify-center h-full p-8 text-center">
					<SheetHeader>
						<SheetTitle>Your cart is empty</SheetTitle>
						<SheetDescription>Looks like you haven't added any products to your cart yet.</SheetDescription>
					</SheetHeader>
					<SheetFooter>
						<SheetClose asChild>
							<Button>Continue Shopping</Button>
						</SheetClose>
					</SheetFooter>
				</div>
			</SheetContent>
		)
	}

	return (
		<SheetContent side="right" className="w-[400px] sm:w-[540px]">
			<SheetHeader>
				<SheetTitle>Your Cart</SheetTitle>
				<SheetDescription>Review your items</SheetDescription>
			</SheetHeader>

			{/* Cart Items - Scrollable Area */}
			<div className="flex-1 overflow-y-auto py-4 px-6 mt-6">
				<ul className="space-y-6" ref={parent}>
					{Object.values(cart.products).map((product) => {
						const subtotal = cartActions.calculateProductSubtotal(product.id)

						return (
							<li key={product.id} className="flex gap-4 pb-4 border-b">
								{/* Product Image */}
								{product.images && product.images.length > 0 && (
									<div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border">
										<img
											src={product.images[0].url}
											alt={product.images[0].alt || product.name}
											className="h-full w-full object-cover object-center"
										/>
									</div>
								)}

								{/* Product Details */}
								<div className="flex flex-1 flex-col justify-between">
									<div>
										<h3 className="text-base font-medium">{product.name}</h3>
										<p className="mt-1 text-sm text-muted-foreground">
											{product.price} {product.currency}
										</p>
									</div>

									{/* Quantity Controls */}
									<div className="flex items-center justify-between mt-2">
										<div className="flex items-center space-x-2">
											<Button
												variant="outline"
												size="icon"
												className="h-8 w-8"
												onClick={() => userPubkey && cartActions.handleProductUpdate('decrement', userPubkey, product.id)}
												disabled={product.amount <= 1}
											>
												<Minus size={14} />
											</Button>

											<Input
												type="number"
												className="w-12 h-8 text-center p-0"
												value={quantities[product.id] !== undefined ? quantities[product.id] : product.amount}
												onChange={(e) => handleQuantityChange(product.id, e.target.value)}
												onBlur={() => handleQuantityBlur(product.id)}
												min={1}
												max={product.stockQuantity}
											/>

											<Button
												variant="outline"
												size="icon"
												className="h-8 w-8"
												onClick={() => userPubkey && cartActions.handleProductUpdate('increment', userPubkey, product.id)}
												disabled={product.amount >= product.stockQuantity}
											>
												<Plus size={14} />
											</Button>
										</div>

										{/* Delete Button */}
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
											onClick={() => userPubkey && cartActions.handleProductUpdate('remove', userPubkey, product.id)}
										>
											<Trash2 size={16} />
										</Button>
									</div>
								</div>

								{/* Product Total */}
								<div className="flex items-center">
									<p className="text-sm font-medium">
										{subtotal.value.toFixed(2)} {subtotal.currency}
									</p>
								</div>
							</li>
						)
					})}
				</ul>
			</div>

			{/* Cart Footer */}
			<SheetFooter className="border-t p-6 bg-gray-50">
				<div className="space-y-4 w-full">
					{/* Subtotal per currency */}
					<div className="space-y-2">
						{Object.entries(amountsByCurrency).map(([currency, amount]) => (
							<div key={currency} className="flex justify-between">
								<p className="text-sm text-muted-foreground">Subtotal ({currency})</p>
								<p className="text-sm font-medium">
									{amount.toFixed(2)} {currency}
								</p>
							</div>
						))}
					</div>

					<div className="text-xs text-muted-foreground">Shipping and taxes calculated at checkout</div>

					{/* Action Buttons */}
					<div className="space-y-2">
						<Button className="w-full" size="lg">
							Checkout ({totalItems} {totalItems === 1 ? 'item' : 'items'})
						</Button>
						<div className="flex gap-2">
							<SheetClose asChild>
								<Button variant="outline" className="flex-1">
									Continue Shopping
								</Button>
							</SheetClose>
							<Button
								variant="outline"
								className="flex-1 text-red-500 hover:bg-red-50 hover:text-red-600 border-red-200"
								onClick={() => cartActions.clear()}
							>
								Clear Cart
							</Button>
						</div>
					</div>
				</div>
			</SheetFooter>
		</SheetContent>
	)
}
