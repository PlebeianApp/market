/**
 * Local-only 3-of-4 maintainer-federation candidate.
 *
 * This is an admission/coordinator prototype, not a live threshold change. It creates no keys and
 * is intentionally not exported from the package barrel. Production use still requires a fresh
 * dealerless 3-of-4 DKG/keyset, reviewed Rust/process adapters, and explicit activation approval.
 *
 * Threat model: at most one of the four maintainers is faulty. Every contributing signer must
 * independently validate the same canonical finalized auction, signed bid, locked proofs, exact
 * payout/refund outputs, and Cashu digest before returning a commitment. Three matching signers
 * can therefore authorize the branch; one missing or malformed signer is ignored, while fewer
 * than three matching signers block before aggregation.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	validateDemoFrostParticipantPolicy,
	type DemoFrostParticipantPolicyEvidence,
	type DemoFrostParticipantPolicyPackage,
	type DemoFrostParticipantPolicyPorts,
} from './demo-frost-participant-policy'
import {
	demoFrostTranscriptHash,
	type DemoCommitteeAuthorizationRequest,
	type DemoFrostAggregatePort,
	type DemoFrostParticipantPort,
	type DemoParticipantId,
	type DemoRoundOneCommitment,
	type DemoRoundOneRequest,
	type DemoRoundTwoRequest,
	type DemoSignatureShare,
} from './demo-sigall-settlement'
import type { DemoPolicyVerifiedFrostParticipantPort } from './demo-frost-threshold3-process-boundary'

const PARTICIPANT_IDS = [1, 2, 3, 4] as const
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

export interface DemoMaintainerFederationRequest extends DemoCommitteeAuthorizationRequest {
	threshold: 3
	policyPackageDigest: string
	closureEvidenceDigest: string
	signedBidEvidenceDigest: string
	committeeLockedProofsDigest: string
}

export interface DemoMaintainerFederationRoundOne {
	commitment: DemoRoundOneCommitment
	policyEvidence: DemoFrostParticipantPolicyEvidence
}

export interface DemoMaintainerFederationParticipantPort {
	readonly participantId: DemoParticipantId
	readonly verifyingShare: string
	roundOneVerified(request: DemoMaintainerFederationRequest): Promise<DemoMaintainerFederationRoundOne>
	roundTwo(request: DemoRoundTwoRequest): Promise<DemoSignatureShare>
}

/** Participant-local source. The coordinator supplies only public lookup digests, never policy bytes. */
export interface DemoMaintainerParticipantPolicySource {
	readExact(request: {
		sessionId: string
		packageDigest: string
		cashuSigAllDigest: string
		policyPackageDigest: string
		closureEvidenceDigest: string
		signedBidEvidenceDigest: string
		committeeLockedProofsDigest: string
	}): Promise<DemoFrostParticipantPolicyPackage | null>
}

export interface DemoMaintainerFederationAuthorization {
	schema: 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1'
	threshold: 3
	participantIds: [DemoParticipantId, DemoParticipantId, DemoParticipantId]
	sessionId: string
	packageDigest: string
	cashuSigAllDigest: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	transcriptHash: string
	signature: string
	/** Concrete Rust process authorization root; absent in legacy in-memory adapters. */
	frostOperationRoot?: string
}

export interface DemoMaintainerFederationPort {
	authorize(
		request: DemoMaintainerFederationRequest,
		options?: { excludeParticipantId?: DemoParticipantId },
	): Promise<DemoMaintainerFederationAuthorization>
}

export interface DemoMaintainerFederationOptions {
	/** Bounds a silent participant in each FROST round. */
	roundTimeoutMs?: number
	/** Use only for a fresh session after this public participant failed a prior round two. */
	excludeParticipantId?: DemoParticipantId
}

export class DemoMaintainerFederationRefusedError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly failedParticipantIds: DemoParticipantId[] = [],
	) {
		super(`${code}: ${message}`)
		this.name = 'DemoMaintainerFederationRefusedError'
	}
}

function refuse(code: string, message: string, failedParticipantIds: DemoParticipantId[] = []): never {
	throw new DemoMaintainerFederationRefusedError(code, message, [...failedParticipantIds])
}

