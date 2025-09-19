import { Button } from '@/components/ui/button'
import { Check, Receipt, MapPin } from 'lucide-react'
import type { CheckoutFormData } from './ShippingAddressForm'
import type { LightningInvoiceData } from '@/queries/payment'
import { cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { getShippingEvent, getShippingService, getShippingPickupAddressString } from '@/queries/shipping'
import { useEffect, useState } from 'react'

interface OrderFinalizeComponentProps {
	shippingData: CheckoutFormData | null
	invoices: LightningInvoiceData[]
	totalInSats: number
	onNewOrder: () => void
	onViewOrders?: () => void
}

export function OrderFinalizeComponent({ shippingData, invoices, totalInSats, onNewOrder, onViewOrders }: OrderFinalizeComponentProps) {
	const { cart } = useStore(cartStore)
	const [pickupAddresses, setPickupAddresses] = useState<Array<{ sellerName: string; address: string }>>([])
	const [isAllPickup, setIsAllPickup] = useState(false)

	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	// Check for pickup orders and collect pickup addresses
	useEffect(() => {
		const checkPickupOrders = async () => {
			const products = Object.values(cart.products)
			if (products.length === 0) {
				setIsAllPickup(false)
				setPickupAddresses([])
				return
			}

			const pickupData = await Promise.all(
				products.map(async (product) => {
					if (!product.shippingMethodId) return null

					try {
						const shippingEvent = await getShippingEvent(product.shippingMethodId)
						if (!shippingEvent) return null

						const serviceTag = getShippingService(shippingEvent)
						const isPickup = serviceTag?.[1] === 'pickup'

						if (isPickup) {
							const pickupAddressString = getShippingPickupAddressString(shippingEvent)
							return {
								isPickup: true,
								sellerName: product.sellerPubkey || 'Unknown Seller',
								address: pickupAddressString || 'Pickup address not specified',
							}
						}

						return { isPickup: false, sellerName: '', address: '' }
					} catch (error) {
						console.error('Error checking shipping service:', error)
						return null
					}
				}),
			)

			const validPickupData = pickupData.filter(Boolean)
			const allPickup = validPickupData.every((data) => data?.isPickup)
			const pickupItems = validPickupData.filter((data) => data?.isPickup)

			setIsAllPickup(allPickup)
			setPickupAddresses(
				pickupItems.map((item) => ({
					sellerName: item?.sellerName || 'Unknown Seller',
					address: item!.address,
				})),
			)
		}

		checkPickupOrders()
	}, [cart.products])

	const allInvoicesPaid = invoices.every((invoice) => invoice.status === 'paid')
	const paidInvoices = invoices.filter((invoice) => invoice.status === 'paid')
	const pendingInvoices = invoices.filter((invoice) => invoice.status === 'pending')
	const failedInvoices = invoices.filter((invoice) => invoice.status === 'failed')

	// If this is the final summary (after payments), show completion state
	const isPostPayment = invoices.length > 0 && invoices.some((invoice) => invoice.status !== 'pending')

	return (
		<div className="space-y-6Can we">
			{/* Payment Status - only show if invoices exist */}
			{isPostPayment && (
				<div className="space-y-3">
					{allInvoicesPaid ? (
						<div className="bg-green-50 border border-green-200 rounded-lg p-4">
							<div className="flex items-center gap-2">
								<Check className="w-5 h-5 text-green-600" />
								<span className="font-medium text-green-800">All payments completed successfully!</span>
							</div>
							<p className="text-sm text-green-700 mt-1">
								Your orders have been sent to the merchants and you should receive confirmation shortly.
							</p>
						</div>
					) : (
						<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
							<p className="text-yellow-800 font-medium">Payment Status:</p>
							<ul className="text-sm text-yellow-700 mt-1 space-y-1">
								{paidInvoices.length > 0 && (
									<li>
										✓ {paidInvoices.length} payment{paidInvoices.length !== 1 ? 's' : ''} completed
									</li>
								)}
								{pendingInvoices.length > 0 && (
									<li>
										⏳ {pendingInvoices.length} payment{pendingInvoices.length !== 1 ? 's' : ''} pending
									</li>
								)}
								{failedInvoices.length > 0 && (
									<li>
										❌ {failedInvoices.length} payment{failedInvoices.length !== 1 ? 's' : ''} failed
									</li>
								)}
							</ul>
						</div>
					)}
				</div>
			)}

			{/* Shipping/Pickup Address */}
			{isAllPickup ? (
				<div className="bg-green-50 p-4 rounded-lg border border-green-200">
					<div className="flex items-center gap-2 mb-3">
						<MapPin className="h-5 w-5 text-green-600" />
						<h3 className="font-medium text-green-800">Pickup Locations</h3>
					</div>
					<div className="space-y-3">
						{pickupAddresses.map((pickup, index) => (
							<div key={index} className="bg-white p-3 rounded border border-green-100">
								<div className="text-sm font-medium text-green-700 mb-1">Seller: {pickup.sellerName}</div>
								<div className="text-sm text-gray-700">
									<strong>Pickup Address:</strong> {pickup.address}
								</div>
							</div>
						))}
					</div>
				</div>
			) : (
				shippingData && (
					<div className="bg-gray-50 rounded-lg p-4">
						<h3 className="font-medium text-gray-900 mb-3">Shipping Address</h3>
						<div className="text-sm text-gray-600 space-y-1">
							<p className="font-medium text-gray-900">{shippingData.name}</p>
							{shippingData.email && <p>Email: {shippingData.email}</p>}
							<p>{shippingData.firstLineOfAddress}</p>
							<p>
								{shippingData.city}, {shippingData.zipPostcode}
							</p>
							<p>{shippingData.country}</p>
							{shippingData.phone && <p>Phone: {shippingData.phone}</p>}
							{shippingData.additionalInformation && (
								<div className="mt-2 pt-2 border-t border-gray-200">
									<p className="text-xs text-gray-500">Delivery Notes:</p>
									<p className="text-sm">{shippingData.additionalInformation}</p>
								</div>
							)}
						</div>
					</div>
				)
			)}

			{/* Order Total */}
			<div className="bg-gray-50 rounded-lg p-4">
				<h3 className="font-medium text-gray-900 mb-3">Order Total</h3>
				<div className="space-y-2">
					<div className="flex justify-between text-sm">
						<span className="text-gray-600">Subtotal:</span>
						<span className="font-medium">{formatSats(totalInSats)} sats</span>
					</div>
					<div className="border-t pt-2 mt-3">
						<div className="flex justify-between font-semibold text-lg">
							<span>Total:</span>
							<span>{formatSats(totalInSats)} sats</span>
						</div>
					</div>
				</div>
			</div>

			{/* Payment Summary - only if invoices exist */}
			{invoices.length > 0 && (
				<div className="bg-gray-50 rounded-lg p-4">
					<h3 className="font-medium text-gray-900 mb-3">Payment Breakdown</h3>
					<div className="space-y-2">
						{invoices.map((invoice, index) => (
							<div key={invoice.id} className="flex justify-between items-center">
								<div className="flex items-center gap-2">
									<span className="text-sm">{invoice.sellerName}</span>
									{invoice.status === 'paid' && <Check className="w-4 h-4 text-green-600" />}
									{invoice.status === 'pending' && <span className="w-4 h-4 rounded-full bg-yellow-400 animate-pulse"></span>}
									{invoice.status === 'failed' && <span className="w-4 h-4 rounded-full bg-red-400"></span>}
									{invoice.status === 'processing' && <span className="w-4 h-4 rounded-full bg-blue-400 animate-pulse"></span>}
								</div>
								<div className="text-right">
									<span className="text-sm font-medium">{formatSats(invoice.amount)} sats</span>
									{isPostPayment && <div className="text-xs text-gray-500 capitalize">{invoice.status}</div>}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Order Items - detailed breakdown */}
			{invoices.length > 0 && (
				<div className="bg-gray-50 rounded-lg p-4">
					<h3 className="font-medium text-gray-900 mb-3">Order Items</h3>
					<div className="space-y-3">
						{invoices.map((invoice) => (
							<div key={invoice.id}>
								<div className="font-medium text-sm text-gray-800 mb-2">From {invoice.sellerName}:</div>
								<div className="space-y-1 ml-4">
									{invoice.items?.map((item) => (
										<div key={item.productId} className="flex justify-between text-sm">
											<span className="text-gray-600">
												{item.name} x{item.amount}
											</span>
											<span className="font-medium">{formatSats(item.price)} sats</span>
										</div>
									)) || <div className="text-sm text-gray-500">No items details available</div>}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Next Steps - only for completed orders */}
			{isPostPayment && allInvoicesPaid && (
				<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
					<h4 className="font-medium text-blue-900 mb-2">What's Next?</h4>
					<ul className="text-sm text-blue-800 space-y-1">
						<li>• Merchants will be notified of your payment</li>
						<li>• You'll receive order confirmations via Nostr messages</li>
						<li>• Tracking information will be shared when items ship</li>
						<li>• Check your messages for updates from sellers</li>
					</ul>
				</div>
			)}

			{/* Action Buttons - Only show post-payment buttons */}
			{isPostPayment && (
				<div className="space-y-3 pt-4">
					{allInvoicesPaid && onViewOrders && (
						<Button onClick={onViewOrders} className="w-full btn-black">
							View Your Purchases
						</Button>
					)}

					<Button onClick={onNewOrder} className={`w-full ${allInvoicesPaid ? 'hover-transparent-black' : 'btn-black'}`}>
						{allInvoicesPaid ? 'Continue Shopping' : 'Back to Store'}
					</Button>

					{allInvoicesPaid && (
						<Button variant="outline" className="w-full" onClick={() => window.print()}>
							Print Order Summary
						</Button>
					)}
				</div>
			)}
		</div>
	)
}
