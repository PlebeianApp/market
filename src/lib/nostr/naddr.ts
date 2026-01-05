import { nip19 } from 'nostr-tools'

export function naddrFromAddress(kind: number, pubkey: string, identifier: string, relays?: string[]): string {
	return nip19.naddrEncode({ kind, pubkey, identifier, relays })
}
