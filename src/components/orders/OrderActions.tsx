import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ORDER_STATUS, SHIPPING_STATUS } from '@/lib/schemas/order'
import { cn } from '@/lib/utils'
import { useUpdateOrderStatusMutation } from '@/publish/orders'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getAuctionOrderAuthority, getBuyerPubkey, getOrderStatus, getSellerPubkey, isAuctionOrder } from '@/queries/orders'
import { useUpdateShippingStatusMutation } from '@/queries/shipping'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { Ban, Check, CheckCircle, Clock, Package, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { StockUpdateDialog } from './StockUpdateDialog'

interface OrderActionsProps {
	order: OrderWithRelatedEvents
	userPubkey: string
	className?: string
}

export function OrderActions({ order, userPubkey, className = '' }: OrderActionsProps) {
	const [cancelReason, setCancelReason] = useState('')
	const [isCancelOpen, setIsCancelOpen] = useState(false)

	const [trackingNumber, setTrackingNumber] = useState('')
	const [isShippingOpen, setIsShippingOpen] = useState(false)

	const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false)
	const [isPaymentConfirmOpen, setIsPaymentConfirmOpen] = useState(false)

	const updateOrderStatus = useUpdateOrderStatusMutation()
	const updateShippingStatus = useUpdateShippingStatusMutation()

	// Presentation-only: "does this order carry an auction coordinate?".
	// It is NOT authority for settlement, payment, or fulfillment decisions —
	// see getAuctionOrderAuthority() in @/queries/orders.
	const isAuction = isAuctionOrder(order)

	// Canonical action authority for auction orders: the auction-claim marker
	// (getAuctionClaimPublicMarkerFields) is the client-visible projection of
	// "validated settlement → canonical claim". A parseable kind-30408 `a` tag
	// alone is never sufficient authority.
	const hasAuctionClaimAuthority = getAuctionOrderAuthority(order).hasCanonicalClaim

	const status = getOrderStatus(order)

	const buyerPubkey = getBuyerPubkey(order.order)
	const sellerPubkey = getSellerPubkey(order.order)

	const isBuyer = userPubkey === buyerPubkey
	const isSeller = userPubkey === sellerPubkey

	// Determine which actions are allowed based on role and current status
	const canCancel = status === ORDER_STATUS.PENDING && (isBuyer || isSeller)
	const hasBeenShipped = order.shippingUpdates.some((update) => update.tags.find((tag) => tag[0] === 'status')?.[1] === 'shipped')

	// Seller actions
	const canConfirm = isSeller && status === ORDER_STATUS.PENDING
	// Fulfillment transition for auction orders (ADR-0003 / ADR-0004):
	//   validated settlement → canonical claim → fulfillment-ready
	//     → Process → Ship → Receive/Complete
	// There is no generic payment-confirmation step for an auction, so an order
	// carrying the canonical claim marker is already fulfillment-ready while it
	// is still PENDING. It must not be stranded waiting for a generic CONFIRMED
	// status the auction flow never publishes, and no synthetic payment event
	// may be manufactured to unblock it.
	const canProcess = isSeller && (status === ORDER_STATUS.CONFIRMED || (hasAuctionClaimAuthority && status === ORDER_STATUS.PENDING))
	const canShip = isSeller && status === ORDER_STATUS.PROCESSING && !hasBeenShipped

	// Buyer actions
	const canReceive = isBuyer && status === ORDER_STATUS.PROCESSING && hasBeenShipped

	// Auction orders are handled by the auction settlement flow (ADR-0003),
	// not the product order lifecycle: there is no invoice to confirm and
	// cancellation cannot release the bidder's locked proofs. Suppress the
	// Cancel/Confirm buttons without touching canProcess/canShip/canReceive,
	// so auction orders still progress through processing/shipping.
	const showCancel = canCancel && !isAuction
	const showConfirm = canConfirm && !isAuction

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

	const handleConfirmOrder = () => {
		handleStatusUpdate(ORDER_STATUS.CONFIRMED)
		setIsPaymentConfirmOpen(false)
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

	return (
		<div className={cn('space-y-3 w-full mx-2', className)}>
			{/* Primary Action Button */}
			{(showCancel || showConfirm || canProcess || canShip || canReceive) && (
				<div className="flex flex-wrap gap-2">
					{showCancel && (
						<Button
							variant="outline"
							onClick={() => setIsCancelOpen(true)}
							disabled={updateOrderStatus.isPending}
							className="w-full sm:w-auto"
						>
							<X className="w-4 h-4 mr-2" /> Cancel Order
						</Button>
					)}

					{showConfirm && (
						<Button onClick={() => setIsPaymentConfirmOpen(true)} disabled={updateOrderStatus.isPending} className="w-full sm:w-auto">
							<Check className="w-4 h-4 mr-2" /> Confirm Payment Received
						</Button>
					)}

					{canProcess && (
						<Button
							onClick={() => handleStatusUpdate(ORDER_STATUS.PROCESSING)}
							disabled={updateOrderStatus.isPending}
							className="w-full sm:w-auto"
						>
							<Package className="w-4 h-4 mr-2" /> Process Order
						</Button>
					)}

					{canShip && (
						<Button onClick={() => setIsShippingOpen(true)} disabled={updateShippingStatus.isPending} className="w-full sm:w-auto">
							<Truck className="w-4 h-4 mr-2" /> Mark As Shipped
						</Button>
					)}

					{canReceive && (
						<Button
							onClick={() => handleStatusUpdate(ORDER_STATUS.COMPLETED)}
							disabled={updateOrderStatus.isPending}
							className="w-full sm:w-auto"
						>
							<CheckCircle className="w-4 h-4 mr-2" /> I've Received This Item
						</Button>
					)}
				</div>
			)}

			{/* Final State Indicators */}
			{!showCancel && !showConfirm && !canProcess && !canShip && !canReceive && (
				<div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
					{status === ORDER_STATUS.COMPLETED ? (
						<>
							<CheckCircle className="w-4 h-4 text-green-600" />
							<span>Order completed</span>
						</>
					) : status === ORDER_STATUS.CANCELLED ? (
						<>
							<Ban className="w-4 h-4 text-red-600" />
							<span>Order cancelled</span>
						</>
					) : (
						<>
							<Clock className="w-4 h-4 text-yellow-600" />
							<span>Awaiting action from other party</span>
						</>
					)}
				</div>
			)}

			{/* Payment Confirmation Dialog */}
			<Dialog open={isPaymentConfirmOpen} onOpenChange={setIsPaymentConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Confirm Payment Received</DialogTitle>
						<DialogDescription>Please verify that you have received payment before confirming this order.</DialogDescription>
					</DialogHeader>
					<div className="space-y-2 py-4">
						<p className="text-sm text-gray-600">
							By clicking confirm, you acknowledge the funds have been received and you will now process the order.
						</p>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsPaymentConfirmOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleConfirmOrder}>Confirm Payment</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Shipping Dialog */}
			<Dialog open={isShippingOpen} onOpenChange={setIsShippingOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Mark Order As Shipped</DialogTitle>
						<DialogDescription>Add tracking information if available</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div>
							<Label htmlFor="tracking">Tracking URL (Optional)</Label>
							<Input
								id="tracking"
								value={trackingNumber}
								onChange={(e) => setTrackingNumber(e.target.value)}
								placeholder="https://carrier.com/track/..."
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsShippingOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleShipped}>Mark As Shipped</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Cancel Dialog */}
			<Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Cancel This Order</DialogTitle>
						<DialogDescription>This cannot be undone. Please confirm you want to proceed.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<Label htmlFor="reason">Cancellation Reason (Optional)</Label>
						<Textarea
							id="reason"
							value={cancelReason}
							onChange={(e) => setCancelReason(e.target.value)}
							placeholder="Why are you cancelling?"
							rows={3}
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsCancelOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleCancel}>
							Yes, Cancel Order
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Stock Update Dialog - only for product orders, not auctions */}
			{!isAuction && (
				<StockUpdateDialog
					open={isStockUpdateOpen}
					onOpenChange={setIsStockUpdateOpen}
					order={order}
					onComplete={() => {}} // No-op: no additional actions needed.
				/>
			)}
		</div>
	)
}
