import type { NostrEventLike } from '../nostr/eventLike'
import type { EventFilter } from './filter'

/** Why an event was or was not kept. Rejection carries the parser's reason so owner surfaces can explain it. */
export type EventStoreAddResult =
	| { status: 'added' }
	| { status: 'duplicate' }
	| { status: 'superseded' }
	| { status: 'deleted' }
	| { status: 'rejected'; reason: string }

/** Admission gate run before an event is stored; return a reason string to reject. */
export type EventAdmission<E extends NostrEventLike = NostrEventLike> = (event: E) => true | string

/**
 * Holds validated relay events with Nostr replace/delete semantics applied.
 * Hosts supply the instance (in-memory, applesauce, NDK cache); SDK workflows only see this port.
 */
export interface EventStorePort<E extends NostrEventLike = NostrEventLike> {
	add(event: E): EventStoreAddResult
	get(id: string): E | undefined
	/** Latest version of a replaceable (`d` omitted) or addressable event. */
	getReplaceable(kind: number, pubkey: string, d?: string): E | undefined
	query(filters: EventFilter | readonly EventFilter[]): E[]
	/** Called with each event that becomes current; returns an unsubscribe function. */
	subscribe(filters: EventFilter | readonly EventFilter[], listener: (event: E) => void): () => void
	/** Applied NIP-09 deletion for this event, if any. */
	isDeleted(event: E): boolean
}
