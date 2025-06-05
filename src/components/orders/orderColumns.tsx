import { ndkActions } from '@/lib/stores/ndk'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { formatSats, getBuyerPubkey, getEventDate, getOrderAmount, getOrderId, getSellerPubkey } from '@/queries/orders'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { UserWithAvatar } from '../UserWithAvatar'
import { OrderActions } from './OrderActions'

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
						Order ID: {orderId ? `${orderId.substring(0, 8)}...` : 'Unknown'}
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

// Actions column for purchases (buyer's perspective)
const purchaseActionsColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'actions',
	header: 'Actions',
	cell: ({ row }) => {
		const ndk = ndkActions.getNDK()
		const currentUserPubkey = ndk?.activeUser?.pubkey

		if (!currentUserPubkey) return null

		return <OrderActions order={row.original} userPubkey={currentUserPubkey} />
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

		return <OrderActions order={row.original} userPubkey={currentUserPubkey} />
	},
}

// Columns for purchases (buyer's perspective)
export const purchaseColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	baseOrderColumns[0], // Order ID
	{
		accessorKey: 'seller',
		header: 'Seller',
		cell: ({ row }) => {
			const sellerPubkey = getSellerPubkey(row.original.order)
			return <UserWithAvatar pubkey={sellerPubkey || ''} showBadge={false} size="sm" disableLink={false} />
		},
	},
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	purchaseActionsColumn, // Actions
]

// Columns for sales (seller's perspective)
export const salesColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	baseOrderColumns[0], // Order ID
	{
		accessorKey: 'buyer',
		header: 'Buyer',
		cell: ({ row }) => {
			const buyerPubkey = getBuyerPubkey(row.original.order)
			return <UserWithAvatar pubkey={buyerPubkey || ''} showBadge={false} size="sm" disableLink={false} />
		},
	},
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	salesActionsColumn, // Actions
]

// Full columns (showing both buyer and seller)
export const fullOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	baseOrderColumns[0], // Order ID
	{
		accessorKey: 'seller',
		header: 'Seller',
		cell: ({ row }) => {
			const sellerPubkey = getSellerPubkey(row.original.order)
			return <UserWithAvatar pubkey={sellerPubkey || ''} showBadge={false} size="sm" disableLink={false} />
		},
	},
	{
		accessorKey: 'buyer',
		header: 'Buyer',
		cell: ({ row }) => {
			const buyerPubkey = getBuyerPubkey(row.original.order)
			return <UserWithAvatar pubkey={buyerPubkey || ''} showBadge={false} size="sm" disableLink={false} />
		},
	},
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
]
