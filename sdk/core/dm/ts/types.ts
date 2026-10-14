/**
 * types.ts — the vocabulary of the `dm` contract.
 *
 * The spec is `../dm.md`; this file is the one implementation's spelling of it. It declares the component's
 * own shapes **once**, structurally — it imports **no sibling module's types**. The signer shape mirrors the
 * SDK's host-facing signing port, and the relay source mirrors the relay-config port; both are declared here
 * as the *shapes the component needs*, so the component lands and rebases independently of either.
 *
 * A NIP-59 **rumor** is an unsigned event with a canonical `id` (the library's own `Rumor` shape). A
 * **gift wrap** is a signed kind-1059 event (mirrors `nostr-tools`' `Event`).
 */
import type { Event } from 'nostr-tools'
import type { Observable } from 'rxjs'

/**
 * A NIP-59 rumor: an unsigned event carrying its canonical `id`. This is exactly the library's `Rumor`
 * (`UnsignedEvent & { id: string }`), declared here so the component names no vendor type at its boundary.
 */
export type DmRumor = {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
}

/** The event a signer stamps and signs, in the shape our host-facing port already speaks. */
export type DmSignableEvent = {
	kind: number
	content: string
	created_at: number
	tags: string[][]
	pubkey: string
}

/**
 * The signer shape the write and read paths need, declared here (never imported from a sibling module).
 *
 * `signEvent` returns a **bare signature** — that is our host port's contract, and `adapter.ts` is the one
 * place that assembles the library's full-event shape around it. NIP-44 encryption/decryption is passed
 * straight through; the component never sees a private key.
 */
export interface DmSigner {
	getPublicKey(): Promise<string>
	signEvent(event: DmSignableEvent): Promise<string>
	encrypt(recipientPubkey: string, plaintext: string): Promise<string>
	decrypt(senderPubkey: string, ciphertext: string): Promise<string>
	supportsNip44(operation: 'encrypt' | 'decrypt'): Promise<boolean>
}

/**
 * A relay-list event as the DM path receives it. The DM relay list is kind **10050**; the component never
 * parses its `relay` tags itself — the relay-config port does, through the library's validator and parser.
 */
export type DmRelayListEvent = {
	id?: string
	kind: number
	pubkey: string
	created_at: number
	tags: string[][]
	content?: string
}

/**
 * The structural relay-config surface the DM path reads. **Only `dmRelays` is used** — the recipient's and the
 * sender's kind-**10050** DM relay list. The shape is declared here (the relay-config port is not imported),
 * so this component depends on relay-config only through this interface.
 *
 * `dmRelays` answers `undefined` when no `10050` exists — the **library's** own answer; **no `10002` is ever
 * substituted** for a missing `10050` (NIP-17's MUST).
 */
export interface DmRelaySource {
	dmRelays(pubkey: string): Observable<string[] | undefined>
}

/**
 * The resolved DM relay targets — relay-config's own answer per side. `undefined` means "no `10050`", and the
 * target is then not ready. There is **no status enum and no source event here**: relay-config answers relay
 * URLs, and the component does not re-derive anything from the raw list events.
 */
export type DmRelayTargets = {
	/** True only when **both** sides answered a non-empty `10050`. */
	ready: boolean
	recipientPubkey: string
	senderPubkey: string
	/** The recipient's `10050` (where the recipient reads), or `undefined`. */
	recipient: string[] | undefined
	/** The sender's own `10050` (the self-wrap target), or `undefined`. */
	sender: string[] | undefined
}

/** The write path's result: the rumor plus the two gift wraps (recipient-facing and sender self-wrap). */
export type DmWriteResult = {
	rumor: DmRumor
	recipient: Event
	sender: Event
}

/** The read path's result: the seal under the gift wrap and the rumor under the seal. */
export type DmReadResult = {
	seal: Event
	rumor: DmRumor
}
