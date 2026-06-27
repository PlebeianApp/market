import { getPublicKey } from 'nostr-tools/pure'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils.js'

export interface TestKeyPair {
	pk: string
	sk: string
}

/**
 * Derives a deterministic secp256k1 keypair from an arbitrary label.
 *
 * Test identities (e2e fixtures, scenarios) are referenced across multiple
 * processes. The most important case: `e2e/seed-relay.ts` publishes the admin
 * list (kind 30000) including `devUser1.pk`, and the dev server caches that
 * list once at startup. The Playwright test worker runs in a *separate*
 * process and logs in as `devUser1` — if the two computed different random
 * keys, the seeded user would not be recognised as an admin and every
 * merchant flow would fail.
 *
 * Deriving the key from a stable label (instead of `crypto.getRandomValues`)
 * guarantees every process agrees on the same key for the same identity. And
 * because the key is computed at runtime from a label — never written as a
 * 64-hex literal — it stays out of the repo's source text, which the security
 * pre-commit/CI scan (`scripts/git-hooks/pre-commit`) flags.
 *
 * The label is mixed with a domain-separation prefix so these test-only keys
 * cannot collide with any real key.
 */
const DOMAIN = 'plebeian-market:test-key:v1:'

function derivePrivateKey(label: string): string {
	return bytesToHex(sha256(utf8ToBytes(DOMAIN + label)))
}

const cache = new Map<string, TestKeyPair>()

export function generateTestKeyPair(name: string): TestKeyPair {
	const cached = cache.get(name)
	if (cached) return cached

	const sk = derivePrivateKey(name)
	const pk = getPublicKey(new Uint8Array(Buffer.from(sk, 'hex')))
	const pair: TestKeyPair = { pk, sk }
	cache.set(name, pair)
	return pair
}

export function resetTestKeys(): void {
	cache.clear()
}
