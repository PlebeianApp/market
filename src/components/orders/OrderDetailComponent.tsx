import { ProductCard } from '@/components/ProductCard'
import { PaymentDialog } from '@/components/checkout/PaymentDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuctionClaimPublicMarkerFields, type PrivateAuctionClaimPayload } from '@/lib/auctions/privateAuctionClaimMessage'
import { authStore } from '@/lib/stores/auth'
import type { PaymentInvoiceData } from '@/lib/types/invoice'
import { cn } from '@/lib/utils'
import { getCoordsFromATag, isValidATag } from '@/lib/utils/coords'
import { getStatusMessaging, getStatusStyles } from '@/lib/utils/orderUtils'
import { auctionByATagQueryOptions, usePrivateAuctionClaimForOrder } from '@/queries/auctions'
import { getAuctionCoordinatesFromOrder, getOrderStatus, type OrderWithRelatedEvents } from '@/queries/orders'
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
import { useEffect, useMemo, useState } from 'react'
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
import { AuctionCard } from '@/components/AuctionCard'
import { UserCard } from '@/components/UserCard'
import {
	useAuctionBids,
	useAuctionSettlements,
	useAuctionPathReleases,
	useAuctionVerdicts,
	useAuctionClaimOrders,
	getAuctionAuditors,
	getAuctionTitle,
} from '@/queries/auctions'
import { findBidderRecord } from '@/lib/auction/bidderRecords'
import type { ParsedBidEvent, ParsedPathReleaseEvent, ParsedSettlementEvent, ParsedValidatorVerdictEvent } from '@/lib/auction/events'
import { getSettlementDescriptor, type GetSettlementDescriptorInput, type SettlementDescriptor } from '@/lib/auction/settlementDescriptor'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent, parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { describeOrderSettlementStatus, type OrderSettlementDisplayState } from './orderSettlementStatusView'

interface OrderDetailComponentProps {
	order: OrderWithRelatedEvents
}

function formatPrivateAuctionClaimAddress(payload: PrivateAuctionClaimPayload): string {
	const { shippingAddress } = payload
	return [
		shippingAddress.name,
		shippingAddress.firstLineOfAddress,
		shippingAddress.additionalInformation,
		[shippingAddress.city, shippingAddress.zipPostcode].filter(Boolean).join(' '),
		shippingAddress.country,
	]
		.filter(Boolean)
		.join('\n')
}

