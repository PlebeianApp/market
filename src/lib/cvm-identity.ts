import { getPublicKey } from 'nostr-tools/pure'

function isValidHexPubkey(value: string): boolean {
	return /^[0-9a-fA-F]{64}$/.test(value)
}

function hexToBytes(hex: string): Uint8Array {
	return new Uint8Array(Buffer.from(hex, 'hex'))
}

/**
 * Resolves the CVM server pubkey using a consistent fallback order
 * (most specific to least specific):
 *
 *   1. Service-specific pubkey (CVM_CURRENCY_SERVER_PUBLIC_KEY / CURRENCY_SERVER_PUBKEY)
 *   2. General CVM pubkey (CVM_SERVER_PUBLIC_KEY / CVM_SERVER_PUBKEY)
 *   3. Derive from CVM private key (CVM_SERVER_KEY)
 *   4. Throw — NO hardcoded fallback
 *
 * Per Franchovy's review on #975: "currency → public → private"
 */
export function resolveCvmServerPubkey(): string {
	const servicePubkey = process.env.CVM_CURRENCY_SERVER_PUBLIC_KEY || process.env.CURRENCY_SERVER_PUBKEY
	if (servicePubkey && isValidHexPubkey(servicePubkey)) return servicePubkey

	const generalPubkey = process.env.CVM_SERVER_PUBLIC_KEY || process.env.CVM_SERVER_PUBKEY
	if (generalPubkey && isValidHexPubkey(generalPubkey)) return generalPubkey

	const privateKey = process.env.CVM_SERVER_KEY
	if (privateKey && isValidHexPubkey(privateKey)) {
		return getPublicKey(hexToBytes(privateKey))
	}

	throw new Error('No CVM server pubkey available. Set CVM_SERVER_PUBLIC_KEY or CVM_SERVER_KEY in your environment.')
}
