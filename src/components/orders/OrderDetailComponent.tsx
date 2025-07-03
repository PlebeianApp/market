import { ProductCard } from '@/components/ProductCard'
import { SingleInvoicePayment, type SingleInvoiceData } from '@/components/checkout/SingleInvoicePayment'
import { OrderActions } from '@/components/orders/OrderActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { authStore } from '@/lib/stores/auth'
import { getEventDate, type OrderWithRelatedEvents } from '@/queries/orders'
import { productQueryOptions } from '@/queries/products'
import { fetchV4VShares } from '@/queries/v4v'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { AlertTriangle, CheckCircle, Clock, CreditCard, MessageSquare, Package, Receipt, RefreshCw, Truck, Users, XCircle, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { DetailField } from '../ui/DetailField'
import { toast } from 'sonner'

interface OrderDetailComponentProps {
	order: OrderWithRelatedEvents
}

// Helper functions to extract data from order events
const getOrderId = (orderEvent: NDKEvent): string => {
	return orderEvent.tags.find((tag) => tag[0] === 'order')?.[1] || orderEvent.id
}

const getTotalAmount = (orderEvent: NDKEvent): number => {
	return parseInt(orderEvent.tags.find((tag) => tag[0] === 'amount')?.[1] || '0')
}

const getProductRefs = (orderEvent: NDKEvent): string[] => {
	return orderEvent.tags.filter((tag) => tag[0] === 'item').map((tag) => tag[1])
}

const getSellerPubkey = (orderEvent: NDKEvent): string => {
	return orderEvent.tags.find((tag) => tag[0] === 'p')?.[1] || ''
}

// Extract payment methods from payment request events
const extractPaymentMethods = (paymentRequest: NDKEvent) => {
	const paymentTags = paymentRequest.tags.filter((tag) => tag[0] === 'payment')
	return paymentTags.map((tag) => ({
		type: tag[1] as 'lightning' | 'bitcoin' | 'other',
		details: tag[2],
		proof: tag[3] || undefined,
	}))
}

// Check if payment has been completed based on receipts
const isPaymentCompleted = (paymentRequestId: string, paymentReceipts: NDKEvent[]): boolean => {
	return paymentReceipts.some((receipt) => {
		const orderTag = receipt.tags.find((tag) => tag[0] === 'order')
		return orderTag?.[1] === paymentRequestId
	})
}

export function OrderDetailComponent({ order }: OrderDetailComponentProps) {
	const { user } = useStore(authStore)
	const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)

	if (!order) {
		return (
			<div className="container mx-auto px-4 py-8">
				<Card>
					<CardContent className="p-8 text-center">
						<p className="text-gray-500">Order not found</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Parse order data
	const orderEvent = order.order
	const orderId = getOrderId(orderEvent)
	const buyerPubkey = orderEvent.pubkey
	const sellerPubkey = getSellerPubkey(orderEvent)
	const isBuyer = buyerPubkey === user?.pubkey
	const isOrderSeller = sellerPubkey === user?.pubkey
	const totalAmount = getTotalAmount(orderEvent)

	// Get order status from latest status update or default to pending
	const orderStatus = order.latestStatus?.tags.find((tag) => tag[0] === 'status')?.[1] || 'pending'

	// Get product references from order
	const productRefs = getProductRefs(orderEvent)
	const productIds = productRefs.map((ref) => {
		const parts = ref.split(':')
		return parts.length >= 3 ? parts[2] : ref
	})

	// Fetch products
	const productQueries = useQueries({
		queries: productIds.map((productId) => ({
			...productQueryOptions(productId),
			enabled: !!productId,
		})),
	})

	// Fetch V4V shares for the seller
	const { data: sellerV4VShares = [] } = useQuery({
		queryKey: ['v4vShares', sellerPubkey],
		queryFn: () => fetchV4VShares(sellerPubkey),
		enabled: !!sellerPubkey,
	})

	const productQueriesReady = productQueries.every((query) => !query.isLoading)
	const products = productQueries.map((query) => query.data).filter(Boolean) as NDKEvent[]

	// Convert payment requests to individual payable invoices
	const invoicesFromPaymentRequests = useMemo(() => {
		if (!order.paymentRequests || order.paymentRequests.length === 0) {
			return []
		}

		const invoices: SingleInvoiceData[] = []

		// Each payment request represents a separate payable invoice
		order.paymentRequests.forEach((paymentRequest) => {
			const amountTag = paymentRequest.tags.find((tag) => tag[0] === 'amount')
			const amount = amountTag?.[1] ? parseInt(amountTag[1], 10) : 0

			if (amount <= 0) return

			const paymentMethods = extractPaymentMethods(paymentRequest)
			const lightningPayment = paymentMethods.find((p) => p.type === 'lightning')
			const isCompleted = isPaymentCompleted(paymentRequest.id, order.paymentReceipts)

			// Determine if this is a V4V payment or merchant payment
			const recipientPubkey = paymentRequest.pubkey
			const isSellerPayment = recipientPubkey === sellerPubkey

			// Find the V4V recipient name if applicable
			let recipientName = 'Merchant'
			if (!isSellerPayment) {
				const v4vRecipient = sellerV4VShares.find((share) => share.pubkey === recipientPubkey)
				recipientName = v4vRecipient ? v4vRecipient.name : 'V4V Recipient'
			}

			const expirationTag = paymentRequest.tags.find((tag) => tag[0] === 'expiration')
			const expirationValue = expirationTag?.[1]
			const expiresAt = expirationValue ? parseInt(expirationValue, 10) : Math.floor(Date.now() / 1000) + 3600

			invoices.push({
				id: paymentRequest.id,
				bolt11: lightningPayment?.details || '',
				amount,
				description: isSellerPayment ? 'Merchant Payment' : 'V4V Community Payment',
				recipientName,
				status: isCompleted ? 'paid' : 'pending',
				expiresAt,
				createdAt: paymentRequest.created_at || Math.floor(Date.now() / 1000),
			})
		})

		return invoices
	}, [order.paymentRequests, order.paymentReceipts, totalAmount, orderId])

	const handlePaymentComplete = (invoiceId: string, preimage?: string) => {
		console.log(`Payment completed for invoice ${invoiceId}`, { preimage })
		toast.success('Payment completed successfully!')
	}

	const handlePaymentFailed = (invoiceId: string, error: string) => {
		console.error(`Payment failed for invoice ${invoiceId}:`, error)
		toast.error(`Payment failed: ${error}`)
	}

	// Calculate payment statistics
	const incompleteInvoices = invoicesFromPaymentRequests.filter(
		(invoice) => invoice.status === 'failed' || invoice.status === 'expired' || invoice.status === 'pending',
	)

	const paidInvoices = invoicesFromPaymentRequests.filter((invoice) => invoice.status === 'paid')
	const totalInvoices = invoicesFromPaymentRequests.length
	const paymentProgress = totalInvoices > 0 ? (paidInvoices.length / totalInvoices) * 100 : 0

	const getStatusIcon = (status: string) => {
		switch (status) {
			case 'paid':
				return <CheckCircle className="w-4 h-4 text-green-600" />
			case 'pending':
				return <Clock className="w-4 h-4 text-yellow-600" />
			case 'processing':
				return <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
			case 'failed':
			case 'expired':
				return <XCircle className="w-4 h-4 text-red-600" />
			default:
				return <AlertTriangle className="w-4 h-4 text-gray-600" />
		}
	}

	const getStatusColor = (status: string) => {
		switch (status) {
			case 'paid':
				return 'bg-green-100 text-green-800 border-green-300'
			case 'pending':
				return 'bg-yellow-100 text-yellow-800 border-yellow-300'
			case 'processing':
				return 'bg-blue-100 text-blue-800 border-blue-300'
			case 'failed':
			case 'expired':
				return 'bg-red-100 text-red-800 border-red-300'
			default:
				return 'bg-gray-100 text-gray-800 border-gray-300'
		}
	}

	const renderEventCard = (event: NDKEvent, title: string, icon: React.ReactNode, type: string) => {
		const eventDate = new Date((event.created_at || 0) * 1000).toLocaleString()
		let content = event.content
		let extraInfo = null

		if (type === 'status') {
			const statusTag = event.tags.find((tag) => tag[0] === 'status')
			if (statusTag) {
				extraInfo = <Badge variant="outline">{statusTag[1].charAt(0).toUpperCase() + statusTag[1].slice(1)}</Badge>
			}
		} else if (type === 'shipping') {
			const statusTag = event.tags.find((tag) => tag[0] === 'status')
			const trackingTag = event.tags.find((tag) => tag[0] === 'tracking')
			const carrierTag = event.tags.find((tag) => tag[0] === 'carrier')

			extraInfo = (
				<div className="space-y-2">
					{statusTag && <Badge variant="outline">Status: {statusTag[1]}</Badge>}
					{trackingTag && (
						<div className="text-sm">
							<strong>Tracking:</strong> {trackingTag[1]}
						</div>
					)}
					{carrierTag && (
						<div className="text-sm">
							<strong>Carrier:</strong> {carrierTag[1]}
						</div>
					)}
				</div>
			)
		}

		return (
			<Card key={event.id}>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							{icon}
							<CardTitle className="text-lg">{title}</CardTitle>
						</div>
					</div>
					{extraInfo && <div className="mt-2">{extraInfo}</div>}
				</CardHeader>
				{content && (
					<CardContent className="pt-0">
						<p className="text-gray-700">{content}</p>
					</CardContent>
				)}
				<CardFooter className="flex justify-center">
					<span className="text-xs text-muted-foreground">{eventDate}</span>
				</CardFooter>
			</Card>
		)
	}

	const allEvents = [
		...order.statusUpdates.map((event) => ({
			event,
			type: 'status',
			title: 'Status Update',
			icon: <Package className="w-5 h-5" />,
		})),
		...order.shippingUpdates.map((event) => ({
			event,
			type: 'shipping',
			title: 'Shipping Update',
			icon: <Truck className="w-5 h-5" />,
		})),
		...order.paymentRequests.map((event) => ({
			event,
			type: 'payment_request',
			title: 'Payment Request',
			icon: <CreditCard className="w-5 h-5" />,
		})),
		...order.paymentReceipts.map((event) => ({
			event,
			type: 'payment',
			title: 'Payment Receipt',
			icon: <Receipt className="w-5 h-5" />,
		})),
		...order.generalMessages.map((event) => ({
			event,
			type: 'message',
			title: 'Message',
			icon: <MessageSquare className="w-5 h-5" />,
		})),
	].sort((a, b) => (b.event.created_at || 0) - (a.event.created_at || 0))

	return (
		<div className="container mx-auto px-4 py-8">
			<div className="space-y-6">
				{/* Order Header */}
				<Card>
					<CardHeader>
						<div className="flex justify-between items-center">
							<div>
								<CardTitle>Order Details</CardTitle>
							</div>
							<OrderActions order={order} userPubkey={user?.pubkey || ''} />
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<DetailField label="Order ID:" value={orderId || 'N/A'} />
							<DetailField label="Amount:" value={`${totalAmount} sats`} valueClassName="font-bold" />
							<DetailField
								label="Date:"
								value={orderEvent.created_at ? format(new Date(orderEvent.created_at * 1000), 'dd.MM.yyyy, HH:mm') : 'N/A'}
							/>
							<DetailField label="Role:" value={isBuyer ? 'Buyer' : isOrderSeller ? 'Seller' : 'Observer'} />
							<DetailField label="Status:" value={orderStatus.charAt(0).toUpperCase() + orderStatus.slice(1)} />
						</div>
					</CardContent>
				</Card>

				{/* Products */}
				{products.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle>Products</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
								{products.map((product) => (
									<ProductCard key={product.id} product={product} />
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Debug Information - only in development */}
				{process.env.NODE_ENV === 'development' && (
					<Card>
						<CardHeader>
							<CardTitle>Debug Info</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-sm space-y-2">
								<p>Current User: {user?.pubkey}</p>
								<p>Buyer Pubkey: {buyerPubkey}</p>
								<p>Seller Pubkey: {sellerPubkey}</p>
								<p>Is Buyer: {isBuyer ? 'Yes' : 'No'}</p>
								<p>Is Order Seller: {isOrderSeller ? 'Yes' : 'No'}</p>
								<p>Total Invoices: {totalInvoices}</p>
								<p>Payment Requests: {order.paymentRequests?.length || 0}</p>
								<p>Payment Receipts: {order.paymentReceipts?.length || 0}</p>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Payment Processing */}
				{totalInvoices > 0 && (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<CreditCard className="w-5 h-5" />
								Payment Details ({totalInvoices} invoices)
							</CardTitle>
							{/* Payment Summary */}
							<div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
								<div className="flex items-center gap-2">
									<CreditCard className="w-4 h-4 text-green-600" />
									<div>
										<p className="text-gray-500">Merchant</p>
										<p className="font-semibold">
											{invoicesFromPaymentRequests.filter((inv) => inv.description === 'Merchant Payment').length} invoice
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<Users className="w-4 h-4 text-purple-600" />
									<div>
										<p className="text-gray-500">V4V Recipients</p>
										<p className="font-semibold">
											{invoicesFromPaymentRequests.filter((inv) => inv.description === 'V4V Community Payment').length} invoices
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<Package className="w-4 h-4 text-blue-600" />
									<div>
										<p className="text-gray-500">Total Amount</p>
										<p className="font-semibold">
											{invoicesFromPaymentRequests.reduce((sum, inv) => sum + inv.amount, 0).toLocaleString()} sats
										</p>
									</div>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							{/* Reattempt All Button - only for buyers */}
							{isBuyer && incompleteInvoices.length > 0 && (
								<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2 text-yellow-800">
											<AlertTriangle className="w-5 h-5" />
											<div>
												<p className="font-medium">
													{incompleteInvoices.length} invoice{incompleteInvoices.length !== 1 ? 's' : ''} require payment
												</p>
												<p className="text-sm">Complete all payments to finalize your order</p>
											</div>
										</div>
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												toast.info('Refreshing payment status for all incomplete invoices...')
											}}
											className="text-yellow-700 border-yellow-300 hover:bg-yellow-100"
										>
											<RefreshCw className="w-4 h-4 mr-2" />
											Refresh All
										</Button>
									</div>
								</div>
							)}

							{/* Payment Progress */}
							<div className="space-y-2">
								<div className="flex justify-between text-sm">
									<span>Payment Progress</span>
									<span>{Math.round(paymentProgress)}% Complete</span>
								</div>
								{/* Progress bar */}
								<div className="w-full bg-gray-200 rounded-full h-2">
									<div
										className="bg-green-600 h-2 rounded-full transition-all duration-300"
										style={{ width: `${paymentProgress}%` }}
									/>
								</div>
							</div>

							{/* Individual invoice payment buttons */}
							<div className="grid gap-3">
								{invoicesFromPaymentRequests.map((invoice) => {
									const isComplete = invoice.status === 'paid'
									const needsPayment = !isComplete && invoice.bolt11

									return (
										<div key={invoice.id} className="border rounded-lg p-4">
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-3">
													{/* Payment type icon */}
													<div
														className={`p-2 rounded-lg ${
															invoice.description === 'Merchant Payment' ? 'bg-green-100' : 'bg-purple-100'
														}`}
													>
														{invoice.description === 'Merchant Payment' ? (
															<CreditCard className="w-4 h-4 text-green-600" />
														) : (
															<Users className="w-4 h-4 text-purple-600" />
														)}
													</div>

													<Badge className={getStatusColor(invoice.status || 'pending')} variant="outline">
														{getStatusIcon(invoice.status || 'pending')}
														<span className="ml-1 capitalize">{invoice.status}</span>
													</Badge>
													<div>
														<p className="font-semibold">{invoice.amount.toLocaleString()} sats</p>
														<p className="text-sm text-gray-600">{invoice.description}</p>
														<p className="text-xs text-gray-500">{invoice.recipientName}</p>
													</div>
												</div>

												{/* Payment button - only for buyers */}
												{isBuyer && needsPayment && (
													<Dialog>
														<DialogTrigger asChild>
															<Button size="sm">
																<Zap className="w-4 h-4 mr-2" />
																Pay Invoice
															</Button>
														</DialogTrigger>
														<DialogContent className="max-w-md">
															<DialogHeader>
																<DialogTitle>Pay Invoice</DialogTitle>
															</DialogHeader>
															<SingleInvoicePayment
																invoice={invoice}
																onPaymentComplete={handlePaymentComplete}
																onPaymentFailed={handlePaymentFailed}
																showHeader={false}
																nwcEnabled={true}
															/>
														</DialogContent>
													</Dialog>
												)}

												{/* Status display for sellers or when payment not needed */}
												{(!isBuyer || !needsPayment) && !isComplete && (
													<div className="text-sm text-gray-500">
														{needsPayment
															? 'Awaiting buyer payment'
															: invoice.bolt11
															? 'Processing...'
															: 'Awaiting payment request'}
													</div>
												)}
											</div>
										</div>
									)
								})}
							</div>

							{/* V4V Information */}
							{sellerV4VShares.length > 0 && (
								<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
									<div className="flex items-center gap-2 mb-2">
										<Users className="w-5 h-5 text-blue-600" />
										<h4 className="font-medium text-blue-900">Value-for-Value Recipients</h4>
									</div>
									<div className="text-sm text-blue-800">
										This seller shares revenue with {sellerV4VShares.length} community recipient
										{sellerV4VShares.length !== 1 ? 's' : ''}:
									</div>
									<div className="mt-2 space-y-1">
										{sellerV4VShares.map((share, index) => (
											<div key={index} className="flex justify-between text-sm">
												<span className="text-blue-700">{share.name}</span>
												<span className="text-blue-600 font-medium">{share.percentage}%</span>
											</div>
										))}
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				)}

				{/* Order Timeline */}
				{allEvents.length > 0 && (
					<div>
						<h2 className="text-xl font-bold mb-4">Order Timeline</h2>
						<div className="space-y-4">
							{allEvents.map(({ event, type, title, icon }) => renderEventCard(event, title, icon, type))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
