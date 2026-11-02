/** Source-prepared admission-domain refusal fixtures. NOT_RUN. */
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFrostThreshold3AdmissionPort,
	DemoAdmissionSqliteSessionStore,
	sameDemoAdmissionPolicyAuthorizationFacts,
	type DemoAdmissionSigningSessionStore,
} from './demo-frost-threshold3-admission'
import type { DemoIntegratedAdmissionPolicyEvidenceV1 } from './demo-integrated-admission-policy'
import {
	demoIntegratedFundingBundleDigest,
	demoIntegratedFundingReceiptDigest,
	prepareDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptTerms,
} from './demo-integrated-funding-receipt'

const secret = (value: number) => new Uint8Array(32).fill(value)
const xonly = (value: number) => bytesToHex(schnorr.getPublicKey(secret(value)))
const sign = (digest: string, value: number) => bytesToHex(schnorr.sign(hexToBytes(digest), secret(value)))
const hex = (value: string) => value.repeat(64).slice(0, 64)

function unsigned(validFrom: number, validUntil: number) {
	const terms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: 'demo-network', chain_id: 'demo-chain',
		mint_url: 'http://127.0.0.1:3338',
		auction_id: 'auction-admission', bidder: xonly(4), bid_amount: 1000, pool_amount: 1000,
		replaces_bid_id: '', funding_operation_id: 'funding-admission', attested_at: validFrom,
		expires_at: validUntil, proof_state_refs: [`02${'11'.repeat(32)}`], active_keyset_id: 'zero-fee',
		input_fee_ppk: 0, locktime: validUntil + 2700, bidder_public_key: `02${xonly(1)}`,
		refund_public_key: `02${xonly(3)}`, committee_public_key: `02${xonly(2)}`,
		committee_keyset_id: 'committee', committee_keyset_version: '1', dkg_run_id: 'dkg-run',
		public_key_package_sha256: hex('6'), signer_roster_digest: hex('7'), winner_package_digest: hex('8'),
		return_package_digest: hex('9'), return_cashu_sigall_digest: hex('a'), bidder_return_signature: sign(hex('a'), 1),
	}
	const bundle = demoIntegratedFundingBundleDigest(terms)
	return prepareDemoIntegratedFundingReceipt(terms, sign(bundle, 4))
}

function evidence(receiptDigest: string): [DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1] {
	return [1, 2, 3].map((id) => ({
		schema: 'COCO_DEMO_INTEGRATED_ADMISSION_POLICY_EVIDENCE_V1', participantId: id as 1 | 2 | 3, receiptDigest,
		mintEvidenceDigest: String(id).repeat(64), consensusEvidenceDigest: String(id + 1).repeat(64),
		proofUseEvidenceDigest: String(id + 2).repeat(64), bundleDigest: hex('8'),
		proofStateRefs: [`02${'11'.repeat(32)}`], poolAmount: 1000,
	})) as [DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1]
}

const sessions: DemoAdmissionSigningSessionStore = {
	async claim() { throw new Error('session must not be claimed by refusal fixture') },
	async complete() { throw new Error('result must not be stored by refusal fixture') },
	async observeParticipant() { throw new Error('signer anchor must not be observed by refusal fixture') },
}

function port(run: () => void, badRoster = false) {
	return createDemoFrostThreshold3AdmissionPort({
		binaryPath: '/tmp/coco-demo-frost-participant-3of4-demo', publicKeyPackagePath: '/tmp/public-package.json',
		scratchParent: '/tmp', selectedParticipantIds: [1, 2, 3], sessions,
		participants: [1, 2, 3, 4].map((participantId) => ({
			participantId: (badRoster && participantId === 4 ? 3 : participantId) as 1 | 2 | 3 | 4,
			configPath: `/tmp/participant-${participantId}.json`, stateDirectory: `/tmp/participant-${participantId}`,
			verifyingShare: `${participantId % 2 === 0 ? '02' : '03'}${String(participantId).repeat(64)}`,
			policyService: {
				participantId: participantId as 1 | 2 | 3 | 4,
				async validateExact() { throw new Error('refusal fixture must reject before participant policy execution') },
			},
		})) as unknown as Parameters<typeof createDemoFrostThreshold3AdmissionPort>[0]['participants'],
		runCommand: async () => { run() },
	})
}

describe('admission-only FROST refusal fixtures (prepared, not yet executed)', () => {
	test('permits a fresh local consensus observation but no stable admission-fact drift', () => {
		const supplied = evidence(hex('f'))[0]
		expect(sameDemoAdmissionPolicyAuthorizationFacts(supplied, {
			...supplied, consensusEvidenceDigest: hex('e'),
		})).toBe(true)
		expect(sameDemoAdmissionPolicyAuthorizationFacts(supplied, {
			...supplied, mintEvidenceDigest: hex('d'), consensusEvidenceDigest: hex('e'),
		})).toBe(false)
	})

	test('rejects a mutated receipt and an expired receipt before session or Rust command', async () => {
		let commands = 0
		const now = Math.floor(Date.now() / 1000)
		const valid = unsigned(now - 1, now + 120)
		const digest = demoIntegratedFundingReceiptDigest(valid)
		const mutated = { ...valid, auction_id: 'auction-mutated' }
		await expect(port(() => { commands++ }).signExact({
			receipt: mutated, receiptDigest: digest,
			bundle: {} as never, nowSeconds: now,
			dkgBinding: { dkgRunId: 'dkg-run', publicKeyPackageSha256: hex('6'), signerRosterDigest: hex('7') },
			participantEvidence: evidence(digest),
		})).rejects.toThrow()
		const expired = unsigned(now - 120, now - 1)
		const expiredDigest = demoIntegratedFundingReceiptDigest(expired)
		await expect(port(() => { commands++ }).signExact({
			receipt: expired, receiptDigest: expiredDigest,
			bundle: {} as never, nowSeconds: now,
			dkgBinding: { dkgRunId: 'dkg-run', publicKeyPackageSha256: hex('6'), signerRosterDigest: hex('7') },
			participantEvidence: evidence(expiredDigest),
		})).rejects.toThrow(/participant evidence differs/)
		expect(commands).toBe(0)
	})

	test('rejects a wrong four-signer roster at adapter construction', () => {
		expect(() => port(() => undefined, true)).toThrow(/four ordered participant identities/)
	})

	test('independent coordinator anchor rejects restored epochs and replacement generations', async () => {
		const database = new Database(':memory:')
		try {
			const store = new DemoAdmissionSqliteSessionStore(database)
			const binding = {
				version: 'COCO_DEMO_FROST_ADMISSION_3OF4_V1' as const, participant_id: 1 as const,
				dkg_run_id: 'dkg-run', public_key_package_sha256: hex('6'), signer_roster_digest: hex('7'),
				state_directory_identity: hex('8'), journal_generation: hex('9'), restart_epoch: 1,
			}
			await store.observeParticipant(binding)
			await store.observeParticipant({ ...binding, restart_epoch: 2 })
			await expect(store.observeParticipant({ ...binding, restart_epoch: 2 })).rejects.toThrow(/REGRESSED/)
			await expect(store.observeParticipant({ ...binding, restart_epoch: 3, journal_generation: hex('a') })).rejects.toThrow(/REPLACED/)
		} finally { database.close() }
	})
})
