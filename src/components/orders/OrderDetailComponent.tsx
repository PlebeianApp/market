import { ProductCard } from '@/components/ProductCard'
import { PaymentDialog } from '@/components/checkout/PaymentDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import type { PaymentInvoiceData } from '@/lib/types/invoice'
import { cn } from '@/lib/utils'
import { getCoordsFromATag } from '@/lib/utils/coords'
import { getStatusStyles } from '@/lib/utils/orderUtils'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getProductId, productSmartQueryOptions } from '@/queries/products'
import {
	getShippingInfo,
	getShippingPickupAddressString,
	getShippingService,
	parseShippingReference,
	shippingOptionByCoordinatesQueryOptions,
	shippingOptionQueryOptions,
} from '@/queries/shipping'
import { fetchV4VShares } from '@/queries/v4v'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { format } from 'date-fns'
import { CreditCard, MapPin, MessageSquare, Package, Receipt, Truck, ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DetailField } from '../ui/DetailField'
import { Separator } from '../ui/separator'
import { OrderActions } from './OrderActions'
import { TimelineEventCard } from './TimelineEventCard'

// Imported helpers and components
import { getOrderId, getOrderItems, getSellerPubkey, getShippingRef, getTotalAmount } from './orderDetailHelpers'
import { useOrderInvoices } from './useOrderInvoices'
import {
	DeliveryAddressDisplay,
	IncompleteInvoicesBanner,
	InvoiceCard,
	NoPaymentRequestsCard,
	PaymentProgressBar,
	PaymentSummary,
	PickupAddressDisplay,
	ShippingInfoDisplay,
	TrackingInfoDisplay,
	V4VRecipientsCard,
} from './detail'

interface OrderDetailComponentProps {
	order: OrderWithRelatedEvents
}

