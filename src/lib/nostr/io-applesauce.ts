/**
 * Applesauce-backed implementation of the {@link NostrIo} port — the
 * destination of the NDK -> applesauce migration.
 *
 * Uses `applesauce-relay`'s `RelayPool` for subscribe/fetch/publish. Relays
 * are mirrored from the NDK store for now (temporary coupling that goes away
 * when the NDK singleton is deleted in Wave D).
 *
 * `sign` is intentionally not wired here: it lands in Wave A3 once the
 * signer (NIP-07 / nsec) is migrated off NDK. Until then, callers that need
 * signing keep routing through the NDK bridge (NIP-46 stays there longest).
 */
import { RelayPool } from 'applesauce-relay'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

import { getWriteRelays, ndkStore } from '@/lib/stores/ndk'
import type { FetchOptions, NostrFilter, NostrIo, PublishOptions, PublishResult, SubscribeOptions } from './io'

let pool: RelayPool | null = null

function getPool(): RelayPool {
	if (!pool) pool = new RelayPool()
	return pool
}

/** Resolve target relays: explicit override wins, else mirror NDK's configured relays. */
function relayUrls(override?: string[]): string[] {
	if (override && override.length > 0) return override
	return ndkStore.state.explicitRelayUrls
}

function writeRelayUrls(override?: string[]): string[] {
	if (override && override.length > 0) return override
	return getWriteRelays()
}

function asFilters(filter: NostrFilter | NostrFilter[]): NostrFilter[] {
	return Array.isArray(filter) ? filter : [filter]
}

/**
 * Bounded connection-retry policy for `subscription()` relay streams.
 *
 * Restores the applesauce 5.2 `subscription()` default of retrying connection
 * errors up to 3 times with a ~1s linear backoff. Two v6 subtleties make the
 * config explicit rather than `reconnect: true`:
 *
 * - `reconnect: true` maps to RxJS `retry()` with NO count, i.e. unbounded.
 *   A relay that stays down would retry forever, keeping the subscription
 *   (and its WebSocket reconnect timer) alive with no give-up path.
 * - `resetOnSuccess: true` (5.2's default) must be dropped: v6's relay stream
 *   emits an OPEN message per relay on every resubscribe attempt, which the
 *   retry operator would treat as "success" and re-arm the counter, making
 *   the bound unreachable for a relay that fails right after opening.
 */
const SUBSCRIBE_RECONNECT = {
	count: 3,
	delay: 1000,
} as const

export const applesauceIo: NostrIo = {
	fetchEvents(filter, opts?: FetchOptions) {
		const urls = relayUrls(opts?.relayUrls)
		if (urls.length === 0) return Promise.resolve([])
		const filters = asFilters(filter)
		const collected: NostrEvent[] = []
		// Deduplicate by event id.
		//
		// `RelayPool.request(urls, filters)` delivers an event once per matching
		// filter, so a request with several filters (e.g. fetchAuctionBids sends
		// `#e` AND `#a`) emits any event carrying both tags more than once. The
		// NDK adapter this port replaces returned a `Set` (deduplicated by
		// `deduplicationKey()`, see `ndkActions.fetchEventsWithTimeout`), and the
		// `NostrIo` port documents a single collection of matching events. Callers
		// rely on that: duplicate bids make `computeValidatedBids`' M5
		// same-bidder proof-reuse screen flag a legitimate bid as invalid, which
		// aborts a settlement publish.
		//
		// Uniqueness is therefore part of the port contract and is enforced here,
		// at the seam, so every caller gets it.
		const seenIds = new Set<string>()
		return new Promise<NostrEvent[]>((resolve, reject) => {
			let subscription: { unsubscribe(): void } | undefined
			const timer = setTimeout(() => {
				subscription?.unsubscribe()
				resolve(collected)
			}, opts?.timeoutMs ?? 8000)
			subscription = getPool()
				.request(urls, filters)
				.subscribe({
					next: (event) => {
						const raw = event as NostrEvent
						const id = raw?.id
						if (id) {
							if (seenIds.has(id)) return
							seenIds.add(id)
						}
						collected.push(raw)
					},
					complete: () => {
						clearTimeout(timer)
						resolve(collected)
					},
					error: (err) => {
						clearTimeout(timer)
						reject(err)
					},
				})
		})
	},

	subscribe(filter, onEvent, opts?: SubscribeOptions) {
		const urls = relayUrls(opts?.relayUrls)
		if (urls.length === 0) return () => {}
		const filters = asFilters(filter)
		let subscription: { unsubscribe(): void } | undefined
		let stopAfterSubscribe = false
		let stopped = false
		const stop = () => {
			if (stopped) return
			stopped = true
			subscription?.unsubscribe()
		}
		// Group subscription emits a single EOSE only after every relay has
		// settled, so closeOnEose should stop on that group-level marker.
		const stopIfCloseOnEose = () => {
			if (!opts?.closeOnEose || stopped) return
			if (subscription) stop()
			else {
				stopped = true
				stopAfterSubscribe = true
			}
		}
		subscription = getPool()
			.subscription(urls, filters, {
				resubscribe: false,
				// Bounded 3-retry policy (see SUBSCRIBE_RECONNECT) — NOT the unbounded
				// `reconnect: true` that v6's subscription stream would otherwise expand to.
				reconnect: SUBSCRIBE_RECONNECT,
			})
			.subscribe((message) => {
				if (message === 'EOSE') {
					stopIfCloseOnEose()
					return
				}
				if (!stopped) onEvent(message as NostrEvent)
			})
		if (stopAfterSubscribe) subscription.unsubscribe()
		return stop
	},

	async publish(event, opts?: PublishOptions): Promise<PublishResult> {
		const urls = writeRelayUrls(opts?.relayUrls)
		if (urls.length === 0) throw new Error('No relays configured for publish')
		// RelayPool.publish resolves with one PublishResponse per relay that
		// answered (errors are mapped to ok:false responses). Only ok responses
		// are ACKs; surface those URLs so callers can fail closed on zero.
		const responses = await getPool().publish(urls, event)
		return { publishedRelays: new Set(responses.filter((response) => response.ok).map((response) => response.from)) }
	},

	async sign(_template: EventTemplate) {
		throw new Error('applesauceIo.sign is not wired until Wave A3 (auth/signer migration)')
	},

	async getUser() {
		// Delegated to the NDK bridge until the signer migrates off NDK (Wave A3).
		const { ndkIo } = await import('./io-ndk')
		return ndkIo.getUser()
	},
}
