import CartItem from '@/components/CartItem'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cartActions, cartStore, useCartTotals } from '@/lib/stores/cart'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

export default function CartSheetContent() {
	const { cart } = useStore(cartStore)
	const [parent, enableAnimations] = useAutoAnimate()
	const { totalItems, subtotalByCurrency } = useCartTotals()
	const userPubkey = cartActions.getUserPubkey()

	useEffect(() => {
		enableAnimations(true)
	}, [parent, enableAnimations])

	// Group products by seller using the cart store function
	const productsBySeller = cartActions.groupProductsBySeller()

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
		<SheetContent side="right">
			<SheetHeader>
				<SheetTitle>Your Cart</SheetTitle>
				<SheetDescription>Review your items</SheetDescription>
			</SheetHeader>

			{/* Cart Items - Scrollable Area */}
			<div className="flex-1 overflow-y-auto py-4 px-6 mt-6">
				<div className="space-y-8" ref={parent}>
					{Object.entries(productsBySeller).map(([sellerPubkey, products]) => (
						<div key={sellerPubkey} className="space-y-4">
							{/* Seller information */}
							<div className="flex items-center justify-between">
								<UserWithAvatar pubkey={sellerPubkey} size="sm" showBadge={false} />
								<span className="text-sm text-muted-foreground">
									{products.length} {products.length === 1 ? 'item' : 'items'}
								</span>
							</div>

							<Separator />

							{/* Products from this seller */}
							<ul className="space-y-6">
								{products.map((product) => (
									<CartItem
										key={product.id}
										productId={product.id}
										amount={product.amount}
										onQuantityChange={handleQuantityChange}
										onRemove={handleRemoveProduct}
									/>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>

			{/* Cart Footer */}
			<SheetFooter className="border-t p-6 bg-gray-50">
				<div className="space-y-4 w-full">
					{/* Subtotal per currency */}
					<div className="space-y-2">
						{Object.entries(subtotalByCurrency).map(([currency, amount]) => (
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
