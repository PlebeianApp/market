import type { DemoSignerPureContext } from './demo-signer-pure-policy'
/** Participant-local policy for the distinct FundingAbortV1 FROST domain. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayFundingAbortActorUnsignedEvent,
	type DemoFridayFundingAbortCertificateV1,
	type DemoFridayFundingAbortNostrEventV1,
} from './demo-friday-funding-pool-lifecycle'
import type { DemoFridayLockedAbortEvidenceV1 } from './demo-friday-funding-abort-service'
import {
	validateDemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'
import { proofPoint } from './nut-client'
import {
	type DemoFundingAbortParticipantEvidenceV1,
} from './demo-frost-threshold3-funding-abort'

type ActorTerms = Omit<DemoFridayFundingAbortCertificateV1,
	'participantPolicyDigest' | 'actorAbortEvent' | 'committeeAbortSignature'>
const HEX_32 = /^[0-9a-f]{64}$/
function refuse(message: string): never { throw new Error(`DEMO_FUNDING_ABORT_POLICY: ${message}`) }
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) refuse('canonical integer is invalid')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value is invalid')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonical(value)))) }

export interface DemoFundingAbortParticipantPolicyRequestV1 {
	schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_POLICY_REQUEST_V1'
	actorTerms: ActorTerms
	actorAbortEvent: DemoFridayFundingAbortNostrEventV1
	evidence: DemoFridayLockedAbortEvidenceV1
	returnTemplate: DemoMaintainerExactBranchTemplate
	nowSeconds: number
}

export interface DemoFundingAbortParticipantPolicyPorts {
	participantId: 1 | 2 | 3 | 4
	validateExact(request: DemoFundingAbortParticipantPolicyRequestV1): Promise<DemoFundingAbortParticipantEvidenceV1>
}

export function sameDemoFundingAbortParticipantEvidence(
	left: DemoFundingAbortParticipantEvidenceV1,
	right: DemoFundingAbortParticipantEvidenceV1,
): boolean { return canonical(left) === canonical(right) }

/**
 * Compare the immutable authorization facts while allowing a signer to
 * re-observe a later, still-safe Comet height.  The three omitted digests are
 * observation receipts: the policy call below has already re-authenticated the
 * current Comet state, mint state and proof-use claim before this comparison.
 * They must remain in the originally signed quorum transcript, but a later
 * height must not make an already persisted FROST session impossible to
 * resume.
 */
export function sameDemoFundingAbortStableParticipantEvidence(
	left: DemoFundingAbortParticipantEvidenceV1,
	right: DemoFundingAbortParticipantEvidenceV1,
): boolean {
	const stable = (value: DemoFundingAbortParticipantEvidenceV1) => ({
		schema: value.schema, participantId: value.participantId, operationId: value.operationId,
		poolDigest: value.poolDigest, proofYsDigest: value.proofYsDigest,
		activeKeysetId: value.activeKeysetId, returnPackageDigest: value.returnPackageDigest,
		returnCashuSigAllDigest: value.returnCashuSigAllDigest, mintEvidenceDigest: value.mintEvidenceDigest,
	})
	return canonical(stable(left)) === canonical(stable(right))
}

function exactActorEvent(terms: ActorTerms, event: DemoFridayFundingAbortNostrEventV1): void {
	const unsigned = demoFridayFundingAbortActorUnsignedEvent(terms, event.created_at)
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	if (event.id !== id || event.pubkey !== unsigned.pubkey || event.created_at !== unsigned.created_at
		|| event.kind !== unsigned.kind || canonical(event.tags) !== canonical(unsigned.tags)
		|| event.content !== unsigned.content || !/^[0-9a-f]{128}$/.test(event.sig)
		|| !schnorr.verify(hexToBytes(event.sig), hexToBytes(id), hexToBytes(event.pubkey))) {
		refuse('actor did not authorize the exact abort')
	}
}

export type DemoFundingAbortPolicyOptions = {
	participantId: 1 | 2 | 3 | 4
	pins: {
		authNetworkId: string; chainId: string; genesisSha256: string; mintUrl: string
		activeKeysetId: string; committeePublicKey: string; committeeKeysetId: string
		committeeKeysetVersion: string; dkgRunId: string; publicKeyPackageSha256: string
		signerRosterDigest: string
	}
	consensus: { readExact(request: { operationId: string; auctionId: string }): Promise<{
		origin: 'none'; evidenceDigest: string
	}> }
	mint: { verifyExact(request: { template: DemoMaintainerExactBranchTemplate; proofYs: string[] }): Promise<{
		activeKeysetId: string; proofStates: Array<{ proofY: string; state: 'UNSPENT' }>; evidenceDigest: string
	}> }
	proofUse: { claimExact(request: { operationId: string; auctionId: string; proofYs: string[]; poolDigest: string }): Promise<{
		evidenceDigest: string
	}> }
}


