export interface NostrEventLike {
	id: string
	pubkey: string
	kind: number
	created_at?: number
	content: string
	tags: string[][]
	sig?: string
}

/**
 * Normalize either a raw Nostr event or a wrapper exposing `rawEvent()`.
 * Keeping this compatibility at the boundary lets consumers work with raw
 * protocol events without depending on a particular relay client library.
 */
export const toRawEvent = (event: NostrEventLike): NostrEventLike => {
	const maybeRawEvent = (event as { rawEvent?: unknown }).rawEvent
	if (typeof maybeRawEvent === 'function') return maybeRawEvent.call(event) as NostrEventLike
	return event
}

export const getEventAddress = (event: NostrEventLike): string => {
	const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
	return `${event.kind}:${event.pubkey}:${identifier}`
}
