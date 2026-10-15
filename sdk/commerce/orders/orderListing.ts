import { resolveBuyerOrderStatus, type BuyerOrderStatus } from './orderStatus'

export const ORDER_LISTING_SORTS = ['newest', 'oldest', 'recently-updated', 'least-updated'] as const

export type OrderListingSort = (typeof ORDER_LISTING_SORTS)[number]
export type OrderListingStatusFilter = 'any' | BuyerOrderStatus

interface TimestampedEvent {
	created_at?: number
	tags?: string[][]
}

export interface OrderListingEntry {
	order: TimestampedEvent
	latestStatus?: TimestampedEvent
	latestShipping?: TimestampedEvent
	latestPaymentRequest?: TimestampedEvent
	latestPaymentReceipt?: TimestampedEvent
	latestMessage?: TimestampedEvent
}

function getLatestActivity(entry: OrderListingEntry): number {
	return Math.max(
		entry.order.created_at || 0,
		entry.latestStatus?.created_at || 0,
		entry.latestShipping?.created_at || 0,
		entry.latestPaymentRequest?.created_at || 0,
		entry.latestPaymentReceipt?.created_at || 0,
		entry.latestMessage?.created_at || 0,
	)
}

/** Filters by the latest order-status event and sorts by creation or latest related activity. */
export function filterAndSortOrderListings<T extends OrderListingEntry>(
	entries: readonly T[],
	statusFilter: string = 'any',
	sort: string = 'newest',
): T[] {
	const status = statusFilter.toLowerCase()
	const filtered = status === 'any' ? [...entries] : entries.filter((entry) => resolveBuyerOrderStatus(entry.latestStatus?.tags) === status)
	const byActivity = sort === 'recently-updated' || sort === 'least-updated'
	const ascending = sort === 'oldest' || sort === 'least-updated'
	const timeOf = (entry: T) => (byActivity ? getLatestActivity(entry) : entry.order.created_at || 0)

	return filtered.sort((a, b) => (ascending ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a)))
}
