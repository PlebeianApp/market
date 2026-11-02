/**
 * Local fake-money disposition signer process.
 *
 * Each process independently reads its loopback Comet RPC, verifies the exact
 * admitted receipt/displacement and fake-mint proof state, owns a durable
 * proof-use database, checks an external rollback anchor, and only then asks
 * its own Rust key-share process path for a FROST nonce/share. Stdio is local
 * test transport, not FIPS evidence.
 */
import { hasValidDleq } from '@cashu/cashu-ts'

import { deriveDemoCometSignedBidEvidence } from './demo-comet-signed-bid-verifier'
import { createDemoCometDisplacementVerifier, createLoopbackCometReader } from './demo-comet-displacement-verifier'
import { openDemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import { demoIntegratedDisplacementFinalityDigest } from './demo-integrated-authority'
import { demoFrostParticipantPolicyDigest, type DemoFrostParticipantPolicyPackage, type DemoFrostParticipantPolicyPorts } from './demo-frost-participant-policy'
import { createDemoFrostThreshold3RustParticipantWorker, type DemoFrostThreshold3ParticipantWorker } from './demo-frost-threshold3-rust-participant-worker'
import { serveDemoFrostParticipantWorker } from './demo-frost-stdio-transport'
import { exactDemoNut07Result } from './demo-nut07-exact'
import { CashuMintClient, proofPoint } from './nut-client'
import { bytesToHex } from '@noble/hashes/utils.js'

const participantId = Number(process.env.FRIDAY_PARTICIPANT_ID) as 1 | 2 | 3 | 4
const rpc = process.env.FRIDAY_COMET_RPC ?? ''
const network = process.env.FRIDAY_NETWORK ?? ''
const chainId = process.env.FRIDAY_CHAIN_ID ?? ''
const genesisHash = process.env.FRIDAY_GENESIS_HASH ?? ''
const validatorsHash = process.env.FRIDAY_COMET_VALIDATORS_HASH ?? ''
const validatorRosterVersion = process.env.FRIDAY_VALIDATOR_ROSTER_VERSION ?? ''
const dkgRunId = process.env.FRIDAY_DKG_RUN_ID ?? ''
const committeeKeysetId = process.env.FRIDAY_COMMITTEE_KEYSET_ID ?? ''
const committeeKeysetVersion = process.env.FRIDAY_COMMITTEE_KEYSET_VERSION ?? ''
const publicKeyPackageSha256 = process.env.FRIDAY_PUBLIC_PACKAGE_SHA256 ?? ''
const signerRosterDigest = process.env.FRIDAY_SIGNER_ROSTER_DIGEST ?? ''
const replacementBidEventId = process.env.FRIDAY_REPLACEMENT_BID_EVENT_ID ?? ''
const displacementHeight = Number(process.env.FRIDAY_DISPLACEMENT_HEIGHT)
const configPath = process.env.FRIDAY_SIGNER_CONFIG ?? ''
const stateDirectory = process.env.FRIDAY_SIGNER_STATE ?? ''
const binaryPath = process.env.FRIDAY_SIGNER_BINARY ?? ''
const scratchParent = process.env.FRIDAY_SIGNER_SCRATCH ?? ''
const proofUsePath = process.env.FRIDAY_TERMINAL_PROOF_USE_DB ?? ''
const anchorPath = process.env.FRIDAY_TERMINAL_ANCHOR_DB ?? ''
const enrollmentPermitPath = process.env.FRIDAY_TERMINAL_ENROLLMENT_PERMIT ?? ''
const HEX_32 = /^[0-9a-f]{64}$/

if (![1, 2, 3, 4].includes(participantId) || [rpc, network, chainId, validatorRosterVersion, dkgRunId,
	committeeKeysetId, committeeKeysetVersion, configPath, stateDirectory, binaryPath, scratchParent,
	proofUsePath, anchorPath, enrollmentPermitPath].some((value) => value.length === 0)
	|| [genesisHash, validatorsHash, publicKeyPackageSha256, signerRosterDigest, replacementBidEventId].some((value) => !HEX_32.test(value))
	|| !Number.isSafeInteger(displacementHeight) || displacementHeight < 1
	|| ![configPath, stateDirectory, binaryPath, scratchParent, proofUsePath, anchorPath, enrollmentPermitPath].every((value) => value.startsWith('/'))) {
	throw new Error('DEMO_TERMINAL_WORKER_CONFIG: exact participant, signer, Comet, and mint pins are required')
}

const anchor = openDemoDispositionSignerAnchor({
	participantId, dkgRunId, publicKeyPackageSha256, signerRosterDigest, stateDirectory,
	signerMetadataPath: `${stateDirectory}/disposition-metadata.sqlite3`, proofUsePath,
	coordinatorAnchorPath: anchorPath, initialEnrollmentPermitPath: enrollmentPermitPath,
})
const reader = createLoopbackCometReader(rpc)
const displacementVerifier = createDemoCometDisplacementVerifier({
	reader, network, chainId, genesisHash, validatorRosterVersion, validatorsHash,
	committeeKeysetId, committeeKeysetVersion, dkgRunId, publicKeyPackageSha256, signerRosterDigest,
})

function exactMarker(value: unknown, schema: string): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['schema', 'source'])
		|| (value as { schema?: unknown }).schema !== schema || (value as { source?: unknown }).source !== 'participant-local') {
		throw new Error('DEMO_TERMINAL_WORKER_EVIDENCE: participant-local evidence marker is malformed')
	}
}

