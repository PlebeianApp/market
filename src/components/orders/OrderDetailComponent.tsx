import { ProductCard } from '@/components/ProductCard'
import { PaymentDialog } from '@/components/checkout/PaymentDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authStore } from '@/lib/stores/auth'
import type { PaymentInvoiceData } from '@/lib/types/invoice'
import { cn } from '@/lib/utils'
import { getCoordsFromATag } from '@/lib/utils/coords'
import { getStatusMessaging, getStatusStyles } from '@/lib/utils/orderUtils'
import { type OrderWithRelatedEvents } from '@/queries/orders'
import { getProductId, productSmartQueryOptions } from '@/queries/products'
import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'
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
import {
	Ban,
	Check,
	CreditCard,
	Download,
	MapPin,
	MessageSquare,
	Package,
	Receipt,
	Truck,
	CheckCircle,
	Clock,
	AlertTriangle,
	ArrowRightLeft,
	X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DetailField } from '../ui/DetailField'
import { OrderActions } from './OrderActions'
import { PrivateOrderDetailsCard } from './PrivateOrderDetailsCard'
import { TimelineEventCard } from './TimelineEventCard'
import type { ComponentType, SVGProps } from 'react'

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
import { UserCard } from '@/components/UserCard'

interface OrderDetailComponentProps {
	order: OrderWithRelatedEvents
}

// Map status icon names to Lucide components
const STATUS_ICON_MAP: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
	truck: Truck,
	tick: Check,
	check: Check,
	clock: Clock,
	cross: X,
	ban: Ban,
	circle: CheckCircle,
}

// Custom size classes for consistent rendering
const ICON_SIZE_CLASSES = 'w-4 h-4'

function renderStatusIcon(iconName?: string | null, className?: string) {
	if (!iconName) return null

	const IconComponent = STATUS_ICON_MAP[iconName]

	if (!IconComponent) return null

	return <IconComponent className={cn(ICON_SIZE_CLASSES, className)} />
}

