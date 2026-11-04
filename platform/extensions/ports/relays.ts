import { verifyNostrEvent } from '@sdk/core/nostr/eventValidation'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { NostrRelayPort } from '@sdk/core/ports/nostrRelay'
import type { ScopedRelayPort } from '@sdk/core/extensions'

export interface ScopedRelayPortOptions {
	/** Bound by Platform from instance config; extensions cannot widen it. */
	relayUrls: readonly string[]
	/** Granted only with the `relays:publish` host port. */
	allowPublish: boolean
	/** Ends subscriptions when the extension stops. */
	signal?: AbortSignal
}

/** Wraps a host relay port with a fixed relay list. Publish, if granted, accepts only validly signed events. */
export function createScopedRelayPort(port: NostrRelayPort, options: ScopedRelayPortOptions): ScopedRelayPort {
	const relayUrls = Object.freeze([...options.relayUrls])
	const scoped: ScopedRelayPort = {
		fetchEvents: (filters, queryOptions) => {
			const signals = [queryOptions?.signal, options.signal].filter((signal): signal is AbortSignal => signal !== undefined)
			const query = port.fetchEvents(filters, relayUrls)
			return signals.length === 0 ? query : raceAbort(query, AbortSignal.any(signals))
		},
		subscribe(filters, onEvent) {
			if (options.signal?.aborted) return () => undefined
			const unsubscribe = port.subscribe(filters, onEvent, relayUrls)
			options.signal?.addEventListener('abort', unsubscribe, { once: true })
			return () => {
				options.signal?.removeEventListener('abort', unsubscribe)
				unsubscribe()
			}
		},
	}
	if (options.allowPublish) {
		scoped.publish = async (event) => {
			const verified = verifyNostrEvent(event)
			if (!verified.ok) throw new Error('Extensions may only publish validly signed events')
			return port.publish(verified.value as NostrEventLike, relayUrls)
		}
	}
	return scoped
}

function raceAbort<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
	if (signal.aborted) {
		promise.catch(() => undefined)
		return Promise.reject(signal.reason)
	}
	let onAbort: () => void = () => undefined
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason)
		signal.addEventListener('abort', onAbort, { once: true })
	})
	return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', onAbort))
}
