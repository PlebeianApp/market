/**
 * adapter.ts — the **vendor surface, one file**. This is the only file in the module that names
 * `applesauce-common` / `applesauce-core` gift-wrap symbols.
 *
 * What the library does, and what we therefore do not write:
 *
 * - **Write.** `sealRumor(pubkey, signer)` (`applesauce-common/operations/gift-wrap`) encrypts the rumor to
 *   `pubkey` (NIP-44) and signs the kind-13 seal with the signer's key; `wrapSeal(pubkey)` then **mints its
 *   own ephemeral key** (`generateSecretKey()` inside the library) and signs the kind-1059 gift wrap with it —
 *   so the ephemeral-author requirement is satisfied by the primitive, not by us. The seal and wrap timestamps
 *   are randomised by the library. The pipeline is `eventPipe` from `applesauce-core/helpers/pipeline`.
 * - **Read.** `unlockGiftWrap(gift, signer)` decrypts the gift wrap through its seal down to the unsigned
 *   rumor, verifying the seal's signature and that the seal author matches the rumor author; the library's
 *   `getGiftWrapSeal(gift)` then hands the seal back. Nothing here re-implements seal/wrap/unwrap or NIP-44.
 *
 * The **only** seam is `toLibrarySigner`: our host-facing `DmSigner` (whose `signEvent` returns a bare
 * signature) is adapted to the library's `EventSigner` (whose `signEvent` must return a full signed event).
 * That assembly — the canonical id and the envelope — is a port adapter, not NIP-59 logic.
 */
import { getGiftWrapSeal, unlockGiftWrap } from 'applesauce-common/helpers/gift-wrap'
import { sealRumor, wrapSeal } from 'applesauce-common/operations/gift-wrap'
import type { EventSigner } from 'applesauce-core/factories'
import { pipe } from 'applesauce-core/helpers/pipeline'
import { getEventHash } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import type { DmReadResult, DmRumor, DmSignableEvent, DmSigner, DmWriteResult } from './types'

/**
 * The one seam between our `DmSigner` port and the library's `EventSigner`/`EncryptedContentSigner`.
 *
 * The library signs with a signer that returns a whole signed event; our port returns only the signature, so
 * the id and the envelope are assembled here. NIP-44 encryption/decryption is passed straight through to the
 * port's own `encrypt`/`decrypt` — the library only ever needs the operation, never a private key.
 */
export function toLibrarySigner(signer: DmSigner): EventSigner {
	return {
		getPublicKey: () => signer.getPublicKey(),
		signEvent: async (draft) => {
			const base: DmSignableEvent = {
				pubkey: (draft as { pubkey?: string }).pubkey ?? (await signer.getPublicKey()),
				created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
				kind: draft.kind,
				tags: draft.tags,
				content: draft.content,
			}
			const sig = await signer.signEvent(base)
			return { ...base, id: getEventHash(base), sig } as Event
		},
		nip44: {
			encrypt: (pubkey: string, plaintext: string) => signer.encrypt(pubkey, plaintext),
			decrypt: (pubkey: string, ciphertext: string) => signer.decrypt(pubkey, ciphertext),
		},
	}
}

/** Gift-wrap one seal to `pubkey` through the library's own pipeline. */
async function wrapTo(pubkey: string, rumor: DmRumor, signer: EventSigner): Promise<Event> {
	// `sealRumor` seals the rumor (signing the seal with the signer); `wrapSeal` mints the ephemeral author.
	return (await pipe(rumor, sealRumor(pubkey, signer), wrapSeal(pubkey))) as Event
}

/**
 * The write path. Given a rumor and the recipient's pubkey, produce the **two** gift wraps NIP-17 requires:
 * one addressed to the recipient and one self-wrap addressed to the sender's own pubkey (so the sender can
 * read back what they sent). Both wrap the same rumor; each mints a fresh ephemeral author inside the library.
 */
export async function wrapRumor(params: { rumor: DmRumor; recipientPubkey: string; signer: DmSigner }): Promise<DmWriteResult> {
	const signer = toLibrarySigner(params.signer)
	const senderPubkey = await params.signer.getPublicKey()
	const recipient = await wrapTo(params.recipientPubkey, params.rumor, signer)
	const sender = await wrapTo(senderPubkey, params.rumor, signer)
	return { rumor: params.rumor, recipient, sender }
}

/** The read path. Unwrap a gift wrap addressed to our own pubkey, through its seal, to the rumor. */
export async function unwrapGift(giftWrap: Event, signer: DmSigner): Promise<DmReadResult> {
	const rumor = await unlockGiftWrap(giftWrap, toLibrarySigner(signer))
	const seal = getGiftWrapSeal(giftWrap)
	if (!seal) throw new Error('DM gift wrap has no seal')
	return { seal: seal as Event, rumor: rumor as DmRumor }
}

/** The seal under a gift wrap, when the wrap carries one (a freshly wrapped or already-unwrapped wrap does). */
export function giftWrapSeal(giftWrap: Event): Event | undefined {
	return getGiftWrapSeal(giftWrap) as Event | undefined
}