export function OrderDetailComponent({ order }: OrderDetailComponentProps) {
	const { user } = useStore(authStore)
	const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
	const [selectedInvoiceIndex, setSelectedInvoiceIndex] = useState(0)
	const [dialogInvoices, setDialogInvoices] = useState<PaymentInvoiceData[]>([])

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
	const canViewLegacyBuyerContact = isBuyer
	const canViewBuyerContact = isBuyer || isOrderSeller

	const totalAmount = getTotalAmount(orderEvent)

	// Extract shipping information
	const shippingRef = getShippingRef(orderEvent)
	const shippingAddress = isBuyer ? orderEvent.tags.find((tag) => tag[0] === 'address')?.[1] : undefined
	const deliveryContact = isBuyer ? orderEvent.tags.find((tag) => tag[0] === 'email')?.[1] : undefined

	// Get status styles for coloring the header
	const {
		headerBgColor,
		bgColor: statusBadgeBgColor,
		iconName,
		label: statusLabel,
	} = useMemo(() => getStatusStyles(order), [order.latestStatus, order.latestShipping]) ?? {}
	const statusExplanation = useMemo(() => getStatusMessaging(order, isBuyer), [order.latestStatus, order.latestShipping, isBuyer])

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
			if (parts.length === 3 && parts[0] === SHIPPING_KIND.toString()) {
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
	const isDigitalService = shippingOption ? getShippingService(shippingOption)?.[1] === 'digital' : false
	const pickupAddress = shippingOption && isPickupService ? getShippingPickupAddressString(shippingOption) : null
	const shouldShowPrivateDetailsUnavailable = isOrderSeller && Boolean(shippingOption) && !isPickupService && !order.privateOrderDetails

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

	const headerTitle = `Products (${products.length} unique)`
	const headerSubText = `${orderItems.reduce((total, item) => total + item.quantity, 0)} items`

	return (
		<div className="container mx-auto px-4 py-4">
			<div className="space-y-6">
				{/* Order Header */}
				{/* === ORDER HEADER === */}
				<Card>
					<CardHeader className="p-0">
						<div className={cn('p-4 rounded-t-xl', headerBgColor)}>
							<div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
								<div className="flex items-center space-x-3">
									<div className={`p-2 rounded-lg ${'bg-blue-100'}`}>
										<Package className="w-5 h-5 text-blue-700" />
									</div>
									<div>
										<p className="text-sm font-medium text-gray-900">{'Products'}</p>
										<h2 className="font-semibold truncate max-w-[300px] text-gray-800" title={headerTitle}>
											{headerTitle}
										</h2>
										{headerSubText && <p className="text-xs text-gray-600 mt-0.5">{headerSubText}</p>}
									</div>
								</div>
							</div>

							<div className="border-t border-white/20 pt-4">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<DetailField label="Amount:" value={`${totalAmount} sats`} valueClassName="font-bold text-gray-900" />
									<DetailField
										label="Date:"
										value={orderEvent.created_at ? format(new Date(orderEvent.created_at * 1000), 'dd.MM.yyyy, HH:mm') : 'N/A'}
										valueClassName="text-gray-900"
									/>
								</div>
							</div>
						</div>
					</CardHeader>

					<CardContent className="pt-4">
						{/* STATUS SECTION - Separated from actions */}
						<div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
							<div className="flex items-center gap-2 mb-2">
								<div className={`p-1.5 rounded-md ${statusBadgeBgColor}`}>{renderStatusIcon(iconName)}</div>
								<span className="font-semibold text-gray-900 capitalize">{statusLabel}</span>
							</div>
							<p className="text-sm text-gray-700 ml-9">{statusExplanation || 'No pending actions required.'}</p>
						</div>

						{/* ORDER ACTIONS - Now at the bottom with labels */}
						<OrderActions order={order} userPubkey={user?.pubkey || ''} />
					</CardContent>
				</Card>

				{/* Buyer Information Card */}
				<Card>
					<CardHeader>
						<CardTitle>Buyer</CardTitle>
					</CardHeader>
					<CardContent>
						<UserCard pubkey={buyerPubkey} size="md" subtitle="nip-05" />
					</CardContent>
				</Card>

				{canViewLegacyBuyerContact && deliveryContact && (
					<Card>
						<CardHeader>
							<CardTitle>Buyer Contact</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-gray-700">
								<strong>Delivery contact:</strong> {deliveryContact}
							</p>
							<p className="text-xs text-gray-500 mt-2">The seller can use this contact for order coordination after payment settles.</p>
						</CardContent>
					</Card>
				)}

				<PrivateOrderDetailsCard order={order} currentUserPubkey={user?.pubkey} showUnavailable={shouldShowPrivateDetailsUnavailable} />

				{/* Products */}
				{products.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle>{'Products'}</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="grid grid-cols-1 gap-4">
								{products.map((product) => {
									const lookupId = getProductId(product) || product.id
									const quantity = quantityMap.get(lookupId) || quantityMap.get(product.id) || 1

									return (
										<div key={product.id} className="p-4 border rounded-lg">
											{
												<div>
													<ProductCard product={product} />
													<div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
														<span className="text-sm text-gray-500">Quantity</span>
														<span className="text-lg font-semibold">{quantity}</span>
													</div>
												</div>
											}
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
								{isPickupService ? (
									<MapPin className="w-5 h-5" />
								) : isDigitalService ? (
									<Download className="w-5 h-5" />
								) : (
									<Truck className="w-5 h-5" />
								)}
								<CardTitle>
									{isPickupService ? 'Pickup Information' : isDigitalService ? 'Digital Delivery' : 'Shipping Information'}
								</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								{shippingInfo && <ShippingInfoDisplay shippingInfo={shippingInfo} totalAmount={totalAmount} />}

								{isPickupService && pickupAddress && <PickupAddressDisplay pickupAddress={pickupAddress} />}

								{isDigitalService && (
									<div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
										<div className="flex items-start gap-2">
											<Download className="w-4 h-4 text-purple-600 mt-0.5" />
											<div>
												<p className="font-medium text-purple-900">Digital Delivery</p>
												<p className="text-sm text-purple-800 mt-1">
													The seller will use the buyer-provided delivery contact after payment settles.
												</p>
											</div>
										</div>
									</div>
								)}

								{!isPickupService && !isDigitalService && shippingAddress && <DeliveryAddressDisplay shippingAddress={shippingAddress} />}

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

				{/* --- PAYMENT SECTION --- */}
				{
					/* For Products: Show Invoice Logic */
					<>
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
									{isBuyer && incompleteInvoices.length > 0 && (
										<IncompleteInvoicesBanner
											count={incompleteInvoices.length}
											onRefresh={() => {
												toast.info('Refreshing payment status for all incomplete invoices...')
											}}
										/>
									)}

									<PaymentProgressBar paidCount={paidInvoices.length} totalCount={totalInvoices} progressPercent={paymentProgress} />

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

									{sellerV4VShares.length > 0 && <V4VRecipientsCard shares={sellerV4VShares} />}
								</CardContent>
							</Card>
						)}

						{totalInvoices === 0 && <NoPaymentRequestsCard isBuyer={isBuyer} />}
					</>
				}

				{/* Order Timeline */}
				{allEvents.length > 0 && (
					<div>
						<h2 className="text-xl font-bold mb-4">Order Timeline</h2>
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
