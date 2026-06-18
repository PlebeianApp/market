import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'

function generateEphemeralKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

export const TEST_APP_PRIVATE_KEY = process.env.TEST_APP_PRIVATE_KEY || generateEphemeralKey()

export const TEST_APP_PUBLIC_KEY = getPublicKey(hexToBytes(TEST_APP_PRIVATE_KEY))

export const RELAY_URL = 'ws://localhost:10547'
export const TEST_PORT = 34567
export const BASE_URL = `http://localhost:${TEST_PORT}`
