import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Receipt } from 'lucide-react'
import type { CheckoutFormData } from './ShippingAddressForm'
import type { LightningInvoiceData } from '@/queries/payment'

interface OrderFinalizeComponentProps {
	shippingData: CheckoutFormData | null
	invoices: LightningInvoiceData[]
	totalInSats: number
	onNewOrder: () => void
	onContinueToPayment?: () => void
	onViewOrders?: () => void
}

export function OrderFinalizeComponent({
	shippingData,
	invoices,
	totalInSats,
	onNewOrder,
	onContinueToPayment,
	onViewOrders,
}: OrderFinalizeComponentProps) {
	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	const allInvoicesPaid = invoices.every((invoice) => invoice.status === 'paid')
	const paidInvoices = invoices.filter((invoice) => invoice.status === 'paid')
	const pendingInvoices = invoices.filter((invoice) => invoice.status === 'pending')
	const failedInvoices = invoices.filter((invoice) => invoice.status === 'failed')

	// If this is the final summary (after payments), show completion state
	const isPostPayment = invoices.length > 0 && invoices.some((invoice) => invoice.status !== 'pending')

	return (
		<div className="h-full">
			{/* Order Summary - Full Width */}
			<Card className="h-full">
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className={`p-2 rounded-lg ${isPostPayment ? 'bg-green-100' : 'bg-blue-100'}`}>
							<Receipt className={`h-5 w-5 ${isPostPayment ? 'text-green-600' : 'text-blue-600'}`} />
						</div>
						<div>
							<CardTitle>{isPostPayment ? 'Order Complete!' : 'Order Summary'}</CardTitle>
							<p className="text-sm text-gray-600">
								{isPostPayment
									? allInvoicesPaid
										? 'Order completed successfully!'
										: 'Processing your order...'
									: 'Review your order details'}
							</p>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
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

					{/* Shipping Address */}
					{shippingData && (
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

					{/* Action Buttons */}
					<div className="space-y-3 pt-4">
						{!isPostPayment && onContinueToPayment && (
							<Button onClick={onContinueToPayment} className="w-full bg-black text-white hover:bg-gray-800">
								Continue to Payment
							</Button>
						)}

						{isPostPayment && (
							<>
								{allInvoicesPaid && onViewOrders && (
									<Button onClick={onViewOrders} className="w-full bg-black text-white hover:bg-gray-800">
										View Your Purchases
									</Button>
								)}

								<Button
									onClick={onNewOrder}
									className={`w-full ${allInvoicesPaid && onViewOrders ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-black text-white hover:bg-gray-800'}`}
								>
									{allInvoicesPaid ? 'Continue Shopping' : 'Back to Store'}
								</Button>

								{allInvoicesPaid && (
									<Button variant="outline" className="w-full" onClick={() => window.print()}>
										Print Order Summary
									</Button>
								)}
							</>
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
