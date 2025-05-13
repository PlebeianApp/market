import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { UserDisplay } from '@/components/orders/UserDisplay'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { formatSats, getBuyerPubkey, getEventDate, getOrderAmount, getOrderId, getOrderStatus, getSellerPubkey } from '@/queries/orders'
import type { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { UserWithAvatar } from '../UserWithAvatar'

// Base columns that are common to all order lists
export const baseOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
  {
    accessorKey: 'orderId',
    header: 'Order I.D',
    cell: ({ row }) => {
      const orderId = getOrderId(row.original.order)
      return (
        <div className="border border-gray-300 rounded px-3 py-1 inline-block">
          <Link 
            to="/dashboard/messages/$orderId" 
            params={{ orderId: orderId || 'unknown' }}
            className="font-mono text-xs hover:underline"
          >
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
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = getOrderStatus(row.original)
      return <OrderStatusBadge status={status} />
    },
  }
]

// Columns for purchases (buyer's perspective)
export const purchaseColumns: ColumnDef<OrderWithRelatedEvents>[] = [
  baseOrderColumns[0], // Order ID
  {
    accessorKey: 'seller',
    header: 'Seller',
    cell: ({ row }) => {
      const sellerPubkey = getSellerPubkey(row.original.order)
      return <UserWithAvatar pubkey={sellerPubkey || ''} showBadge={false} size="sm" />
    },
  },
  baseOrderColumns[1], // Date
  baseOrderColumns[2], // Amount
  baseOrderColumns[3], // Status (now at the end)
]

// Columns for sales (seller's perspective)
export const salesColumns: ColumnDef<OrderWithRelatedEvents>[] = [
  baseOrderColumns[0], // Order ID
  {
    accessorKey: 'buyer',
    header: 'Buyer',
    cell: ({ row }) => {
      const buyerPubkey = getBuyerPubkey(row.original.order)
      return <UserWithAvatar pubkey={buyerPubkey || ''} showBadge={false} size="sm" />
    },
  },
  baseOrderColumns[1], // Date
  baseOrderColumns[2], // Amount
  baseOrderColumns[3], // Status (now at the end)
]

// Full columns (showing both buyer and seller)
export const fullOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
  baseOrderColumns[0], // Order ID
  {
    accessorKey: 'seller',
    header: 'Seller',
    cell: ({ row }) => {
      const sellerPubkey = getSellerPubkey(row.original.order)
      return <UserWithAvatar pubkey={sellerPubkey || ''} showBadge={false} size="sm" />
    },
  },
  {
    accessorKey: 'buyer',
    header: 'Buyer',
    cell: ({ row }) => {
      const buyerPubkey = getBuyerPubkey(row.original.order)
      return <UserWithAvatar pubkey={buyerPubkey || ''} showBadge={false} size="sm" />
    },
  },
  baseOrderColumns[1], // Date
  baseOrderColumns[2], // Amount
  baseOrderColumns[3], // Status (now at the end)
] 