function policyPorts(policy: DemoFrostParticipantPolicyPackage): DemoFrostParticipantPolicyPorts {
	return {
		closureVerifier: {
			async verifyAndDerive(evidence) {
				exactMarker(evidence, 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1')
				const certificate = await displacementVerifier.verifyAndDerive({
					network, chainId, genesisHash, validatorRosterVersion,
					auctionId: policy.auctionId, replacementBidEventId, displacementHeight,
				})
				if (certificate.displacedFundingOperationId !== policy.operationId
					|| certificate.admittedFundingReceipt.return_package_digest !== policy.packageDigest
					|| certificate.admittedFundingReceipt.return_cashu_sigall_digest !== policy.cashuSigAllDigest) {
					throw new Error('DEMO_TERMINAL_WORKER_CLOSURE: certified receipt differs from exact terminal policy')
				}
				return {
					evidenceDigest: demoIntegratedDisplacementFinalityDigest(certificate), network: certificate.network,
					chainId: certificate.chainId, auctionId: certificate.auctionId,
					operationId: certificate.displacedFundingOperationId,
					// V1 pre-signed templates use the stable admitted funding
					// operation in both legacy bid slots. The actual displaced
					// event is independently bound by the finality evidence above.
					bidId: certificate.displacedFundingOperationId,
					bidEventId: certificate.displacedFundingOperationId,
					bidderActorId: certificate.displacedBidderActorId, role: 'refund' as const,
					outcomeHeight: certificate.commits[2].height,
					appStateHash: certificate.commits[2].appHash,
					amount: certificate.displacedPoolAmount, locktime: certificate.timing.locktime,
					proofStateRefs: [...certificate.proofStateRefs], recipientPublicKey: policy.recipientPublicKey,
				}
			},
		},
		signedBidVerifier: {
			async verifyAndDerive(evidence) {
				exactMarker(evidence, 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1')
				return deriveDemoCometSignedBidEvidence({
					reader, validatorsHash, minimumHeight: displacementHeight + 2,
					fundingOperationId: policy.operationId, deposits: policy.deposits,
					sellerRecipientPublicKey: policy.sellerRecipientPublicKey,
				})
			},
		},
		proofUse: {
			async assertExclusive(request) {
				const policyDigest = demoFrostParticipantPolicyDigest(policy)
				if (request.network !== network || request.chainId !== chainId || request.auctionId !== policy.auctionId
					|| request.operationId !== policy.operationId || request.policyPackageDigest !== policyDigest
					|| request.mintUrl !== policy.mintUrl || request.activeKeysetId !== policy.activeKeysetId
					|| JSON.stringify(request.proofStateRefs) !== JSON.stringify(policy.deposits.map(({ proofStateRef }) => proofStateRef))) {
					throw new Error('DEMO_TERMINAL_WORKER_PROOF_USE: request differs from exact terminal policy')
				}
				const client = new CashuMintClient({ mintUrl: policy.mintUrl })
				const active = (await client.keysets()).keysets.filter((entry) => entry.active && entry.unit === 'sat')
				if (active.length !== 1 || active[0]!.id !== policy.activeKeysetId || (active[0]!.input_fee_ppk ?? 0) !== 0) {
					throw new Error('DEMO_TERMINAL_WORKER_MINT: active zero-fee keyset differs from policy')
				}
				const keyset = (await client.keys(policy.activeKeysetId)).keysets.find((value) => value.id === policy.activeKeysetId && value.unit === 'sat')
				if (keyset === undefined || policy.committeeLockedProofs.some((proof) => proof.id !== policy.activeKeysetId
					|| !hasValidDleq(proof as never, keyset as never, { require: true }))) {
					throw new Error('DEMO_TERMINAL_WORKER_MINT: input DLEQ/keyset binding failed')
				}
				const Ys = policy.committeeLockedProofs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true)))
				const response = await fetch(`${policy.mintUrl}/v1/checkstate`, {
					method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys }),
				})
				if (!response.ok) throw new Error(`DEMO_TERMINAL_WORKER_MINT: NUT-07 returned HTTP ${response.status}`)
				const exact = exactDemoNut07Result(Ys, await response.json())
				if (exact.states.some((state) => state !== 'UNSPENT')) throw new Error('DEMO_TERMINAL_WORKER_MINT: full proof pool is not UNSPENT')
				anchor.claimProofs(request.proofStateRefs.map((proofRef) => ({
					proofRef, network, chainId, auctionId: policy.auctionId,
					operationId: policy.operationId, policyDigest,
				})))
			},
		},
	}
}

const sessions = new Map<string, DemoFrostThreshold3ParticipantWorker>()
const worker: DemoFrostThreshold3ParticipantWorker = {
	async roundOne(request, signal) {
		if (sessions.has(request.binding.sessionId)) throw new Error('DEMO_TERMINAL_WORKER_SESSION: duplicate round one')
		const signer = createDemoFrostThreshold3RustParticipantWorker({
			participantId, dkgRunId, publicKeyPackageSha256, configPath, stateDirectory,
			binaryPath, scratchParent, policyPorts: policyPorts(request.policy),
			stateGuard: {
				assertCurrent: anchor.assertRustStateCurrent,
				recordAdvance: anchor.recordRustStateAdvance,
			},
		})
		const result = await signer.roundOne(request, signal)
		sessions.set(request.binding.sessionId, signer)
		return result
	},
	async roundTwo(request, signal) {
		const signer = sessions.get(request.binding.sessionId)
		if (signer === undefined) throw new Error('DEMO_TERMINAL_WORKER_SESSION: round two lacks accepted round one')
		sessions.delete(request.binding.sessionId)
		return signer.roundTwo(request, signal)
	},
}

try { await serveDemoFrostParticipantWorker(worker) }
finally { anchor.close() }
