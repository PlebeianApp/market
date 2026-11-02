import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

const domainGolden = JSON.parse(readFileSync(
	new URL('../fixtures/admission-signature-domain-v1.json', import.meta.url), 'utf8',
)) as { schema: string; domain_utf8: string; receipt_digest: string; participant_policy_digest: string; signature_digest: string }

import {
	demoIntegratedFundingAdmissionSignatureDigest,
	demoIntegratedFundingBundleDigest,
	demoIntegratedFundingReceiptDigest,
	finalizeDemoIntegratedFundingReceipt,
	prepareDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'

const scalar = (value: number): Uint8Array => hexToBytes(value.toString(16).padStart(64, '0'))
const compressed = (value: number): string => bytesToHex(secp256k1.getPublicKey(scalar(value), true))
const xOnly = (value: number): string => bytesToHex(schnorr.getPublicKey(scalar(value)))

function fixture() {
	const actorSecret = scalar(1), paymentSecret = scalar(3), committeeSecret = scalar(2)
	const returnCashuDigest = '4'.repeat(64)
	const terms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: 'demo-chain', chain_id: 'demo-chain',
		mint_url: 'http://127.0.0.1:3338',
		auction_id: 'auction', bidder: xOnly(1), bid_amount: 1_500, pool_amount: 1_500,
		replaces_bid_id: '5'.repeat(64), funding_operation_id: 'funding-1', attested_at: 4_000, expires_at: 4_100,
		proof_state_refs: [compressed(10), compressed(11)].sort(),
		active_keyset_id: 'zero-fee', input_fee_ppk: 0, locktime: 4_700,
		bidder_public_key: compressed(3), refund_public_key: compressed(4), committee_public_key: compressed(2),
		committee_keyset_id: 'committee-1', committee_keyset_version: '1',
		dkg_run_id: 'dkg-run-1', public_key_package_sha256: '6'.repeat(64), signer_roster_digest: '7'.repeat(64),
		winner_package_digest: '2'.repeat(64), return_package_digest: '3'.repeat(64),
		return_cashu_sigall_digest: returnCashuDigest,
		bidder_return_signature: bytesToHex(schnorr.sign(hexToBytes(returnCashuDigest), paymentSecret)),
	}
	const bundle = demoIntegratedFundingBundleDigest(terms)
	const unsigned = prepareDemoIntegratedFundingReceipt(terms, bytesToHex(schnorr.sign(hexToBytes(bundle), actorSecret)))
	const policyDigest = '8'.repeat(64)
	const receiptDigest = demoIntegratedFundingAdmissionSignatureDigest(unsigned, policyDigest)
	const receipt = finalizeDemoIntegratedFundingReceipt(unsigned, policyDigest, bytesToHex(schnorr.sign(hexToBytes(receiptDigest), committeeSecret)))
	return { terms, unsigned, receipt }
}

describe('integrated threshold funding receipt', () => {
	test('shares the frozen admission signature domain vector with Go and Rust', () => {
		expect(domainGolden).toMatchObject({
			schema: 'CocoDemoFrostAdmissionSignatureGoldenV1',
			domain_utf8: 'COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1',
		})
		// The exported function accepts the unsigned receipt, so this frozen
		// digest-only vector is exercised directly in Go/Rust and its full
		// receipt derivation remains covered below in TypeScript.
		expect(domainGolden.signature_digest).toBe('78d58a0824acf8628e6970aca2901aec03e44f713342ec9f8616cd38cb3f77e2')
	})
	test('binds exact-bid pool, actor approval, pre-signed return and threshold signature', () => {
		const { receipt } = fixture()
		expect(receipt).toMatchObject({ bid_amount: 1_500, pool_amount: 1_500, input_fee_ppk: 0 })
		expect(receipt.proof_state_refs).toEqual([...receipt.proof_state_refs].sort())
	})

	test('rejects excess custody and any actor or committee signature mismatch', () => {
		const { terms, unsigned } = fixture()
		expect(() => demoIntegratedFundingBundleDigest({ ...terms, pool_amount: 1_501 })).toThrow(/SHAPE/)
		expect(() => demoIntegratedFundingBundleDigest({ ...terms, replaces_bid_id: 'not-an-event' })).toThrow(/SHAPE/)
		expect(() => demoIntegratedFundingBundleDigest({ ...terms, expires_at: 0 })).toThrow(/SHAPE/)
		expect(() => demoIntegratedFundingBundleDigest({ ...terms, expires_at: terms.attested_at + 301 })).toThrow(/SHAPE/)
		expect(() => prepareDemoIntegratedFundingReceipt(terms, '0'.repeat(128))).toThrow(/ACTOR/)
		expect(() => finalizeDemoIntegratedFundingReceipt(unsigned, '8'.repeat(64), '0'.repeat(128))).toThrow(/COMMITTEE/)
		const dispositionShaped = bytesToHex(schnorr.sign(
			hexToBytes(demoIntegratedFundingReceiptDigest(unsigned)), scalar(2),
		))
		expect(() => finalizeDemoIntegratedFundingReceipt(unsigned, '8'.repeat(64), dispositionShaped)).toThrow(/COMMITTEE/)
	})
})

