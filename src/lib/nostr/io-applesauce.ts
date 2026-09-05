/**
 * Applesauce-backed implementation of the {@link NostrIo} port — the
 * destination of the NDK -> applesauce migration.
 *
 * Uses `applesauce-relay`'s `RelayPool` for subscribe/fetch/publish. Relays
 * are mirrored from the NDK store for now (temporary coupling that goes away
 * when the NDK singleton is deleted in Wave D).
 *
 * `sign` routes through the attached signer capability (Wave A3): when a user
 * has logged in the `signer-registry` holds their capability and signing is
 * delegated to it with a fail-closed pubkey-equality assertion; when no
 * capability is attached it still throws (there is nothing to sign with).
 */
import { RelayGroup, RelayPool } from 'applesauce-relay'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

import { getWriteRelays, ndkStore } from '@/lib/stores/ndk'
import type { FetchOptions, NostrFilter, NostrIo, PublishOptions, SubscribeOptions } from './io'
import { getSignerCapability } from './signer-registry'

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
 * Bounded connection-retry policy for raw `req()` subscriptions.
 *
 * Restores the applesauce 5.2 `subscription()` default of retrying connection
 * errors up to 3 times with a ~1s linear backoff. Two v6 subtleties make the
 * config explicit rather than `reconnect: true`:
 *
 * - `reconnect: true` maps to RxJS `retry()` with NO count, i.e. unbounded.
 *   A relay that stays down would retry forever, keeping the subscription
 *   (and its WebSocket reconnect timer) alive with no give-up path.
 * - `resetOnSuccess: true` (5.2's default) must be dropped: v6's `req()`
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
		return new Promise<NostrEvent[]>((resolve, reject) => {
			let subscription: { unsubscribe(): void } | undefined
			const timer = setTimeout(() => {
				subscription?.unsubscribe()
				resolve(collected)
			}, opts?.timeoutMs ?? 8000)
			subscription = getPool()
				.request(urls, filters, {
					// v6 request() defaults to completeOnAny(completeAfterFirstRelay(5s), completeOnAllEose()):
					// the FIRST relay's EOSE starts a 5s fuse that can end the request before slower relays
					// deliver their events. Pin all-EOSE completion so every relay's events are collected
					// within our own timeoutMs window instead.
					complete: RelayGroup.completeOnAllEose(),
				})
				.subscribe({
					next: (event) => collected.push(event as NostrEvent),
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
		// Track per-relay EOSE so closeOnEose only stops the GROUP once every
		// relay has finished sending — the first relay's EOSE must not tear
		// down subscriptions that still have events incoming from other relays.
		// CLOSED/ERROR are terminal for that relay (resubscribe: false), so they
		// settle it too — this matches 5.2, which surfaced a failed relay as a
		// virtual EOSE instead of letting it hold the group open forever.
		const settled = new Set<string>()
		const settledTarget = urls.length
		const groupSettled = () => settled.size >= settledTarget
		// Emitted before the observable is assigned; unsubscribes right after subscribe() returns.
		const stopIfCloseOnEose = () => {
			if (!opts?.closeOnEose || stopped || !groupSettled()) return
			if (subscription) stop()
			else {
				stopped = true
				stopAfterSubscribe = true
			}
		}
		subscription = getPool()
			.req(urls, filters, {
				resubscribe: false,
				// Bounded 3-retry policy (see SUBSCRIBE_RECONNECT) — NOT the unbounded
				// `reconnect: true` that v6's raw req() would otherwise expand to.
				reconnect: SUBSCRIBE_RECONNECT,
			})
			.subscribe((message) => {
				if (message.type === 'EOSE') {
					settled.add(message.from)
					stopIfCloseOnEose()
					return
				}
				// Surface per-relay failures instead of dropping them silently:
				// with resubscribe: false a CLOSED or ERROR permanently removes
				// that relay from this subscription, and there is no other trace
				// of why its events stopped arriving.
				if (message.type === 'CLOSED' || message.type === 'ERROR') {
					console.warn('[nostr:subscribe] relay subscription issue:', message)
					settled.add(message.from)
					stopIfCloseOnEose()
					return
				}
				if (message.type === 'EVENT' && !stopped) onEvent(message.event as NostrEvent)
			})
		if (stopAfterSubscribe) subscription.unsubscribe()
		return stop
	},

	async publish(event, opts?: PublishOptions) {
		const urls = writeRelayUrls(opts?.relayUrls)
		if (urls.length === 0) throw new Error('No relays configured for publish')
		await getPool().publish(urls, event)
	},

	async sign(template: EventTemplate): Promise<NostrEvent> {
		const capability = getSignerCapability()
		if (!capability) {
			throw new Error('applesauceIo.sign: no signer capability attached (login first)')
		}
		const signed = await capability.signEvent(template)
		const pubkey = await capability.getPublicKey()
		// ADR-0008 signed-event identity invariant: in-signer verification alone
		// does not prove WHICH key signed — assert the pubkey matches the
		// authenticated user's, and fail closed otherwise.
		if (signed.pubkey !== pubkey) {
			throw new Error('Signer returned an event for a different pubkey than the authenticated user')
		}
		return signed
	},

	async getUser() {
		// Delegated to the NDK bridge until the signer migrates off NDK (Wave A3).
		const { ndkIo } = await import('./io-ndk')
		return ndkIo.getUser()
	},
}
