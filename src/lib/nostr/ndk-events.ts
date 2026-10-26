import { NDKEvent, NDKUser, type NDKFilter, type NDKRelaySet, type NDKSigner } from '@nostr-dev-kit/ndk'
import { verifyEvent, type Event } from 'nostr-tools'
import { UnsupportedSignerOperationError, type EncryptingSigner, type SignableRumorLike } from '@sdk/core'

import type { NostrFilter, NostrIo } from './io'

export { NDKEvent }
export type { NDKFilter, NDKRelaySet, NDKSigner }

/** Adapt NDK's signer to the SDK's signing and NIP-44 encryption port. */
export function toEncryptingSigner(signer: NDKSigner): EncryptingSigner {
	return {
		async getPublicKey() {
			const user = await signer.user()
			if (!user?.pubkey) throw new Error('Signer pubkey unavailable')
			return user.pubkey
		},
		async signEvent(event: SignableRumorLike) {
			if (typeof signer.sign !== 'function') {
				throw new UnsupportedSignerOperationError('Signer does not support sign')
			}
			return await signer.sign(event as Parameters<NDKSigner['sign']>[0])
		},
		async encrypt(recipientPubkey: string, plaintext: string) {
			return await signer.encrypt(new NDKUser({ pubkey: recipientPubkey }), plaintext, 'nip44')
		},
		async decrypt(senderPubkey: string, ciphertext: string) {
			return await signer.decrypt(new NDKUser({ pubkey: senderPubkey }), ciphertext, 'nip44')
		},
		async supportsNip44(operation: 'encrypt' | 'decrypt') {
			if (typeof signer.encryptionEnabled !== 'function') return false
			if (operation === 'encrypt' && typeof signer.encrypt !== 'function') return false
			if (operation === 'decrypt' && typeof signer.decrypt !== 'function') return false
			try {
				const enabled = await signer.encryptionEnabled('nip44')
				return enabled.includes('nip44')
			} catch {
				return false
			}
		},
	}
}

type NdkEventContext = ConstructorParameters<typeof NDKEvent>[0]

export function rehydrateVerifiedNdkEvent(ndk: NdkEventContext, event: Event): NDKEvent | null {
	try {
		if (!verifyEvent(event)) return null
		return new NDKEvent(ndk, event)
	} catch {
		return null
	}
}

/**
 * Latest-wins ordering for two versions of the same deduplication-key event.
 * Higher `created_at` wins; on an equal timestamp the lexicographically lower
 * id wins (NIP-01 replaceable-event tie-break), so the winner never depends on
 * relay-arrival order.
 */
function isNewerEvent(candidate: NDKEvent, existing: NDKEvent): boolean {
	const candidateTime = candidate.created_at ?? 0
	const existingTime = existing.created_at ?? 0
	if (candidateTime !== existingTime) return candidateTime > existingTime
	return candidate.id < existing.id
}

export async function fetchNdkEventSet(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext,
	filter: NDKFilter | NDKFilter[],
): Promise<Set<NDKEvent>> {
	const rawEvents = await nostrIo.fetchEvents(filter as NostrFilter | NostrFilter[])
	// Dedupe on NDK's coordinate-level identity, not the raw event id: replaceable
	// (kind 0/3/1e4-2e4 -> `kind:pubkey`) and parameterized replaceable
	// (kind 3e4-4e4 -> `kind:pubkey:d`) events are versions of one logical event,
	// so conflicting copies collected from different relays must collapse to a
	// single latest-wins winner instead of leaking in relay-arrival order.
	const eventsByKey = new Map<string, NDKEvent>()
	for (const event of rawEvents) {
		const ndkEvent = rehydrateVerifiedNdkEvent(ndk, event)
		if (!ndkEvent) continue
		const key = ndkEvent.deduplicationKey()
		const existing = eventsByKey.get(key)
		if (!existing || isNewerEvent(ndkEvent, existing)) eventsByKey.set(key, ndkEvent)
	}
	return new Set(eventsByKey.values())
}

export function mergeNdkEventSetsById(...eventSets: Set<NDKEvent>[]): Set<NDKEvent> {
	const eventsById = new Map<string, NDKEvent>()
	for (const eventSet of eventSets) {
		for (const event of eventSet) {
			if (!eventsById.has(event.id)) eventsById.set(event.id, event)
		}
	}
	return new Set(eventsById.values())
}
