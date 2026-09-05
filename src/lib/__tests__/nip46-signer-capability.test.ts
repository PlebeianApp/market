/**
 * NIP-46 (bunker) lane → `createNostrConnectCapability` parity tests
 * (ADR-0008 B-2 / B-2fix).
 *
 * Restored from the pre-B-2 `nip46-signer-capability.test.ts` parity suite and
 * re-anchored to the CURRENT seam: `createNostrConnectCapability` in
 * `nostr-connect-signer.ts` (the real seam the bunker lane now flows through).
 *
 * Two things are proven here that the earlier bridge suite could not be:
 *  1. NIP-59 parity — a NostrConnectSigner-backed capability still
 *     `createEncryptedPrivateOrderMessageWithSigner` / `decryptPrivateOrderMessageWithSigner`
 *     gift-wrap round-trips (the evidence the bunker lane still flows through
 *     NIP-59 after the A3-4 seam flip).
 *  2. Identity collapse — a bunker whose `get_public_key` reports the WRONG
 *     identity (the CHANNEL key, per the B-1 three-way mock) is rejected
 *     behaviorally at sign time, not merely observed as a structural
 *     `clientPubkey !== userPk` fact.
 *
 * The `NostrConnectSignerLike` mocks are backed by real secret keys (honest
 * crypto): signs finalize with the real key, nip44 round-trips use real
 * conversation keys, so `verifyEvent` and NIP-59 decrypt stay truthful.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'

import { createNostrConnectCapability } from '@/lib/nostr/nostr-connect-signer'
import type { NostrConnectSignerLike } from '@/lib/nostr/nostr-connect-signer'
import {
	createEncryptedPrivateOrderMessageWithSigner,
	decryptPrivateOrderMessageWithSigner,
	type PrivateOrderDeliveryDetails,
} from '@/lib/orders/privateOrderMessage'
import { NIP59_GIFT_WRAP_KIND, NIP59_SEAL_KIND } from '@/lib/nostr/nip59'

const CREATED_AT = 1_700_000_000

// Three-way key separation (B-1): the user key the bunker signs WITH vs the
// channel/remote-signer key that signs the kind-24133 transport — distinct.
const USER_SK = '33'.repeat(32)
const REMOTE_SK = '22'.repeat(32)
const userPk = getPublicKey(hexToBytes(USER_SK))
const remoteSignerPk = getPublicKey(hexToBytes(REMOTE_SK))

/** A `NostrConnectSignerLike` backed by a real secret key, with honest nip44. */
function bunkerSignerFor(secretKey: Uint8Array): NostrConnectSignerLike {
	const pubkey = getPublicKey(secretKey)
	return {
		getPublicKey: async () => pubkey,
		signEvent: async (template) => finalizeEvent(template as EventTemplate, secretKey) as unknown as NostrEvent,
		nip44: {
			encrypt: async (pk, plaintext) => nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(secretKey, pk)),
			decrypt: async (pk, ciphertext) => nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(secretKey, pk)),
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
			phone: '+155****4567',
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

describe('NostrConnectSigner-backed capability NIP-59 parity (ADR-0008 B-2fix items 2a/2b)', () => {
	test('createEncryptedPrivateOrderMessageWithSigner produces a valid signed gift wrap (parity with local lane)', async () => {
		const buyerKey = generateSecretKey()
		const sellerKey = generateSecretKey()
		const buyerPubkey = getPublicKey(buyerKey)
		const sellerPubkey = getPublicKey(sellerKey)
		const capability = createNostrConnectCapability(bunkerSignerFor(buyerKey))

		const { seal, giftWrap, rumor } = await createEncryptedPrivateOrderMessageWithSigner({
			details: privateOrderDetails(buyerPubkey, sellerPubkey),
			signer: capability,
			createdAt: CREATED_AT,
		})

		expect(rumor.pubkey).toBe(buyerPubkey)
		expect(seal.kind).toBe(NIP59_SEAL_KIND)
		expect(seal.pubkey).toBe(buyerPubkey)
		expect(verifyEvent(seal)).toBe(true)
		expect(giftWrap.kind).toBe(NIP59_GIFT_WRAP_KIND)
		expect(verifyEvent(giftWrap)).toBe(true)
	})

	test('decryptPrivateOrderMessageWithSigner recovers the order details from the gift wrap (parity with local lane)', async () => {
		const buyerKey = generateSecretKey()
		const sellerKey = generateSecretKey()
		const buyerCapability = createNostrConnectCapability(bunkerSignerFor(buyerKey))
		const sellerCapability = createNostrConnectCapability(bunkerSignerFor(sellerKey))
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

describe('NostrConnectSigner-backed capability identity collapse (ADR-0008 B-2fix item 2c)', () => {
	test('get_public_key reporting the WRONG (channel) identity is rejected behaviorally at sign time (invariant 2)', async () => {
		// Three-way key separation (B-1): the CHANNEL key (remoteSignerPk) signs
		// the kind-24133 transport envelope and must NEVER be the authenticated
		// user identity — that resolves via getPublicKey() ONLY. A collapsed bunker
		// that CLAIMS get_public_key === remoteSignerPk (the channel key) while
		// signing events with the USER key is rejected when the app signs. This is
		// behavioral (a wrong-identity sign fails closed), not a structural
		// `clientPubkey !== userPk` observation.
		const collapsed: NostrConnectSignerLike = {
			getPublicKey: async () => remoteSignerPk, // WRONG identity — the channel key
			signEvent: async (template) => finalizeEvent(template as EventTemplate, hexToBytes(USER_SK)) as unknown as NostrEvent,
			nip04: undefined,
			nip44: undefined,
		}
		const capability = createNostrConnectCapability(collapsed)

		// The claimed identity is the channel key — but the honest signature is by
		// the user key, so the signed-event identity assert fails closed.
		await expect(capability.signEvent({ kind: 1, content: 'hello', tags: [], created_at: CREATED_AT })).rejects.toThrow(/different pubkey/)
	})

	test('the authenticated user pubkey stays distinct from remote/client keys (invariant 2, structural oracle)', () => {
		const capability = createNostrConnectCapability(bunkerSignerFor(hexToBytes(USER_SK)))

		// The channel key and client identity are inherently separate; the
		// capability resolves ONLY the user identity. This guards the seam, but the
		// BEHAVIORAL rejection above is what proves collapse is caught.
		expect(userPk).not.toBe(remoteSignerPk)
		expect(capability.nip44).toBeDefined()
	})
})
