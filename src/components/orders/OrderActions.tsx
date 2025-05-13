import { Button } from '@/components/ui/button'
import { getBuyerPubkey, getOrderStatus, getSellerPubkey } from '@/queries/orders'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { ORDER_STATUS } from '@/lib/schemas/order'
import { Check, Clock, MoreHorizontal, PackageCheck, PackageX, ShoppingBag, Truck, X } from 'lucide-react'
import { useUpdateOrderStatusMutation } from '@/publish/orders'
import { toast } from 'sonner'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '../ui/textarea'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

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

	const status = getOrderStatus(order)
	const buyerPubkey = getBuyerPubkey(order.order)
	const sellerPubkey = getSellerPubkey(order.order)

	const isBuyer = userPubkey === buyerPubkey
	const isSeller = userPubkey === sellerPubkey

	// Determine which actions are allowed based on role and current status
	const canCancel =
		(status === ORDER_STATUS.PENDING || status === ORDER_STATUS.CONFIRMED) && (isBuyer || (isSeller && status === ORDER_STATUS.PENDING))

	// Seller actions
	const canConfirm = isSeller && status === ORDER_STATUS.PENDING
	const canProcess = isSeller && status === ORDER_STATUS.CONFIRMED
	const canShip = isSeller && status === ORDER_STATUS.PROCESSING
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
		// Keep status as processing but add tracking information
		handleStatusUpdate(ORDER_STATUS.PROCESSING, 'Order has been shipped', trackingNumber)
		setIsShippingOpen(false)
		setTrackingNumber('')
	}

	if (!isBuyer && !isSeller) {
		return null // Don't show actions if user is neither buyer nor seller
	}

	// Get status styles based on the current status
	const getStatusStyles = () => {
		switch (status) {
			case ORDER_STATUS.CONFIRMED:
				return {
					bgColor: 'bg-blue-100',
					textColor: 'text-blue-800',
					icon: <Check className="mr-2 h-4 w-4 text-blue-500" />,
				}
			case ORDER_STATUS.PROCESSING:
				return {
					bgColor: 'bg-yellow-100',
					textColor: 'text-yellow-800',
					icon: <Truck className="mr-2 h-4 w-4 text-yellow-500" />,
				}
			case ORDER_STATUS.COMPLETED:
				return {
					bgColor: 'bg-green-100',
					textColor: 'text-green-800',
					icon: <PackageCheck className="mr-2 h-4 w-4 text-green-500" />,
				}
			case ORDER_STATUS.CANCELLED:
				return {
					bgColor: 'bg-red-100',
					textColor: 'text-red-800',
					icon: <PackageX className="mr-2 h-4 w-4 text-red-500" />,
				}
			case ORDER_STATUS.PENDING:
			default:
				return {
					bgColor: 'bg-gray-100',
					textColor: 'text-gray-800',
					icon: <Clock className="mr-2 h-4 w-4 text-gray-500" />,
				}
		}
	}

	const { bgColor, textColor, icon } = getStatusStyles()

	return (
		<div className="flex items-center justify-end">
			<div className={cn('flex items-center rounded-md px-3 py-1', bgColor, textColor)}>
				{icon}
				<span className="font-medium capitalize">{status}</span>
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
							Complete Order
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

			{/* Shipping dialog */}
			<Dialog open={isShippingOpen} onOpenChange={setIsShippingOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Shipping Information</DialogTitle>
						<DialogDescription>Add tracking information for this shipment</DialogDescription>
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
