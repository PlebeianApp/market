/**
 * Interim NIP-46 → SignerCapability bridge tests (ADR-0008 A3-4fix).
 *
 * The bridge wraps an NDK `NDKNip46Signer` in the exact `SignerCapability`
 * shape the nsec / NIP-07 lanes already produce, so the bunker lane flows
 * through the same seam the A3-4 flip (nip59 / privateOrderMessage /
 * publish/orders.tsx / queries/orders.tsx) now consumes. Before the bridge,
 * bunker login attached `undefined` and private-delivery orders threw
 * "Encrypted seller delivery could not be prepared".
 *
 * The mock signer is backed by a real local secret key (never a fake pubkey):
 * getPublicKey / sign / encrypt / decrypt all derive from that key, so
 * `verifyEvent` and the NIP-44 round-trips stay cryptographically honest.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
import type { EventTemplate } from 'nostr-tools/pure'

import { createNip46Signer, createNip46SignerCapability } from '@/lib/nostr/nip46-signer-capability'
import {
	createEncryptedPrivateOrderMessageWithSigner,
	decryptPrivateOrderMessageWithSigner,
	type PrivateOrderDeliveryDetails,
} from '@/lib/orders/privateOrderMessage'
import { NIP59_GIFT_WRAP_KIND, NIP59_SEAL_KIND } from '@/lib/nostr/nip59'

const CREATED_AT = 1_700_000_000

/** The subset of NDKNip46Signer the bridge calls. */
type Nip46SignerLike = {
	blockUntilReady: () => Promise<{ pubkey: string }>
	getPublicKey: () => Promise<string>
	sign: (event: { kind?: number; tags: string[][]; content: string; created_at: number; id?: string }) => Promise<string>
	encrypt: (recipient: { pubkey: string }, value: string, scheme: string) => Promise<string>
	decrypt: (sender: { pubkey: string }, value: string, scheme: string) => Promise<string>
}

/** A bunker signer emulated with a real secret key so signatures decrypt honestly. */
function nip46SignerFor(secretKey: Uint8Array): Nip46SignerLike {
	const pubkey = getPublicKey(secretKey)
	return {
		blockUntilReady: async () => ({ pubkey }),
		getPublicKey: async () => pubkey,
		sign: async (event) => {
			const finalized = finalizeEvent(
				{ kind: event.kind, tags: event.tags, content: event.content, created_at: event.created_at } as EventTemplate,
				secretKey,
			)
			return finalized.sig
		},
		encrypt: async (recipient, value) => {
			const conversationKey = nip44.v2.utils.getConversationKey(secretKey, recipient.pubkey)
			return nip44.v2.encrypt(value, conversationKey)
		},
		decrypt: async (sender, value) => {
			const conversationKey = nip44.v2.utils.getConversationKey(secretKey, sender.pubkey)
			return nip44.v2.decrypt(value, conversationKey)
		},
	}
}

function privateOrderDetails(buyerPubkey: string, sellerPubkey: string): PrivateOrderDeliveryDetails {
	return {
		orderId: 'order-123',
		buyerPubkey,
		sellerPubkey,
		totalAmountSats: 2100,
		shippingRef: `30406:${sellerPubkey}:standard`,
		items: [{ productRef: `30402:${sellerPubkey}:product-1`, quantity: 2 }],
		delivery: {
			name: 'Satoshi Nakamoto',
			email: 'buyer@example.com',
			phone: '+15551234567',
			address: {
				firstLineOfAddress: '123 Main Street',
				additionalInformation: 'Apt Secret Notes',
				city: 'Los Angeles',
				zipPostcode: '90210',
				country: 'United States',
			},
		},
		orderNotes: 'Leave the package behind the planter',
	}
}

