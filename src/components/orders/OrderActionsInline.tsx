import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ORDER_STATUS, SHIPPING_STATUS } from '@/lib/schemas/order'
import { cn } from '@/lib/utils'
import { getStatusStyles } from '@/lib/utils/orderUtils'
import { useUpdateOrderStatusMutation } from '@/publish/orders'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getBuyerPubkey, getOrderStatus, getSellerPubkey } from '@/queries/orders'
import { useUpdateShippingStatusMutation } from '@/queries/shipping'
import { Ban, Check, CheckCircle, Clock, Package, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { StockUpdateDialog } from './StockUpdateDialog'

interface OrderActionsInlineProps {
	order: OrderWithRelatedEvents
	userPubkey: string
}

export function OrderActionsInline({ order, userPubkey }: OrderActionsInlineProps) {
	const [cancelReason, setCancelReason] = useState('')
	const [isCancelOpen, setIsCancelOpen] = useState(false)

	const [trackingNumber, setTrackingNumber] = useState('')
	const [isShippingOpen, setIsShippingOpen] = useState(false)

	const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false)

	const updateOrderStatus = useUpdateOrderStatusMutation()
	const updateShippingStatus = useUpdateShippingStatusMutation()

	const status = getOrderStatus(order)

	const buyerPubkey = getBuyerPubkey(order.order)
	const sellerPubkey = getSellerPubkey(order.order)

	const isBuyer = userPubkey === buyerPubkey
	const isSeller = userPubkey === sellerPubkey

	// Determine which actions are allowed based on role and current status
	const canCancel = status === ORDER_STATUS.PENDING && (isBuyer || isSeller)

	// Check if the order has been shipped
	const hasBeenShipped = order.shippingUpdates.some((update) => update.tags.find((tag) => tag[0] === 'status')?.[1] === 'shipped')

	// Seller actions
	const canConfirm = isSeller && status === ORDER_STATUS.PENDING
	const canProcess = isSeller && status === ORDER_STATUS.CONFIRMED
	const canShip = isSeller && status === ORDER_STATUS.PROCESSING && !hasBeenShipped

	// Buyer actions
	const canReceive = isBuyer && status === ORDER_STATUS.PROCESSING && hasBeenShipped

	const handleStatusUpdate = (newStatus: string, reason?: string, tracking?: string) => {
		const orderEventId = order.order.id
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
		const orderEventId = order.order.id
		if (!orderEventId) {
			toast.error('Order ID not found')
			return
		}

		updateShippingStatus.mutate({
			orderEventId,
			status: SHIPPING_STATUS.SHIPPED,
			tracking: trackingNumber,
			reason: 'Order has been shipped',
		})

		setIsShippingOpen(false)
		setTrackingNumber('')
		setIsStockUpdateOpen(true)
	}

	if (!isBuyer && !isSeller) {
		return null
	}

	const handleStockUpdateComplete = () => {
		// Stock has been updated, dialog can close
	}

	const { bgColor, borderColor, textColor, iconName, label } = getStatusStyles(order)

	const renderStatusIcon = () => {
		switch (iconName) {
			case 'truck':
				return <Truck className="h-3 w-3" />
			case 'tick':
				return <Check className="h-3 w-3" />
			case 'clock':
				return <Clock className="h-3 w-3" />
			case 'cross':
				return <X className="h-3 w-3" />
			default:
				return null
		}
	}

	// Determine the next action based on role and status
	const getNextAction = () => {
		if (isSeller) {
			if (canConfirm) return { label: 'Confirm', icon: Check, action: () => handleStatusUpdate(ORDER_STATUS.CONFIRMED) }
			if (canProcess) return { label: 'Process', icon: Package, action: () => handleStatusUpdate(ORDER_STATUS.PROCESSING) }
			if (canShip) return { label: 'Ship', icon: Truck, action: () => setIsShippingOpen(true) }
		}
		if (isBuyer && canReceive) {
			return { label: 'Received', icon: CheckCircle, action: () => handleStatusUpdate(ORDER_STATUS.COMPLETED) }
		}
		return null
	}

	const nextAction = getNextAction()
	const isLoading = updateOrderStatus.isPending || updateShippingStatus.isPending

	return (
		<div className="flex items-center gap-2">
			{/* Cancel Button - always visible, disabled/dimmed when not available */}
			{canCancel ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="outline"
							size="icon"
							onClick={() => setIsCancelOpen(true)}
							disabled={isLoading}
							className="shrink-0 h-6 w-6 bg-black text-white border border-transparent hover:bg-black hover:text-[#ff3eb5] hover:border-[#ff3eb5]"
							aria-label="Cancel order"
						>
							<X className="h-3 w-3" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Cancel</TooltipContent>
				</Tooltip>
			) : (
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="shrink-0 h-6 w-6 flex items-center justify-center text-muted-foreground/40 border border-muted-foreground/20 rounded opacity-40 cursor-default">
							<Check className="h-3 w-3" />
						</div>
					</TooltipTrigger>
					<TooltipContent>Order accepted</TooltipContent>
				</Tooltip>
			)}

			{/* Status Badge - fixed width to match widest label (Cancelled) */}
			<Tooltip>
				<TooltipTrigger asChild>
					<div
						className={cn(
							'flex items-center justify-center rounded px-2 h-6 w-6 md:w-[120px] lg:w-6 xl:w-[120px] border cursor-default',
							bgColor,
							borderColor,
							textColor,
						)}
					>
						<div className="w-4 shrink-0">{renderStatusIcon()}</div>
						<span className="hidden md:block lg:hidden xl:block font-medium capitalize text-xs whitespace-nowrap flex-1 text-center">
							{label}
						</span>
					</div>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>

			{/* Next Action Button - text centered, icon in fixed box on right */}
			{nextAction ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="primary"
							size="sm"
							onClick={nextAction.action}
							disabled={isLoading}
							className="shrink-0 w-6 md:w-[100px] lg:w-6 xl:w-[100px] h-6 px-2 text-xs bg-black text-white border border-transparent rounded cursor-pointer hover:bg-black hover:text-[#ff3eb5] hover:border-[#ff3eb5] justify-center"
						>
							<span className="hidden md:block lg:hidden xl:block flex-1 text-center">{nextAction.label}</span>
							<div className="w-4 shrink-0 flex justify-center md:justify-end lg:justify-center xl:justify-end">
								<nextAction.icon className="h-3 w-3" />
							</div>
						</Button>
					</TooltipTrigger>
					<TooltipContent>{nextAction.label}</TooltipContent>
				</Tooltip>
			) : status === ORDER_STATUS.COMPLETED ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="shrink-0 w-6 md:w-[100px] lg:w-6 xl:w-[100px] h-6 px-2 text-xs text-green-600 border border-green-600/50 rounded flex items-center justify-center cursor-default">
							<span className="hidden md:block lg:hidden xl:block flex-1 text-center">Done</span>
							<div className="w-4 shrink-0 flex justify-center md:justify-end lg:justify-center xl:justify-end">
								<CheckCircle className="h-3 w-3" />
							</div>
						</div>
					</TooltipTrigger>
					<TooltipContent>Done</TooltipContent>
				</Tooltip>
			) : status === ORDER_STATUS.CANCELLED ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="shrink-0 w-6 md:w-[100px] lg:w-6 xl:w-[100px] h-6 px-2 text-xs text-muted-foreground border border-muted-foreground/50 rounded flex items-center justify-center cursor-default">
							<span className="hidden md:block lg:hidden xl:block flex-1 text-center">Cancelled</span>
							<div className="w-4 shrink-0 flex justify-center md:justify-end lg:justify-center xl:justify-end">
								<Ban className="h-3 w-3" />
							</div>
						</div>
					</TooltipTrigger>
					<TooltipContent>Cancelled</TooltipContent>
				</Tooltip>
			) : (
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="shrink-0 w-6 md:w-[100px] lg:w-6 xl:w-[100px] h-6 px-2 text-xs text-muted-foreground border border-muted-foreground/50 rounded flex items-center justify-center cursor-default">
							<span className="hidden md:block lg:hidden xl:block flex-1 text-center">Waiting</span>
							<div className="w-4 shrink-0 flex justify-center md:justify-end lg:justify-center xl:justify-end">
								<Clock className="h-3 w-3" />
							</div>
						</div>
					</TooltipTrigger>
					<TooltipContent>Waiting</TooltipContent>
				</Tooltip>
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

			{/* Stock Update Dialog */}
			<StockUpdateDialog
				open={isStockUpdateOpen}
				onOpenChange={setIsStockUpdateOpen}
				order={order}
				onComplete={handleStockUpdateComplete}
			/>
		</div>
	)
}
