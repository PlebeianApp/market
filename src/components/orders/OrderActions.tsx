import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ORDER_STATUS, SHIPPING_STATUS } from '@/lib/schemas/order'
import { cn } from '@/lib/utils'
import { useUpdateOrderStatusMutation } from '@/publish/orders'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getBuyerPubkey, getOrderStatus, getSellerPubkey } from '@/queries/orders'
import { useUpdateShippingStatusMutation } from '@/queries/shipping'
import { MoreHorizontal, PackageCheck, Truck, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'

interface OrderActionsProps {
	order: OrderWithRelatedEvents
	userPubkey: string
	variant?: 'primary' | 'outline' | 'ghost' | 'link' | 'secondary' | 'destructive'
	className?: string
}

export function OrderActions({ order, userPubkey, variant = 'outline', className = '' }: OrderActionsProps) {
	const [cancelReason, setCancelReason] = useState('')
	const [isCancelOpen, setIsCancelOpen] = useState(false)

	const [trackingNumber, setTrackingNumber] = useState('')
	const [isShippingOpen, setIsShippingOpen] = useState(false)

	const updateOrderStatus = useUpdateOrderStatusMutation()
	const updateShippingStatus = useUpdateShippingStatusMutation()

	const status = getOrderStatus(order)

	const buyerPubkey = getBuyerPubkey(order.order)
	const sellerPubkey = getSellerPubkey(order.order)

	const isBuyer = userPubkey === buyerPubkey
	const isSeller = userPubkey === sellerPubkey

	// Determine which actions are allowed based on role and current status
	const canCancel =
		(status === ORDER_STATUS.PENDING || status === ORDER_STATUS.CONFIRMED) && (isBuyer || (isSeller && status === ORDER_STATUS.PENDING))

	// Check if the order has been shipped
	const hasBeenShipped = order.shippingUpdates.some((update) => update.tags.find((tag) => tag[0] === 'status')?.[1] === 'shipped')

	// Seller actions
	const canConfirm = isSeller && status === ORDER_STATUS.PENDING
	const canProcess = isSeller && status === ORDER_STATUS.CONFIRMED
	const canShip = isSeller && status === ORDER_STATUS.PROCESSING && !hasBeenShipped
	const canComplete = isSeller && status === ORDER_STATUS.PROCESSING

	// Buyer actions
	const canReceive = isBuyer && status === ORDER_STATUS.PROCESSING

	const handleStatusUpdate = (newStatus: string, reason?: string, tracking?: string) => {
		if (!order.order.id) {
			toast.error('Order ID not found')
			return
		}

		updateOrderStatus.mutate({
			orderEventId: order.order.id,
			status: newStatus as any,
			reason,
			tracking,
		})
	}

	const handleCancel = () => {
		handleStatusUpdate(ORDER_STATUS.CANCELLED, cancelReason)
		setIsCancelOpen(false)
		setCancelReason('')
	}

	const handleShipped = () => {
		if (!order.order.id) {
			toast.error('Order ID not found')
			return
		}

		// Use a normal status update instead of a shipping update
		// This ensures it's processed the same way as other status changes
		updateOrderStatus.mutate({
			orderEventId: order.order.id,
			status: ORDER_STATUS.PROCESSING, // Keep as processing but with shipping info
			tracking: trackingNumber,
			reason: 'Order has been shipped',
		})

		// Also send a shipping update for record keeping, but don't rely on it for UI updates
		updateShippingStatus.mutate({
			orderEventId: order.order.id,
			status: SHIPPING_STATUS.SHIPPED,
			tracking: trackingNumber,
			reason: 'Order has been shipped',
		})

		setIsShippingOpen(false)
		setTrackingNumber('')
	}

	if (!isBuyer && !isSeller) {
		return null // Don't show actions if user is neither buyer nor seller
	}

	// Get status styles based on the current status
	const getStatusStyles = () => {
		// Check if the order has been shipped (has shipping updates with shipped status)
		const hasBeenShipped = order.shippingUpdates.some((update) => update.tags.find((tag) => tag[0] === 'status')?.[1] === 'shipped')

		// Special case for processing + shipped
		if (status === ORDER_STATUS.PROCESSING && hasBeenShipped) {
			return {
				bgColor: 'bg-orange-100',
				textColor: 'text-orange-800',
				icon: <Truck className="h-4 w-4 text-orange-500" />,
				label: 'Shipped', // Override display label
			}
		}

		switch (status) {
			case ORDER_STATUS.CONFIRMED:
				return {
					bgColor: 'bg-blue-100',
					textColor: 'text-blue-800',
					icon: <div className="i-tick h-4 w-4 text-blue-500" />,
					label: 'Confirmed',
				}
			case ORDER_STATUS.PROCESSING:
				return {
					bgColor: 'bg-yellow-100',
					textColor: 'text-yellow-800',
					icon: <div className="i-clock h-4 w-4 text-yellow-500" />,
					label: 'Processing',
				}
			case ORDER_STATUS.COMPLETED:
				return {
					bgColor: 'bg-green-100',
					textColor: 'text-green-800',
					icon: <div className="i-tick h-4 w-4 text-green-500" />,
					label: 'Completed',
				}
			case ORDER_STATUS.CANCELLED:
				return {
					bgColor: 'bg-red-100',
					textColor: 'text-red-800',
					icon: <div className="i-cross h-4 w-4 text-red-500" />,
					label: 'Cancelled',
				}
			case ORDER_STATUS.PENDING:
			default:
				return {
					bgColor: 'bg-gray-100',
					textColor: 'text-gray-800',
					icon: <div className="i-clock h-4 w-4 text-gray-500" />,
					label: 'Pending',
				}
		}
	}

	const { bgColor, textColor, icon, label } = getStatusStyles()

	return (
		<div className="flex items-center justify-end">
			<div className={cn('flex items-center justify-center gap-2 rounded-md px-3 py-1 w-32', bgColor, textColor)}>
				{icon}
				<span className="font-medium capitalize">{label}</span>
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="sm" className="ml-2 h-8 w-8 p-0">
						<span className="sr-only">Open menu</span>
						<MoreHorizontal className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuLabel>Actions</DropdownMenuLabel>
					<DropdownMenuSeparator />

					{/* Buyer Actions */}
					{isBuyer && canReceive && (
						<DropdownMenuItem onClick={() => handleStatusUpdate(ORDER_STATUS.COMPLETED)}>
							<div className="i-tick mr-2 h-4 w-4" />
							Confirm Receipt
						</DropdownMenuItem>
					)}

					{/* Seller Actions */}
					{isSeller && canConfirm && (
						<DropdownMenuItem onClick={() => handleStatusUpdate(ORDER_STATUS.CONFIRMED)}>
							<div className="i-tick mr-2 h-4 w-4" />
							Confirm Order
						</DropdownMenuItem>
					)}

					{isSeller && canProcess && (
						<DropdownMenuItem onClick={() => handleStatusUpdate(ORDER_STATUS.PROCESSING)}>
							<ShoppingBag className="mr-2 h-4 w-4" />
							Start Processing
						</DropdownMenuItem>
					)}

					{/* Shipping action - open dialog */}
					{isSeller && canShip && (
						<DropdownMenuItem onClick={() => setIsShippingOpen(true)}>
							<Truck className="mr-2 h-4 w-4" />
							Mark as Shipped
						</DropdownMenuItem>
					)}

					{isSeller && canComplete && (
						<DropdownMenuItem onClick={() => handleStatusUpdate(ORDER_STATUS.COMPLETED)}>
							<PackageCheck className="mr-2 h-4 w-4" />
							{hasBeenShipped ? 'Mark as Delivered' : 'Complete Order'}
						</DropdownMenuItem>
					)}

					{/* Cancel action - open dialog */}
					{canCancel && (
						<DropdownMenuItem className="text-red-600" onClick={() => setIsCancelOpen(true)}>
							<div className="i-cross mr-2 h-4 w-4" />
							Cancel Order
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Shipping dialog */}
			<Dialog open={isShippingOpen} onOpenChange={setIsShippingOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Shipping Information</DialogTitle>
						<DialogDescription className="break-words">Add tracking information for this shipment</DialogDescription>
					</DialogHeader>

					<div className="space-y-2 py-4">
						<Label htmlFor="tracking">Tracking Number (Optional)</Label>
						<Input
							id="tracking"
							value={trackingNumber}
							onChange={(e) => setTrackingNumber(e.target.value)}
							placeholder="Enter tracking number"
						/>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setIsShippingOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleShipped}>Mark as Shipped</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Cancel dialog */}
			<Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Cancel Order</DialogTitle>
						<DialogDescription>Are you sure you want to cancel this order? This action cannot be undone.</DialogDescription>
					</DialogHeader>
					<Textarea
						value={cancelReason}
						onChange={(e) => setCancelReason(e.target.value)}
						placeholder="Reason for cancellation (optional)"
						className="min-h-[100px]"
					/>
					<DialogFooter className="mt-4">
						<Button variant="outline" onClick={() => setIsCancelOpen(false)}>
							Go Back
						</Button>
						<Button variant="destructive" onClick={handleCancel}>
							Cancel Order
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
