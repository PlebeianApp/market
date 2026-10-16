import { Check, Download, MapPin, MessageCircle, SkipForward } from 'lucide-react'
import {
	summarizeCheckoutDelivery,
	type CheckoutDeliveryRequirements,
	type CheckoutFormData,
	type PaymentInvoiceData,
} from '@sdk/commerce/checkout'
import { Button } from '../../primitives/button'

export interface OrderFinalizeViewProps {
	shippingData: CheckoutFormData | null
	invoices: readonly PaymentInvoiceData[]
	totalInSats: number
	deliveryRequirements: CheckoutDeliveryRequirements
	pickupAddresses: readonly { sellerName: string; address: string }[]
	onMessageSeller: (pubkey: string) => void
	onNewOrder: () => void
	onViewOrders?: () => void
	onPrint: () => void
}

const formatSats = (sats: number): string => Math.round(sats).toLocaleString()
const plural = (count: number) => (count !== 1 ? 's' : '')

export function OrderFinalizeView({
	shippingData,
	invoices,
	totalInSats,
	deliveryRequirements,
	pickupAddresses,
	onMessageSeller,
	onNewOrder,
	onViewOrders,
	onPrint,
}: OrderFinalizeViewProps) {
	const { isAllPickup, isAllDigital, noAddressRequired } = summarizeCheckoutDelivery(deliveryRequirements)
	const hasDigitalDelivery = deliveryRequirements.hasDigitalDelivery

	const allInvoicesPaid = invoices.every((invoice) => invoice.status === 'paid')
	const allInvoicesCompleted = invoices.every((invoice) => invoice.status === 'paid' || invoice.status === 'skipped')
	const paidInvoices = invoices.filter((invoice) => invoice.status === 'paid')
	const skippedInvoices = invoices.filter((invoice) => invoice.status === 'skipped')
	const pendingInvoices = invoices.filter((invoice) => invoice.status === 'pending')
	const expiredInvoices = invoices.filter((invoice) => invoice.status === 'expired')
	const merchantInvoices = invoices.filter((invoice) => invoice.type === 'merchant')

	// Any non-pending invoice means payment has been attempted, so show the completion state.
	const isPostPayment = invoices.length > 0 && invoices.some((invoice) => invoice.status !== 'pending')

	return (
		<div className="space-y-6 pb-8">
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
										You have {skippedInvoices.length} payment{plural(skippedInvoices.length)} to complete later. You can find{' '}
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
										✓ {paidInvoices.length} payment{plural(paidInvoices.length)} completed
									</li>
								)}
								{skippedInvoices.length > 0 && (
									<li>
										⏭️ {skippedInvoices.length} payment{plural(skippedInvoices.length)} skipped
									</li>
								)}
								{pendingInvoices.length > 0 && (
									<li>
										⏳ {pendingInvoices.length} payment{plural(pendingInvoices.length)} pending
									</li>
								)}
								{expiredInvoices.length > 0 && (
									<li>
										❌ {expiredInvoices.length} payment{plural(expiredInvoices.length)} expired
									</li>
								)}
							</ul>
						</div>
					)}
				</div>
			)}

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
			) : isAllDigital ? (
				<div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
					<div className="flex items-center gap-2 mb-2">
						<Download className="h-5 w-5 text-purple-600" />
						<h3 className="font-medium text-purple-800">Digital Delivery</h3>
					</div>
					<p className="text-sm text-purple-700">The seller will use your delivery contact after payment settles.</p>
					{shippingData?.email && <p className="text-sm text-purple-600 mt-2">Digital delivery contact: {shippingData.email}</p>}
				</div>
			) : noAddressRequired ? (
				<div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
					<h3 className="font-medium text-indigo-800 mb-2">No Shipping Required</h3>
					<p className="text-sm text-indigo-700">
						Items are for pickup or digital delivery. Sellers will use any digital delivery contact after payment settles.
					</p>
					{hasDigitalDelivery && shippingData?.email && (
						<p className="text-sm text-indigo-600 mt-2">Digital delivery contact: {shippingData.email}</p>
					)}
				</div>
			) : (
				shippingData && (
					<div className="bg-gray-50 rounded-lg p-4">
						<h3 className="font-medium text-gray-900 mb-3">Shipping Address</h3>
						<div className="text-sm text-gray-600 space-y-1">
							<p className="font-medium text-gray-900">{shippingData.name}</p>
							{shippingData.email && (
								<p>
									{hasDigitalDelivery ? 'Digital delivery contact' : 'Email'}: {shippingData.email}
								</p>
							)}
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

			{invoices.length > 0 && (
				<div className="bg-gray-50 rounded-lg p-4">
					<h3 className="font-medium text-gray-900 mb-3">Payment Breakdown</h3>
					<div className="space-y-2">
						{invoices.map((invoice) => (
							<div key={invoice.id} className="flex justify-between items-center">
								<div className="flex items-center gap-2">
									<span className="text-sm">{invoice.recipientName}</span>
									{invoice.status === 'paid' && <Check className="w-4 h-4 text-green-600" />}
									{invoice.status === 'skipped' && <SkipForward className="w-4 h-4 text-orange-600" />}
									{invoice.status === 'pending' && <span className="w-4 h-4 rounded-full bg-yellow-400 animate-pulse"></span>}
									{invoice.status === 'expired' && <span className="w-4 h-4 rounded-full bg-red-400"></span>}
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

			{merchantInvoices.length > 0 && (
				<div className="bg-gray-50 rounded-lg p-4">
					<h3 className="font-medium text-gray-900 mb-3">Need to contact the seller?</h3>
					<div className="space-y-2">
						{merchantInvoices.map((invoice) => (
							<Button
								key={invoice.recipientPubkey}
								variant="outline"
								className="w-full flex items-center justify-center gap-2"
								onClick={() => onMessageSeller(invoice.recipientPubkey)}
							>
								<MessageCircle className="w-4 h-4" />
								Message {invoice.recipientName}
							</Button>
						))}
					</div>
					<p className="text-xs text-gray-500 mt-2">Chat directly with sellers about your order, shipping, or any questions</p>
				</div>
			)}

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
						<Button variant="outline" className="w-full" onClick={onPrint}>
							Print Order Summary
						</Button>
					)}
				</div>
			)}
		</div>
	)
}
