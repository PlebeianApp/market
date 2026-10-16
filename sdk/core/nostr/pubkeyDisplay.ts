import { nip19 } from 'nostr-tools'

/** Short, human-scannable pubkey label (e.g. "npub1abcde...wxyz") for when no profile name is known. */
export function formatPubkeyShort(pubkey: string): string {
	try {
		const npub = nip19.npubEncode(pubkey)
		return `${npub.slice(0, 10)}...${npub.slice(-4)}`
	} catch {
		return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`
	}
}
