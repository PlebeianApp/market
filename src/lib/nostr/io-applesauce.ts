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
import type { FetchOptions, NostrFilter, NostrIo, PublishOptions, SubscribeOptions } from './io'

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
		subscription = getPool()
			.subscription(urls, filters, { resubscribe: false })
			.subscribe((message) => {
				if (message === 'EOSE') {
					if (opts?.closeOnEose) {
						if (subscription) stop()
						else {
							stopped = true
							stopAfterSubscribe = true
						}
					}
					return
				}
				if (!stopped) onEvent(message as NostrEvent)
			})
		if (stopAfterSubscribe) subscription.unsubscribe()
		return stop
	},

	async publish(event, opts?: PublishOptions) {
		const urls = writeRelayUrls(opts?.relayUrls)
		if (urls.length === 0) throw new Error('No relays configured for publish')
		await getPool().publish(urls, event)
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
