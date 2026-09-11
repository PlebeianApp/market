import { ndkActions } from '@/lib/stores/ndk'
import { cn } from '@/lib/utils'
import { getCoordsFromATag } from '@/lib/utils/coords'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import {
	formatSats,
	getAuctionCoordinatesFromOrder,
	getBuyerPubkey,
	getEventDate,
	getOrderAmount,
	getOrderId,
	getSellerPubkey,
	isAuctionOrder,
} from '@/queries/orders'
import { auctionByATagQueryOptions, getAuctionTitle } from '@/queries/auctions'
import { getProductTitle, isEventId, productSmartQueryOptions } from '@/queries/products'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { OrderActions } from './OrderActions'
import { getOrderItems } from './orderDetailHelpers'
import { UserCard } from '../UserCard'

// Base columns that are common to all order lists
export const baseOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	{
		accessorKey: 'orderId',
		header: 'Order ID',
		cell: ({ row }) => {
			const orderId = getOrderId(row.original.order)
			return (
				<div className="border border-gray-300 rounded px-3 py-1 inline-block">
					<Link to="/dashboard/orders/$orderId" params={{ orderId: orderId || 'unknown' }} className="font-mono text-xs hover:underline">
						{orderId ? `${orderId.substring(0, 8)}...` : 'Unknown'}
					</Link>
				</div>
			)
		},
	},
	{
		accessorKey: 'date',
		header: 'Time & Date',
		cell: ({ row }) => {
			const date = getEventDate(row.original.order)
			return <span className="text-xs text-muted-foreground">{date}</span>
		},
	},
	{
		accessorKey: 'amount',
		header: () => <div className="text-right">Amount</div>,
		cell: ({ row }) => {
			const amount = getOrderAmount(row.original.order)
			return <div className="text-right font-medium">{formatSats(amount)}</div>
		},
	},
]

// Type column: Product vs Auction chip. The distinction comes from the
// PR's own `isAuctionOrder` helper (kind-30408 'a' tag on the order event).
const orderTypeColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'type',
	header: 'Type',
	cell: ({ row }) => {
		const isAuction = isAuctionOrder(row.original)
		return (
			<span
				data-testid="order-type"
				className={cn(
					'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
					isAuction ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-blue-200 bg-blue-50 text-blue-700',
				)}
			>
				{isAuction ? 'Auction' : 'Product'}
			</span>
		)
	},
}

/**
 * Item column: resolves the ordered item's title through the existing query
 * layer — auctions via the kind-30408 coordinate ('a' tag), products via the
 * smart (event-id or d-tag) product query. Falls back to the coordinate's
 * d-tag string when the event cannot be resolved; malformed tags never crash.
 */
function OrderItemTitleCell({ order }: { order: OrderWithRelatedEvents }) {
	const orderEvent = order.order
	const orderSellerPubkey = getSellerPubkey(orderEvent)

	const auctionCoordinates = getAuctionCoordinatesFromOrder(order)
	const isAuction = !!auctionCoordinates

	const auctionCoords = useMemo(() => {
		if (!auctionCoordinates) return null
		try {
			return getCoordsFromATag(auctionCoordinates)
		} catch {
			return null
		}
	}, [auctionCoordinates])

	const productLookup = useMemo(() => {
		if (isAuction) return null
		const firstItem = getOrderItems(orderEvent)[0]?.productRef ?? ''
		if (!firstItem) return null
		if (firstItem.includes(':')) {
			try {
				const parsed = getCoordsFromATag(firstItem)
				if (parsed.kind === 30402) return { id: parsed.identifier, sellerPubkey: parsed.pubkey }
				return null
			} catch {
				return null
			}
		}
		// Legacy item refs may be bare event ids — fetchProductSmart handles them.
		return { id: firstItem, sellerPubkey: undefined }
	}, [isAuction, orderEvent])

	const { data: auctionEvent } = useQuery({
		...auctionByATagQueryOptions(auctionCoords?.pubkey ?? '', auctionCoords?.identifier ?? ''),
		enabled: isAuction && !!auctionCoords?.pubkey && !!auctionCoords.identifier,
	})

	const { data: productEvent } = useQuery({
		...productSmartQueryOptions(productLookup?.id ?? '', productLookup?.sellerPubkey ?? orderSellerPubkey),
		enabled: !isAuction && !!productLookup && (isEventId(productLookup.id) || !!productLookup.sellerPubkey),
	})

	// Fallback: the coordinate d-tag (or raw item ref) — never an empty title.
	const fallbackTitle = isAuction ? (auctionCoords?.identifier ?? '') : (productLookup?.id ?? '')

	const title = isAuction
		? auctionEvent
			? getAuctionTitle(auctionEvent)
			: fallbackTitle
		: productEvent
			? getProductTitle(productEvent) || fallbackTitle
			: fallbackTitle

	return (
		<span
			data-testid="order-item-title"
			title={title}
			className="inline-block max-w-[220px] truncate align-middle text-xs text-muted-foreground"
		>
			{title || 'Unknown item'}
		</span>
	)
}

const orderItemColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'item',
	header: 'Item',
	cell: ({ row }) => <OrderItemTitleCell order={row.original} />,
}

// Actions column for purchases (buyer's perspective)
const purchaseActionsColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'actions',
	header: 'Actions',
	cell: ({ row }) => {
		const ndk = ndkActions.getNDK()
		const currentUserPubkey = ndk?.activeUser?.pubkey

		if (!currentUserPubkey) return null

		return (
			<div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-2">
				<OrderActions order={row.original} userPubkey={currentUserPubkey} />
			</div>
		)
	},
}

// Actions column for sales (seller's perspective)
const salesActionsColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'actions',
	header: 'Actions',
	cell: ({ row }) => {
		const ndk = ndkActions.getNDK()
		const currentUserPubkey = ndk?.activeUser?.pubkey

		if (!currentUserPubkey) return null

		return (
			<div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-2">
				<OrderActions order={row.original} userPubkey={currentUserPubkey} />
			</div>
		)
	},
}

// Columns for purchases (buyer's perspective)
export const purchaseColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	baseOrderColumns[0], // Order ID
	orderTypeColumn, // Type (Product/Auction)
	orderItemColumn, // Item title
	{
		accessorKey: 'seller',
		header: 'Seller',
		cell: ({ row }) => {
			const sellerPubkey = getSellerPubkey(row.original.order)
			return <UserCard pubkey={sellerPubkey || ''} size="xs" onPress="none" />
		},
	},
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	purchaseActionsColumn, // Actions
]

// Columns for sales (seller's perspective)
export const salesColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	{
		...baseOrderColumns[0], // Order ID
		accessorFn: (row) => getOrderId(row.order),
	},
	orderTypeColumn, // Type (Product/Auction)
	orderItemColumn, // Item title
	{
		accessorKey: 'buyer',
		header: 'Buyer',
		cell: ({ row }) => {
			const buyerPubkey = getBuyerPubkey(row.original.order)
			return <UserCard pubkey={buyerPubkey || ''} size="xs" onPress="none" />
		},
		accessorFn: (row) => getBuyerPubkey(row.order),
	},
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	salesActionsColumn, // Actions
]

// Full columns (showing both buyer and seller)
export const fullOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	baseOrderColumns[0], // Order ID
	orderTypeColumn, // Type (Product/Auction)
	orderItemColumn, // Item title
	{
		accessorKey: 'seller',
		header: 'Seller',
		cell: ({ row }) => {
			const sellerPubkey = getSellerPubkey(row.original.order)
			return <UserCard pubkey={sellerPubkey || ''} size="xs" onPress="none" />
		},
	},
	{
		accessorKey: 'buyer',
		header: 'Buyer',
		cell: ({ row }) => {
			const buyerPubkey = getBuyerPubkey(row.original.order)
			return <UserCard pubkey={buyerPubkey || ''} size="xs" onPress="none" />
		},
	},
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	{
		...salesActionsColumn,
		header: 'Actions',
	},
]
