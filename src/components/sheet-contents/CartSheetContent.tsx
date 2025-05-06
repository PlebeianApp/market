import CartItem from '@/components/CartItem'
import { ShippingSelector } from '@/components/ShippingSelector'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { cartActions, cartStore, useCartTotals } from '@/lib/stores/cart'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { useEffect, useState, useMemo } from 'react'

export default function CartSheetContent() {
	const { cart } = useStore(cartStore)
	const [parent, enableAnimations] = useAutoAnimate()
	const { totalItems, subtotalByCurrency, shippingByCurrency, totalByCurrency } = useCartTotals()
	const userPubkey = cartActions.getUserPubkey()
	const [sellerShippingOptions, setSellerShippingOptions] = useState<Record<string, RichShippingInfo[]>>({})
	const [selectedShippingByUser, setSelectedShippingByUser] = useState<Record<string, string>>({})

	// Add validation for shipping methods
	const hasAllShippingMethods = useMemo(() => {
		return Object.values(cart.products).every((product) => product.shippingMethodId !== null)
	}, [cart.products])

	// Get products missing shipping - make this reactive with useMemo
	const missingShippingCount = useMemo(() => {
		return Object.values(cart.products).filter((product) => !product.shippingMethodId).length
	}, [cart.products])

	// Fetch shipping options for each seller
	useEffect(() => {
		const fetchShippingForSellers = async () => {
			const productsBySeller = cartActions.groupProductsBySeller()
			const newSellerShippingOptions: Record<string, RichShippingInfo[]> = {}
			const newSelectedShipping: Record<string, string> = {}

			// For each seller, fetch shipping options using the first product
			for (const [sellerPubkey, products] of Object.entries(productsBySeller)) {
				if (products.length > 0) {
					try {
						const firstProductId = products[0].id
						const options = await cartActions.fetchAvailableShippingOptions(firstProductId)
						newSellerShippingOptions[sellerPubkey] = options

						// Initialize selected shipping with what's already in the cart
						if (products[0].shippingMethodId) {
							newSelectedShipping[sellerPubkey] = products[0].shippingMethodId
						}
					} catch (error) {
						console.error(`Failed to fetch shipping options for seller ${sellerPubkey}:`, error)
						newSellerShippingOptions[sellerPubkey] = []
					}
				}
			}

			setSellerShippingOptions(newSellerShippingOptions)
			// Update selected shipping, but keep existing selections
			setSelectedShippingByUser((prev) => ({ ...newSelectedShipping, ...prev }))
		}

		fetchShippingForSellers()
	}, [cart.products])

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

	// Handle shipping option selection for a seller
	const handleShippingSelect = async (sellerPubkey: string, shippingOption: RichShippingInfo) => {
		// Log current state for debugging
		console.log('Before shipping update:', {
			sellerPubkey,
			shippingOption,
			products: productsBySeller[sellerPubkey],
		})

		const products = productsBySeller[sellerPubkey] || []

		// Use Promise.all to wait for all shipping updates to complete
		await Promise.all(products.map((product) => cartActions.setShippingMethod(product.id, shippingOption)))

		// Update selected shipping state
		setSelectedShippingByUser((prev) => ({
			...prev,
			[sellerPubkey]: shippingOption.id,
		}))

		// Log updated state for debugging
		console.log('After shipping update:', {
			sellerPubkey,
			shippingOption,
			updatedProducts: cartStore.state.cart.products,
		})
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
		<SheetContent className="flex flex-col w-full sm:max-w-lg">
			<SheetHeader>
				<SheetTitle>Your Cart</SheetTitle>
				<SheetDescription>Review your items</SheetDescription>
			</SheetHeader>

			{/* Update warning message to use memoized value */}
			{missingShippingCount > 0 && (
				<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
					<div className="flex">
						<div className="ml-3">
							<p className="text-sm text-yellow-700">
								Please select shipping options for {missingShippingCount} {missingShippingCount === 1 ? 'item' : 'items'} before checkout.
							</p>
						</div>
					</div>
				</div>
			)}

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

							<ShippingSelector
								options={sellerShippingOptions[sellerPubkey] || []}
								selectedId={selectedShippingByUser[sellerPubkey]}
								onSelect={(option) => handleShippingSelect(sellerPubkey, option)}
								className="w-full"
							/>

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
										hideShipping={true}
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
					{/* Subtotal, Shipping, and Total per currency */}
					<div className="space-y-2">
						{Object.entries(subtotalByCurrency).map(([currency, amount]) => (
							<div key={`subtotal-${currency}`} className="flex justify-between">
								<p className="text-sm text-muted-foreground">Subtotal ({currency})</p>
								<p className="text-sm font-medium">
									{amount.toFixed(2)} {currency}
								</p>
							</div>
						))}

						{Object.entries(shippingByCurrency)
							.filter(([_, amount]) => amount > 0)
							.map(([currency, amount]) => (
								<div key={`shipping-${currency}`} className="flex justify-between">
									<p className="text-sm text-muted-foreground">Shipping ({currency})</p>
									<p className="text-sm font-medium">
										{amount.toFixed(2)} {currency}
									</p>
								</div>
							))}

						<Separator className="my-2" />

						{Object.entries(totalByCurrency).map(([currency, amount]) => (
							<div key={`total-${currency}`} className="flex justify-between">
								<p className="text-sm font-semibold">Total ({currency})</p>
								<p className="text-sm font-bold">
									{amount.toFixed(2)} {currency}
								</p>
							</div>
						))}
					</div>

					<div className="text-xs text-muted-foreground">Taxes calculated at checkout</div>

					{/* Action Buttons */}
					<div className="space-y-2">
						<Button
							className="w-full"
							size="lg"
							disabled={!hasAllShippingMethods || totalItems === 0}
							title={!hasAllShippingMethods ? 'Please select shipping options for all items' : ''}
						>
							{totalItems === 0
								? 'Cart is empty'
								: missingShippingCount > 0
									? `Select shipping for ${missingShippingCount} more ${missingShippingCount === 1 ? 'item' : 'items'}`
									: `Checkout (${totalItems} ${totalItems === 1 ? 'item' : 'items'})`}
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
								disabled={totalItems === 0}
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
