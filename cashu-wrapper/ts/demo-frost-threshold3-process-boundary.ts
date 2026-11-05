/**
 * Four separately enrolled process transports adapted to threshold-three signing.
 * Any selected three processes may sign; two can never cross round two.
 */
import {
	demoFrostProcessRosterDigest,
	type DemoFrostObservedProcess,
	type DemoFrostProcessBinding,
	type DemoFrostProcessParticipant,
	type DemoFrostProcessRoundOneRequest,
	type DemoFrostProcessRoundOneResponse,
	type DemoFrostProcessRoundTwoRequest,
	type DemoFrostProcessRoundTwoResponse,
} from './demo-frost-process-boundary'
import {
	cloneDemoFrostParticipantPolicy,
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyEvidence,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'
import {
	demoFrostTranscriptHash,
	type DemoFrostParticipantPort,
	type DemoParticipantId,
	type DemoRoundOneCommitment,
	type DemoRoundOneRequest,
	type DemoRoundTwoRequest,
	type DemoSignatureShare,
} from './demo-sigall-settlement'

const PARTICIPANT_IDS = [1, 2, 3, 4] as const
const HEX_32 = /^[0-9a-f]{64}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/

/**
 * A process port that retains the signer-authenticated participant-local
 * policy evidence from round one.  Only the process-boundary implementation
 * can construct this shape; coordinator-side policy callbacks are not a
 * substitute for the remote signer's own Comet/mint/proof-use checks.
 */
export interface DemoPolicyVerifiedFrostParticipantPort extends DemoFrostParticipantPort {
	takeRoundOnePolicyEvidence(sessionId: string): DemoFrostParticipantPolicyEvidence
}

export class DemoFrostThreshold3ProcessError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoFrostThreshold3ProcessError'
	}
}

function refuse(code: string, message: string): never { throw new DemoFrostThreshold3ProcessError(code, message) }

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
		Object.freeze(value)
	}
	return value
}

function rejectForbidden(value: unknown, field = 'message', allowProofSecret = false): void {
	if (value === null || typeof value !== 'object') return
	if (Array.isArray(value)) {
		value.forEach((child, index) => rejectForbidden(child, `${field}[${index}]`, allowProofSecret))
		return
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const normalized = key.replace(/[^a-z]/gi, '').toLowerCase()
		const approved = allowProofSecret && normalized === 'secret' && /^message\.policy\.committeeLockedProofs\[\d+\]$/.test(field)
		if ((!approved && normalized.includes('secret')) || normalized.includes('privatekey') || normalized.includes('mnemonic')
			|| normalized.includes('seed') || normalized === 'share' || normalized === 'keyshare') {
			refuse('DEMO_FROST_T3_PROCESS_SECRET', `${field}.${key} is forbidden at the coordinator boundary`)
		}
		rejectForbidden(child, `${field}.${key}`, allowProofSecret)
	}
}

function exactKeys(value: unknown, expected: string[], field: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		refuse('DEMO_FROST_T3_PROCESS_RESPONSE', `${field} must be an object`)
	}
	const actual = Object.keys(value).sort()
	const wanted = [...expected].sort()
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
		refuse('DEMO_FROST_T3_PROCESS_RESPONSE', `${field} contains missing or unexpected fields`)
	}
}

function exactBinding(actual: DemoFrostProcessBinding, expected: DemoFrostProcessBinding): void {
	exactKeys(actual, [
		'schema', 'participantId', 'processIdentity', 'committeeKeysetId', 'committeeKeysetVersion',
		'rosterDigest', 'policyPackageDigest', 'sessionId', 'packageDigest', 'digest',
	], 'binding')
	for (const key of Object.keys(expected) as (keyof DemoFrostProcessBinding)[]) {
		if (actual[key] !== expected[key]) refuse('DEMO_FROST_T3_PROCESS_BINDING', 'process did not echo the exact binding')
	}
}

function exactPeer(actual: DemoFrostObservedProcess, participant: DemoFrostProcessParticipant): DemoFrostObservedProcess {
	const expected = participant.enrollment
	exactKeys(actual, ['participantId', 'processIdentity', 'processInstanceId', 'restartCounter', 'stateDirectory', 'verifyingShare',
		...(expected.stateDirectoryIdentity === undefined ? [] : ['stateDirectoryIdentity'])], 'peer')
	if (actual.participantId !== expected.participantId || actual.processIdentity !== expected.processIdentity
		|| actual.stateDirectory !== expected.stateDirectory
		|| actual.stateDirectoryIdentity !== expected.stateDirectoryIdentity || actual.verifyingShare !== expected.verifyingShare
		|| actual.processInstanceId.length === 0 || !Number.isSafeInteger(actual.restartCounter) || actual.restartCounter < 0) {
		refuse('DEMO_FROST_T3_PROCESS_IDENTITY', 'transport-attested process differs from enrollment')
	}
	return { ...actual }
}

