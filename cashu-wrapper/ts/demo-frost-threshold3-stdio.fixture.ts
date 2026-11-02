/** No-key child-process fixture for threshold-three process-boundary verification only. */
import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
} from './demo-frost-participant-policy'
import { serveDemoFrostParticipantWorker } from './demo-frost-stdio-transport'
import type { DemoFrostThreshold3ParticipantWorker } from './demo-frost-threshold3-rust-participant-worker'

const participantId = Number(process.argv[2])
if (![1, 2, 3, 4].includes(participantId)) throw new Error('fixture requires participant id 1 through 4')
const point = (offset: number): string => `${(participantId + offset) % 2 === 0 ? '02' : '03'}${(participantId + offset).toString(16).padStart(64, '0')}`

const worker: DemoFrostThreshold3ParticipantWorker = {
	async roundOne(request) {
		return {
			schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1',
			binding: request.binding,
			policyEvidence: {
				schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1',
				policyPackageDigest: demoFrostParticipantPolicyDigest(request.policy),
				closureEvidenceDigest: request.policy.certifiedClosure.evidenceDigest,
				signedBidEvidenceDigest: request.policy.signedBid.evidenceDigest,
				committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(request.policy.committeeLockedProofs),
				authenticatedPackageDigest: request.policy.packageDigest,
				derivedCashuSigAllDigest: request.policy.cashuSigAllDigest,
			},
			commitment: { hiding: point(600), binding: point(700) },
		}
	},
	async roundTwo(request) {
		return {
			schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1',
			binding: request.binding,
			transcriptHash: request.transcriptHash,
			signatureShare: participantId.toString(16).padStart(64, '0'),
		}
	},
}

await serveDemoFrostParticipantWorker(worker)
