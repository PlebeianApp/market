import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayFundingAuthorizationUnsignedEvent,
	demoFridayFundingKeyAuthorizationDigest,
} from './demo-friday-browser-funding-authorization'
import {
	demoIntegratedFundingV4AdmissionSignatureDigest,
	demoIntegratedFundingV4ReceiptDigest,
	finalizeDemoIntegratedFundingReceiptV4,
	prepareDemoIntegratedFundingReceiptV4,
	verifyDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4Terms,
} from './demo-integrated-funding-receipt-v4'

const key = (n: number) => hexToBytes(n.toString(16).padStart(64, '0'))
const xonly = (n: number) => bytesToHex(schnorr.getPublicKey(key(n)))
const compressed = (n: number) => bytesToHex(secp256k1.getPublicKey(key(n), true))
const sign = (digest: string, n: number) => bytesToHex(schnorr.sign(hexToBytes(digest), key(n)))
const digest = (n: string) => n.repeat(64)
const RETURN_SIGNATURE = sign(digest('6'), 2)

function authorization() {
	const content = {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1' as const,
		authNetworkId: 'friday-demo', chainId: 'friday-chain', auctionId: 'auction-1', amount: 2_500,
		mintUrl: 'http://127.0.0.1:3438/', paymentPublicKey: compressed(2), refundPublicKey: compressed(3),
		fundingOperationId: 'operation-1', bundleDigest: digest('4'), returnPackageDigest: digest('5'),
		returnCashuSigAllDigest: digest('6'), bidderReturnSignature: RETURN_SIGNATURE, expiresAt: 1_200,
	}
	const keyDigest = demoFridayFundingKeyAuthorizationDigest(xonly(1), content)
	const unsigned = demoFridayFundingAuthorizationUnsignedEvent(xonly(1), 1_000, {
		...content, paymentKeyAuthorizationSignature: sign(keyDigest, 2), refundKeyAuthorizationSignature: sign(keyDigest, 3),
	})
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...unsigned, id, sig: sign(id, 1) }
}

function withMint<T extends DemoIntegratedFundingReceiptV4Terms>(value: T, mintUrl: string): T {
	const content = JSON.parse(value.actor_funding_authorization.content) as Record<string, unknown>
	content.mintUrl = mintUrl
	const keyTerms = { ...content }
	delete keyTerms.paymentKeyAuthorizationSignature
	delete keyTerms.refundKeyAuthorizationSignature
	const keyDigest = demoFridayFundingKeyAuthorizationDigest(xonly(1), keyTerms as never)
	const rebuilt = {
		...content, paymentKeyAuthorizationSignature: sign(keyDigest, 2), refundKeyAuthorizationSignature: sign(keyDigest, 3),
	} as Parameters<typeof demoFridayFundingAuthorizationUnsignedEvent>[2]
	const unsigned = demoFridayFundingAuthorizationUnsignedEvent(xonly(1), value.attested_at, rebuilt)
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...value, mint_url: mintUrl, actor_funding_authorization: { ...unsigned, id, sig: sign(id, 1) } }
}

function terms(): DemoIntegratedFundingReceiptV4Terms {
	return {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV4', auth_network_id: 'friday-demo', chain_id: 'friday-chain',
		mint_url: 'http://127.0.0.1:3438/', auction_id: 'auction-1', bidder: xonly(1), bid_amount: 2_500,
		pool_amount: 2_500, replaces_bid_id: '', funding_operation_id: 'operation-1', attested_at: 1_000,
		expires_at: 1_200, proof_state_refs: [compressed(8), compressed(9)].sort(), active_keyset_id: 'keyset-1',
		input_fee_ppk: 0, locktime: 4_200, bidder_public_key: compressed(2), refund_public_key: compressed(3),
		committee_public_key: compressed(4), committee_keyset_id: 'committee-1', committee_keyset_version: 'version-1',
		dkg_run_id: 'dkg-1', public_key_package_sha256: digest('a'), signer_roster_digest: digest('b'),
		winner_package_digest: digest('c'), return_package_digest: digest('5'), return_cashu_sigall_digest: digest('6'),
		bidder_return_signature: RETURN_SIGNATURE, prepared_bundle_digest: digest('4'),
		actor_funding_authorization: authorization(),
	}
}

describe('integrated funding V4 receipt', () => {
	test('binds an exact Nostr event rather than a relabelled raw actor signature', () => {
		const unsigned = prepareDemoIntegratedFundingReceiptV4(terms())
		const policy = digest('d')
		const receipt = finalizeDemoIntegratedFundingReceiptV4(
			unsigned, policy, sign(demoIntegratedFundingV4AdmissionSignatureDigest(unsigned, policy), 4),
		)
		expect(verifyDemoIntegratedFundingReceiptV4(receipt)).toEqual(receipt)
		expect('actor_funding_signature' in receipt).toBe(false)
	})

	test('accepts the frozen TypeScript/Rust/Go V4 golden receipt', () => {
		const fixture = JSON.parse(readFileSync('../fixtures/integrated-funding-v4-browser-golden.json', 'utf8')) as {
			receipt: ReturnType<typeof prepareDemoIntegratedFundingReceiptV4>; receiptDigest: string
		}
		expect(demoIntegratedFundingV4ReceiptDigest(fixture.receipt)).toBe(fixture.receiptDigest)
	})

	test('accepts one exact public HTTPS mint identity and rejects arbitrary cleartext/cross-mint substitution', () => {
		const publicTerms = withMint(terms(), 'https://172.105.64.142')
		expect(() => prepareDemoIntegratedFundingReceiptV4(publicTerms)).not.toThrow()
		expect(() => prepareDemoIntegratedFundingReceiptV4(withMint(terms(), 'http://192.0.2.44:3438/'))).toThrow(/cleartext|SHAPE/)
		const substituted = withMint(terms(), 'https://172.105.64.142')
		substituted.mint_url = 'https://192.0.2.44'
		expect(() => prepareDemoIntegratedFundingReceiptV4(substituted)).toThrow(/mint URL|authorization differs|another trusted network/)
	})

	test('rejects a cross-domain event, prepared bundle substitution, and mutated receipt', () => {
		const wrong = terms(); wrong.prepared_bundle_digest = digest('7')
		expect(() => prepareDemoIntegratedFundingReceiptV4(wrong)).toThrow(/authorization differs/)
		const mutated = terms(); mutated.actor_funding_authorization = { ...mutated.actor_funding_authorization, kind: 1 as never }
		expect(() => prepareDemoIntegratedFundingReceiptV4(mutated)).toThrow(/event shape/)
		const unsigned = prepareDemoIntegratedFundingReceiptV4(terms())
		unsigned.return_package_digest = digest('8')
		expect(() => demoIntegratedFundingV4AdmissionSignatureDigest(unsigned, digest('d'))).toThrow()
	})
})
