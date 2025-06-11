import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

export interface TestUser {
	privateKey: string
	publicKey: string
	npub: string
}

// Use a fixed test user for consistency across all tests
export const FIXED_TEST_USER: TestUser = {
	privateKey: '5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0', // devUser1.sk
	publicKey: '86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0', // devUser1.pk
	npub: 'npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah',
}

export function generateTestUser(): TestUser {
	const privateKey = generateSecretKey()
	const privateKeyHex = Buffer.from(privateKey).toString('hex')
	const publicKey = getPublicKey(privateKey)
	const npub = nip19.npubEncode(publicKey)

	return {
		privateKey: privateKeyHex,
		publicKey,
		npub,
	}
}
