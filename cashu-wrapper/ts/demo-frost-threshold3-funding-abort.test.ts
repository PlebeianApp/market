import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { demoFridayFundingAbortActorUnsignedEvent } from './demo-friday-funding-pool-lifecycle'
import {
	demoFrostFundingAbortAuthorization, demoFrostFundingAbortAuthorizationDigest,
	demoFrostFundingAbortParticipantPolicyDigest,
	type DemoFundingAbortParticipantEvidenceV1,
} from './demo-frost-threshold3-funding-abort'

const H = (value: string): string => value.repeat(64)
const C = (value: string): string => `02${value.repeat(64)}`
const evidence = (participantId: 1 | 2 | 3): DemoFundingAbortParticipantEvidenceV1 => ({
	schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1', participantId, operationId: 'operation-1',
	poolDigest: H('1'), proofYsDigest: H('2'), activeKeysetId: 'keyset-1', returnPackageDigest: H('3'),
	returnCashuSigAllDigest: H('4'), mintEvidenceDigest: H('5'), consensusEvidenceDigest: H('6'),
	evidenceDigest: bytesToHex(sha256(utf8ToBytes(`evidence-${participantId}`))),
})

function unsigned() {
	const actorSecret = Uint8Array.from(Buffer.from(H('1'), 'hex'))
	const actor = bytesToHex(schnorr.getPublicKey(actorSecret))
	const paymentSecret = Uint8Array.from(Buffer.from(H('2'), 'hex'))
	const participantEvidence: [DemoFundingAbortParticipantEvidenceV1, DemoFundingAbortParticipantEvidenceV1,
		DemoFundingAbortParticipantEvidenceV1] = [evidence(1), evidence(2), evidence(3)]
	const actorTerms = {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const, authNetworkId: 'network', chainId: 'chain',
		genesisSha256: H('7'), auctionId: 'auction-1', operationId: 'operation-1', actor,
		mintUrl: 'https://mint.invalid', activeKeysetId: 'keyset-1', amount: 1000,
		proofYs: [C('8')], poolDigest: H('1'), nut11LockPublicKeys: [C('2'), C('3')] as [string, string],
		locktime: 10_000, paymentPublicKey: C('2'), refundPublicKey: C('4'), committeePublicKey: C('3'),
		returnPackageDigest: H('3'), returnCashuSigAllDigest: H('4'),
		bidderReturnSignature: bytesToHex(schnorr.sign(Uint8Array.from(Buffer.from(H('4'), 'hex')), paymentSecret)),
		fundingAuthorizationEventId: H('9'), abortNotBefore: 1, abortExpiresAt: 4_201,
		abortReason: 'prebroadcast_service_failure' as const, committeeKeysetId: 'committee',
		committeeKeysetVersion: 'v1', dkgRunId: 'dkg', publicKeyPackageSha256: H('a'),
		signerRosterDigest: H('b'), participantPolicyDigest: demoFrostFundingAbortParticipantPolicyDigest([...participantEvidence]),
	}
	const event = demoFridayFundingAbortActorUnsignedEvent(actorTerms, 2)
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))))
	return { ...actorTerms, actorAbortEvent: { ...event, id, sig: bytesToHex(schnorr.sign(Uint8Array.from(Buffer.from(id, 'hex')), actorSecret)) }, participantEvidence }
}

describe('distinct FundingAbort threshold domain', () => {
	test('binds the canonical validator certificate and policy quorum', () => {
		const value = unsigned(); const { participantEvidence, ...committeeUnsigned } = value
		const authorization = demoFrostFundingAbortAuthorization({ committeeUnsigned,
			participantEvidence: [...participantEvidence], sessionId: H('c') })
		expect(authorization.operation_id).toBe('operation-1')
		expect(authorization.committee_unsigned_hex.length).toBeGreaterThan(100)
		expect(authorization.operation_root).toMatch(/^[0-9a-f]{64}$/)
		expect(demoFrostFundingAbortAuthorizationDigest(authorization)).toMatch(/^[0-9a-f]{64}$/)
	})

	test('rejects policy evidence mutation', () => {
		const value = unsigned(); const { participantEvidence, ...committeeUnsigned } = value
		const changed = structuredClone(participantEvidence); changed[0]!.mintEvidenceDigest = H('d')
		expect(() => demoFrostFundingAbortAuthorization({ committeeUnsigned,
			participantEvidence: changed, sessionId: H('c') })).toThrow('policy')
	})
})
