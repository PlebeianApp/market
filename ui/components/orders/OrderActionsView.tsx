import { useState, type ReactNode } from 'react'
import { Ban, Check, CheckCircle, Clock, Package, Truck, X } from 'lucide-react'
import type { OrderManagementActions } from '@sdk/commerce/orders'
import { ORDER_STATUS } from '@sdk/commerce/messaging'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Textarea } from '../../primitives/textarea'
import { cn } from '../../utils/cn'

export interface OrderActionsViewProps {
	/** Visible-action hints from the SDK; not an authorization check. */
	actions: Pick<OrderManagementActions, 'canCancel' | 'canConfirm' | 'canProcess' | 'canShip' | 'canReceive'>
	/** Order status used for the terminal-state message. */
	status: string
	isUpdatingStatus: boolean
	isUpdatingShipping: boolean
	onConfirm: () => void
	onProcess: () => void
	onReceive: () => void
	onCancel: (reason: string) => void
	onShip: (trackingUrl: string) => void
	className?: string
	/** Rendered after the dialogs, e.g. the post-shipping stock update. */
	children?: ReactNode
}

export function OrderActionsView({
	actions,
	status,
	isUpdatingStatus,
	isUpdatingShipping,
	onConfirm,
	onProcess,
	onReceive,
	onCancel,
	onShip,
	className = '',
	children,
}: OrderActionsViewProps) {
	const [cancelReason, setCancelReason] = useState('')
	const [isCancelOpen, setIsCancelOpen] = useState(false)
	const [trackingNumber, setTrackingNumber] = useState('')
	const [isShippingOpen, setIsShippingOpen] = useState(false)
	const [isPaymentConfirmOpen, setIsPaymentConfirmOpen] = useState(false)

	const { canCancel, canConfirm, canProcess, canShip, canReceive } = actions
	const hasAction = canCancel || canConfirm || canProcess || canShip || canReceive

	return (
		<div className={cn('space-y-3 w-full mx-2', className)}>
			{hasAction ? (
				<div className="flex flex-wrap gap-2">
					{canCancel && (
						<Button variant="outline" onClick={() => setIsCancelOpen(true)} disabled={isUpdatingStatus} className="w-full sm:w-auto">
							<X className="w-4 h-4 mr-2" /> Cancel Order
						</Button>
					)}
					{canConfirm && (
						<Button onClick={() => setIsPaymentConfirmOpen(true)} disabled={isUpdatingStatus} className="w-full sm:w-auto">
							<Check className="w-4 h-4 mr-2" /> Confirm Payment Received
						</Button>
					)}
					{canProcess && (
						<Button onClick={onProcess} disabled={isUpdatingStatus} className="w-full sm:w-auto">
							<Package className="w-4 h-4 mr-2" /> Process Order
						</Button>
					)}
					{canShip && (
						<Button onClick={() => setIsShippingOpen(true)} disabled={isUpdatingShipping} className="w-full sm:w-auto">
							<Truck className="w-4 h-4 mr-2" /> Mark As Shipped
						</Button>
					)}
					{canReceive && (
						<Button onClick={onReceive} disabled={isUpdatingStatus} className="w-full sm:w-auto">
							<CheckCircle className="w-4 h-4 mr-2" /> I've Received This Item
						</Button>
					)}
				</div>
			) : (
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
						<Button
							onClick={() => {
								onConfirm()
								setIsPaymentConfirmOpen(false)
							}}
						>
							Confirm Payment
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

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
						<Button
							onClick={() => {
								onShip(trackingNumber)
								setIsShippingOpen(false)
								setTrackingNumber('')
							}}
						>
							Mark As Shipped
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

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
						<Button
							variant="destructive"
							onClick={() => {
								onCancel(cancelReason)
								setIsCancelOpen(false)
								setCancelReason('')
							}}
						>
							Yes, Cancel Order
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{children}
		</div>
	)
}

export interface StockUpdateRow {
	productRef: string
	productName: string
	quantityOrdered: number
	currentStock: number
	newStock: number
}

export interface StockUpdateDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	rows: readonly StockUpdateRow[]
	loading: boolean
	onStockChange: (productRef: string, value: string) => void
	onSubmit: () => void
}

export function StockUpdateDialogView({ open, onOpenChange, rows, loading, onStockChange, onSubmit }: StockUpdateDialogViewProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Update Product Stock</DialogTitle>
					<DialogDescription>The order has been completed. Update the stock levels for the products in this order.</DialogDescription>
				</DialogHeader>

				{loading && rows.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">Loading product information...</div>
				) : (
					<div className="space-y-4 py-4">
						{rows.map((product) => (
							<div key={product.productRef} className="border rounded-lg p-4 space-y-3">
								<div className="font-medium">{product.productName}</div>
								<div className="grid grid-cols-3 gap-4 text-sm">
									<div>
										<Label className="text-muted-foreground">Ordered</Label>
										<div className="font-medium">{product.quantityOrdered}</div>
									</div>
									<div>
										<Label className="text-muted-foreground">Current Stock</Label>
										<div className="font-medium">{product.currentStock}</div>
									</div>
									<div>
										<Label htmlFor={`stock-${product.productRef}`}>New Stock</Label>
										<Input
											id={`stock-${product.productRef}`}
											type="number"
											min="0"
											value={product.newStock}
											onChange={(e) => onStockChange(product.productRef, e.target.value)}
											className="mt-1"
										/>
									</div>
								</div>
							</div>
						))}
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={onSubmit} disabled={loading || rows.length === 0}>
						{loading ? 'Updating...' : 'Update Stock'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
