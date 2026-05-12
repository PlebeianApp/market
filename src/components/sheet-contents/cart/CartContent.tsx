import CartItem from '@/components/CartItem'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { uiActions } from '@/lib/stores/ui'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo } from 'react'
import { EmptyCartScreen } from './EmptyCartScreen'
import { UserCard } from '@/components/UserCard'

export function CartContent({ className = '' }: { className?: string }) {
	const { cart, sellerData, productsBySeller, totalInSats, totalShippingInSats, totalByCurrency, shippingByCurrency } = useStore(cartStore)

	const [parent, enableAnimations] = useAutoAnimate()
	const navigate = useNavigate()

	const totalItems = useMemo(() => {
		return Object.values(cart.products).reduce((sum, product) => sum + product.amount, 0)
	}, [cart.products])

	const missingShippingCount = useMemo(() => {
		return Object.values(cart.products).filter((product) => !product.shippingMethodId).length
	}, [cart.products])

	const isCartEmpty = useMemo(() => {
		return Object.keys(cart.products).length === 0
	}, [cart.products])

	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	useEffect(() => {
		enableAnimations(true)
	}, [parent, enableAnimations])

	useEffect(() => {
		if (Object.keys(cart.products).length > 0) {
			cartActions.groupProductsBySeller()
			cartActions.updateSellerData()
		}
	}, [cart.products])

	const handleQuantityChange = (productId: string, newAmount: number) => {
		// Updated function signature - no longer needs buyerPubkey
		cartActions.handleProductUpdate('setAmount', productId, newAmount)
	}

	const handleRemoveProduct = (productId: string) => {
		// Updated function signature - no longer needs buyerPubkey
		cartActions.handleProductUpdate('remove', productId)
	}

	if (isCartEmpty) {
		return <EmptyCartScreen />
	}

	return (
		<div className={`flex min-h-0 flex-1 flex-col overflow-hidden px-4 sm:px-6 ${className}`}>
			{missingShippingCount > 0 && (
				<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
					<div className="flex">
						<div className="ml-3">
							<p className="text-sm text-yellow-700">
								Select shipping at checkout for {missingShippingCount} {missingShippingCount === 1 ? 'item' : 'items'}.
							</p>
						</div>
					</div>
				</div>
			)}

			<ScrollArea className="min-h-0 flex-1 overflow-y-auto py-2">
				<div className="space-y-6" ref={parent}>
					{Object.entries(productsBySeller)
						.filter(([sellerPubkey]) => sellerPubkey && sellerPubkey.length > 0 && sellerPubkey !== 'unknown')
						.map(([sellerPubkey, products]) => {
							const data = sellerData[sellerPubkey] || {
								satsTotal: 0,
								currencyTotals: {},
								shares: { sellerAmount: 0, communityAmount: 0, sellerPercentage: 90 },
								shippingSats: 0,
							}

							return (
								<div key={sellerPubkey} className="p-4 rounded-lg border shadow-md bg-white">
									<div className="mb-3">
										<UserCard pubkey={sellerPubkey} size="sm" subtitle="nip-05" />
									</div>

									<ul className="space-y-4">
										{products.map((product, index) => (
											<div key={product.id} className={`p-3 rounded-lg ${index % 2 === 0 ? 'bg-gray-100' : 'bg-white'}`}>
												<CartItem
													productId={product.id}
													sellerPubkey={product.sellerPubkey}
													amount={product.amount}
													onQuantityChange={handleQuantityChange}
													onRemove={handleRemoveProduct}
													hideShipping={true}
												/>
												<div className="mt-2 text-sm text-muted-foreground">
													{product.shippingMethodId ? (
														<span>
															Shipping: {product.shippingMethodName || 'Selected'}
															{product.shippingCost > 0 && product.shippingCostCurrency
																? ` - ${product.shippingCost} ${product.shippingCostCurrency}`
																: ''}
														</span>
													) : (
														<span>Select shipping at checkout</span>
													)}
												</div>
											</div>
										))}
									</ul>

									{Object.entries(data.currencyTotals).map(([currency, amount]) => (
										<div key={`${sellerPubkey}-${currency}`} className="flex justify-between mt-4">
											<p className="text-sm">Products ({currency}):</p>
											<p className="text-sm">
												{amount.toFixed(2)} {currency}
											</p>
										</div>
									))}

									<div className="flex justify-between mt-1">
										<p className="text-sm">Shipping:</p>
										<p className="text-sm font-semibold">{formatSats(data.shippingSats)} sat</p>
									</div>

									<div className="flex justify-between mt-1 font-semibold">
										<p className="text-sm">Total:</p>
										<p className="text-sm">{formatSats(data.satsTotal)} sat</p>
									</div>

									<div className="mt-3">
										<p className="text-sm font-semibold">Payment Breakdown</p>

										<div className="h-2 w-full bg-gray-800 mt-1 rounded-full overflow-hidden">
											<div className="h-full bg-blue-500" style={{ width: `${data.shares.sellerPercentage}%` }} />
										</div>

										<div className="flex justify-between mt-1">
											<p className="text-sm">Merchant: </p>
											<p className="text-sm">
												{formatSats(data.shares.sellerAmount)} sat ({data.shares.sellerPercentage.toFixed(2)}%)
											</p>
										</div>

										{data.shares.communityAmount > 0 && (
											<div className="flex justify-between">
												<p className="text-sm">Community Share: </p>
												<p className="text-sm">
													{formatSats(data.shares.communityAmount)} sat ({(100 - data.shares.sellerPercentage).toFixed(2)}%)
												</p>
											</div>
										)}
									</div>
								</div>
							)
						})}
				</div>
			</ScrollArea>

			<div className="mt-auto shrink-0 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
				<div className="space-y-3 w-full">
					<div className="space-y-1 mb-2">
						<div className="flex justify-between">
							<p className="text-sm">Subtotal:</p>
							<p className="text-sm">{formatSats(totalInSats - totalShippingInSats)} sat</p>
						</div>
						<div className="flex justify-between">
							<p className="text-sm">Shipping:</p>
							<p className="text-sm">{formatSats(totalShippingInSats)} sat</p>
						</div>
						<div className="flex justify-between text-lg font-bold">
							<p>Total:</p>
							<p>{formatSats(totalInSats)} sat</p>
						</div>
					</div>

					{/* View Details temporarily hidden for design sync */}

					<div className="space-y-3 mt-4">
						<div className="flex gap-3">
							<Button
								variant="outline"
								className="flex-1 text-red-500 hover:bg-red-50 hover:text-red-600 border-red-200"
								onClick={() => cartActions.clearForUserIntent()}
								disabled={totalItems === 0}
							>
								Clear
							</Button>

							<Button
								className="flex-1 btn-product-banner"
								disabled={totalItems === 0}
								onClick={() => {
									uiActions.closeDrawer('cart')
									navigate({ to: '/checkout' })
								}}
							>
								Checkout
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
