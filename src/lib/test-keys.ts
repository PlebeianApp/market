import { getPublicKey } from 'nostr-tools/pure'

export interface TestKeyPair {
	pk: string
	sk: string
}

function generateKeyPair(): TestKeyPair {
	const skBytes = crypto.getRandomValues(new Uint8Array(32))
	const sk = Array.from(skBytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
	const pk = getPublicKey(skBytes)
	return { pk, sk }
}

const cache = new Map<string, TestKeyPair>()

export function generateTestKeyPair(name: string): TestKeyPair {
	if (cache.has(name)) return cache.get(name)!
	const pair = generateKeyPair()
	cache.set(name, pair)
	return pair
}

export function resetTestKeys(): void {
	cache.clear()
}
