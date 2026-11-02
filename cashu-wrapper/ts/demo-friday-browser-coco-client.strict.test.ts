import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { exactDemoFridayCommitteeBidContent } from './demo-friday-browser-coco-client'
import {
	demoFridayFundingAuthorizationUnsignedEvent,
	demoFridayFundingKeyAuthorizationDigest,
} from './demo-friday-browser-funding-authorization'
import {
	demoIntegratedFundingV4AdmissionSignatureDigest,
	finalizeDemoIntegratedFundingReceiptV4,
	prepareDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4Terms,
} from './demo-integrated-funding-receipt-v4'

const key = (value: number) => hexToBytes(value.toString(16).padStart(64, '0'))
const xonly = (value: number) => bytesToHex(schnorr.getPublicKey(key(value)))
const compressed = (value: number) => bytesToHex(secp256k1.getPublicKey(key(value), true))
const sign = (digest: string, value: number) => bytesToHex(schnorr.sign(hexToBytes(digest), key(value)))
const digest = (nibble: string) => nibble.repeat(64)
const RETURN_SIGNATURE = sign(digest('6'), 2)

function fundingAuthorization() {
	const terms = {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1' as const,
		authNetworkId: 'friday-demo', chainId: 'friday-chain', auctionId: 'auction-1', amount: 2_500,
		mintUrl: 'http://127.0.0.1:3438/', paymentPublicKey: compressed(2), refundPublicKey: compressed(3),
		fundingOperationId: 'operation-1', bundleDigest: digest('4'), returnPackageDigest: digest('5'),
		returnCashuSigAllDigest: digest('6'), bidderReturnSignature: RETURN_SIGNATURE, expiresAt: 1_200,
	}
	const keyDigest = demoFridayFundingKeyAuthorizationDigest(xonly(1), terms)
	const unsigned = demoFridayFundingAuthorizationUnsignedEvent(xonly(1), 1_000, {
		...terms, paymentKeyAuthorizationSignature: sign(keyDigest, 2),
		refundKeyAuthorizationSignature: sign(keyDigest, 3),
	})
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...unsigned, id, sig: sign(id, 1) }
}

function exactContent() {
	const terms: DemoIntegratedFundingReceiptV4Terms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV4', auth_network_id: 'friday-demo', chain_id: 'friday-chain',
		mint_url: 'http://127.0.0.1:3438/', auction_id: 'auction-1', bidder: xonly(1), bid_amount: 2_500,
		pool_amount: 2_500, replaces_bid_id: '', funding_operation_id: 'operation-1', attested_at: 1_000,
		expires_at: 1_200, proof_state_refs: [compressed(8), compressed(9)].sort(), active_keyset_id: 'keyset-1',
		input_fee_ppk: 0, locktime: 4_200, bidder_public_key: compressed(2), refund_public_key: compressed(3),
		committee_public_key: compressed(4), committee_keyset_id: 'committee-1', committee_keyset_version: 'version-1',
		dkg_run_id: 'dkg-1', public_key_package_sha256: digest('a'), signer_roster_digest: digest('b'),
		winner_package_digest: digest('c'), return_package_digest: digest('5'), return_cashu_sigall_digest: digest('6'),
		bidder_return_signature: RETURN_SIGNATURE, prepared_bundle_digest: digest('4'),
		actor_funding_authorization: fundingAuthorization(),
	}
	const unsigned = prepareDemoIntegratedFundingReceiptV4(terms)
	const policy = digest('d')
	const receipt = finalizeDemoIntegratedFundingReceiptV4(
		unsigned, policy, sign(demoIntegratedFundingV4AdmissionSignatureDigest(unsigned, policy), 4),
	)
	return JSON.stringify({ auction_id: receipt.auction_id, amount: receipt.bid_amount,
		replaces_bid_id: receipt.replaces_bid_id, integrated_funding: receipt })
}

describe('Friday browser strict committee bid content', () => {
	test('accepts only the canonical receipt body with a valid pinned-committee signature', () => {
		const content = exactContent()
		const exact = exactDemoFridayCommitteeBidContent(content)
		expect(exact.receipt.bid_amount).toBe(2_500)
		expect(exact.receiptDigest).toMatch(/^[0-9a-f]{64}$/)

		expect(() => exactDemoFridayCommitteeBidContent('{}')).toThrow(/missing or unexpected/)
		const changedSidecar = JSON.parse(content) as Record<string, unknown>
		changedSidecar.amount = 2_501
		expect(() => exactDemoFridayCommitteeBidContent(JSON.stringify(changedSidecar))).toThrow(/canonical exact receipt/)
		const changedReceipt = JSON.parse(content) as { integrated_funding: { committee_signature: string } }
		changedReceipt.integrated_funding.committee_signature = '0'.repeat(128)
		expect(() => exactDemoFridayCommitteeBidContent(JSON.stringify(changedReceipt))).toThrow(/committee signature/)

		for (const mutate of [
			(value: any) => { value.integrated_funding.auction_id = 'auction-2' },
			(value: any) => { value.integrated_funding.mint_url = 'http://127.0.0.1:3439/' },
			(value: any) => { value.integrated_funding.funding_operation_id = 'operation-2' },
			(value: any) => { value.integrated_funding.proof_state_refs = [compressed(10), compressed(11)].sort() },
			(value: any) => { value.integrated_funding.winner_package_digest = digest('e') },
		]) {
			const crossBound = JSON.parse(content)
			mutate(crossBound)
			expect(() => exactDemoFridayCommitteeBidContent(JSON.stringify(crossBound))).toThrow()
		}
	})
})
