import CartItem from '@/components/CartItem'
import { ShippingSelector } from '@/components/ShippingSelector'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ScrollArea } from '../ui/scroll-area'

export default function CartSheetContent() {
	// Use store directly for better reactivity
	const { 
		cart, 
		sellerData, 
		productsBySeller, 
		totalInSats, 
		totalByCurrency 
	} = useStore(cartStore)
	
	const [parent, enableAnimations] = useAutoAnimate()
	const userPubkey = cartActions.getUserPubkey()
	const [sellerShippingOptions, setSellerShippingOptions] = useState<Record<string, RichShippingInfo[]>>({})
	const [selectedShippingByUser, setSelectedShippingByUser] = useState<Record<string, string>>({})
	const [detailsExpanded, setDetailsExpanded] = useState(false)

	// Calculate totals that aren't stored
	const totalItems = useMemo(() => {
		return Object.values(cart.products).reduce((sum, product) => sum + product.amount, 0)
	}, [cart.products])
	
	// Add validation for shipping methods
	const hasAllShippingMethods = useMemo(() => {
		return Object.values(cart.products).every((product) => product.shippingMethodId !== null)
	}, [cart.products])

	// Get products missing shipping - make this reactive with useMemo
	const missingShippingCount = useMemo(() => {
		return Object.values(cart.products).filter((product) => !product.shippingMethodId).length
	}, [cart.products])

	// Format SATs with commas for thousands
	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}
	
	// Ensure cart data is updated on mount
	useEffect(() => {
		if (Object.keys(cart.products).length > 0) {
			// Initialize all cart data
			cartActions.groupProductsBySeller()
			cartActions.updateSellerData()
		}
	}, [])

	// Fetch shipping options for each seller
	useEffect(() => {
		const fetchShippingForSellers = async () => {
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
	}, [productsBySeller])

	useEffect(() => {
		enableAnimations(true)
	}, [parent, enableAnimations])

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
		const products = productsBySeller[sellerPubkey] || []

		// Use Promise.all to wait for all shipping updates to complete
		await Promise.all(products.map((product) => cartActions.setShippingMethod(product.id, shippingOption)))

		// Update selected shipping state
		setSelectedShippingByUser((prev) => ({
			...prev,
			[sellerPubkey]: shippingOption.id,
		}))
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
		<SheetContent side="right" className="flex flex-col max-h-screen overflow-hidden w-[100vw] sm:min-w-[85vw] md:min-w-[55vw] xl:min-w-[35vw] py-4 px-6">
			<SheetHeader>
				<SheetTitle>YOUR CART</SheetTitle>
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
			<ScrollArea className="flex-1 overflow-y-auto py-2">
				<div className="space-y-8" ref={parent}>
					{Object.entries(productsBySeller).map(([sellerPubkey, products]) => {
						// Get the pre-calculated data for this seller
						const data = sellerData[sellerPubkey] || {
							satsTotal: 0,
							currencyTotals: {},
							shares: { sellerAmount: 0, communityAmount: 0, sellerPercentage: 90 },
							shippingSats: 0
						};
						
						return (
							<div key={sellerPubkey} className="border-b pb-8">
								{/* Seller information */}
								<div className="mb-4">
									<UserWithAvatar pubkey={sellerPubkey} size="sm" showBadge={false} />
								</div>
								
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
								
								{/* Shipping selector */}
								<div className="mt-4">
									<ShippingSelector
										options={sellerShippingOptions[sellerPubkey] || []}
										selectedId={selectedShippingByUser[sellerPubkey]}
										onSelect={(option) => handleShippingSelect(sellerPubkey, option)}
										className="w-full"
									/>
								</div>
								
								{/* Currency Totals for this seller */}
								{Object.entries(data.currencyTotals).map(([currency, amount]) => (
									<div key={`${sellerPubkey}-${currency}`} className="flex justify-between mt-4">
										<p className="text-sm">{currency} Total:</p>
										<p className="text-sm">{amount.toFixed(2)} {currency}</p>
									</div>
								))}
								
								{/* Shipping */}
								<div className="flex justify-between mt-1">
									<p className="text-sm">Shipping:</p>
									<p className="text-sm">{formatSats(data.shippingSats)} sat</p>
								</div>
								
								{/* Total in sats for this seller */}
								<div className="flex justify-between mt-1 font-semibold">
									<p className="text-sm">Total:</p>
									<p className="text-sm">{formatSats(data.satsTotal)} sat</p>
								</div>
								
								{/* Payment breakdown for this seller */}
								<div className="mt-3">
									<p className="text-sm font-semibold">Payment Breakdown</p>
									
									{/* Progress bar */}
									<div className="h-2 w-full bg-gray-800 mt-1 rounded-full overflow-hidden">
										<div 
											className="h-full bg-blue-500" 
											style={{ width: `${data.shares.sellerPercentage}%` }} 
										/>
									</div>
									
									{/* Merchant amount */}
									<div className="flex justify-between mt-1">
										<p className="text-sm">Merchant: </p>
										<p className="text-sm">{formatSats(data.shares.sellerAmount)} sat ({data.shares.sellerPercentage.toFixed(2)}%)</p>
									</div>
									
									{/* Community share */}
									{data.shares.communityAmount > 0 && (
										<div className="flex justify-between">
											<p className="text-sm">Community Share: </p>
											<p className="text-sm">{formatSats(data.shares.communityAmount)} sat ({(100 - data.shares.sellerPercentage).toFixed(2)}%)</p>
										</div>
									)}
								</div>
							</div>
						)
					})}
				</div>
			</ScrollArea>

			{/* Cart Footer */}
			<div className="border-t pt-4 mt-auto">
				<div className="space-y-3 w-full">
					{/* Total in sats */}
					<div className="flex justify-between text-lg font-bold">
						<p>Total:</p>
						<p>{formatSats(totalInSats)} sat</p>
					</div>
					
					{/* Collapsible Details */}
					<button
						className="w-full flex items-center justify-between p-2 border rounded-lg bg-gray-50"
						onClick={() => setDetailsExpanded(!detailsExpanded)}
					>
						<span className="text-sm">View Details</span>
						<ChevronDown className={`w-4 h-4 transition-transform ${detailsExpanded ? 'rotate-180' : ''}`} />
					</button>
					
					{detailsExpanded && (
						<div className="space-y-2 p-2 bg-gray-50 rounded-lg">
							{/* Show original currency totals */}
							{Object.entries(totalByCurrency).map(([currency, amount]) => (
								<div key={`total-${currency}`} className="flex justify-between">
									<p className="text-sm">{currency} Total:</p>
									<p className="text-sm">{amount.toFixed(2)}</p>
								</div>
							))}
							
							{/* Calculate total shipping in sats */}
							{(() => {
								const totalShipping = Object.values(sellerData).reduce(
									(sum, data) => sum + data.shippingSats, 
									0
								);
								const subtotalSats = totalInSats - totalShipping;
								
								return (
									<>
										<Separator className="my-2" />
										<div className="flex justify-between">
											<p className="text-sm">Subtotal:</p>
											<p className="text-sm">{formatSats(subtotalSats)} sat</p>
										</div>
										
										<div className="flex justify-between">
											<p className="text-sm">Shipping:</p>
											<p className="text-sm">{formatSats(totalShipping)} sat</p>
										</div>
										
										<Separator className="my-2" />
										
										<div className="flex justify-between font-semibold">
											<p className="text-sm">Grand Total:</p>
											<p className="text-sm">{formatSats(totalInSats)} sat</p>
										</div>
									</>
								);
							})()}
						</div>
					)}

					{/* Action Buttons */}
					<div className="space-y-3 mt-4">
						<div className="flex gap-3">
							<Button
								variant="outline"
								className="flex-1 text-red-500 hover:bg-red-50 hover:text-red-600 border-red-200"
								onClick={() => cartActions.clear()}
								disabled={totalItems === 0}
							>
								Clear
							</Button>
							
							<Button
								className="flex-1 bg-black text-white hover:bg-gray-800"
								disabled={!hasAllShippingMethods || totalItems === 0}
								title={!hasAllShippingMethods ? 'Please select shipping options for all items' : ''}
							>
								Checkout
							</Button>
						</div>
					</div>
				</div>
			</div>
		</SheetContent>
	)
}
