/**
 * harness.ts — the host side of the component, for the tests. It is **not** part of the implementation's
 * inventory of behaviour; it is the specimen the tests hand it: a run-time identity, an `DmSigner` adapter
 * over a raw private key (the same shape the SDK's host port offers), a signed relay-list event, and a rumor
 * builder. No fixture is shared between cases and no socket is opened.
 */
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, nip44 } from 'nostr-tools'
import type { Event, UnsignedEvent } from 'nostr-tools'
import type { DmRelayListEvent, DmRumor, DmSigner } from './types'

/** A key pair minted at run time — no fixture, no shared pubkey between cases. */
export type Identity = { secret: Uint8Array; pubkey: string }

export function identity(): Identity {
	const secret = generateSecretKey()
	return { secret, pubkey: getPublicKey(secret) }
}

/** Our host-facing signer port, over a raw private key: bare signature out, NIP-44 passed through. */
export function signerFor(privateKey: Uint8Array): DmSigner {
	return {
		getPublicKey: async () => getPublicKey(privateKey),
		signEvent: async (event) =>
			finalizeEvent(
				{
					kind: event.kind,
					created_at: event.created_at,
					tags: event.tags,
					content: event.content,
					pubkey: event.pubkey,
				} as UnsignedEvent,
				privateKey,
			).sig,
		encrypt: async (recipient, plaintext) => nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(privateKey, recipient)),
		decrypt: async (sender, ciphertext) => nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(privateKey, sender)),
		supportsNip44: async () => true,
	}
}

/** A canonical (id-stamped) unsigned rumor. */
export function rumor(params: { pubkey: string; tags: string[][]; content: string; kind?: number; createdAt?: number }): DmRumor {
	const base = {
		pubkey: params.pubkey,
		created_at: params.createdAt ?? 20,
		kind: params.kind ?? 16,
		tags: params.tags,
		content: params.content,
	}
	return { ...base, id: getEventHash(base) }
}

/** A signed relay-list event: `relays` `relay` tags on one event (the `10050` shape). */
export function relayList(kind: number, who: Identity, relays: string[], createdAt = 10): Event {
	return finalizeEvent({ kind, created_at: createdAt, tags: relays.map((url) => ['relay', url]), content: '' }, who.secret)
}

export const asRelayEvent = (event: Event): DmRelayListEvent => event as DmRelayListEvent
