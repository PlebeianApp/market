import { nip19 } from 'nostr-tools'

/**
 * The allocation the editor shows for one recipient. Deliberately unit-neutral:
 * `bps` is expressed in whatever unit the call site declared (see
 * `lib/v4v/allocations.ts`), and `locked` marks a participant the surface has
 * already committed to and that the editor therefore must not remove or reprice.
 */
export interface V4VShare {
	readonly id: string
	readonly name: string
	readonly pubkey: string
	/** The allocation, in the unit the call site declared. */
	readonly bps: number
	/** A fixed participant (e.g. an auction validator): cannot be removed or repriced. */
	readonly locked?: boolean
	/** Why the row is fixed, shown on the locked row itself. */
	readonly lockedReason?: string
}

/** What a new recipient must be able to do before it may be added. */
export interface V4VRecipientRequirement {
	/** Whether the check applies at all (an auction, for instance, may not need zaps). */
	readonly required: boolean
	/** The check's answer for the currently typed recipient; undefined until it resolves. */
	readonly satisfied?: boolean | undefined
	/** Whether the answer is still in flight. */
	readonly checking: boolean
	/** Copy shown while checking. */
	readonly checkingMessage: string
	/** Copy shown when the recipient does not satisfy the requirement. */
	readonly unsatisfiedMessage: string
}

/** The pubkey side of an npub-or-hex identifier, and its npub form. */
export const pubkeyForms = (identifier: string): { pubkey: string; npub: string } => {
	if (identifier.startsWith('npub')) {
		try {
			const { data } = nip19.decode(identifier)
			if (typeof data === 'string') return { pubkey: data, npub: identifier }
		} catch {
			// An undecodable npub stays as typed; the caller renders it as invalid.
			return { pubkey: identifier, npub: identifier }
		}
	}
	try {
		return { pubkey: identifier, npub: nip19.npubEncode(identifier) }
	} catch {
		return { pubkey: identifier, npub: identifier }
	}
}