function samePeer(left: DemoFrostObservedProcess, right: DemoFrostObservedProcess): boolean {
	return left.participantId === right.participantId && left.processIdentity === right.processIdentity
		&& left.processInstanceId === right.processInstanceId && left.restartCounter === right.restartCounter
		&& left.stateDirectory === right.stateDirectory && left.stateDirectoryIdentity === right.stateDirectoryIdentity
		&& left.verifyingShare === right.verifyingShare
}

async function bounded<T>(participantId: DemoParticipantId, round: string, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController()
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			controller.abort()
			reject(new DemoFrostThreshold3ProcessError('DEMO_FROST_T3_PROCESS_WITHHELD', `participant ${participantId} withheld ${round}`))
		}, timeoutMs)
	})
	try { return await Promise.race([run(controller.signal), timeout]) }
	catch (error) {
		if (error instanceof DemoFrostThreshold3ProcessError) throw error
		return refuse('DEMO_FROST_T3_PROCESS_UNAVAILABLE', `participant ${participantId} ${round} failed: ${error instanceof Error ? error.message : 'transport failure'}`)
	} finally { if (timer !== undefined) clearTimeout(timer) }
}

function validateRequest(request: DemoRoundOneRequest, options: {
	committeeKeysetId: string
	committeeKeysetVersion: string
	policy: DemoFrostParticipantPolicyPackage
}): void {
	exactKeys(request, 'commitments' in request
		? ['sessionId', 'digest', 'packageDigest', 'committeeKeysetId', 'committeeKeysetVersion', 'commitments', 'transcriptHash']
		: ['sessionId', 'digest', 'packageDigest', 'committeeKeysetId', 'committeeKeysetVersion'], 'coordinatorRequest')
	if (!HEX_32.test(request.sessionId) || !HEX_32.test(request.packageDigest) || !HEX_32.test(request.digest)) {
		refuse('DEMO_FROST_T3_PROCESS_REQUEST', 'session and package digests must be exact lowercase hex')
	}
	if (request.committeeKeysetId !== options.committeeKeysetId || request.committeeKeysetVersion !== options.committeeKeysetVersion
		|| request.packageDigest !== options.policy.packageDigest || request.digest !== options.policy.cashuSigAllDigest) {
		refuse('DEMO_FROST_T3_PROCESS_POLICY', 'coordinator request differs from configured policy/keyset')
	}
}

function validateSubset(request: DemoRoundTwoRequest): void {
	if (request.commitments.length !== 3) refuse('PAYMENT_BLOCKED_MISSING_PARTICIPANT', 'threshold-three round two requires exactly three commitments')
	const ids = request.commitments.map((value) => value.participantId)
	if (new Set(ids).size !== 3 || ids.some((id, index) => !PARTICIPANT_IDS.includes(id) || (index > 0 && ids[index - 1]! >= id))) {
		refuse('DEMO_FROST_T3_PROCESS_TRANSCRIPT', 'commitments must be an ordered three-member subset')
	}
	const noncePoints: string[] = []
	for (const [index, commitment] of request.commitments.entries()) {
		exactKeys(commitment, ['participantId', 'sessionId', 'digest', 'hiding', 'binding'], `commitments[${index}]`)
		if (commitment.sessionId !== request.sessionId || commitment.digest !== request.digest
			|| !COMPRESSED_KEY.test(commitment.hiding) || !COMPRESSED_KEY.test(commitment.binding)) {
			refuse('DEMO_FROST_T3_PROCESS_TRANSCRIPT', 'commitment differs from the exact session or digest')
		}
		noncePoints.push(commitment.hiding.slice(2), commitment.binding.slice(2))
	}
	if (new Set(noncePoints).size !== noncePoints.length) refuse('DEMO_FROST_T3_PROCESS_TRANSCRIPT', 'duplicate nonce commitment')
	if (request.transcriptHash !== demoFrostTranscriptHash(request, request.commitments)) refuse('DEMO_FROST_T3_PROCESS_TRANSCRIPT', 'transcript hash mismatch')
}

