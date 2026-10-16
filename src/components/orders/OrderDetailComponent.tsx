import { ProductCard } from '@/components/ProductCard'
import { PaymentDialog } from '@/components/checkout/PaymentDialog'
import {
	OrderBuyerCardView,
	OrderDetailLayoutView,
	OrderMissingView,
	OrderNotFoundView,
	OrderPaymentDetailsCardView,
	OrderProductsCardView,
	OrderTimelineView,
} from '@ui/components/orders/OrderDetailLayout'
import { getAuctionClaimPublicMarkerFields } from '@/lib/auctions/privateAuctionClaimMessage'
import { authStore } from '@/lib/stores/auth'
import type { PaymentInvoiceData } from '@/lib/types/invoice'
import { getCoordsFromATag } from '@/lib/utils/coords'
import { getStatusMessaging, getStatusStyles } from '@/lib/utils/orderUtils'
import { usePrivateAuctionClaimForOrder } from '@/queries/auctions'
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
import { MessageSquare, Package, Receipt, Truck, CreditCard } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { OrderActions } from './OrderActions'
import { PrivateOrderDetailsCard } from './PrivateOrderDetailsCard'
import { TimelineEventCard } from '@ui/components/TimelineEventCard'
import { copyToClipboard } from '@/lib/utils'
import { OrderBuyerContactCard, OrderDetailHeader, OrderShippingCard, PrivateAuctionClaimCard } from '@ui/components/OrderDetailSections'

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
	TrackingInfoDisplay,
	V4VRecipientsCard,
} from './detail'
import { UserCard } from '@/components/UserCard'

interface OrderDetailComponentProps {
	order: OrderWithRelatedEvents
}

function privateAuctionClaimUnavailableMessage(status?: string, reason?: string): string {
	if (status === 'unavailable' && reason === 'no_signer') {
		return 'Private auction claim details unavailable until the seller signing session is connected.'
	}
	if (status === 'unavailable' && reason === 'not_seller') {
		return 'Private auction claim details are only available to the auction seller.'
	}
	if (status === 'unavailable' && reason === 'relay_error') {
		return 'Private auction claim details could not be loaded from the relay — this is usually temporary; retry in a moment.'
	}
	return 'Private auction claim details are not available from the encrypted claim path yet.'
}

export function OrderDetailComponent({ order }: OrderDetailComponentProps) {
	const { user } = useStore(authStore)
	const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
	const [selectedInvoiceIndex, setSelectedInvoiceIndex] = useState(0)
	const [dialogInvoices, setDialogInvoices] = useState<PaymentInvoiceData[]>([])

	if (!order) {
		return <OrderMissingView />
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
	const auctionClaimFields = getAuctionClaimPublicMarkerFields({ pubkey: orderEvent.pubkey, tags: orderEvent.tags })
	const privateAuctionClaimQuery = usePrivateAuctionClaimForOrder(orderEvent, isOrderSeller && !!auctionClaimFields)
	const privateAuctionClaimResult = privateAuctionClaimQuery.data
	const privateAuctionClaimPayload = privateAuctionClaimResult?.status === 'found' ? privateAuctionClaimResult.claim.payload : null

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
		return <OrderNotFoundView />
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
		<OrderDetailLayoutView
			dialogs={
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
			}
		>
			<OrderDetailHeader
				title={headerTitle}
				subText={headerSubText}
				totalSats={totalAmount}
				createdAt={orderEvent.created_at}
				status={{
					label: statusLabel,
					iconName,
					headerBgColor,
					badgeBgColor: statusBadgeBgColor,
					explanation: statusExplanation,
				}}
				actions={<OrderActions order={order} userPubkey={user?.pubkey || ''} />}
			/>

			<OrderBuyerCardView userCard={<UserCard pubkey={buyerPubkey} size="md" subtitle="nip-05" />} />

			{canViewLegacyBuyerContact && deliveryContact && <OrderBuyerContactCard deliveryContact={deliveryContact} />}

			{isOrderSeller && auctionClaimFields && (
				<PrivateAuctionClaimCard
					isLoading={privateAuctionClaimQuery.isLoading}
					claim={privateAuctionClaimPayload}
					unavailableMessage={privateAuctionClaimUnavailableMessage(
						privateAuctionClaimResult?.status,
						privateAuctionClaimResult?.status === 'unavailable' ? privateAuctionClaimResult.reason : undefined,
					)}
				/>
			)}
			<PrivateOrderDetailsCard order={order} currentUserPubkey={user?.pubkey} showUnavailable={shouldShowPrivateDetailsUnavailable} />

			<OrderProductsCardView
				items={products.map((product) => {
					const lookupId = getProductId(product) || product.id
					return {
						id: product.id,
						product: <ProductCard product={product} />,
						quantity: quantityMap.get(lookupId) || quantityMap.get(product.id) || 1,
					}
				})}
			/>

			{(shippingInfo || shippingAddress) && (
				<OrderShippingCard
					mode={isPickupService ? 'pickup' : isDigitalService ? 'digital' : 'shipping'}
					shippingInfo={shippingInfo}
					pickupAddress={pickupAddress}
					deliveryAddress={shippingAddress ? <DeliveryAddressDisplay shippingAddress={shippingAddress} /> : undefined}
					tracking={
						<TrackingInfoDisplay
							trackingNumber={order.latestShipping?.tags.find((tag) => tag[0] === 'tracking')?.[1]}
							carrier={order.latestShipping?.tags.find((tag) => tag[0] === 'carrier')?.[1]}
							shippingStatus={order.latestShipping?.tags.find((tag) => tag[0] === 'status')?.[1]}
						/>
					}
				/>
			)}

			{totalInvoices > 0 ? (
				<OrderPaymentDetailsCardView
					totalInvoices={totalInvoices}
					summary={<PaymentSummary enrichedInvoices={enrichedInvoices} />}
					banner={
						isBuyer && incompleteInvoices.length > 0 ? (
							<IncompleteInvoicesBanner
								count={incompleteInvoices.length}
								onRefresh={() => {
									toast.info('Refreshing payment status for all incomplete invoices...')
								}}
							/>
						) : undefined
					}
					progress={<PaymentProgressBar paidCount={paidInvoices.length} totalCount={totalInvoices} progressPercent={paymentProgress} />}
					invoices={enrichedInvoices.map((invoice, index) => (
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
					footer={sellerV4VShares.length > 0 ? <V4VRecipientsCard shares={sellerV4VShares} /> : undefined}
				/>
			) : (
				<NoPaymentRequestsCard isBuyer={isBuyer} />
			)}

			{allEvents.length > 0 && (
				<OrderTimelineView>
					{allEvents.map(({ event, type, title, icon }, index) => (
						<TimelineEventCard
							key={event.id}
							event={event}
							type={type}
							title={title}
							icon={icon}
							timelineIndex={allEvents.length - index}
							onCopyPreimage={(preimage) => copyToClipboard(preimage)}
						/>
					))}
				</OrderTimelineView>
			)}
		</OrderDetailLayoutView>
	)
}
