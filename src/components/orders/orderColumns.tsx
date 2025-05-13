import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { UserDisplay } from '@/components/orders/UserDisplay'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { formatSats, getBuyerPubkey, getEventDate, getOrderAmount, getOrderId, getOrderStatus, getSellerPubkey } from '@/queries/orders'
import type { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'

// Base columns that are common to all order lists
export const baseOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
  {
    accessorKey: 'orderId',
    header: 'Order ID',
    cell: ({ row }) => {
      const orderId = getOrderId(row.original.order)
      return (
        <Link 
          to="/dashboard/messages/$orderId" 
          params={{ orderId: orderId || 'unknown' }}
          className="font-mono text-xs hover:underline"
        >
          {orderId ? `${orderId.substring(0, 8)}...` : 'Unknown'}
        </Link>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = getOrderStatus(row.original)
      return <OrderStatusBadge status={status} />
    },
  },
  {
    accessorKey: 'date',
    header: 'Date',
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
  }
]

// Columns for purchases (buyer's perspective)
export const purchaseColumns: ColumnDef<OrderWithRelatedEvents>[] = [
  ...baseOrderColumns.slice(0, 1),
  {
    accessorKey: 'seller',
    header: 'Seller',
    cell: ({ row }) => {
      const sellerPubkey = getSellerPubkey(row.original.order)
      return <UserDisplay pubkey={sellerPubkey} />
    },
  },
  ...baseOrderColumns.slice(1)
]

// Columns for sales (seller's perspective)
export const salesColumns: ColumnDef<OrderWithRelatedEvents>[] = [
  ...baseOrderColumns.slice(0, 1),
  {
    accessorKey: 'buyer',
    header: 'Buyer',
    cell: ({ row }) => {
      const buyerPubkey = getBuyerPubkey(row.original.order)
      return <UserDisplay pubkey={buyerPubkey} />
    },
  },
  ...baseOrderColumns.slice(1)
]

// Full columns (showing both buyer and seller)
export const fullOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
  ...baseOrderColumns.slice(0, 1),
  {
    accessorKey: 'seller',
    header: 'Seller',
    cell: ({ row }) => {
      const sellerPubkey = getSellerPubkey(row.original.order)
      return <UserDisplay pubkey={sellerPubkey} />
    },
  },
  {
    accessorKey: 'buyer',
    header: 'Buyer',
    cell: ({ row }) => {
      const buyerPubkey = getBuyerPubkey(row.original.order)
      return <UserDisplay pubkey={buyerPubkey} />
    },
  },
  ...baseOrderColumns.slice(1)
] 