export async function preflightDemoFundingAbortParticipantPolicy(options: Omit<DemoFundingAbortPolicyOptions, 'proofUse'>,
	request: DemoFundingAbortParticipantPolicyRequestV1, context?: DemoSignerPureContext) {
	const pins = Object.freeze({ ...options.pins })
			if (request.schema !== 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_POLICY_REQUEST_V1'
				|| !Number.isSafeInteger(request.nowSeconds) || request.nowSeconds < request.actorTerms.abortNotBefore
				|| request.nowSeconds > request.actorTerms.abortExpiresAt) { context?.refuse('ABORT_TIME'); refuse('request time is outside abort authority') }
			const terms = request.actorTerms, evidence = request.evidence
			for (const [left, right] of [
				[terms.authNetworkId, pins.authNetworkId], [terms.chainId, pins.chainId],
				[terms.genesisSha256, pins.genesisSha256], [terms.mintUrl, pins.mintUrl],
				[terms.activeKeysetId, pins.activeKeysetId], [terms.committeePublicKey, pins.committeePublicKey],
				[terms.committeeKeysetId, pins.committeeKeysetId],
				[terms.committeeKeysetVersion, pins.committeeKeysetVersion], [terms.dkgRunId, pins.dkgRunId],
				[terms.publicKeyPackageSha256, pins.publicKeyPackageSha256],
				[terms.signerRosterDigest, pins.signerRosterDigest],
			]) if (left !== right) { context?.refuse('ABORT_BINDING'); refuse('request differs from participant deployment pins') }
			exactActorEvent(terms, request.actorAbortEvent)
			const template = validateDemoMaintainerExactBranchTemplate(request.returnTemplate, 'refund')
			const proofYs = template.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
			if (template.operationId !== terms.operationId || template.auctionId !== terms.auctionId
				|| template.bidderActorId !== terms.actor || template.mintUrl !== terms.mintUrl
				|| template.amount !== terms.amount || template.committeePublicKey !== terms.committeePublicKey
				|| template.bidderPublicKey !== terms.paymentPublicKey || template.refundPublicKey !== terms.refundPublicKey
				|| template.locktime !== terms.locktime || template.templateDigest !== terms.returnPackageDigest
				|| template.cashuSigAllDigest !== terms.returnCashuSigAllDigest
				|| canonical(proofYs) !== canonical(terms.proofYs)
				|| evidence.operationId !== terms.operationId || evidence.poolDigest !== terms.poolDigest
				|| canonical(evidence.proofYs) !== canonical(terms.proofYs)) { context?.refuse('ABORT_BINDING'); refuse('return template or locked evidence differs') }
			const readConsensus = () => options.consensus.readExact({ operationId: terms.operationId, auctionId: terms.auctionId })
			const consensus = await (context ? context.observe(readConsensus) : readConsensus())
			const readMint = () => options.mint.verifyExact({ template, proofYs })
			const mint = await (context ? context.observe(readMint) : readMint())
			if (consensus.origin !== 'none' || mint.activeKeysetId !== terms.activeKeysetId
				|| mint.proofStates.length !== proofYs.length
				|| mint.proofStates.some((value, index) => value.proofY !== proofYs[index] || value.state !== 'UNSPENT')
				|| ![consensus.evidenceDigest, mint.evidenceDigest].every((value) => HEX_32.test(value))) {
				refuse('consensus, mint, or proof-use evidence is not exact')
			}
			const result = {
				schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1' as const,
				participantId: options.participantId, operationId: terms.operationId, poolDigest: terms.poolDigest,
				proofYsDigest: digest(proofYs), activeKeysetId: terms.activeKeysetId,
				returnPackageDigest: terms.returnPackageDigest,
				returnCashuSigAllDigest: terms.returnCashuSigAllDigest,
				mintEvidenceDigest: mint.evidenceDigest, consensusEvidenceDigest: consensus.evidenceDigest,
				evidenceDigest: '',
			}
			context?.check()
			return { evidence: result, proofClaim: { operationId: terms.operationId, auctionId: terms.auctionId, proofYs, poolDigest: terms.poolDigest } }
}
export function finalizeDemoFundingAbortPolicyEvidence(ready: Awaited<ReturnType<typeof preflightDemoFundingAbortParticipantPolicy>>, proofDigest: string): DemoFundingAbortParticipantEvidenceV1 {
	if (!HEX_32.test(proofDigest)) refuse('proof-use evidence is not exact')
	const evidence = { ...ready.evidence }
	evidence.evidenceDigest = digest(['COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1', evidence, proofDigest])
	return evidence
}
export function createDemoFundingAbortParticipantPolicy(options: DemoFundingAbortPolicyOptions): DemoFundingAbortParticipantPolicyPorts {
	return { participantId: options.participantId, async validateExact(request) {
		const { proofUse, ...readOnly } = options
		const ready = await preflightDemoFundingAbortParticipantPolicy(readOnly, request)
		const proof = await proofUse.claimExact(ready.proofClaim)
		return finalizeDemoFundingAbortPolicyEvidence(ready, proof.evidenceDigest)
	} }
}
