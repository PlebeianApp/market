import { ProductCard } from '@/components/ProductCard'
import { PaymentDialog, type PaymentInvoiceData } from '@/components/checkout/PaymentDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { authStore } from '@/lib/stores/auth'
import { getEventDate, type OrderWithRelatedEvents } from '@/queries/orders'
import { productQueryOptions } from '@/queries/products'
import { useGenerateInvoiceMutation } from '@/queries/payment'
import { fetchV4VShares } from '@/queries/v4v'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import {
	AlertTriangle,
	CheckCircle,
	Clock,
	CreditCard,
	MessageSquare,
	Package,
	Receipt,
	RefreshCw,
	Truck,
	Users,
	XCircle,
	Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { DetailField } from '../ui/DetailField'
import { toast } from 'sonner'
import { OrderActions } from './OrderActions'

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

// NEW: Extract item quantities from order tags
const getOrderItems = (orderEvent: NDKEvent): Array<{ productRef: string; quantity: number }> => {
	return orderEvent.tags
		.filter((tag) => tag[0] === 'item')
		.map((tag) => ({
			productRef: tag[1],
			quantity: parseInt(tag[2] || '1', 10), // Default to 1 if quantity is missing
		}))
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
const isPaymentCompleted = (paymentRequest: NDKEvent, paymentReceipts: NDKEvent[]): boolean => {
	// Get payment request details
	const requestAmount = paymentRequest.tags.find((tag) => tag[0] === 'amount')?.[1]
	const requestRecipient = paymentRequest.tags.find((tag) => tag[0] === 'recipient')?.[1]

	if (!requestAmount || !requestRecipient) {
		console.log(`❌ Payment request missing required tags:`, { requestAmount, requestRecipient, id: paymentRequest.id })
		return false
	}

	console.log(`🔍 Checking payment completion for request:`, {
		id: paymentRequest.id,
		amount: requestAmount,
		recipient: requestRecipient,
	})

	const matchingReceipt = paymentReceipts.find((receipt) => {
		// Look for order tag, amount tag, and p tag (recipient) in the receipt
		const orderTag = receipt.tags.find((tag) => tag[0] === 'order')
		const amountTag = receipt.tags.find((tag) => tag[0] === 'amount')
		const recipientTag = receipt.tags.find((tag) => tag[0] === 'p')
		const paymentTag = receipt.tags.find((tag) => tag[0] === 'payment')

		// For exact recipient match, allow small amount variations (±2 sats for fees/rounding)
		const requestAmountNum = parseInt(requestAmount, 10)
		const receiptAmountNum = parseInt(amountTag?.[1] || '0', 10)
		const amountDiff = Math.abs(requestAmountNum - receiptAmountNum)
		const amountMatches = amountDiff <= 2 // Allow up to 2 sats difference

		// Must have exact recipient match
		const recipientMatches = recipientTag?.[1] === requestRecipient

		// Match receipt to payment request by recipient and approximate amount
		const matches = orderTag && amountTag && recipientTag && paymentTag && recipientMatches && amountMatches

		if (matches) {
			console.log(`✅ Found matching receipt for payment request ${paymentRequest.id} (amount diff: ${amountDiff} sats)`)
		} else if (recipientMatches && !amountMatches) {
			console.log(
				`⚠️ Recipient matches but amount differs too much: request=${requestAmountNum}, receipt=${receiptAmountNum}, diff=${amountDiff}`,
			)
		}

		return matches
	})

	const isCompleted = !!matchingReceipt
	console.log(`🏁 Payment request ${paymentRequest.id} completion status:`, isCompleted)

	return isCompleted
}

export function OrderDetailComponent({ order }: OrderDetailComponentProps) {
	const { user } = useStore(authStore)
	const { mutateAsync: generateInvoice } = useGenerateInvoiceMutation()
	const [generatingInvoices, setGeneratingInvoices] = useState<Set<string>>(new Set())
	const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
	const [selectedInvoiceIndex, setSelectedInvoiceIndex] = useState(0)

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

	// Get product references and quantities from order
	const orderItems = getOrderItems(orderEvent)
	const productIds = orderItems.map((item) => {
		const parts = item.productRef.split(':')
		return parts.length >= 3 ? parts[2] : item.productRef
	})

	// Create a quantity map for easy lookup
	const quantityMap = new Map(
		orderItems.map((item) => {
			const parts = item.productRef.split(':')
			const productId = parts.length >= 3 ? parts[2] : item.productRef
			return [productId, item.quantity]
		}),
	)

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

	const products = productQueries.map((query) => query.data).filter(Boolean) as NDKEvent[]

	// Convert payment requests to individual payable invoices
	const invoicesFromPaymentRequests = useMemo(() => {
		if (!order.paymentRequests || order.paymentRequests.length === 0) {
			return []
		}

		const invoices: PaymentInvoiceData[] = []

		// Each payment request represents a separate payable invoice
		order.paymentRequests.forEach((paymentRequest) => {
			const amountTag = paymentRequest.tags.find((tag) => tag[0] === 'amount')
			const amount = amountTag?.[1] ? parseInt(amountTag[1], 10) : 0

			if (amount <= 0) return

			const paymentMethods = extractPaymentMethods(paymentRequest)
			const lightningPayment = paymentMethods.find((p) => p.type === 'lightning')
			const isCompleted = isPaymentCompleted(paymentRequest, order.paymentReceipts)

			// Determine if this is a V4V payment or merchant payment
			const recipientPubkey = paymentRequest.tags.find((tag) => tag[0] === 'recipient')?.[1] || paymentRequest.pubkey
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

			// Extract lightning address from payment method for invoice generation
			const lightningAddress = lightningPayment?.details || ''

			// Check if the payment details contain a BOLT11 invoice or lightning address
			const isBolt11 = lightningAddress.toLowerCase().startsWith('lnbc') || lightningAddress.toLowerCase().startsWith('lntb')
			const actualBolt11 = isBolt11 ? lightningAddress : '' // Only use if it's actually a BOLT11 invoice
			const actualLightningAddress = !isBolt11 ? lightningAddress : '' // Only use if it's a lightning address

			invoices.push({
				id: paymentRequest.id,
				orderId: orderId,
				bolt11: actualBolt11, // Only include BOLT11 invoices here
				amount,
				description: isSellerPayment ? 'Merchant Payment' : 'V4V Community Payment',
				recipientName,
				status: isCompleted ? 'paid' : 'pending',
				expiresAt,
				createdAt: paymentRequest.created_at || Math.floor(Date.now() / 1000),
				lightningAddress: actualLightningAddress, // Store lightning address separately for invoice generation
				recipientPubkey, // Store recipient pubkey for invoice generation
				type: isSellerPayment ? 'merchant' : 'v4v',
			})
		})

		return invoices
	}, [order.paymentRequests, order.paymentReceipts, totalAmount, orderId, sellerV4VShares, sellerPubkey])

	// Function to generate a new invoice for a payment request
	const handleGenerateNewInvoice = async (invoice: PaymentInvoiceData) => {
		if (!invoice.lightningAddress) {
			toast.error('No lightning address available for this payment')
			return
		}

		setGeneratingInvoices((prev) => new Set(prev).add(invoice.id))

		try {
			const recipientPubkey = invoice.recipientPubkey || sellerPubkey
			const newInvoiceData = await generateInvoice({
				sellerPubkey: recipientPubkey,
				amountSats: invoice.amount,
				description: invoice.description || 'Payment',
				invoiceId: invoice.id,
				items: [], // Empty items array for order payments
				type: invoice.type === 'merchant' ? 'seller' : invoice.type,
			})

			// TODO: Update the payment request with the new invoice
			// This would require creating a new payment request event or updating the existing one
			console.log('Generated new invoice:', newInvoiceData)
			toast.success(`New invoice generated for ${invoice.recipientName}`)
		} catch (error) {
			console.error('Failed to generate new invoice:', error)
			toast.error(`Failed to generate new invoice: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setGeneratingInvoices((prev) => {
				const newSet = new Set(prev)
				newSet.delete(invoice.id)
				return newSet
			})
		}
	}

	const handlePaymentComplete = (invoiceId: string, preimage: string) => {
		console.log(`Payment completed for invoice ${invoiceId}`, { preimage })
		toast.success('Payment completed successfully!')
		// Note: Payment receipt is automatically created by PaymentDialog using zap infrastructure
	}

	const handlePaymentFailed = (invoiceId: string, error: string) => {
		console.error(`Payment failed for invoice ${invoiceId}:`, error)
		toast.error(`Payment failed: ${error}`)
	}

	// Calculate payment statistics
	const incompleteInvoices = invoicesFromPaymentRequests.filter((invoice) => invoice.status === 'expired' || invoice.status === 'pending')

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
			case 'expired':
				return 'bg-red-100 text-red-800 border-red-300'
			default:
				return 'bg-gray-100 text-gray-800 border-gray-300'
		}
	}

	const currentUserPubkey = user?.pubkey
	const isOrderOwner = currentUserPubkey === buyerPubkey // The buyer is the order owner who created the order

	if (!order.order) {
		return (
			<div className="text-center py-8">
				<h2 className="text-xl font-semibold text-gray-900">Order not found</h2>
				<p className="text-gray-600 mt-2">The requested order could not be found.</p>
			</div>
		)
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
						<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
							<div>
								<CardTitle className="text-2xl">Order #{orderId.substring(0, 8)}...</CardTitle>
								<p className="text-gray-600 mt-1">Created {getEventDate(orderEvent)}</p>
							</div>
							<OrderActions order={order} userPubkey={user?.pubkey || ''} />
						</div>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
							<div className="flex items-center space-x-2">
								<Package className="w-5 h-5 text-gray-500" />
								<div>
									<p className="text-sm text-gray-500">Products</p>
									<p className="font-semibold">
										{orderItems.reduce((total, item) => total + item.quantity, 0)} items ({products.length} unique)
									</p>
								</div>
							</div>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:col-span-2">
								<DetailField label="Order ID:" value={orderId || 'N/A'} valueClassName="break-all" />
								<DetailField label="Amount:" value={`${totalAmount} sats`} valueClassName="font-bold" />
								<DetailField
									label="Date:"
									value={orderEvent.created_at ? format(new Date(orderEvent.created_at * 1000), 'dd.MM.yyyy, HH:mm') : 'N/A'}
								/>
								<DetailField label="Role:" value={isBuyer ? 'Buyer' : isOrderSeller ? 'Seller' : 'Observer'} />
								<DetailField label="Status:" value={orderStatus.charAt(0).toUpperCase() + orderStatus.slice(1)} />
							</div>
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
							<div className="grid grid-cols-1 gap-4">
								{products.map((product) => {
									const productId = product.id
									const quantity = quantityMap.get(productId) || 1
									return (
										<div key={product.id} className="flex items-center space-x-4 p-4 border rounded-lg">
											<div className="flex-1 min-w-0">
												<ProductCard product={product} />
											</div>
											<div className="text-right flex-shrink-0">
												<div className="text-sm text-gray-500">Quantity</div>
												<div className="text-lg font-semibold">{quantity}</div>
											</div>
										</div>
									)
								})}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Debug Information */}
				{process.env.NODE_ENV === 'development' && (
					<Card>
						<CardHeader>
							<CardTitle>Debug Info</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-sm space-y-2">
								<p className="break-all">Current User: {currentUserPubkey}</p>
								<p className="break-all">Buyer Pubkey: {buyerPubkey}</p>
								<p className="break-all">Seller Pubkey: {sellerPubkey}</p>
								<p>Is Buyer: {isBuyer ? 'Yes' : 'No'}</p>
								<p>Is Order Owner: {isOrderOwner ? 'Yes' : 'No'}</p>
								<p>Is Order Seller: {isOrderSeller ? 'Yes' : 'No'}</p>
								<p>Total Invoices: {totalInvoices}</p>
								<p>Payment Requests: {order.paymentRequests?.length || 0}</p>
								<p>Payment Receipts: {order.paymentReceipts?.length || 0}</p>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Payment Processing - visible to both buyer and seller */}
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
												// Trigger refresh or reattempt logic for all incomplete invoices
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
									<div className="bg-green-600 h-2 rounded-full transition-all duration-300" style={{ width: `${paymentProgress}%` }} />
								</div>
							</div>

							{/* Individual invoice payment buttons */}
							<div className="grid gap-3">
								{invoicesFromPaymentRequests.map((invoice, index) => {
									const isComplete = invoice.status === 'paid'
									const isGeneratingThis = generatingInvoices.has(invoice.id)

									return (
										<div
											key={invoice.id}
											className={`border rounded-lg p-4 ${isComplete ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}
										>
											<div className="flex items-center justify-between mb-3">
												<div className="flex items-center gap-3">
													<div className={`p-2 rounded-full ${isComplete ? 'bg-green-100' : 'bg-gray-100'}`}>
														{isComplete ? (
															<CheckCircle className="w-4 h-4 text-green-600" />
														) : (
															<CreditCard className="w-4 h-4 text-gray-600" />
														)}
													</div>
													<div>
														<h4 className="font-medium">{invoice.recipientName}</h4>
														<p className="text-sm text-gray-500">{invoice.description}</p>
													</div>
												</div>
												<div className="text-right">
													<p className="font-semibold">{invoice.amount.toLocaleString()} sats</p>
													<Badge className={getStatusColor(invoice.status || 'pending')} variant="outline">
														{(invoice.status || 'pending').charAt(0).toUpperCase() + (invoice.status || 'pending').slice(1)}
													</Badge>
												</div>
											</div>

											{/* Payment action buttons - only for buyers and incomplete payments */}
											{isBuyer && !isComplete && (
												<div className="flex gap-2">
													<Button
														variant="outline"
														size="sm"
														className="flex-1"
														disabled={isGeneratingThis}
														onClick={() => {
															setSelectedInvoiceIndex(index)
															setPaymentDialogOpen(true)
														}}
													>
														{isGeneratingThis ? (
															<>
																<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
																Generating...
															</>
														) : (
															<>
																<Zap className="w-4 h-4 mr-2" />
																Pay Invoice
															</>
														)}
													</Button>

													{/* Generate new invoice button */}
													{invoice.lightningAddress && (
														<Button
															variant="outline"
															size="sm"
															onClick={() => handleGenerateNewInvoice(invoice)}
															disabled={isGeneratingThis}
															title="Generate a new invoice with fresh expiration"
														>
															{isGeneratingThis ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
														</Button>
													)}
												</div>
											)}

											{/* Show payment completion status for completed payments */}
											{isComplete && (
												<div className="bg-green-100 text-green-800 p-2 rounded text-sm">✅ Payment completed successfully</div>
											)}
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

				{/* Payment status when no invoices exist - visible to both buyer and seller */}
				{totalInvoices === 0 && (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<CreditCard className="w-5 h-5" />
								Payment Status
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-center py-8">
								<Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
								<p className="text-lg font-medium text-gray-900 mb-2">
									{isBuyer ? 'Waiting for Payment Requests' : 'No Payment Requests Created'}
								</p>
								<p className="text-gray-600">
									{isBuyer
										? 'The seller has not yet created payment requests for this order.'
										: 'Payment requests have not been created for this order yet.'}
								</p>
								<p className="text-sm text-gray-500 mt-2">
									Payment requests: {order.paymentRequests?.length || 0} | Payment receipts: {order.paymentReceipts?.length || 0}
								</p>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Order Timeline */}
				{allEvents.length > 0 && (
					<div>
						<h2 className="text-xl font-bold mb-4">Order Timeline</h2>
						<div className="space-y-4">{allEvents.map(({ event, type, title, icon }) => renderEventCard(event, title, icon, type))}</div>
					</div>
				)}
			</div>

			{/* Payment Dialog */}
			<PaymentDialog
				open={paymentDialogOpen}
				onOpenChange={setPaymentDialogOpen}
				invoices={invoicesFromPaymentRequests}
				currentIndex={selectedInvoiceIndex}
				onPaymentComplete={handlePaymentComplete}
				onPaymentFailed={handlePaymentFailed}
				title={`Pay for Order #${orderId.substring(0, 8)}...`}
				showNavigation={invoicesFromPaymentRequests.length > 1}
				nwcEnabled={true}
			/>
		</div>
	)
}
