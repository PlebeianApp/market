import type { CheckoutDeliveryRequirements } from '@sdk/commerce/checkout'
import { cartStore } from '@/lib/stores/cart'
import { uiActions } from '@/lib/stores/ui'
import { getShippingEvent, getShippingPickupAddressString, getShippingService } from '@/queries/shipping'
import { useStore } from '@tanstack/react-store'
import { useEffect, useState } from 'react'
import type { PaymentInvoiceData } from '@/lib/types/invoice'
import type { CheckoutFormData } from './ShippingAddressForm'
import { OrderFinalizeView } from '@ui/components/checkout/OrderFinalizeView'

interface OrderFinalizeComponentProps {
	shippingData: CheckoutFormData | null
	invoices: PaymentInvoiceData[]
	totalInSats: number
	onNewOrder: () => void
	onViewOrders?: () => void
	deliveryRequirements: CheckoutDeliveryRequirements
}

export function OrderFinalizeComponent({
	shippingData,
	invoices,
	totalInSats,
	onNewOrder,
	onViewOrders,
	deliveryRequirements,
}: OrderFinalizeComponentProps) {
	const { cart } = useStore(cartStore)
	const [pickupAddresses, setPickupAddresses] = useState<Array<{ sellerName: string; address: string }>>([])

	// Pickup addresses are display-only; delivery requirements are resolved by checkout state.
	useEffect(() => {
		const products = Object.values(cart.products)
		if (products.length === 0 || !deliveryRequirements.isResolved || !deliveryRequirements.hasPickupDelivery) {
			setPickupAddresses([])
			return
		}

		void Promise.all(
			products.map(async (product) => {
				if (!product.shippingMethodId) return null
				try {
					const shippingEvent = await getShippingEvent(product.shippingMethodId)
					if (!shippingEvent || getShippingService(shippingEvent)?.[1] !== 'pickup') return null
					return {
						sellerName: product.sellerPubkey || 'Unknown Seller',
						address: getShippingPickupAddressString(shippingEvent) || 'Pickup address not specified',
					}
				} catch (error) {
					console.error('Error checking shipping service:', error)
					return null
				}
			}),
		).then((results) => setPickupAddresses(results.filter((item): item is { sellerName: string; address: string } => item !== null)))
	}, [cart.products, deliveryRequirements.hasPickupDelivery, deliveryRequirements.isResolved])

	return (
		<OrderFinalizeView
			shippingData={shippingData}
			invoices={invoices}
			totalInSats={totalInSats}
			deliveryRequirements={deliveryRequirements}
			pickupAddresses={pickupAddresses}
			onMessageSeller={(pubkey) => uiActions.openConversation(pubkey)}
			onNewOrder={onNewOrder}
			onViewOrders={onViewOrders}
			onPrint={() => window.print()}
		/>
	)
}