function privateAuctionClaimUnavailableMessage(status?: string, reason?: string): string {
	if (status === 'unavailable' && reason === 'no_signer') {
		return 'Private auction claim details unavailable until the seller signing session is connected.'
	}
	if (status === 'unavailable' && reason === 'not_seller') {
		return 'Private auction claim details are only available to the auction seller.'
	}
	return 'Private auction claim details are not available from the encrypted claim path yet.'
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

// --- Auction Settlement Status Display (validated settlement descriptor) ---
//
// Every state shown here is derived from `getSettlementDescriptor()`
// (ADR-0003/ADR-0004), which validates bids against verdict quorum, path
// releases against the bid lock, and settlement completeness before
// producing a descriptor. Raw `settlements[0]` / path-release boolean
// pairs are never treated as settlement state — relay data is untrusted.
const SETTLEMENT_STATE_STYLE: Record<OrderSettlementDisplayState, { badge: string; text: string }> = {
	'Awaiting Settlement': { badge: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-900' },
	'Path Release Observed': { badge: 'bg-blue-50 border-blue-200', text: 'text-blue-900' },
	'Settlement Event Observed': { badge: 'bg-purple-50 border-purple-200', text: 'text-purple-900' },
	Settled: { badge: 'bg-green-50 border-green-200', text: 'text-green-900' },
	'Reserve Not Met': { badge: 'bg-red-50 border-red-200', text: 'text-red-900' },
	Cancelled: { badge: 'bg-gray-50 border-gray-200', text: 'text-gray-900' },
	'Validating…': { badge: 'bg-amber-50 border-amber-200', text: 'text-amber-900' },
}

const SETTLEMENT_STATE_ICON: Record<OrderSettlementDisplayState, React.ReactNode> = {
	'Awaiting Settlement': <Clock className="w-5 h-5 text-yellow-600" />,
	'Path Release Observed': <ArrowRightLeft className="w-5 h-5 text-blue-600" />,
	'Settlement Event Observed': <CheckCircle className="w-5 h-5 text-purple-600" />,
	Settled: <CheckCircle className="w-5 h-5 text-green-600" />,
	'Reserve Not Met': <AlertTriangle className="w-5 h-5 text-red-600" />,
	Cancelled: <Ban className="w-5 h-5 text-gray-600" />,
	'Validating…': <AlertTriangle className="w-5 h-5 text-amber-600" />,
}

const VERIFIED_BADGE_TEXT: Record<SettlementDescriptor['verifiedBadge'], string | null> = {
	none: null,
	settlement: 'Verified · Settlement confirmed',
	'settlement-pending-redemption': 'Settlement accepted · Awaiting redemption',
	'path-release': 'Verified · Path release confirmed',
	verifying: 'Verifying…',
}

function AuctionSettlementStatus({ descriptor, isValidating }: { descriptor: SettlementDescriptor | null; isValidating: boolean }) {
	const displayState = isValidating ? 'Validating…' : describeOrderSettlementStatus(descriptor)
	const style = SETTLEMENT_STATE_STYLE[displayState]
	const description = isValidating
		? 'Validating the auction settlement against its path release and bid chain before showing a status.'
		: (descriptor?.message ?? 'Waiting for the auction to end and the settlement flow to start.')
	const evidenceText = descriptor ? VERIFIED_BADGE_TEXT[descriptor.verifiedBadge] : null

	return (
		<Card>
			<CardHeader className="p-4">
				<div className={`flex items-center gap-3 p-3 rounded-lg border ${style.badge}`}>
					{SETTLEMENT_STATE_ICON[displayState]}
					<div>
						<h3 className={`font-semibold ${style.text}`} data-testid="auction-settlement-status">
							{displayState}
						</h3>
						<p className={`text-sm mt-1 ${style.text} opacity-80`}>{description}</p>
					</div>
				</div>
			</CardHeader>
			{descriptor && (descriptor.bidAmount > 0 || evidenceText) && (
				<CardContent className="px-4 pb-4 pt-0">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
						{descriptor.bidAmount > 0 && (
							<div className="flex justify-between items-center bg-gray-50 p-2 rounded">
								<span className="text-muted-foreground font-medium">Winning Bid:</span>
								<span className="font-bold">{descriptor.bidAmount.toLocaleString()} sats</span>
							</div>
						)}
						{evidenceText && (
							<div className="flex justify-between items-center bg-gray-50 p-2 rounded">
								<span className="text-muted-foreground font-medium">Evidence:</span>
								<span className={descriptor.verifiedBadge === 'verifying' ? 'text-amber-700 font-medium' : 'text-green-700 font-medium'}>
									{evidenceText}
								</span>
							</div>
						)}
					</div>
				</CardContent>
			)}
		</Card>
	)
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
	const auctionCoordinates = getAuctionCoordinatesFromOrder(order)
	const isAuctionOrder = !!auctionCoordinates
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

	// Fetch auction-related data if this is an auction order
	const auctionCoords = isValidATag(auctionCoordinates || '') ? getCoordsFromATag(auctionCoordinates || '') : null

	const { data: auctionBids = [] } = useAuctionBids('', 500, auctionCoordinates || '')
	const { data: auctionSettlements = [] } = useAuctionSettlements('', 100, auctionCoordinates || '')
	const { data: auctionPathReleases = [] } = useAuctionPathReleases('', 200, auctionCoordinates || '')
	const {
		data: auctionData,
		isLoading: auctionLoading,
		isError: auctionError,
	} = useQuery({
		...auctionByATagQueryOptions(auctionCoords?.pubkey ?? '', auctionCoords?.identifier ?? ''),
		enabled: !!auctionCoords?.pubkey && !!auctionCoords.identifier,
	})

	// --- Validated settlement status (ADR-0003 / ADR-0004) ---
	// Relay-sourced bids, path releases, and settlements are untrusted. The
	// settlement card never derives status from raw `settlements[0]` or bare
	// path-release presence; everything flows through getSettlementDescriptor(),
	// which validates bid quorum, path-release/bid-chain integrity, and
	// settlement completeness first.
	const { data: auctionVerdicts = [] } = useAuctionVerdicts(
		auctionData?.id ?? '',
		500,
		auctionCoordinates || '',
		isAuctionOrder ? getAuctionAuditors(auctionData ?? null) : [],
	)
	const { data: auctionClaimOrders = [] } = useAuctionClaimOrders(auctionCoordinates || '')

	const parsedAuctionForSettlement = useMemo(() => {
		if (!auctionData) return null
		const result = parseAuctionEvent(auctionData.rawEvent())
		return result.ok ? result.value : null
	}, [auctionData])

	const parsedBidsForSettlement = useMemo(
		() =>
			auctionBids
				.map((b) => parseBidEvent(b.rawEvent()))
				.filter((r): r is { ok: true; value: ParsedBidEvent } => r.ok)
				.map((r) => r.value),
		[auctionBids],
	)

	const parsedVerdictsForSettlement = useMemo(
		() =>
			auctionVerdicts
				.map((e) =>
					parseValidatorVerdictEvent(
						e as unknown as { id: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number },
					),
				)
				.filter((r): r is { ok: true; value: ParsedValidatorVerdictEvent } => r.ok)
				.map((r) => r.value),
		[auctionVerdicts],
	)

	const parsedSettlementsForSettlement = useMemo(
		() =>
			auctionSettlements
				.map((s) => parseSettlementEvent(s.rawEvent()))
				.filter((r): r is { ok: true; value: ParsedSettlementEvent } => r.ok)
				.map((r) => r.value),
		[auctionSettlements],
	)

	const parsedPathReleasesForSettlement = useMemo(
		() =>
			auctionPathReleases
				.map((pr) => parsePathReleaseEvent(pr.rawEvent()))
				.filter((r): r is { ok: true; value: ParsedPathReleaseEvent } => r.ok)
				.map((r) => r.value),
		[auctionPathReleases],
	)

	const [orderSettlementDescriptor, setOrderSettlementDescriptor] = useState<SettlementDescriptor | null>(null)
	const [descriptorFailed, setDescriptorFailed] = useState(false)
	const [descriptorReady, setDescriptorReady] = useState(false)

	const descriptorInput = useMemo<GetSettlementDescriptorInput | null>(() => {
		if (!parsedAuctionForSettlement) return null
		const myBids = user?.pubkey ? parsedBidsForSettlement.filter((b) => b.bidderPubkey === user.pubkey) : []
		const myTopBidEvent = myBids.length
			? myBids.reduce((best, bid) => {
					if (bid.amount > best.amount) return bid
					if (bid.amount < best.amount) return best
					return bid.createdAt < best.createdAt ? bid : best
				})
			: null
		return {
			auction: parsedAuctionForSettlement,
			bids: parsedBidsForSettlement,
			verdicts: parsedVerdictsForSettlement,
			settlements: parsedSettlementsForSettlement,
			pathReleases: parsedPathReleasesForSettlement,
			claimOrders: auctionClaimOrders.map((o) => o.rawEvent()),
			currentUserPubkey: user?.pubkey || undefined,
			myTopBidEvent,
			hasBidderRecord: !!(myTopBidEvent && findBidderRecord(myTopBidEvent.id)),
			hasPlacedBid: myBids.length > 0,
			now: Math.floor(Date.now() / 1000),
		}
	}, [
		parsedAuctionForSettlement,
		parsedBidsForSettlement,
		parsedVerdictsForSettlement,
		parsedSettlementsForSettlement,
		parsedPathReleasesForSettlement,
		auctionClaimOrders,
		user?.pubkey,
	])

	useEffect(() => {
		if (!descriptorInput) {
			setDescriptorReady(false)
			return
		}
		let cancelled = false
		getSettlementDescriptor(descriptorInput)
			.then((d) => {
				if (cancelled) return
				setOrderSettlementDescriptor(d)
				setDescriptorFailed(false)
				setDescriptorReady(true)
			})
			.catch((err) => {
				console.error('getSettlementDescriptor failed:', err)
				if (!cancelled) setDescriptorFailed(true)
			})
		return () => {
			cancelled = true
		}
	}, [descriptorInput])

	// Without the auction event, or with a failed parse/descriptor run, we
	// cannot claim any validated status — surface 'Validating…' instead of a
	// potentially wrong one.
	const settlementValidating =
		isAuctionOrder && (auctionLoading || auctionError || !parsedAuctionForSettlement || descriptorFailed || !descriptorReady)

	const headerTitle = isAuctionOrder && auctionData ? `Auction: ${getAuctionTitle(auctionData)}` : `Products (${products.length} unique)`
	const headerSubText = isAuctionOrder ? undefined : `${orderItems.reduce((total, item) => total + item.quantity, 0)} items`

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
									<div className={`p-2 rounded-lg ${isAuctionOrder ? 'bg-purple-100' : 'bg-blue-100'}`}>
										{isAuctionOrder ? <Package className="w-5 h-5 text-purple-700" /> : <Package className="w-5 h-5 text-blue-700" />}
									</div>
									<div>
										<p className="text-sm font-medium text-gray-900">{isAuctionOrder ? 'Auction Item' : 'Products'}</p>
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

				{isOrderSeller && auctionClaimFields && (
					<Card>
						<CardHeader>
							<CardTitle>Private Auction Claim Details</CardTitle>
						</CardHeader>
						<CardContent>
							{privateAuctionClaimQuery.isLoading && <p className="text-sm text-gray-600">Loading private auction claim details...</p>}

							{!privateAuctionClaimQuery.isLoading && privateAuctionClaimPayload && (
								<div className="space-y-4">
									<div>
										<p className="text-sm font-semibold text-gray-900">Private shipping address</p>
										<p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
											{formatPrivateAuctionClaimAddress(privateAuctionClaimPayload)}
										</p>
									</div>

									<div className="grid gap-3 sm:grid-cols-2">
										{privateAuctionClaimPayload.email && (
											<p className="text-sm text-gray-700">
												<strong>Contact email:</strong> {privateAuctionClaimPayload.email}
											</p>
										)}
										{privateAuctionClaimPayload.phone && (
											<p className="text-sm text-gray-700">
												<strong>Contact phone:</strong> {privateAuctionClaimPayload.phone}
											</p>
										)}
									</div>

									{privateAuctionClaimPayload.notes && (
										<div>
											<p className="text-sm font-semibold text-gray-900">Message to seller</p>
											<p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{privateAuctionClaimPayload.notes}</p>
										</div>
									)}
								</div>
							)}

							{!privateAuctionClaimQuery.isLoading && !privateAuctionClaimPayload && (
								<p className="text-sm text-gray-600">
									{privateAuctionClaimUnavailableMessage(
										privateAuctionClaimResult?.status,
										privateAuctionClaimResult?.status === 'unavailable' ? privateAuctionClaimResult.reason : undefined,
									)}
								</p>
							)}
						</CardContent>
					</Card>
				)}
				<PrivateOrderDetailsCard order={order} currentUserPubkey={user?.pubkey} showUnavailable={shouldShowPrivateDetailsUnavailable} />

				{/* Products or Auctions */}
				{(products.length > 0 || (isAuctionOrder && auctionData)) && (
					<Card>
						<CardHeader>
							<CardTitle>{isAuctionOrder ? 'Auction Item' : 'Products'}</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="grid grid-cols-1 gap-4">
								{isAuctionOrder && auctionData ? (
									<div key={auctionData.id} className="p-4 border rounded-lg">
										<AuctionCard auction={auctionData} bids={auctionBids} className="w-full" />
										<div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
											<span className="text-sm text-gray-500">Quantity</span>
											<span className="text-lg font-semibold">1</span>
										</div>
									</div>
								) : (
									products.map((product) => {
										const lookupId = getProductId(product) || product.id
										const quantity = quantityMap.get(lookupId) || quantityMap.get(product.id) || 1
										const isAuction = product.kind === 30408

										return (
											<div key={product.id} className="p-4 border rounded-lg">
												{isAuction ? (
													<div className="space-y-4">
														<AuctionCard auction={product} bids={auctionBids} className="w-full" />
														<div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
															<span className="text-sm text-gray-500">Quantity</span>
															<span className="text-lg font-semibold">{quantity}</span>
														</div>
													</div>
												) : (
													<div>
														<ProductCard product={product} />
														<div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
															<span className="text-sm text-gray-500">Quantity</span>
															<span className="text-lg font-semibold">{quantity}</span>
														</div>
													</div>
												)}
											</div>
										)
									})
								)}
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
								{shippingInfo && <ShippingInfoDisplay shippingInfo={shippingInfo} />}

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
				{/* For Auctions: Show Settlement Status */}
				{isAuctionOrder ? (
					<>
						<AuctionSettlementStatus descriptor={orderSettlementDescriptor} isValidating={settlementValidating} />
					</>
				) : (
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
				)}

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
