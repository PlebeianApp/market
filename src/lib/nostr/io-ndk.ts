/**
 * Temporary NDK-backed implementation of the {@link NostrIo} port.
 *
 * This bridges the existing NDK singleton (`@/lib/stores/ndk`) onto the
 * library-agnostic seam. It is the default adapter during the migration and
 * is deleted in Wave D once every caller has flipped to `io-applesauce.ts`.
 */
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import type { FetchOptions, NostrFilter, NostrIo, SubscribeOptions } from './io'

/** Convert an NDKEvent into a raw nostr-tools event. */
function toRaw(event: NDKEvent): NostrEvent {
	return event.rawEvent() as unknown as NostrEvent
}

export const ndkIo: NostrIo = {
	async fetchEvents(filter, opts?: FetchOptions) {
		const ndk = ndkStore.state.ndk
		const relaySet = opts?.relayUrls?.length && ndk ? NDKRelaySet.fromRelayUrls(opts.relayUrls, ndk) : undefined
		const events = await ndkActions.fetchEventsWithTimeout(filter as NostrFilter[], {
			timeoutMs: opts?.timeoutMs,
			relaySet,
		})
		return Array.from(events).map(toRaw)
	},

	subscribe(filter, onEvent, opts?: SubscribeOptions) {
		const ndk = ndkStore.state.ndk
		if (!ndk) return () => {}
		const relaySet = opts?.relayUrls?.length ? NDKRelaySet.fromRelayUrls(opts.relayUrls, ndk) : undefined
		const subscriptionOpts = {
			closeOnEose: opts?.closeOnEose ?? false,
			onEvent: (event: NDKEvent) => onEvent(toRaw(event)),
		}
		const subscription = relaySet
			? ndk.subscribe(filter as NostrFilter[], subscriptionOpts, relaySet)
			: ndk.subscribe(filter as NostrFilter[], subscriptionOpts)
		return () => {
			subscription.stop()
		}
	},

	async publish(event) {
		const ndk = ndkStore.state.ndk
		if (!ndk) throw new Error('NDK not initialized')
		const ndkEvent = new NDKEvent(ndk, event)
		await ndkActions.publishEvent(ndkEvent)
	},

	async sign(template: EventTemplate) {
		const ndk = ndkStore.state.ndk
		if (!ndk) throw new Error('NDK not initialized')
		const signer = ndkActions.getSigner()
		if (!signer) throw new Error('No signer available')
		const ndkEvent = new NDKEvent(ndk, template)
		await ndkEvent.sign(signer)
		return toRaw(ndkEvent)
	},

	async getUser() {
		const user = await ndkActions.getUser()
		return user?.pubkey ? { pubkey: user.pubkey } : null
	},
}
