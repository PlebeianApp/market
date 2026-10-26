/**
 * index.ts — the contract entry: the write path (`wrapDm`), the read path (`unwrapDm`), the relay targets
 * (`resolveDmRelayTargets` / `dmRelaySourceFromEvents`) and the module's types.
 *
 * **What is ours.** The contract; the two-wraps-per-send rule (recipient + sender self-wrap) and the direction
 * split; the structural `DmSigner` / `DmRelaySource` shapes; and the `ready` rule (both sides must answer a
 * non-empty `10050`). The vendor supplies the seal, the wrap, the ephemeral author and the unwrap; relay-config
 * supplies the `10050` parse. Not one of those is re-written here.
 *
 * **What is not here at all.** A private key, a NIP-44 implementation, a `relay`-tag parser, a pool, a socket,
 * or a store of our own beyond the one relay-config requires to answer `dmRelays`.
 */
import type { Event } from 'nostr-tools'
import { giftWrapSeal, unwrapGift, wrapRumor } from './adapter'
import { dmRelaySourceFromEvents, resolveDmRelayTargets } from './relay-source'
import type { DmReadResult, DmRumor, DmSigner, DmWriteResult } from './types'

/**
 * The write path. Given a rumor, the recipient's pubkey and a signer, produce the two gift wraps NIP-17
 * requires — one for the recipient, one self-wrap for the sender — through the library's primitives.
 */
async function wrapDm(params: { rumor: DmRumor; recipientPubkey: string; signer: DmSigner }): Promise<DmWriteResult> {
	return wrapRumor(params)
}

/** The read path. Unwrap a gift wrap addressed to our own pubkey, through its seal, to the rumor. */
async function unwrapDm(params: { giftWrap: Event; signer: DmSigner }): Promise<DmReadResult> {
	return unwrapGift(params.giftWrap, params.signer)
}

export { wrapDm, unwrapDm, dmRelaySourceFromEvents, resolveDmRelayTargets, giftWrapSeal }
export { DM_GIFT_WRAP_KIND, DM_RELAYS_KIND, DM_SEAL_KIND } from './types'
export type {
	DmPublishPort,
	DmReadResult,
	DmRelayListEvent,
	DmRelaySource,
	DmRelayTargets,
	DmRumor,
	DmSignableEvent,
	DmSigner,
	DmWriteResult,
} from './types'
