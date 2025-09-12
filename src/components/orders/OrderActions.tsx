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
import { getStatusStyles } from '@/lib/utils/orderUtils'
import { useUpdateOrderStatusMutation } from '@/publish/orders'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getBuyerPubkey, getOrderId, getOrderStatus, getSellerPubkey } from '@/queries/orders'
import { useUpdateShippingStatusMutation } from '@/queries/shipping'
import { MoreHorizontal, PackageCheck, Truck, ShoppingBag, Clock, X, Check } from 'lucide-react'
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
		const orderEventId = getOrderId(order.order)
		if (!orderEventId) {
			toast.error('Order ID not found')
			return
		}

		updateOrderStatus.mutate({
			orderEventId,
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
		const orderEventId = getOrderId(order.order)
		if (!orderEventId) {
			toast.error('Order ID not found')
			return
		}

		// Use a normal status update instead of a shipping update
		// This ensures it's processed the same way as other status changes
		updateOrderStatus.mutate({
			orderEventId,
			status: ORDER_STATUS.PROCESSING, // Keep as processing but with shipping info
			tracking: trackingNumber,
			reason: 'Order has been shipped',
		})

		// Also send a shipping update for record keeping, but don't rely on it for UI updates
		updateShippingStatus.mutate({
			orderEventId,
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

	// Check if there are any available actions
	const hasActions = canCancel || canConfirm || canProcess || canShip || canComplete || canReceive

	const { bgColor, textColor, iconName, label } = getStatusStyles(order)

	const renderIcon = () => {
		switch (iconName) {
			case 'truck':
				return <Truck className="h-4 w-4" />
			case 'tick':
				return <Check className="h-4 w-4" />
			case 'clock':
				return <Clock className="h-4 w-4" />
			case 'cross':
				return <X className="h-4 w-4" />
			default:
				return null
		}
	}

	return (
		<div className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
			<div className={cn('flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1 md:w-32 md:flex-none', bgColor, textColor)}>
				{renderIcon()}
				<span className="font-medium capitalize">{label}</span>
			</div>

			{hasActions && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
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
								<Check className="mr-2 h-4 w-4" />
								Confirm Receipt
							</DropdownMenuItem>
						)}

						{/* Seller Actions */}
						{isSeller && canConfirm && (
							<DropdownMenuItem onClick={() => handleStatusUpdate(ORDER_STATUS.CONFIRMED)}>
								<Check className="mr-2 h-4 w-4" />
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
								<X className="mr-2 h-4 w-4" />
								Cancel Order
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			)}

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
						<Button onClick={handleShipped}>Save</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Cancel dialog */}
			<Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Cancel Order</DialogTitle>
						<DialogDescription className="break-words">
							Are you sure you want to cancel this order? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-2 py-4">
						<Label htmlFor="reason">Reason (Optional)</Label>
						<Textarea
							id="reason"
							value={cancelReason}
							onChange={(e) => setCancelReason(e.target.value)}
							placeholder="Enter reason for cancellation"
						/>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setIsCancelOpen(false)}>
							Back
						</Button>
						<Button variant="destructive" onClick={handleCancel}>
							Confirm Cancellation
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
