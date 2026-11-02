import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
	demoFridayFundingAuthorizationUnsignedEvent,
	demoFridayFundingKeyAuthorizationDigest,
	verifyDemoFridayBrowserFundingAuthorization,
	type DemoFridayBrowserFundingAuthorizationContentV1,
	type DemoFridayFundingKeyAuthorizationTermsV1,
} from './demo-friday-browser-funding-authorization'

const secret = hexToBytes('1'.padStart(64, '0'))
const actor = bytesToHex(schnorr.getPublicKey(secret))
const compressed = (n: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(n.toString(16).padStart(64, '0')), true))
const paymentSecret = hexToBytes('2'.padStart(64, '0'))
const refundSecret = hexToBytes('3'.padStart(64, '0'))
const returnCashuSigAllDigest = '8'.repeat(64)
const terms: DemoFridayFundingKeyAuthorizationTermsV1 = {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1', authNetworkId: 'friday-demo', chainId: 'friday-chain',
	auctionId: 'auction-1', amount: 2_500, mintUrl: 'http://127.0.0.1:3438/',
	paymentPublicKey: compressed(2), refundPublicKey: compressed(3), fundingOperationId: 'funding-1',
	bundleDigest: '4'.repeat(64), returnPackageDigest: '5'.repeat(64), returnCashuSigAllDigest,
	bidderReturnSignature: bytesToHex(schnorr.sign(hexToBytes(returnCashuSigAllDigest), paymentSecret)), expiresAt: 1_200,
}

function authorizedContent(overrides: Partial<typeof terms> = {}): DemoFridayBrowserFundingAuthorizationContentV1 {
	const value = { ...terms, ...overrides }
	const digest = demoFridayFundingKeyAuthorizationDigest(actor, value)
	return { ...value,
		paymentKeyAuthorizationSignature: bytesToHex(schnorr.sign(hexToBytes(digest), paymentSecret)),
		refundKeyAuthorizationSignature: bytesToHex(schnorr.sign(hexToBytes(digest), refundSecret)),
	}
}

function signed(overrides: Partial<typeof terms> = {}) {
	const unsigned = demoFridayFundingAuthorizationUnsignedEvent(actor, 1_000, authorizedContent(overrides))
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), secret)) }
}

describe('Friday browser funding authorization', () => {
	test('accepts a NIP-07-shaped event that binds a distinct client-held payment key', () => {
		const authorization = verifyDemoFridayBrowserFundingAuthorization(signed(), {
			authNetworkId: 'friday-demo', chainId: 'friday-chain', mintUrl: terms.mintUrl, nowSeconds: 1_100,
		})
		expect(authorization.event.pubkey).toBe(actor)
		expect(authorization.content.paymentPublicKey).toBe(compressed(2))
		const fips = signed({ mintUrl: 'http://[fd42::1]:3438' })
		expect(verifyDemoFridayBrowserFundingAuthorization(fips, {
			authNetworkId: 'friday-demo', chainId: 'friday-chain', mintUrl: 'http://[fd42::1]:3438', nowSeconds: 1_100,
		}).content.mintUrl).toBe('http://[fd42::1]:3438')
	})

	test('rejects key, amount, operation, mint, expiry, tag, and signature substitution', () => {
		const pins = { authNetworkId: 'friday-demo', chainId: 'friday-chain', mintUrl: terms.mintUrl, nowSeconds: 1_100 }
		expect(() => verifyDemoFridayBrowserFundingAuthorization(signed({ paymentPublicKey: compressed(3) }), pins)).toThrow(/keys are invalid or equal/)
		expect(() => verifyDemoFridayBrowserFundingAuthorization(signed({ amount: 50_001 }), pins)).toThrow(/amount/)
		expect(() => verifyDemoFridayBrowserFundingAuthorization(signed({ mintUrl: 'https://mint.invalid/' }), pins)).toThrow(/trusted network/)
		expect(() => verifyDemoFridayBrowserFundingAuthorization(signed({ expiresAt: 1_301 }), pins)).toThrow(/validity/)
		expect(() => verifyDemoFridayBrowserFundingAuthorization(signed({ bidderReturnSignature: '0'.repeat(128) }), pins)).toThrow(/exact Cashu return/)
		const changed = signed(); changed.tags[1] = ['a', 'another-auction']
		expect(() => verifyDemoFridayBrowserFundingAuthorization(changed, pins)).toThrow(/noncanonical/)
		const bad = signed(); bad.sig = '0'.repeat(128)
		expect(() => verifyDemoFridayBrowserFundingAuthorization(bad, pins)).toThrow(/signature/)
		const wrongKeyProof = signed(); const parsed = JSON.parse(wrongKeyProof.content)
		parsed.paymentKeyAuthorizationSignature = '0'.repeat(128); wrongKeyProof.content = JSON.stringify(parsed)
		expect(() => verifyDemoFridayBrowserFundingAuthorization(wrongKeyProof, pins)).toThrow(/proof-of-possession/)
	})
})
