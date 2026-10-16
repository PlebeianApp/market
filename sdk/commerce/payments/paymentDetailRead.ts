import type { NostrEventLike } from '../../core/nostr/eventLike'
import { readThroughStore, type EventReadContext } from '../../core/event-store/read'

export const PAYMENT_DETAIL_KIND = 30078
export const PAYMENT_DETAIL_LABEL = 'payment_detail'

export interface PaymentDetailQuery {
	author?: string
	/** Product or collection coordinate the detail is scoped to. */
	coordinate?: string
}

/** Latest, non-deleted payment-detail event per `d`; decrypting and parsing the content stays with the caller. */
export function readPaymentDetailEventsWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	query: PaymentDetailQuery,
): Promise<E[]> {
	return readThroughStore(context, [
		{
			kinds: [PAYMENT_DETAIL_KIND],
			'#l': [PAYMENT_DETAIL_LABEL],
			...(query.author && { authors: [query.author] }),
			...(query.coordinate && { '#a': [query.coordinate] }),
		},
	])
}
