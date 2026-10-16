import CartItem from '@/components/CartItem'
import { ScrollArea } from '@ui/primitives/scroll-area'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { uiActions } from '@/lib/stores/ui'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo } from 'react'
import { EmptyCartScreen } from '@ui/components/EmptyCartScreen'
import { CartFooter, CartLineShipping, CartSellerCard, CartShippingReminder, type CartSellerTotals } from '@ui/components/CartViews'
import { UserCard } from '@/components/UserCard'

const EMPTY_SELLER_TOTALS: CartSellerTotals = {
	satsTotal: 0,
	currencyTotals: {},
	shares: { sellerAmount: 0, communityAmount: 0, sellerPercentage: 90 },
	shippingSats: 0,
}

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
			<CartShippingReminder count={missingShippingCount} />

			<ScrollArea className="min-h-0 flex-1 overflow-y-auto py-2">
				<div className="space-y-6" ref={parent}>
					{Object.entries(productsBySeller)
						.filter(([sellerPubkey]) => sellerPubkey && sellerPubkey.length > 0 && sellerPubkey !== 'unknown')
						.map(([sellerPubkey, products]) => (
							<CartSellerCard
								key={sellerPubkey}
								seller={<UserCard pubkey={sellerPubkey} size="sm" subtitle="nip-05" />}
								totals={sellerData[sellerPubkey] || EMPTY_SELLER_TOTALS}
								items={products.map((product) => ({
									key: product.id,
									content: (
										<>
											<CartItem
												productId={product.id}
												sellerPubkey={product.sellerPubkey}
												amount={product.amount}
												onQuantityChange={handleQuantityChange}
												onRemove={handleRemoveProduct}
												hideShipping={true}
											/>
											<CartLineShipping
												shippingMethodId={product.shippingMethodId}
												shippingMethodName={product.shippingMethodName}
												shippingCost={product.shippingCost}
												shippingCostCurrency={product.shippingCostCurrency}
											/>
										</>
									),
								}))}
							/>
						))}
				</div>
			</ScrollArea>

			<div className="mt-auto shrink-0 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
				<CartFooter
					totalSats={totalInSats}
					shippingSats={totalShippingInSats}
					canCheckout={totalItems > 0}
					onClear={() => cartActions.clearForUserIntent()}
					onCheckout={() => {
						uiActions.closeDrawer('cart')
						navigate({ to: '/checkout' })
					}}
				/>
			</div>
		</div>
	)
}