export function OrderDetailComponent({ order }: OrderDetailComponentProps) {
	const { user } = useStore(authStore)
	const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
	const [selectedInvoiceIndex, setSelectedInvoiceIndex] = useState(0)
	const [dialogInvoices, setDialogInvoices] = useState<PaymentInvoiceData[]>([])

	const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())

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

	// Extract shipping information
	const shippingRef = getShippingRef(orderEvent)
	const shippingAddress = orderEvent.tags.find((tag) => tag[0] === 'address')?.[1]

	// Get status styles for coloring the header
	const { headerBgColor } = getStatusStyles(order)

	// Get order status from latest status update or default to pending
	const orderStatus = order.latestStatus?.tags.find((tag) => tag[0] === 'status')?.[1] || 'pending'

	// Get product references and quantities from order
	const orderItems = getOrderItems(orderEvent)
	const parsedOrderItems = useMemo(
		() =>
			orderItems.map((item) => {
				let coords: { identifier: string; pubkey: string } | null = null

				if (item.productRef.includes(':')) {
					try {
						const parsed = getCoordsFromATag(item.productRef)
						coords = { identifier: parsed.identifier, pubkey: parsed.pubkey }
					} catch (err) {
						console.warn('Failed to parse product reference as a-tag', err)
					}
				}

				return {
					...item,
					lookupId: coords?.identifier || item.productRef,
					itemSellerPubkey: coords?.pubkey || sellerPubkey,
				}
			}),
		[orderItems, sellerPubkey],
	)

	// Create a quantity map keyed by the product lookup id (prefer d-tag over event id)
	const quantityMap = useMemo(() => {
		const map = new Map<string, number>()
		parsedOrderItems.forEach((item) => {
			if (item.lookupId) {
				map.set(item.lookupId, item.quantity)
			}
			map.set(item.productRef, item.quantity)
		})
		return map
	}, [parsedOrderItems])

	// Fetch products
	const productQueries = useQueries({
		queries: parsedOrderItems.map((item) => ({
			...productSmartQueryOptions(item.lookupId, item.itemSellerPubkey),
			enabled: !!item.lookupId,
		})),
	})

	// Fetch V4V shares for the seller
	const { data: sellerV4VShares = [] } = useQuery({
		queryKey: ['v4vShares', sellerPubkey],
		queryFn: () => fetchV4VShares(sellerPubkey),
		enabled: !!sellerPubkey,
	})

	// Use the invoice hook
	const {
		enrichedInvoices,
		paidInvoices,
		incompleteInvoices,
		totalInvoices,
		paymentProgress,
		generatingInvoices,
		handleGenerateNewInvoice,
		handlePaymentComplete,
		handlePaymentFailed,
	} = useOrderInvoices({
		order,
		sellerV4VShares,
		userPubkey: user?.pubkey,
	})

	// Parse shipping reference and fetch shipping option details
	const parsedShippingData = useMemo(() => {
		if (!shippingRef) return null

		if (shippingRef.includes(':')) {
			const parts = shippingRef.split(':')
			if (parts.length === 3 && parts[0] === '30406') {
				return { pubkey: parts[1], dTag: parts[2] }
			}
		}

		return null
	}, [shippingRef])

	// Fetch shipping option by coordinates if we have parsed data
	const { data: shippingOptionByCoords } = useQuery({
		...shippingOptionByCoordinatesQueryOptions(parsedShippingData?.pubkey || '', parsedShippingData?.dTag || ''),
		enabled: !!parsedShippingData,
	})

	// Fetch shipping option by ID if we don't have coordinates
	const { data: shippingOptionById } = useQuery({
		...shippingOptionQueryOptions(parseShippingReference(shippingRef || '')),
		enabled: !!shippingRef && !parsedShippingData,
	})

	// Use the appropriate shipping option
	const shippingOption = shippingOptionByCoords || shippingOptionById

	// Extract shipping information
	const shippingInfo = shippingOption ? getShippingInfo(shippingOption) : null
	const isPickupService = shippingOption ? getShippingService(shippingOption)?.[1] === 'pickup' : false
	const pickupAddress = shippingOption && isPickupService ? getShippingPickupAddressString(shippingOption) : null

	const products = productQueries.map((query) => query.data).filter(Boolean) as NDKEvent[]

	const openPaymentDialog = (invoiceList: PaymentInvoiceData[]) => {
		if (!invoiceList.length) return
		setDialogInvoices(invoiceList)
		setSelectedInvoiceIndex(0)
		setPaymentDialogOpen(true)
	}

	const onPaymentComplete = async (invoiceId: string, preimage: string) => {
		setPaymentDialogOpen(false)
		await handlePaymentComplete(invoiceId, preimage, dialogInvoices)
	}

	const onPaymentFailed = (invoiceId: string, error: string) => {
		handlePaymentFailed(invoiceId, error)
	}

	const allProductsExpanded = products.length > 0 && expandedProducts.size === products.length
	const [timelineExpanded, setTimelineExpanded] = useState(false)

	const toggleAllProducts = () => {
		if (allProductsExpanded) {
			setExpandedProducts(new Set())
		} else {
			setExpandedProducts(new Set(products.map((p) => p.id)))
		}
	}

	const toggleProduct = (productId: string) => {
		setExpandedProducts((prev) => {
			const next = new Set(prev)
			if (next.has(productId)) {
				next.delete(productId)
			} else {
				next.add(productId)
			}
			return next
		})
	}

	if (!order.order) {
		return (
			<div className="text-center py-8">
				<h2 className="text-xl font-semibold text-gray-900">Order not found</h2>
				<p className="text-gray-600 mt-2">The requested order could not be found.</p>
			</div>
		)
	}

	// Timeline events
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
		<div className="container mx-auto px-4 py-4">
			<div className="space-y-6">
				{/* Order Header */}
				<Card>
					<CardHeader className="p-0">
						<div className={cn('p-4 rounded-t-xl', headerBgColor)}>
							<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
								<div className="flex items-center space-x-2">
									<div>
										<p className="text-sm text-gray-500">Products</p>
										<p className="font-semibold">
											{orderItems.reduce((total, item) => total + item.quantity, 0)} items ({products.length} unique)
										</p>
									</div>
								</div>
								<OrderActions order={order} userPubkey={user?.pubkey || ''} />
							</div>
						</div>
					</CardHeader>
					<CardContent className="pt-4">
						<div className="text-sm">
							<span className="text-muted-foreground">Order ID: </span>
							<span className="font-medium break-all">{orderId || 'N/A'}</span>
						</div>
						<Separator className="my-4" />
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
							<div className="flex items-center justify-between">
								<CardTitle>Products</CardTitle>
								<Button variant="ghost" size="sm" onClick={toggleAllProducts} className="text-sm">
									{allProductsExpanded ? (
										<>
											<ChevronUp className="w-4 h-4" />
										</>
									) : (
										<>
											<ChevronDown className="w-4 h-4" />
										</>
									)}
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							<div className="grid grid-cols-1 gap-4">
								{products.map((product) => {
									const lookupId = getProductId(product) || product.id
									const quantity = quantityMap.get(lookupId) || quantityMap.get(product.id) || 1
									const isExpanded = expandedProducts.has(product.id)

									return (
										<div key={product.id} className="border rounded-lg overflow-hidden">
											<button
												onClick={() => toggleProduct(product.id)}
												className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
											>
												<div className="flex items-center gap-3 flex-1">
													<span className="font-medium text-left">{product.tags.find((t) => t[0] === 'title')?.[1] || 'Product'}</span>
													<span className="text-sm text-gray-500">Qty: {quantity}</span>
												</div>
												{isExpanded ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
											</button>

											{isExpanded && (
												<div className="p-4 border-t border-gray-200 bg-gray-50">
													<ProductCard product={product} />
												</div>
											)}
										</div>
									)
								})}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Shipping Information */}
				{(shippingInfo || shippingAddress) && (
					<Card>
						<CardHeader>
							<div className="flex items-center gap-2">
								{isPickupService ? <MapPin className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
								<CardTitle>{isPickupService ? 'Pickup Information' : 'Shipping Information'}</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								{shippingInfo && <ShippingInfoDisplay shippingInfo={shippingInfo} />}

								{isPickupService && pickupAddress && <PickupAddressDisplay pickupAddress={pickupAddress} />}

								{!isPickupService && shippingAddress && <DeliveryAddressDisplay shippingAddress={shippingAddress} />}

								{/* Tracking Information */}
								<TrackingInfoDisplay
									trackingNumber={order.latestShipping?.tags.find((tag) => tag[0] === 'tracking')?.[1]}
									carrier={order.latestShipping?.tags.find((tag) => tag[0] === 'carrier')?.[1]}
									shippingStatus={order.latestShipping?.tags.find((tag) => tag[0] === 'status')?.[1]}
								/>

								{shippingInfo?.description && (
									<div className="mt-4 p-3 bg-gray-50 rounded-lg">
										<p className="text-sm text-gray-700">{shippingInfo.description}</p>
									</div>
								)}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Payment Processing */}
				{totalInvoices > 0 && (
					<Card>
						<CardHeader className="p-0">
							<div className="bg-gray-50 p-4 rounded-t-xl">
								<div className="flex items-start gap-2">
									<CreditCard className="w-5 h-5" />
									<div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
										<CardTitle>Payment Details</CardTitle>
										<span className="text-muted-foreground">({totalInvoices} invoices)</span>
									</div>
								</div>
								<div className="my-3 border-b border-gray-300 sm:hidden" />
								<PaymentSummary enrichedInvoices={enrichedInvoices} />
							</div>
						</CardHeader>
						<CardContent className="space-y-4 pt-4">
							{/* Incomplete invoices banner */}
							{isBuyer && incompleteInvoices.length > 0 && (
								<IncompleteInvoicesBanner
									count={incompleteInvoices.length}
									onRefresh={() => {
										toast.info('Refreshing payment status for all incomplete invoices...')
									}}
								/>
							)}

							{/* Payment Progress */}
							<PaymentProgressBar paidCount={paidInvoices.length} totalCount={totalInvoices} progressPercent={paymentProgress} />

							{/* Individual invoice cards */}
							<div className="grid gap-3">
								{enrichedInvoices.map((invoice, index) => (
									<InvoiceCard
										key={invoice.id}
										invoice={invoice}
										index={index}
										totalInvoices={enrichedInvoices.length}
										isBuyer={isBuyer}
										isGenerating={generatingInvoices.has(invoice.id)}
										onPay={(inv) => openPaymentDialog([inv])}
										onGenerateNew={handleGenerateNewInvoice}
									/>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{/* No payment requests card */}
				{totalInvoices === 0 && <NoPaymentRequestsCard isBuyer={isBuyer} />}

				{/* Order Timeline */}
				{allEvents.length > 0 && (
					<div>
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-xl font-bold">Order Timeline</h2>
							<Button variant="ghost" size="sm" onClick={() => setTimelineExpanded(!timelineExpanded)}>
								{timelineExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
							</Button>
						</div>
						{timelineExpanded && (
							<div className="space-y-4">
								{allEvents.map(({ event, type, title, icon }, index) => (
									<TimelineEventCard
										key={event.id}
										event={event}
										type={type}
										title={title}
										icon={icon}
										timelineIndex={allEvents.length - index}
									/>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			{/* Payment Dialog */}
			<PaymentDialog
				open={paymentDialogOpen}
				onOpenChange={setPaymentDialogOpen}
				invoices={dialogInvoices}
				currentIndex={selectedInvoiceIndex}
				onPaymentComplete={onPaymentComplete}
				onPaymentFailed={onPaymentFailed}
				title={`Pay for Order #${orderId.substring(0, 8)}...`}
				showNavigation={dialogInvoices.length > 1}
				nwcEnabled={true}
			/>
		</div>
	)
}