export function createDemoThreshold3SeparatedProcessPorts(options: {
	committeeKeysetId: string
	committeeKeysetVersion: string
	requestTimeoutMs: number
	policy: DemoFrostParticipantPolicyPackage
	participants: [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant]
}): [DemoPolicyVerifiedFrostParticipantPort, DemoPolicyVerifiedFrostParticipantPort,
	DemoPolicyVerifiedFrostParticipantPort, DemoPolicyVerifiedFrostParticipantPort] {
	if (options.committeeKeysetId.length === 0 || options.committeeKeysetVersion.length === 0) refuse('DEMO_FROST_T3_PROCESS_KEYSET', 'keyset binding is required')
	if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0 || options.requestTimeoutMs > 60_000) {
		refuse('DEMO_FROST_T3_PROCESS_TIMEOUT', 'timeout must be from 1 through 60000 milliseconds')
	}
	const policy = deepFreeze(cloneDemoFrostParticipantPolicy(options.policy))
	const policyPackageDigest = demoFrostParticipantPolicyDigest(policy)
	const enrollments = options.participants.map((participant) => ({ ...participant.enrollment }))
	const rosterDigest = demoFrostProcessRosterDigest(enrollments)
	const directoryIdentities = enrollments.map((value) => value.stateDirectoryIdentity)
	const usesDirectoryIdentities = directoryIdentities.some((value) => value !== undefined)
	const directoriesAreIsolated = usesDirectoryIdentities
		? directoryIdentities.every((value) => value !== undefined) && new Set(directoryIdentities).size === 4
		: new Set(enrollments.map((value) => value.stateDirectory)).size === 4
	if (new Set(enrollments.map((value) => value.processIdentity)).size !== 4 || !directoriesAreIsolated
		|| new Set(enrollments.map((value) => value.verifyingShare.slice(2))).size !== 4) {
		refuse('DEMO_FROST_T3_PROCESS_ISOLATION', 'four distinct process identities, directories, and verifying shares are required')
	}
	if (!usesDirectoryIdentities) {
		for (const [index, directory] of enrollments.map((value) => value.stateDirectory).entries()) {
			for (const [otherIndex, other] of enrollments.map((value) => value.stateDirectory).entries()) {
				if (index !== otherIndex && other.startsWith(`${directory}/`)) refuse('DEMO_FROST_T3_PROCESS_ISOLATION', 'state directories must not contain one another')
			}
		}
	}
	const observedInstances = new Map<string, Map<DemoParticipantId, string>>()

	return options.participants.map((participant, index): DemoPolicyVerifiedFrostParticipantPort => {
		const enrollment = enrollments[index]!
		const active = new Map<string, { binding: DemoFrostProcessBinding; peer: DemoFrostObservedProcess; commitment: DemoRoundOneCommitment }>()
		const policyEvidence = new Map<string, DemoFrostParticipantPolicyEvidence>()
		const binding = (request: DemoRoundOneRequest): DemoFrostProcessBinding => ({
			schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1', participantId: enrollment.participantId,
			processIdentity: enrollment.processIdentity, committeeKeysetId: request.committeeKeysetId,
			committeeKeysetVersion: request.committeeKeysetVersion, rosterDigest, policyPackageDigest,
			sessionId: request.sessionId, packageDigest: request.packageDigest, digest: request.digest,
		})
		return {
			takeRoundOnePolicyEvidence(sessionId) {
				const evidence = policyEvidence.get(sessionId)
				if (evidence === undefined) refuse('DEMO_FROST_T3_PROCESS_POLICY', 'no signer-authenticated policy evidence for session')
				policyEvidence.delete(sessionId)
				return structuredClone(evidence)
			},
			participantId: enrollment.participantId,
			verifyingShare: enrollment.verifyingShare,
			async roundOne(request): Promise<DemoRoundOneCommitment> {
				validateRequest(request, options)
				if (active.has(request.sessionId)) refuse('DEMO_FROST_T3_PROCESS_SESSION_REUSE', 'session already opened')
				const expectedBinding = binding(request)
				const processRequest: DemoFrostProcessRoundOneRequest = {
					schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1',
					binding: expectedBinding, policy: deepFreeze(cloneDemoFrostParticipantPolicy(policy)),
				}
				rejectForbidden(processRequest, 'message', true)
				const exchange = await bounded(enrollment.participantId, 'round one', options.requestTimeoutMs,
					(signal) => participant.transport.roundOne(processRequest, { signal }))
				rejectForbidden(exchange)
				exactKeys(exchange, ['peer', 'message'], 'roundOneExchange')
				const peer = exactPeer(exchange.peer, participant)
				const instances = observedInstances.get(request.sessionId) ?? new Map<DemoParticipantId, string>()
				if ([...instances.values()].includes(peer.processInstanceId)) refuse('DEMO_FROST_T3_PROCESS_ISOLATION', 'two participants reported one process instance')
				instances.set(enrollment.participantId, peer.processInstanceId)
				observedInstances.set(request.sessionId, instances)
				const response = exchange.message as DemoFrostProcessRoundOneResponse
				exactKeys(response, ['schema', 'binding', 'policyEvidence', 'commitment'], 'roundOneResponse')
				if (response.schema !== 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1') refuse('DEMO_FROST_T3_PROCESS_RESPONSE', 'wrong round-one schema')
				exactBinding(response.binding, expectedBinding)
				exactKeys(response.policyEvidence, [
					'schema', 'policyPackageDigest', 'closureEvidenceDigest', 'signedBidEvidenceDigest',
					'committeeLockedProofsDigest', 'authenticatedPackageDigest', 'derivedCashuSigAllDigest',
				], 'roundOneResponse.policyEvidence')
				exactKeys(response.commitment, ['hiding', 'binding'], 'roundOneResponse.commitment')
				if (response.policyEvidence.policyPackageDigest !== policyPackageDigest
					|| response.policyEvidence.closureEvidenceDigest !== policy.certifiedClosure.evidenceDigest
					|| response.policyEvidence.signedBidEvidenceDigest !== policy.signedBid.evidenceDigest
					|| response.policyEvidence.committeeLockedProofsDigest !== demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs)
					|| response.policyEvidence.authenticatedPackageDigest !== policy.packageDigest
					|| response.policyEvidence.derivedCashuSigAllDigest !== policy.cashuSigAllDigest
					|| !COMPRESSED_KEY.test(response.commitment.hiding) || !COMPRESSED_KEY.test(response.commitment.binding)) {
					refuse('DEMO_FROST_T3_PROCESS_POLICY', 'process evidence or commitment is malformed')
				}
				const commitment: DemoRoundOneCommitment = {
					participantId: enrollment.participantId, sessionId: request.sessionId, digest: request.digest,
					hiding: response.commitment.hiding, binding: response.commitment.binding,
				}
				active.set(request.sessionId, { binding: expectedBinding, peer, commitment })
				policyEvidence.set(request.sessionId, structuredClone(response.policyEvidence))
				return commitment
			},
			async roundTwo(request): Promise<DemoSignatureShare> {
				validateRequest(request, options)
				validateSubset(request)
				const opened = active.get(request.sessionId)
				if (!opened) refuse('DEMO_FROST_T3_PROCESS_ROUND_ORDER', 'no accepted round one for this process')
				const own = request.commitments.find((value) => value.participantId === enrollment.participantId)
				if (own === undefined || own.participantId !== opened.commitment.participantId
					|| own.sessionId !== opened.commitment.sessionId || own.digest !== opened.commitment.digest
					|| own.hiding !== opened.commitment.hiding || own.binding !== opened.commitment.binding) {
					refuse('DEMO_FROST_T3_PROCESS_TRANSCRIPT', 'selected subset changed this process commitment')
				}
				const expectedBinding = binding(request)
				exactBinding(expectedBinding, opened.binding)
				active.delete(request.sessionId)
				const processRequest: DemoFrostProcessRoundTwoRequest = {
					schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_REQUEST_V1', binding: expectedBinding,
					transcriptHash: request.transcriptHash, commitments: request.commitments.map((value) => ({ ...value })),
				}
				rejectForbidden(processRequest)
				const exchange = await bounded(enrollment.participantId, 'round two', options.requestTimeoutMs,
					(signal) => participant.transport.roundTwo(processRequest, { signal }))
				rejectForbidden(exchange)
				exactKeys(exchange, ['peer', 'message'], 'roundTwoExchange')
				const peer = exactPeer(exchange.peer, participant)
				if (!samePeer(peer, opened.peer)) refuse('DEMO_FROST_T3_PROCESS_RESTARTED', 'process restarted between rounds')
				const response = exchange.message as DemoFrostProcessRoundTwoResponse
				exactKeys(response, ['schema', 'binding', 'transcriptHash', 'signatureShare'], 'roundTwoResponse')
				if (response.schema !== 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1' || response.transcriptHash !== request.transcriptHash || !HEX_32.test(response.signatureShare)) {
					refuse('DEMO_FROST_T3_PROCESS_RESPONSE', 'malformed round-two response')
				}
				exactBinding(response.binding, expectedBinding)
				return { participantId: enrollment.participantId, sessionId: request.sessionId, digest: request.digest, transcriptHash: request.transcriptHash, share: response.signatureShare }
			},
		}
	}) as [DemoPolicyVerifiedFrostParticipantPort, DemoPolicyVerifiedFrostParticipantPort,
		DemoPolicyVerifiedFrostParticipantPort, DemoPolicyVerifiedFrostParticipantPort]
}
