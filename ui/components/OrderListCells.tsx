import type { ReactNode } from 'react'
import { getOrderAmountSats, getOrderReference, type OrderReadEvent } from '@sdk/commerce/orders'

export function OrderReferenceBadge({
	order,
	renderLink,
}: {
	order: OrderReadEvent
	renderLink: (orderReference: string, children: ReactNode) => ReactNode
}) {
	const reference = getOrderReference(order)

	return (
		<div className="inline-block rounded border border-gray-300 px-3 py-1">
			{renderLink(reference || 'unknown', reference ? `${reference.substring(0, 8)}...` : 'Unknown')}
		</div>
	)
}

export function OrderDateText({ order }: { order: { created_at?: number } }) {
	const date = order.created_at
		? new Date(order.created_at * 1000).toLocaleString('de-DE', {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			})
		: '-'

	return <span className="text-xs text-muted-foreground">{date}</span>
}

export function OrderAmountText({ order }: { order: OrderReadEvent }) {
	const amount = getOrderAmountSats(order)

	return <div className="text-right font-medium">{amount ? `${parseInt(amount).toLocaleString()} sats` : '-'}</div>
}