describe('createNip46Signer', () => {
	// A self-extending debug chain is all `new NDKNip46Signer` needs at
	// construction time (NDK builds `ndk.debug.extend("nip46:signer")` and the
	// RPC layer calls `.extend("rpc-pool")` on the result before any network).
	const makeDebug = Object.assign(() => {}, { extend: () => makeDebug })

	test('the bunker lane produces a signer bundle whose capability is defined (not undefined)', () => {
		const fakeNdk = { debug: makeDebug } as never
		const bundle = createNip46Signer(fakeNdk, 'bunker://deadbeef?relay=wss://relay.example.com', {
			privateKey: 'nsec1placeholder',
			pubkey: 'd'.repeat(64),
		} as never)

		expect(bundle.signer).toBeDefined()
		expect(bundle.capability).toBeDefined()
		// Regression guard: before the bridge, the NIP-46 lane had NO capability
		// (login set `undefined`). The bundle must carry a full capability.
		expect(typeof bundle.capability.getPublicKey).toBe('function')
		expect(typeof bundle.capability.signEvent).toBe('function')
		expect(bundle.capability.nip44).toBeDefined()
		expect(bundle.capability.nip04).toBeDefined()
	})
})

describe('createNip46SignerCapability', () => {
	test('exposes getPublicKey, signEvent, nip44 and nip04 for the bunker pubkey', async () => {
		const key = generateSecretKey()
		const capability = createNip46SignerCapability(nip46SignerFor(key))

		expect(await capability.getPublicKey()).toBe(getPublicKey(key))
		expect(typeof capability.signEvent).toBe('function')
		expect(capability.nip44).toBeDefined()
		expect(capability.nip44?.encrypt).toBeTypeOf('function')
		expect(capability.nip44?.decrypt).toBeTypeOf('function')
		expect(capability.nip04).toBeDefined()
		expect(capability.nip04?.encrypt).toBeTypeOf('function')
		expect(capability.nip04?.decrypt).toBeTypeOf('function')
	})

	test('signEvent returns a valid signature and canonical id for the signer pubkey', async () => {
		const key = generateSecretKey()
		const pubkey = getPublicKey(key)
		const capability = createNip46SignerCapability(nip46SignerFor(key))

		const signed = await capability.signEvent({
			kind: 1,
			content: 'hello bunker',
			created_at: CREATED_AT,
			tags: [],
			pubkey,
		})

		expect(signed.pubkey).toBe(pubkey)
		expect(signed.id).toBe(getEventHash({ kind: 1, content: 'hello bunker', created_at: CREATED_AT, tags: [], pubkey }))
		expect(signed.sig).toBeTypeOf('string')
		expect(verifyEvent(signed)).toBe(true)
	})

	test('bunker-backed capability produces a valid signed private-order gift wrap (parity with local lane)', async () => {
		const buyerKey = generateSecretKey()
		const sellerKey = generateSecretKey()
		const buyerCapability = createNip46SignerCapability(nip46SignerFor(buyerKey))
		const buyerPubkey = getPublicKey(buyerKey)
		const sellerPubkey = getPublicKey(sellerKey)

		const { seal, giftWrap, rumor } = await createEncryptedPrivateOrderMessageWithSigner({
			details: privateOrderDetails(buyerPubkey, sellerPubkey),
			signer: buyerCapability,
			createdAt: CREATED_AT,
		})

		expect(rumor.pubkey).toBe(buyerPubkey)
		expect(seal.kind).toBe(NIP59_SEAL_KIND)
		expect(seal.pubkey).toBe(buyerPubkey)
		expect(verifyEvent(seal)).toBe(true)
		expect(giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(verifyEvent(giftWrap)).toBe(true)
	})

	test('bunker-backed capability decrypts a private-order gift wrap to order details (parity with local lane)', async () => {
		const buyerKey = generateSecretKey()
		const sellerKey = generateSecretKey()
		const buyerCapability = createNip46SignerCapability(nip46SignerFor(buyerKey))
		const sellerCapability = createNip46SignerCapability(nip46SignerFor(sellerKey))
		const buyerPubkey = getPublicKey(buyerKey)
		const sellerPubkey = getPublicKey(sellerKey)
		const details = privateOrderDetails(buyerPubkey, sellerPubkey)

		const { giftWrap, rumor } = await createEncryptedPrivateOrderMessageWithSigner({
			details,
			signer: buyerCapability,
			createdAt: CREATED_AT,
		})

		const decrypted = await decryptPrivateOrderMessageWithSigner({
			giftWrap,
			signer: sellerCapability,
			expectedSellerPubkey: sellerPubkey,
			expectedBuyerPubkey: buyerPubkey,
		})

		expect(decrypted.rumor).toEqual(rumor)
		expect(decrypted.seal.pubkey).toBe(buyerPubkey)
		expect(decrypted.details).toEqual(details)
	})
})
