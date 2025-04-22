import { Button } from '@/components/ui/button'
import { SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import CartItem from '@/components/CartItem'
import { useEffect } from 'react'

export default function CartSheetContent() {
	const { cart } = useStore(cartStore)
	const [parent, enableAnimations] = useAutoAnimate()

	useEffect(() => {
		enableAnimations(true)
	}, [parent, enableAnimations])

	// Get calculated values from cart store
	const totalItems = cartActions.calculateTotalItems()
	const amountsByCurrency = cartActions.calculateAmountsByCurrency()
	const userPubkey = cartActions.getUserPubkey()

	// Handle quantity change for a product
	const handleQuantityChange = (productId: string, newAmount: number) => {
		if (userPubkey) {
			cartActions.handleProductUpdate('setAmount', userPubkey, productId, newAmount)
		}
	}

	// Handle remove product
	const handleRemoveProduct = (productId: string) => {
		if (userPubkey) {
			cartActions.handleProductUpdate('remove', userPubkey, productId)
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
					{Object.values(cart.products).map((product) => (
						<CartItem
							key={product.id}
							productId={product.id}
							amount={product.amount}
							stockQuantity={product.stockQuantity}
							onQuantityChange={handleQuantityChange}
							onRemove={handleRemoveProduct}
						/>
					))}
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
