import type { ReactNode } from 'react'
import { CreditCard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../../primitives/card'

export function OrderNotFoundView() {
	return (
		<div className="text-center py-8">
			<h2 className="text-xl font-semibold text-gray-900">Order not found</h2>
			<p className="text-gray-600 mt-2">The requested order could not be found.</p>
		</div>
	)
}

export function OrderMissingView() {
	return (
		<div className="container mx-auto px-4 py-8">
			<Card>
				<CardContent className="p-8 text-center">
					<p className="text-gray-500">Order not found</p>
				</CardContent>
			</Card>
		</div>
	)
}

export function OrderBuyerCardView({ userCard }: { userCard: ReactNode }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Buyer</CardTitle>
			</CardHeader>
			<CardContent>{userCard}</CardContent>
		</Card>
	)
}

export interface OrderProductsCardViewProps {
	items: readonly { id: string; product: ReactNode; quantity: number }[]
}

export function OrderProductsCardView({ items }: OrderProductsCardViewProps) {
	if (items.length === 0) return null
	return (
		<Card>
			<CardHeader>
				<CardTitle>Products</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-1 gap-4">
					{items.map((item) => (
						<div key={item.id} className="p-4 border rounded-lg">
							{item.product}
							<div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
								<span className="text-sm text-gray-500">Quantity</span>
								<span className="text-lg font-semibold">{item.quantity}</span>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	)
}

export interface OrderPaymentDetailsCardViewProps {
	totalInvoices: number
	summary: ReactNode
	banner?: ReactNode
	progress: ReactNode
	invoices: ReactNode
	footer?: ReactNode
}

export function OrderPaymentDetailsCardView({
	totalInvoices,
	summary,
	banner,
	progress,
	invoices,
	footer,
}: OrderPaymentDetailsCardViewProps) {
	return (
		<Card>
			<CardHeader className="p-0">
				<div className="bg-gray-50 p-4 rounded-t-xl">
					<div className="flex items-start gap-2">
						<CreditCard className="w-5 h-5" />
						<div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
							<CardTitle>Payment Details</CardTitle>
							<span className="text-muted-foreground">({totalInvoices} invoices)</span>
						</div>
					</div>
					<div className="my-3 border-b border-gray-300 sm:hidden" />
					{summary}
				</div>
			</CardHeader>
			<CardContent className="space-y-4 pt-4">
				{banner}
				{progress}
				<div className="grid gap-3">{invoices}</div>
				{footer}
			</CardContent>
		</Card>
	)
}

export function OrderTimelineView({ children }: { children: ReactNode }) {
	return (
		<div>
			<h2 className="text-xl font-bold mb-4">Order Timeline</h2>
			<div className="space-y-4">{children}</div>
		</div>
	)
}

export function OrderDetailLayoutView({ children, dialogs }: { children: ReactNode; dialogs?: ReactNode }) {
	return (
		<div className="container mx-auto px-4 py-4">
			<div className="space-y-6">{children}</div>
			{dialogs}
		</div>
	)
}
