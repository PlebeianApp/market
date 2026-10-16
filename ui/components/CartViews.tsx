import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../primitives/button'
import { Separator } from '../primitives/separator'

const formatSats = (sats: number): string => Math.round(sats).toLocaleString()

export function CartShippingReminder({ count, context = 'cart' }: { count: number; context?: 'cart' | 'checkout' }) {
	if (count <= 0) return null
	const items = `${count} ${count === 1 ? 'item' : 'items'}`
	return (
		<div className="mb-4 border-l-4 border-yellow-400 bg-yellow-50 p-4">
			<div className="flex">
				<div className="ml-3">
					<p className="text-sm text-yellow-700">
						{context === 'checkout' ? `Please select shipping for ${items} before checkout.` : `Select shipping at checkout for ${items}.`}
					</p>
				</div>
			</div>
		</div>
	)
}

export interface CartLineShippingProps {
	shippingMethodId: string | null
	shippingMethodName: string | null
	shippingCost: number
	shippingCostCurrency: string | null
}

export function CartLineShipping({ shippingMethodId, shippingMethodName, shippingCost, shippingCostCurrency }: CartLineShippingProps) {
	return (
		<div className="mt-2 text-sm text-muted-foreground">
			{shippingMethodId ? (
				<span>
					Shipping: {shippingMethodName || 'Selected'}
					{shippingCost > 0 && shippingCostCurrency ? ` - ${shippingCost} ${shippingCostCurrency}` : ''}
				</span>
			) : (
				<span>Select shipping at checkout</span>
			)}
		</div>
	)
}

export interface CartSellerTotals {
	satsTotal: number
	shippingSats: number
	currencyTotals: Record<string, number>
	shares: { sellerAmount: number; communityAmount: number; sellerPercentage: number }
}

export interface CartSellerCardProps {
	/** Host-rendered seller identity. */
	seller: ReactNode
	/** Host-rendered line items; each is wrapped with alternating backgrounds. */
	items: { key: string; content: ReactNode }[]
	totals: CartSellerTotals
}

/** Per-seller cart group with totals and the merchant/community payment split. */
export function CartSellerCard({ seller, items, totals }: CartSellerCardProps) {
	return (
		<div className="rounded-lg border bg-white p-4 shadow-md">
			<div className="mb-3">{seller}</div>

			<ul className="space-y-4">
				{items.map((item, index) => (
					<li key={item.key} className={`rounded-lg p-3 ${index % 2 === 0 ? 'bg-gray-100' : 'bg-white'}`}>
						{item.content}
					</li>
				))}
			</ul>

			{Object.entries(totals.currencyTotals).map(([currency, amount]) => (
				<div key={currency} className="mt-4 flex justify-between">
					<p className="text-sm">Products ({currency}):</p>
					<p className="text-sm">
						{amount.toFixed(2)} {currency}
					</p>
				</div>
			))}

			<div className="mt-1 flex justify-between">
				<p className="text-sm">Shipping:</p>
				<p className="text-sm font-semibold">{formatSats(totals.shippingSats)} sat</p>
			</div>

			<div className="mt-1 flex justify-between font-semibold">
				<p className="text-sm">Total:</p>
				<p className="text-sm">{formatSats(totals.satsTotal)} sat</p>
			</div>

			<div className="mt-3">
				<p className="text-sm font-semibold">Payment Breakdown</p>
				<div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-800">
					<div className="h-full bg-blue-500" style={{ width: `${totals.shares.sellerPercentage}%` }} />
				</div>
				<div className="mt-1 flex justify-between">
					<p className="text-sm">Merchant: </p>
					<p className="text-sm">
						{formatSats(totals.shares.sellerAmount)} sat ({totals.shares.sellerPercentage.toFixed(2)}%)
					</p>
				</div>
				{totals.shares.communityAmount > 0 && (
					<div className="flex justify-between">
						<p className="text-sm">Community Share: </p>
						<p className="text-sm">
							{formatSats(totals.shares.communityAmount)} sat ({(100 - totals.shares.sellerPercentage).toFixed(2)}%)
						</p>
					</div>
				)}
			</div>
		</div>
	)
}

export function CartTotals({ totalSats, shippingSats }: { totalSats: number; shippingSats: number }) {
	return (
		<div className="mb-2 space-y-1">
			<div className="flex justify-between">
				<p className="text-sm">Subtotal:</p>
				<p className="text-sm">{formatSats(totalSats - shippingSats)} sat</p>
			</div>
			<div className="flex justify-between">
				<p className="text-sm">Shipping:</p>
				<p className="text-sm">{formatSats(shippingSats)} sat</p>
			</div>
			<div className="flex justify-between text-lg font-bold">
				<p>Total:</p>
				<p>{formatSats(totalSats)} sat</p>
			</div>
		</div>
	)
}

export interface CartTotalsDetailsProps {
	totalSats: number
	shippingSats: number
	totalByCurrency: Record<string, number>
	shippingByCurrency: Record<string, number>
	defaultExpanded?: boolean
}

export function CartTotalsDetails({
	totalSats,
	shippingSats,
	totalByCurrency,
	shippingByCurrency,
	defaultExpanded = false,
}: CartTotalsDetailsProps) {
	const [expanded, setExpanded] = useState(defaultExpanded)

	return (
		<>
			<button className="flex w-full items-center justify-between rounded-lg border bg-gray-50 p-2" onClick={() => setExpanded(!expanded)}>
				<span className="text-sm">View Details</span>
				<ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
			</button>

			{expanded && (
				<div className="space-y-2 rounded-lg bg-gray-50 p-2">
					{Object.entries(totalByCurrency).map(([currency, amount]) => (
						<div key={`total-${currency}`} className="flex justify-between">
							<p className="text-sm">Products ({currency}):</p>
							<p className="text-sm">{amount.toFixed(2)}</p>
						</div>
					))}

					{Object.entries(shippingByCurrency).map(([currency, amount]) => (
						<div key={`shipping-${currency}`} className="flex justify-between">
							<p className="text-sm">Products ({currency}):</p>
							<p className="text-sm">{amount.toFixed(2)}</p>
						</div>
					))}

					<Separator className="my-2" />
					<div className="flex justify-between">
						<p className="text-sm">Subtotal:</p>
						<p className="text-sm">{formatSats(totalSats - shippingSats)} sat</p>
					</div>
					<div className="flex justify-between">
						<p className="text-sm">Shipping:</p>
						<p className="text-sm">{formatSats(shippingSats)} sat</p>
					</div>
					<Separator className="my-2" />
					<div className="flex justify-between font-semibold">
						<p className="text-sm">Grand Total:</p>
						<p className="text-sm">{formatSats(totalSats)} sat</p>
					</div>
				</div>
			)}
		</>
	)
}

export interface CartFooterProps {
	totalSats: number
	shippingSats: number
	canCheckout: boolean
	onClear: () => void
	onCheckout: () => void
}

export function CartFooter({ totalSats, shippingSats, canCheckout, onClear, onCheckout }: CartFooterProps) {
	return (
		<div className="w-full space-y-3">
			<CartTotals totalSats={totalSats} shippingSats={shippingSats} />

			<div className="mt-4 flex gap-3">
				<Button
					variant="outline"
					className="flex-1 border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"
					onClick={onClear}
					disabled={!canCheckout}
				>
					Clear
				</Button>
				<Button className="btn-product-banner flex-1" disabled={!canCheckout} onClick={onCheckout}>
					Checkout
				</Button>
			</div>
		</div>
	)
}
