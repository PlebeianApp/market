import { serveDemoFrostParticipantWorker } from './demo-frost-stdio-transport'
import type { DemoFrostParticipantWorker } from './demo-frost-rust-participant-worker'

const withhold = async (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
	const abort = (): void => reject(new Error('fixture participant aborted'))
	if (signal.aborted) abort()
	else signal.addEventListener('abort', abort, { once: true })
})

const worker: DemoFrostParticipantWorker = {
	async roundOne(request, signal) {
		if (process.argv.includes('--withhold')) return withhold(signal)
		return {
			schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1',
			binding: request.binding,
			policyEvidence: {
				schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1',
				policyPackageDigest: '11'.repeat(32),
				closureEvidenceDigest: '22'.repeat(32),
				signedBidEvidenceDigest: '33'.repeat(32),
				committeeLockedProofsDigest: '44'.repeat(32),
				authenticatedPackageDigest: '55'.repeat(32),
				derivedCashuSigAllDigest: '66'.repeat(32),
			},
			commitment: { hiding: `02${'01'.repeat(32)}`, binding: `03${'02'.repeat(32)}` },
		}
	},
	async roundTwo(request, signal) {
		if (process.argv.includes('--withhold')) return withhold(signal)
		return {
			schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1',
			binding: request.binding,
			transcriptHash: request.transcriptHash,
			signatureShare: '77'.repeat(32),
		}
	},
}

await serveDemoFrostParticipantWorker(worker)
