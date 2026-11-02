import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { createDemoFundingAbortParticipantPolicy,
	sameDemoFundingAbortParticipantEvidence,
	sameDemoFundingAbortStableParticipantEvidence } from './demo-funding-abort-participant-policy'
import type { DemoFundingAbortParticipantEvidenceV1 } from './demo-frost-threshold3-funding-abort'
import { demoFridayFundingAbortActorUnsignedEvent } from './demo-friday-funding-pool-lifecycle'

const H = (value: string): string => value.repeat(64)

describe('FundingAbort participant-local policy', () => {
	test('allows a later authenticated observation without changing immutable signing facts', () => {
		const first: DemoFundingAbortParticipantEvidenceV1 = {
			schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1', participantId: 1,
			operationId: 'operation', poolDigest: H('1'), proofYsDigest: H('2'), activeKeysetId: 'keyset',
			returnPackageDigest: H('3'), returnCashuSigAllDigest: H('4'), mintEvidenceDigest: H('5'),
			consensusEvidenceDigest: H('6'), evidenceDigest: H('7'),
		}
		const later = { ...first, consensusEvidenceDigest: H('8'), evidenceDigest: H('9') }
		expect(sameDemoFundingAbortParticipantEvidence(first, later)).toBe(false)
		expect(sameDemoFundingAbortStableParticipantEvidence(first, later)).toBe(true)
		expect(sameDemoFundingAbortStableParticipantEvidence(first, {
			...later, returnPackageDigest: H('a'),
		})).toBe(false)
	})

	test('rejects a different deployment before consulting policy ports', async () => {
		let calls = 0
		const actorSecret = Uint8Array.from(Buffer.from(H('1'), 'hex'))
		const actor = bytesToHex(schnorr.getPublicKey(actorSecret))
		const terms = {
			schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const, authNetworkId: 'network',
			chainId: 'chain', genesisSha256: H('1'), auctionId: 'auction',
			operationId: 'operation', actor, mintUrl: 'https://mint.invalid',
			activeKeysetId: 'keyset', amount: 1_000,
			proofYs: [`02${H('2')}`], poolDigest: H('2'), nut11LockPublicKeys: [`02${H('3')}`,
				`02${H('4')}`] as [string, string], locktime: 10_000,
			paymentPublicKey: `02${H('3')}`, refundPublicKey: `02${H('5')}`,
			committeePublicKey: `02${H('4')}`, returnPackageDigest: H('6'),
			returnCashuSigAllDigest: H('7'), bidderReturnSignature: H('8').repeat(2), fundingAuthorizationEventId: H('3'),
			abortNotBefore: 1_000, abortExpiresAt: 5_200,
			abortReason: 'prebroadcast_service_failure' as const, committeeKeysetId: 'committee',
			committeeKeysetVersion: 'v1', dkgRunId: 'dkg',
			publicKeyPackageSha256: H('4'), signerRosterDigest: H('5'),
		}
		const event = demoFridayFundingAbortActorUnsignedEvent(terms, 1_100)
		const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))))
		const policy = createDemoFundingAbortParticipantPolicy({ participantId: 1, pins: {
			...terms, mintUrl: 'https://another.invalid', activeKeysetId: terms.activeKeysetId,
		}, consensus: { async readExact() { calls++; return { origin: 'none', evidenceDigest: H('6') } } },
		mint: { async verifyExact() { calls++; return { activeKeysetId: terms.activeKeysetId, proofStates: [], evidenceDigest: H('7') } } },
		proofUse: { async claimExact() { calls++; return { evidenceDigest: H('8') } } } })
		await expect(policy.validateExact({ schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_POLICY_REQUEST_V1',
			actorTerms: terms, actorAbortEvent: { ...event, id, sig: bytesToHex(schnorr.sign(Uint8Array.from(Buffer.from(id, 'hex')), actorSecret)) },
			evidence: {} as never, returnTemplate: {} as never, nowSeconds: 1_100 })).rejects.toThrow('pins')
		expect(calls).toBe(0)
	})
})
