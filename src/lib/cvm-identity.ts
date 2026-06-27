import { getPublicKey } from 'nostr-tools/pure'

/**
 * Centralized CVM (ContextVM) key resolution.
 *
 * All CVM pubkeys are resolved here so there is a single source of truth for
 * the fallback order and env-var names. No caller reads CVM env vars directly.
 *
 * Naming note (#1012): the preferred env-var name is `*_PUBLIC_KEY`. The
 * shorter `*_PUBKEY` spellings are kept as deprecated aliases for one release
 * cycle to preserve backward compatibility.
 */

function isValidHexKey(value: string): boolean {
	return /^[0-9a-fA-F]{64}$/.test(value)
}

function hexToBytes(hex: string): Uint8Array {
	return new Uint8Array(Buffer.from(hex, 'hex'))
}

/**
 * Returns the first valid 64-hex value found among the given env-var names,
 * or `null` if none is set / valid. Earlier names take precedence.
 */
function firstValidHexEnv(...names: string[]): string | null {
	for (const name of names) {
		const value = process.env[name]
		if (value && isValidHexKey(value)) return value
	}
	return null
}

/**
 * Derives a pubkey from the CVM private key (`CVM_SERVER_KEY`), or `null` if
 * it is unset or not a valid 64-hex private key.
 */
function pubkeyFromPrivateKey(): string | null {
	const privateKey = process.env.CVM_SERVER_KEY
	if (privateKey && isValidHexKey(privateKey)) {
		return getPublicKey(hexToBytes(privateKey))
	}
	return null
}

function throwNoCvmKey(): never {
	throw new Error(
		'No CVM server pubkey available. Set CVM_SERVER_PUBLIC_KEY or CVM_SERVER_KEY in your environment.',
	)
}

/**
 * Resolves the general CVM server pubkey using a consistent fallback order
 * (most specific to least specific):
 *
 *   1. Service-specific currency pubkey
 *      (`CVM_CURRENCY_SERVER_PUBLIC_KEY` / deprecated `CURRENCY_SERVER_PUBKEY`)
 *   2. General CVM pubkey
 *      (`CVM_SERVER_PUBLIC_KEY` / deprecated `CVM_SERVER_PUBKEY`)
 *   3. Derive from CVM private key (`CVM_SERVER_KEY`)
 *   4. Throw — NO hardcoded fallback
 *
 * Per Franchovy's review on #975: "currency → public → private"
 */
export function resolveCvmServerPubkey(): string {
	return (
		firstValidHexEnv('CVM_CURRENCY_SERVER_PUBLIC_KEY', 'CURRENCY_SERVER_PUBKEY') ??
		firstValidHexEnv('CVM_SERVER_PUBLIC_KEY', 'CVM_SERVER_PUBKEY') ??
		pubkeyFromPrivateKey() ??
		throwNoCvmKey()
	)
}

/**
 * Resolves the CVM auction-validator pubkey.
 *
 * Used when the auction validator runs on a different key than the currency
 * CVM (part of the `auctions/p2pk-buyer-path-custody-v1` architecture). When a
 * separate auction key is not configured, it transparently falls back to the
 * general CVM server pubkey via {@link resolveCvmServerPubkey}:
 *
 *   1. `CVM_AUCTIONS_SERVER_PUBLIC_KEY`
 *   2. resolveCvmServerPubkey() (currency → public → private → throw)
 */
export function resolveCvmAuctionsServerPubkey(): string {
	return firstValidHexEnv('CVM_AUCTIONS_SERVER_PUBLIC_KEY') ?? resolveCvmServerPubkey()
}
