import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

import type { OrderWithRelatedEvents } from './orders'

/**
 * Inject a newly-published event into cached order data for instant UI updates.
 *
 * When a mutation publishes a Nostr event, the relay may take 1-5 seconds to
 * echo it back. During that window, invalidateQueries + refetchQueries returns
 * stale data (the event isn't visible yet), causing the UI to appear unresponsive.
 *
 * This helper directly patches the React Query cache with the published event,
 * so the UI updates instantly. A background invalidation then reconciles with
 * the authoritative relay data once it propagates.
 *
 * Handles both single-order cache entries (orderKeys.details) and list entries
 * (orderKeys.all, byBuyer, bySeller, byPubkey).
 *
 * @see https://github.com/PlebeianApp/market/issues/1103
 * @see https://github.com/PlebeianApp/market/issues/772
 */
export function injectOrderEventIntoCache(
	old: OrderWithRelatedEvents | OrderWithRelatedEvents[] | null | undefined,
	publishedEvent: NDKEvent,
): OrderWithRelatedEvents | OrderWithRelatedEvents[] | null | undefined {
	if (!old) return old

	const updateSingle = (order: OrderWithRelatedEvents): OrderWithRelatedEvents => {
		// Match by order tag or order event id
		const newOrderTag = publishedEvent.tags.find((t) => t[0] === 'order')?.[1]
		const orderTag = order.order.tags.find((t) => t[0] === 'order')?.[1]
		const orderEventId = order.order.id

		const matchesOrder = newOrderTag === orderTag || newOrderTag === orderEventId

		if (!matchesOrder) return order

		// Payment receipts (kind 17) — reference order by tag or event id
		if (publishedEvent.kind === PAYMENT_RECEIPT_KIND) {
			if (order.paymentReceipts.some((e) => e.id === publishedEvent.id)) return order
			const paymentReceipts = [publishedEvent, ...order.paymentReceipts]
			return { ...order, paymentReceipts, latestPaymentReceipt: publishedEvent }
		}

		// Order process events (kind 16) — categorize by type tag
		if (publishedEvent.kind === ORDER_PROCESS_KIND) {
			const typeTag = publishedEvent.tags.find((t) => t[0] === 'type')?.[1]

			if (typeTag === ORDER_MESSAGE_TYPE.STATUS_UPDATE) {
				if (order.statusUpdates.some((e) => e.id === publishedEvent.id)) return order
				const statusUpdates = [publishedEvent, ...order.statusUpdates]
				return { ...order, statusUpdates, latestStatus: publishedEvent }
			}

			if (typeTag === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE) {
				if (order.shippingUpdates.some((e) => e.id === publishedEvent.id)) return order
				const shippingUpdates = [publishedEvent, ...order.shippingUpdates]
				return { ...order, shippingUpdates, latestShipping: publishedEvent }
			}

			if (typeTag === ORDER_MESSAGE_TYPE.PAYMENT_REQUEST) {
				if (order.paymentRequests.some((e) => e.id === publishedEvent.id)) return order
				const paymentRequests = [publishedEvent, ...order.paymentRequests]
				return { ...order, paymentRequests, latestPaymentRequest: publishedEvent }
			}
		}

		return order
	}

	if (Array.isArray(old)) {
		return old.map(updateSingle)
	}
	return updateSingle(old)
}