function validEvidence(
	evidence: DemoFrostParticipantPolicyEvidence,
	request: DemoMaintainerFederationRequest,
): boolean {
	return typeof evidence === 'object'
		&& evidence !== null
		&& JSON.stringify(Object.keys(evidence).sort()) === JSON.stringify([
			'authenticatedPackageDigest',
			'closureEvidenceDigest',
			'committeeLockedProofsDigest',
			'derivedCashuSigAllDigest',
			'policyPackageDigest',
			'schema',
			'signedBidEvidenceDigest',
		])
		&& evidence.schema === 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1'
		&& evidence.policyPackageDigest === request.policyPackageDigest
		&& evidence.closureEvidenceDigest === request.closureEvidenceDigest
		&& evidence.signedBidEvidenceDigest === request.signedBidEvidenceDigest
		&& evidence.committeeLockedProofsDigest === request.committeeLockedProofsDigest
		&& evidence.authenticatedPackageDigest === request.packageDigest
		&& evidence.derivedCashuSigAllDigest === request.cashuSigAllDigest
}

function validCommitment(
	commitment: DemoRoundOneCommitment,
	participant: DemoMaintainerFederationParticipantPort,
	request: DemoMaintainerFederationRequest,
): boolean {
	return typeof commitment === 'object'
		&& commitment !== null
		&& commitment.participantId === participant.participantId
		&& commitment.sessionId === request.sessionId
		&& commitment.digest === request.cashuSigAllDigest
		&& COMPRESSED_KEY.test(commitment.hiding)
		&& COMPRESSED_KEY.test(commitment.binding)
}

function validShare(
	share: DemoSignatureShare,
	participantId: DemoParticipantId,
	request: DemoMaintainerFederationRequest,
	transcriptHash: string,
): boolean {
	return typeof share === 'object'
		&& share !== null
		&& share.participantId === participantId
		&& share.sessionId === request.sessionId
		&& share.digest === request.cashuSigAllDigest
		&& share.transcriptHash === transcriptHash
		&& HEX_32.test(share.share)
}

function verifyAggregate(signature: string, digest: string, publicKey: string): boolean {
	if (!HEX_64.test(signature) || !HEX_32.test(digest) || !COMPRESSED_KEY.test(publicKey)) return false
	try {
		return schnorr.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(publicKey.slice(2)))
	} catch {
		return false
	}
}

function boundedParticipantCall<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('maintainer round timed out')), timeoutMs)
		Promise.resolve()
			.then(run)
			.then(
				(value) => {
					clearTimeout(timer)
					resolve(value)
				},
				(error) => {
					clearTimeout(timer)
					reject(error)
				},
			)
	})
}

/**
 * Build one isolated signer port whose round-one commitment is unreachable until the participant's
 * own policy source and verifier ports derive every exact digest. The coordinator never supplies
 * authenticated closure/signed-bid evidence through this adapter.
 */
