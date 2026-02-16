import { Button } from '@/components/ui/button'
import { cartStore } from '@/lib/stores/cart'
import { uiActions } from '@/lib/stores/ui'
import { getShippingEvent, getShippingPickupAddressString, getShippingService } from '@/queries/shipping'
import { useStore } from '@tanstack/react-store'
import { Check, MapPin, MessageCircle, SkipForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PaymentInvoiceData } from '@/lib/types/invoice'
import type { CheckoutFormData } from './ShippingAddressForm'
import { useProfileName } from '@/queries/profiles'
import { formatSatsAmount, groupInvoicesByStatus, isPostPaymentState, extractUniqueSellers } from '@/lib/utils/orderUtils'

interface OrderFinalizeComponentProps {
	shippingData: CheckoutFormData | null
	invoices: PaymentInvoiceData[]
	totalInSats: number
	onNewOrder: () => void
	onViewOrders?: () => void
}

export function OrderFinalizeComponent({ shippingData, invoices, totalInSats, onNewOrder, onViewOrders }: OrderFinalizeComponentProps) {
	const { cart } = useStore(cartStore)
	const [pickupAddresses, setPickupAddresses] = useState<Array<{ sellerName: string; address: string }>>([])
	const [isAllPickup, setIsAllPickup] = useState(false)

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

						return { isPickup: false, sellerName: product.sellerPubkey || 'Unknown Seller', address: '' }
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

	const {
		paid: paidInvoices,
		skipped: skippedInvoices,
		pending: pendingInvoices,
		expired: expiredInvoices,
		allPaid: allInvoicesPaid,
		allCompleted: allInvoicesCompleted,
	} = groupInvoicesByStatus(invoices)
	const isPostPayment = isPostPaymentState(invoices)
	const sellerPubkeys = extractUniqueSellers(invoices)

	const handleMessageSeller = (pubkey: string) => {
		uiActions.openConversation(pubkey)
	}

	function SellerContactButton({ pubkey, fallbackName }: { pubkey: string; fallbackName: string }) {
		const { data: userName, isLoading } = useProfileName(pubkey)
		const displayName = isLoading ? 'Seller' : userName || fallbackName

		return (
			<Button
				variant="outline"
				className="w-full flex items-center justify-center gap-2"
				onClick={() => uiActions.openConversation(pubkey)}
			>
				<MessageCircle className="w-4 h-4" />
				Message {displayName}
			</Button>
		)
	}

	return (
		<div data-testid="order-finalize" className="space-y-6 pb-8">
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
					) : allInvoicesCompleted ? (
						<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
							<div className="flex items-center gap-2">
								<Check className="w-5 h-5 text-blue-600" />
								<span className="font-medium text-blue-800">Checkout completed!</span>
							</div>
							<p className="text-sm text-blue-700 mt-1">
								{skippedInvoices.length > 0 && (
									<>
										You have {skippedInvoices.length} payment{skippedInvoices.length !== 1 ? 's' : ''} to complete later. You can find{' '}
										{skippedInvoices.length === 1 ? 'it' : 'them'} in your order history.
									</>
								)}
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
								{skippedInvoices.length > 0 && (
									<li>
										⏭️ {skippedInvoices.length} payment{skippedInvoices.length !== 1 ? 's' : ''} skipped
									</li>
								)}
								{pendingInvoices.length > 0 && (
									<li>
										⏳ {pendingInvoices.length} payment{pendingInvoices.length !== 1 ? 's' : ''} pending
									</li>
								)}
								{expiredInvoices.length > 0 && (
									<li>
										❌ {expiredInvoices.length} payment{expiredInvoices.length !== 1 ? 's' : ''} expired
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
						<span className="font-medium">{formatSatsAmount(totalInSats)} sats</span>
					</div>
					<div className="border-t pt-2 mt-3">
						<div className="flex justify-between font-semibold text-lg">
							<span>Total:</span>
							<span>{formatSatsAmount(totalInSats)} sats</span>
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
									<span className="text-sm">{invoice.recipientName}</span>
									{invoice.status === 'paid' && <Check className="w-4 h-4 text-green-600" />}
									{invoice.status === 'skipped' && <SkipForward className="w-4 h-4 text-orange-600" />}
									{invoice.status === 'pending' && <span className="w-4 h-4 rounded-full bg-yellow-400 animate-pulse"></span>}
									{invoice.status === 'expired' && <span className="w-4 h-4 rounded-full bg-red-400"></span>}
								</div>
								<div className="text-right">
									<span className="text-sm font-medium">{formatSatsAmount(invoice.amount)} sats</span>
									{isPostPayment && <div className="text-xs text-gray-500 capitalize">{invoice.status}</div>}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Next Steps - only for completed orders */}
			{isPostPayment && allInvoicesCompleted && (
				<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
					<h4 className="font-medium text-blue-900 mb-2">What's Next?</h4>
					<ul className="text-sm text-blue-800 space-y-1">
						{paidInvoices.length > 0 && <li>• Merchants will be notified of your payment</li>}
						{paidInvoices.length > 0 && <li>• You'll receive order confirmations via Nostr messages</li>}
						{paidInvoices.length > 0 && <li>• Tracking information will be shared when items ship</li>}
						{skippedInvoices.length > 0 && <li>• Complete pending payments from your order history</li>}
						<li>• Check your messages for updates from sellers</li>
					</ul>
				</div>
			)}

			{/* Seller Contact Section - Show on summary or after payment */}
			{sellerPubkeys.length > 0 && (
				<div className="bg-gray-50 rounded-lg p-4">
					<h3 className="font-medium text-gray-900 mb-3">Need to contact the seller?</h3>
					<div className="space-y-2">
						{invoices
							.filter((invoice) => invoice.type === 'merchant')
							.map((invoice) => (
								<Button
									key={invoice.recipientPubkey}
									variant="outline"
									className="w-full flex items-center justify-center gap-2"
									onClick={() => handleMessageSeller(invoice.recipientPubkey)}
								>
									<MessageCircle className="w-4 h-4" />
									Message {invoice.recipientName}
								</Button>
							))}
					</div>
					<p className="text-xs text-gray-500 mt-2">Chat directly with sellers about your order, shipping, or any questions</p>
				</div>
			)}

			{/* Action Buttons - Only show post-payment buttons */}
			{isPostPayment && (
				<div className="space-y-3 pt-4">
					{allInvoicesCompleted && onViewOrders && (
						<Button onClick={onViewOrders} className="w-full btn-black">
							View Your Purchases
						</Button>
					)}

					<Button onClick={onNewOrder} className={`w-full ${allInvoicesCompleted ? 'hover-transparent-black' : 'btn-black'}`}>
						{allInvoicesCompleted ? 'Continue Shopping' : 'Back to Store'}
					</Button>

					{allInvoicesCompleted && (
						<Button variant="outline" className="w-full" onClick={() => window.print()}>
							Print Order Summary
						</Button>
					)}
				</div>
			)}
		</div>
	)
}
