import CartItem from '@/components/CartItem'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo } from 'react'
import { CartSellerCard, CartShippingReminder, CartTotals, CartTotalsDetails, type CartSellerTotals } from '@ui/components/CartViews'
import { UserCard } from './UserCard'

const EMPTY_SELLER_TOTALS: CartSellerTotals = {
	satsTotal: 0,
	currencyTotals: {},
	shares: { sellerAmount: 0, communityAmount: 0, sellerPercentage: 90 },
	shippingSats: 0,
}

interface CartSummaryProps {
	className?: string
	allowQuantityChanges?: boolean
	allowShippingChanges?: boolean
	showExpandedDetails?: boolean
}

export function CartSummary({
	className = '',
	allowQuantityChanges = true,
	allowShippingChanges = true,
	showExpandedDetails = false,
}: CartSummaryProps) {
	const { cart, sellerData, productsBySeller, totalInSats, totalShippingInSats, totalByCurrency, shippingByCurrency } = useStore(cartStore)

	const [parent, enableAnimations] = useAutoAnimate()

	const missingShippingCount = useMemo(() => {
		return Object.values(cart.products).filter((product) => !product.shippingMethodId).length
	}, [cart.products])

	useEffect(() => {
		if (Object.keys(cart.products).length > 0) {
			cartActions.groupProductsBySeller()
			cartActions.updateSellerData()
		}
	}, [cart.products])

	useEffect(() => {
		enableAnimations(true)
	}, [parent, enableAnimations])

	const handleQuantityChange = (productId: string, newAmount: number) => {
		if (allowQuantityChanges) {
			cartActions.handleProductUpdate('setAmount', productId, newAmount)
		}
	}

	const handleRemoveProduct = (productId: string) => {
		if (allowQuantityChanges) {
			cartActions.handleProductUpdate('remove', productId)
		}
	}

	return (
		<div className={`${className}`}>
			<CartShippingReminder count={missingShippingCount} context="checkout" />

			<div className="space-y-6" ref={parent}>
				{Object.entries(productsBySeller).map(([sellerPubkey, products]) => (
					<CartSellerCard
						key={sellerPubkey}
						seller={<UserCard pubkey={sellerPubkey} size="sm" subtitle="nip-05" />}
						totals={sellerData[sellerPubkey] || EMPTY_SELLER_TOTALS}
						items={products.map((product) => ({
							key: product.id,
							content: (
								<CartItem
									productId={product.id}
									sellerPubkey={product.sellerPubkey}
									amount={product.amount}
									onQuantityChange={handleQuantityChange}
									onRemove={handleRemoveProduct}
									hideShipping={!allowShippingChanges}
									isEditable={allowQuantityChanges}
								/>
							),
						}))}
					/>
				))}
			</div>

			<div className="pt-4 mt-4">
				<div className="space-y-3 w-full">
					<CartTotals totalSats={totalInSats} shippingSats={totalShippingInSats} />
					<CartTotalsDetails
						totalSats={totalInSats}
						shippingSats={totalShippingInSats}
						totalByCurrency={totalByCurrency}
						shippingByCurrency={shippingByCurrency}
						defaultExpanded={showExpandedDetails}
					/>
				</div>
			</div>
		</div>
	)
}
