import { ndkActions } from '@/lib/stores/ndk'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getOrderRecipientPubkey, getOrderReference } from '@sdk/commerce/orders'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { OrderAmountText, OrderDateText, OrderReferenceBadge } from '@ui/components/OrderListCells'
import { OrderActions } from './OrderActions'
import { UserCard } from '../UserCard'

// Base columns that are common to all order lists
export const baseOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	{
		accessorKey: 'orderId',
		header: 'Order ID',
		cell: ({ row }) => (
			<OrderReferenceBadge
				order={row.original.order}
				renderLink={(orderId, children) => (
					<Link to="/dashboard/orders/$orderId" params={{ orderId }} className="font-mono text-xs hover:underline">
						{children}
					</Link>
				)}
			/>
		),
	},
	{
		accessorKey: 'date',
		header: 'Time & Date',
		cell: ({ row }) => <OrderDateText order={row.original.order} />,
	},
	{
		accessorKey: 'amount',
		header: () => <div className="text-right">Amount</div>,
		cell: ({ row }) => <OrderAmountText order={row.original.order} />,
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

const sellerColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'seller',
	header: 'Seller',
	cell: ({ row }) => <UserCard pubkey={getOrderRecipientPubkey(row.original.order) || ''} size="xs" onPress="none" />,
}

const buyerColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'buyer',
	header: 'Buyer',
	cell: ({ row }) => <UserCard pubkey={row.original.order.pubkey || ''} size="xs" onPress="none" />,
}

// Columns for purchases (buyer's perspective)
export const purchaseColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	baseOrderColumns[0], // Order ID
	sellerColumn,
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	purchaseActionsColumn, // Actions
]

// Columns for sales (seller's perspective)
export const salesColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	{
		...baseOrderColumns[0], // Order ID
		accessorFn: (row) => getOrderReference(row.order) ?? undefined,
	},
	{
		...buyerColumn,
		accessorFn: (row) => row.order.pubkey,
	},
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	salesActionsColumn, // Actions
]

// Full columns (showing both buyer and seller)
export const fullOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	baseOrderColumns[0], // Order ID
	sellerColumn,
	buyerColumn,
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	{
		...salesActionsColumn,
		header: 'Actions',
	},
]