export function createDemoMaintainerFederationParticipantPort(options: {
	signer: DemoFrostParticipantPort
	policySource: DemoMaintainerParticipantPolicySource
	policyPorts: DemoFrostParticipantPolicyPorts
}): DemoMaintainerFederationParticipantPort {
	const participantId = options.signer.participantId
	const verifyingShare = options.signer.verifyingShare
	const roundOne = options.signer.roundOne.bind(options.signer)
	const roundTwo = options.signer.roundTwo.bind(options.signer)
	const readExact = options.policySource.readExact.bind(options.policySource)
	const policyPorts: DemoFrostParticipantPolicyPorts = Object.freeze({
		closureVerifier: Object.freeze({ verifyAndDerive: options.policyPorts.closureVerifier.verifyAndDerive.bind(options.policyPorts.closureVerifier) }),
		signedBidVerifier: Object.freeze({ verifyAndDerive: options.policyPorts.signedBidVerifier.verifyAndDerive.bind(options.policyPorts.signedBidVerifier) }),
		proofUse: Object.freeze({ assertExclusive: options.policyPorts.proofUse.assertExclusive.bind(options.policyPorts.proofUse) }),
	})
	return Object.freeze({
		participantId,
		verifyingShare,
		async roundOneVerified(value: DemoMaintainerFederationRequest) {
			const request = structuredClone(value)
			const lookup = {
				sessionId: request.sessionId,
				packageDigest: request.packageDigest,
				cashuSigAllDigest: request.cashuSigAllDigest,
				policyPackageDigest: request.policyPackageDigest,
				closureEvidenceDigest: request.closureEvidenceDigest,
				signedBidEvidenceDigest: request.signedBidEvidenceDigest,
				committeeLockedProofsDigest: request.committeeLockedProofsDigest,
			}
			const policy = await readExact(structuredClone(lookup))
			if (policy === null) refuse('DEMO_MAINTAINER_POLICY', 'participant-local exact policy is unavailable')
			const policyEvidence = await validateDemoFrostParticipantPolicy({
				policy,
				expectedPackageDigest: request.packageDigest,
				expectedCashuSigAllDigest: request.cashuSigAllDigest,
				ports: policyPorts,
			})
			if (policyEvidence.policyPackageDigest !== request.policyPackageDigest
				|| policyEvidence.closureEvidenceDigest !== request.closureEvidenceDigest
				|| policyEvidence.signedBidEvidenceDigest !== request.signedBidEvidenceDigest
				|| policyEvidence.committeeLockedProofsDigest !== request.committeeLockedProofsDigest) {
				refuse('DEMO_MAINTAINER_POLICY', 'participant-local derived evidence differs from the requested exact policy')
			}
			const commitment = await roundOne({
				sessionId: request.sessionId,
				digest: request.cashuSigAllDigest,
				packageDigest: request.packageDigest,
				committeeKeysetId: request.committeeKeysetId,
				committeeKeysetVersion: request.committeeKeysetVersion,
			})
			return { commitment, policyEvidence }
		},
		async roundTwo(request: DemoRoundTwoRequest) {
			return roundTwo(structuredClone(request))
		},
	})
}

/**
 * Adapt the authenticated process boundary directly.  The policy evidence is
 * the evidence signed by the separately running participant and checked by
 * `createDemoThreshold3SeparatedProcessPorts`; it is never recreated from a
 * coordinator callback.
 */
export function createDemoMaintainerProcessFederationParticipantPort(
	signer: DemoPolicyVerifiedFrostParticipantPort,
): DemoMaintainerFederationParticipantPort {
	return Object.freeze({
		participantId: signer.participantId,
		verifyingShare: signer.verifyingShare,
		async roundOneVerified(request: DemoMaintainerFederationRequest) {
			const commitment = await signer.roundOne({
				sessionId: request.sessionId, digest: request.cashuSigAllDigest,
				packageDigest: request.packageDigest, committeeKeysetId: request.committeeKeysetId,
				committeeKeysetVersion: request.committeeKeysetVersion,
			})
			const policyEvidence = signer.takeRoundOnePolicyEvidence(request.sessionId)
			if (!validEvidence(policyEvidence, request)) {
				refuse('DEMO_MAINTAINER_POLICY', 'participant process returned policy evidence for another request')
			}
			return { commitment, policyEvidence }
		},
		roundTwo: (request: DemoRoundTwoRequest) => signer.roundTwo(structuredClone(request)),
	})
}

/**
 * Coordinate one local candidate session. A round-two failure stops this session; retry requires a
 * fresh session/nonces and may choose another three-member subset. It never silently reuses nonces.
 */
export function createDemoThreeOfFourMaintainerFederationPort(
	participants: DemoMaintainerFederationParticipantPort[],
	aggregator: DemoFrostAggregatePort,
	options: DemoMaintainerFederationOptions = {},
): DemoMaintainerFederationPort {
	if (participants.length !== 4 || participants.some((participant, index) => participant.participantId !== PARTICIPANT_IDS[index])) {
		refuse('DEMO_MAINTAINER_ROSTER', 'candidate roster must be exactly [1,2,3,4] in order')
	}
	const roundTimeoutMs = options.roundTimeoutMs ?? 5_000
	if (!Number.isSafeInteger(roundTimeoutMs) || roundTimeoutMs <= 0 || roundTimeoutMs > 60_000) {
		refuse('DEMO_MAINTAINER_TIMEOUT', 'round timeout must be an integer from 1 through 60000 milliseconds')
	}
	const excludedParticipantId = options.excludeParticipantId
	if (excludedParticipantId !== undefined && !PARTICIPANT_IDS.includes(excludedParticipantId)) {
		refuse('DEMO_MAINTAINER_ROSTER', 'retry exclusion must name one participant in [1,2,3,4]')
	}
	if (participants.some((participant) => !COMPRESSED_KEY.test(participant.verifyingShare))
		|| new Set(participants.map((participant) => participant.verifyingShare.slice(2))).size !== 4) {
		refuse('DEMO_MAINTAINER_ROSTER', 'candidate requires four distinct public verifying shares')
	}
	const captured = participants.map((participant) => ({
		participantId: participant.participantId,
		verifyingShare: participant.verifyingShare,
		roundOneVerified: participant.roundOneVerified.bind(participant),
		roundTwo: participant.roundTwo.bind(participant),
	}))
	const aggregate = aggregator.aggregate.bind(aggregator)
	return {
		async authorize(value, callOptions = {}) {
			let received: DemoMaintainerFederationRequest
			try { received = structuredClone(value) }
			catch { return refuse('DEMO_MAINTAINER_REQUEST', 'candidate request must be cloneable') }
			if (typeof received !== 'object'
				|| received === null
				|| received.schema !== 'COCO_DEMO_FROST_REQUEST_V1'
				|| received.threshold !== 3
				|| typeof received.committeeKeysetId !== 'string'
				|| received.committeeKeysetId.length === 0
				|| typeof received.committeeKeysetVersion !== 'string'
				|| received.committeeKeysetVersion.length === 0
				|| !COMPRESSED_KEY.test(received.committeePublicKey)
				|| !Array.isArray(received.participants)
				|| received.participants.length !== 4
				|| received.participants.some((participant, index) => typeof participant !== 'object'
					|| participant === null
					|| participant.identifier !== PARTICIPANT_IDS[index]
					|| participant.verifyingShare !== captured[index]!.verifyingShare)) {
				refuse('DEMO_MAINTAINER_REQUEST', 'request must bind the exact four-member roster and threshold three')
			}
			for (const digest of [
				received.sessionId,
				received.packageDigest,
				received.cashuSigAllDigest,
				received.policyPackageDigest,
				received.closureEvidenceDigest,
				received.signedBidEvidenceDigest,
				received.committeeLockedProofsDigest,
			]) if (!HEX_32.test(digest)) refuse('DEMO_MAINTAINER_REQUEST', 'all candidate digests must be 32 lowercase hex bytes')
			// Rebuild the only object allowed across participant boundaries. Extra caller fields are
			// intentionally discarded so bearer/private data cannot be smuggled through this port.
			const request: DemoMaintainerFederationRequest = {
				schema: 'COCO_DEMO_FROST_REQUEST_V1',
				threshold: 3,
				sessionId: received.sessionId,
				packageDigest: received.packageDigest,
				cashuSigAllDigest: received.cashuSigAllDigest,
				committeePublicKey: received.committeePublicKey,
				committeeKeysetId: received.committeeKeysetId,
				committeeKeysetVersion: received.committeeKeysetVersion,
				participants: received.participants.map(({ identifier, verifyingShare }) => ({ identifier, verifyingShare })),
				policyPackageDigest: received.policyPackageDigest,
				closureEvidenceDigest: received.closureEvidenceDigest,
				signedBidEvidenceDigest: received.signedBidEvidenceDigest,
				committeeLockedProofsDigest: received.committeeLockedProofsDigest,
			}

			// Never expose the coordinator's private canonical snapshot. A faulty participant receives its
			// own clone and therefore cannot mutate what another participant validates or what we return.
			const callExcludedParticipantId = callOptions.excludeParticipantId ?? excludedParticipantId
			if (callExcludedParticipantId !== undefined && !PARTICIPANT_IDS.includes(callExcludedParticipantId)) {
				refuse('DEMO_MAINTAINER_ROSTER', 'retry exclusion must name one participant in [1,2,3,4]')
			}
			const eligible = captured.filter((participant) => participant.participantId !== callExcludedParticipantId)
			const responses = await Promise.allSettled(eligible.map((participant) => boundedParticipantCall(
				() => participant.roundOneVerified(structuredClone(request)),
				roundTimeoutMs,
			)))
			const admitted = responses.flatMap((response, index) => {
				if (response.status !== 'fulfilled') return []
				const participant = eligible[index]!
				const value = response.value
				if (typeof value !== 'object'
					|| value === null
					|| !validCommitment(value.commitment, participant, request)
					|| !validEvidence(value.policyEvidence, request)) return []
				return [{ participant, commitment: structuredClone(response.value.commitment) }]
			})
			if (admitted.length < 3) {
				refuse('DEMO_MAINTAINER_THRESHOLD_UNAVAILABLE', 'fewer than three maintainers independently approved the exact finalized outcome')
			}
			const selected = admitted.slice(0, 3)
			const commitments = selected.map(({ commitment }) => commitment)
			const noncePoints = commitments.flatMap((commitment) => [commitment.hiding.slice(2), commitment.binding.slice(2)])
			if (new Set(noncePoints).size !== noncePoints.length) {
				refuse(
					'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
					'selected maintainers returned duplicate nonce commitments; retry fresh subsets',
					selected.map(({ participant }) => participant.participantId),
				)
			}
			const roundOneRequest: DemoRoundOneRequest = {
				sessionId: request.sessionId,
				digest: request.cashuSigAllDigest,
				packageDigest: request.packageDigest,
				committeeKeysetId: request.committeeKeysetId,
				committeeKeysetVersion: request.committeeKeysetVersion,
			}
			const transcriptHash = demoFrostTranscriptHash(roundOneRequest, commitments)
			const roundTwoRequest: DemoRoundTwoRequest = { ...roundOneRequest, commitments, transcriptHash }
			const shareResponses = await Promise.allSettled(selected.map(({ participant }) => boundedParticipantCall(
					() => participant.roundTwo(structuredClone(roundTwoRequest)),
					roundTimeoutMs,
				)))
			const failedRoundTwo = shareResponses.flatMap((response, index) => response.status === 'rejected'
				? [selected[index]!.participant.participantId]
				: [])
			if (failedRoundTwo.length > 0) {
				return refuse(
					'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
					`selected participant ${failedRoundTwo.join(',')} failed round two; retry only with a fresh session and that participant excluded`,
					failedRoundTwo,
				)
			}
			const shares = shareResponses.map((response) => (response as PromiseFulfilledResult<DemoSignatureShare>).value)
			const malformedShareIndex = shares.findIndex((share, index) => !validShare(
				share,
				selected[index]!.participant.participantId,
				request,
				transcriptHash,
			))
			if (malformedShareIndex >= 0) {
				return refuse(
					'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
					`selected participant ${selected[malformedShareIndex]!.participant.participantId} returned a malformed share; retry only with a fresh session and that participant excluded`,
					[selected[malformedShareIndex]!.participant.participantId],
				)
			}
			if (new Set(shares.map((share) => share.share)).size !== 3) {
				refuse(
					'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
					'selected maintainers returned duplicate shares; retry fresh subsets',
					selected.map(({ participant }) => participant.participantId),
				)
			}
			let result: Awaited<ReturnType<DemoFrostAggregatePort['aggregate']>>
			try {
				result = await aggregate({
					sessionId: request.sessionId,
					digest: request.cashuSigAllDigest,
					packageDigest: request.packageDigest,
					transcriptHash,
					commitments,
					shares,
					committeePublicKey: request.committeePublicKey,
				})
			} catch {
				refuse(
					'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
					'candidate aggregate rejected one or more selected shares; retry fresh subsets to exclude one faulty signer',
					selected.map(({ participant }) => participant.participantId),
				)
			}
			if (typeof result !== 'object'
				|| result === null
				|| result.transcriptHash !== transcriptHash
				|| !verifyAggregate(result.signature, request.cashuSigAllDigest, request.committeePublicKey)) {
				refuse(
					'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
					'candidate aggregate does not verify; retry fresh subsets to exclude one faulty signer',
					selected.map(({ participant }) => participant.participantId),
				)
			}
			return {
				schema: 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1',
				threshold: 3,
				participantIds: selected.map(({ participant }) => participant.participantId) as [DemoParticipantId, DemoParticipantId, DemoParticipantId],
				sessionId: request.sessionId,
				packageDigest: request.packageDigest,
				cashuSigAllDigest: request.cashuSigAllDigest,
				committeeKeysetId: request.committeeKeysetId,
				committeeKeysetVersion: request.committeeKeysetVersion,
				transcriptHash,
				signature: bytesToHex(hexToBytes(result.signature)),
			}
		},
	}
}
