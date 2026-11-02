/**
 * Process-isolation boundary for the four FROST participant ports used by the demo settlement.
 *
 * This module is deliberately not a DKG or FROST implementation. It does not create, import, or
 * reconstruct credentials. A transport implementation must connect to a real, separately running
 * participant and must derive `peer` from authenticated IPC/RPC metadata rather than from the
 * participant's message body. The participant process remains responsible for durable nonce
 * handling and correct FROST round computation.
 *
 * `signatureShare` is a public protocol output. Secret key shares, aggregate secrets, private keys,
 * seeds, and mnemonics are forbidden anywhere in the coordinator/process envelopes.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoFrostParticipantPort,
	DemoParticipantId,
	DemoRoundOneCommitment,
	DemoRoundOneRequest,
	DemoRoundTwoRequest,
	DemoSignatureShare,
} from './demo-sigall-settlement'
import { demoFrostTranscriptHash } from './demo-sigall-settlement'
import {
	cloneDemoFrostParticipantPolicy,
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyEvidence,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'

const PARTICIPANT_IDS = [1, 2, 3, 4] as const
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const HEX_32 = /^[0-9a-f]{64}$/

export interface DemoFrostProcessEnrollment {
	participantId: DemoParticipantId
	/** Stable identity persisted by exactly one participant process across restarts. */
	processIdentity: string
	/** Dedicated absolute state directory; it must not contain another participant's state. */
	stateDirectory: string
	/** Public FROST verifying share only, never a secret key share. */
	verifyingShare: string
}

/**
 * Facts attested by the process transport, outside the participant-controlled message body.
 * `processInstanceId` and `restartCounter` make a restart between round one and round two visible.
 */
export interface DemoFrostObservedProcess {
	participantId: DemoParticipantId
	processIdentity: string
	processInstanceId: string
	restartCounter: number
	stateDirectory: string
	verifyingShare: string
}

export interface DemoFrostProcessBinding {
	schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1'
	participantId: DemoParticipantId
	processIdentity: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	rosterDigest: string
	policyPackageDigest: string
	sessionId: string
	packageDigest: string
	digest: string
}

export interface DemoFrostProcessRoundOneRequest {
	schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1'
	binding: DemoFrostProcessBinding
	/**
	 * Sensitive fake-Testnut policy sent only to the authenticated participant. It includes exact
	 * locked proof tuples, but no bidder witness/private key or recipient output opening.
	 */
	policy: DemoFrostParticipantPolicyPackage
}

export interface DemoFrostProcessRoundOneResponse {
	schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1'
	binding: DemoFrostProcessBinding
	/** Produced only after participant-local policy validation and exact SIG_ALL recomputation. */
	policyEvidence: DemoFrostParticipantPolicyEvidence
	commitment: {
		hiding: string
		binding: string
	}
}

export interface DemoFrostProcessRoundTwoRequest {
	schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_REQUEST_V1'
	binding: DemoFrostProcessBinding
	transcriptHash: string
	commitments: DemoRoundOneCommitment[]
}

export interface DemoFrostProcessRoundTwoResponse {
	schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1'
	binding: DemoFrostProcessBinding
	transcriptHash: string
	/** Public FROST protocol output, not the participant's secret key share. */
	signatureShare: string
}

export interface DemoFrostProcessExchange<T> {
	/** Transport-attested peer facts. Implementations must not copy these from `message`. */
	peer: DemoFrostObservedProcess
	message: T
}

/**
 * An implementation should use a real process boundary such as authenticated local IPC. The abort
 * signal is mandatory so a withheld participant cannot leave the coordinator waiting forever.
 */
export interface DemoFrostProcessTransport {
	roundOne(
		request: DemoFrostProcessRoundOneRequest,
		options: { signal: AbortSignal },
	): Promise<DemoFrostProcessExchange<DemoFrostProcessRoundOneResponse>>
	roundTwo(
		request: DemoFrostProcessRoundTwoRequest,
		options: { signal: AbortSignal },
	): Promise<DemoFrostProcessExchange<DemoFrostProcessRoundTwoResponse>>
}

export interface DemoFrostProcessParticipant {
	enrollment: DemoFrostProcessEnrollment
	transport: DemoFrostProcessTransport
}

export class DemoFrostProcessRefusedError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoFrostProcessRefusedError'
		this.code = code
	}
}

function refuse(code: string, message: string): never {
	throw new DemoFrostProcessRefusedError(code, message)
}

function requireText(value: string, field: string): void {
	if (value.length === 0 || value.trim() !== value) {
		refuse('DEMO_FROST_PROCESS_INVALID_TEXT', `${field} must be non-empty and trimmed`)
	}
}

function requireHex32(value: string, field: string): void {
	if (!HEX_32.test(value)) refuse('DEMO_FROST_PROCESS_INVALID_DIGEST', `${field} must be 32 lowercase hex bytes`)
}

function requireCompressedKey(value: string, field: string): void {
	if (!COMPRESSED_KEY.test(value)) {
		refuse('DEMO_FROST_PROCESS_INVALID_PUBLIC_KEY', `${field} must be lowercase compressed secp256k1 hex`)
	}
}

function requireDedicatedDirectory(value: string, field: string): void {
	requireText(value, field)
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//')) {
		refuse('DEMO_FROST_PROCESS_DIRECTORY', `${field} must be a canonical dedicated absolute directory`)
	}
	const segments = value.slice(1).split('/')
	if (segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)) {
		refuse('DEMO_FROST_PROCESS_DIRECTORY', `${field} must not contain empty, dot, or parent segments`)
	}
}

function hashText(value: string): string {
	return bytesToHex(sha256(utf8ToBytes(value)))
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
		Object.freeze(value)
	}
	return value
}

function exactKeys(value: unknown, expected: string[], field: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		refuse('DEMO_FROST_PROCESS_MESSAGE_SHAPE', `${field} must be an object`)
	}
	const actual = Object.keys(value).sort()
	const wanted = [...expected].sort()
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
		refuse('DEMO_FROST_PROCESS_MESSAGE_SHAPE', `${field} contains missing or unexpected fields`)
	}
}

function rejectSecretMaterial(value: unknown, field = 'message', allowCommitteeLockedProofSecrets = false): void {
	if (value === null || typeof value !== 'object') return
	if (Array.isArray(value)) {
		for (const [index, entry] of value.entries()) rejectSecretMaterial(entry, `${field}[${index}]`, allowCommitteeLockedProofSecrets)
		return
	}
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		const normalized = key.replace(/[^a-z]/gi, '').toLowerCase()
		const approvedProofSecret = allowCommitteeLockedProofSecrets
			&& normalized === 'secret'
			&& /^message\.policy\.committeeLockedProofs\[\d+\]$/.test(field)
		if (
			(!approvedProofSecret && normalized.includes('secret')) ||
			normalized.includes('privatekey') ||
			normalized.includes('mnemonic') ||
			normalized.includes('seed') ||
			normalized === 'share' ||
			normalized === 'keyshare'
		) {
			refuse('DEMO_FROST_PROCESS_SECRET_MATERIAL', `${field}.${key} is forbidden at the coordinator boundary`)
		}
		rejectSecretMaterial(entry, `${field}.${key}`, allowCommitteeLockedProofSecrets)
	}
}

function canonicalEnrollment(enrollment: DemoFrostProcessEnrollment, index: number): DemoFrostProcessEnrollment {
	if (enrollment.participantId !== PARTICIPANT_IDS[index]) {
		refuse('DEMO_FROST_PROCESS_ROSTER', 'participant identifiers must be exactly [1,2,3,4] in order')
	}
	requireText(enrollment.processIdentity, `participants[${index}].processIdentity`)
	requireDedicatedDirectory(enrollment.stateDirectory, `participants[${index}].stateDirectory`)
	requireCompressedKey(enrollment.verifyingShare, `participants[${index}].verifyingShare`)
	return { ...enrollment }
}

export function demoFrostProcessRosterDigest(participants: DemoFrostProcessEnrollment[]): string {
	if (participants.length !== 4) refuse('DEMO_FROST_PROCESS_ROSTER', 'exactly four process enrollments are required')
	const canonical = participants.map(canonicalEnrollment)
	return hashText(JSON.stringify(canonical.map((participant) => ({
		participantId: participant.participantId,
		processIdentity: participant.processIdentity,
		stateDirectory: participant.stateDirectory,
		verifyingShare: participant.verifyingShare,
	}))))
}

function exactBinding(actual: DemoFrostProcessBinding, expected: DemoFrostProcessBinding, field: string): void {
	exactKeys(actual, [
		'schema', 'participantId', 'processIdentity', 'committeeKeysetId', 'committeeKeysetVersion',
		'rosterDigest', 'policyPackageDigest', 'sessionId', 'packageDigest', 'digest',
	], field)
	if (
		actual.schema !== expected.schema ||
		actual.participantId !== expected.participantId ||
		actual.processIdentity !== expected.processIdentity ||
		actual.committeeKeysetId !== expected.committeeKeysetId ||
		actual.committeeKeysetVersion !== expected.committeeKeysetVersion ||
		actual.rosterDigest !== expected.rosterDigest ||
		actual.policyPackageDigest !== expected.policyPackageDigest ||
		actual.sessionId !== expected.sessionId ||
		actual.packageDigest !== expected.packageDigest ||
		actual.digest !== expected.digest
	) {
		refuse('DEMO_FROST_PROCESS_BINDING', `${field} does not echo the exact keyset, roster, session, package, and digest binding`)
	}
}

function exactPeer(
	actual: DemoFrostObservedProcess,
	enrollment: DemoFrostProcessEnrollment,
	field: string,
): DemoFrostObservedProcess {
	exactKeys(actual, [
		'participantId', 'processIdentity', 'processInstanceId', 'restartCounter', 'stateDirectory', 'verifyingShare',
	], field)
	if (
		actual.participantId !== enrollment.participantId ||
		actual.processIdentity !== enrollment.processIdentity ||
		actual.stateDirectory !== enrollment.stateDirectory ||
		actual.verifyingShare !== enrollment.verifyingShare
	) {
		refuse('DEMO_FROST_PROCESS_IDENTITY', `${field} differs from the enrolled participant process`)
	}
	requireText(actual.processInstanceId, `${field}.processInstanceId`)
	if (!Number.isSafeInteger(actual.restartCounter) || actual.restartCounter < 0) {
		refuse('DEMO_FROST_PROCESS_IDENTITY', `${field}.restartCounter must be a non-negative safe integer`)
	}
	return { ...actual }
}

function samePeer(left: DemoFrostObservedProcess, right: DemoFrostObservedProcess): boolean {
	return left.participantId === right.participantId &&
		left.processIdentity === right.processIdentity &&
		left.processInstanceId === right.processInstanceId &&
		left.restartCounter === right.restartCounter &&
		left.stateDirectory === right.stateDirectory &&
		left.verifyingShare === right.verifyingShare
}

async function exchangeWithTimeout<T>(options: {
	participantId: DemoParticipantId
	round: 'round one' | 'round two'
	timeoutMs: number
	run(signal: AbortSignal): Promise<T>
}): Promise<T> {
	const controller = new AbortController()
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			controller.abort()
			reject(new DemoFrostProcessRefusedError(
				'DEMO_FROST_PROCESS_WITHHELD',
				`participant ${options.participantId} withheld ${options.round} evidence`,
			))
		}, options.timeoutMs)
	})
	try {
		return await Promise.race([options.run(controller.signal), timeout])
	} catch (error) {
		if (error instanceof DemoFrostProcessRefusedError) throw error
		return refuse(
			'DEMO_FROST_PROCESS_UNAVAILABLE',
			`participant ${options.participantId} ${options.round} failed: ${error instanceof Error ? error.message : 'transport failure'}`,
		)
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}

function bindingFor(
	enrollment: DemoFrostProcessEnrollment,
	rosterDigest: string,
	policyPackageDigest: string,
	request: DemoRoundOneRequest,
): DemoFrostProcessBinding {
	return {
		schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1',
		participantId: enrollment.participantId,
		processIdentity: enrollment.processIdentity,
		committeeKeysetId: request.committeeKeysetId,
		committeeKeysetVersion: request.committeeKeysetVersion,
		rosterDigest,
		policyPackageDigest,
		sessionId: request.sessionId,
		packageDigest: request.packageDigest,
		digest: request.digest,
	}
}

function validateCoordinatorRequest(
	request: DemoRoundOneRequest,
	committeeKeysetId: string,
	committeeKeysetVersion: string,
	policy: DemoFrostParticipantPolicyPackage,
): void {
	requireHex32(request.sessionId, 'request.sessionId')
	requireHex32(request.packageDigest, 'request.packageDigest')
	requireHex32(request.digest, 'request.digest')
	if (request.committeeKeysetId !== committeeKeysetId || request.committeeKeysetVersion !== committeeKeysetVersion) {
		refuse('DEMO_FROST_PROCESS_BINDING', 'coordinator request differs from the configured keyset id or version')
	}
	if (request.packageDigest !== policy.packageDigest || request.digest !== policy.cashuSigAllDigest) {
		refuse('DEMO_FROST_PROCESS_POLICY', 'coordinator request differs from the immutable participant policy digests')
	}
}

function validatePolicyEvidence(
	evidence: DemoFrostParticipantPolicyEvidence,
	policy: DemoFrostParticipantPolicyPackage,
	policyPackageDigest: string,
): void {
	exactKeys(evidence, [
		'schema', 'policyPackageDigest', 'closureEvidenceDigest', 'signedBidEvidenceDigest',
		'committeeLockedProofsDigest', 'authenticatedPackageDigest', 'derivedCashuSigAllDigest',
	], 'roundOneResponse.policyEvidence')
	if (evidence.schema !== 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1'
		|| evidence.policyPackageDigest !== policyPackageDigest
		|| evidence.closureEvidenceDigest !== policy.certifiedClosure.evidenceDigest
		|| evidence.signedBidEvidenceDigest !== policy.signedBid.evidenceDigest
		|| evidence.committeeLockedProofsDigest !== demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs)
		|| evidence.authenticatedPackageDigest !== policy.packageDigest
		|| evidence.derivedCashuSigAllDigest !== policy.cashuSigAllDigest) {
		refuse('DEMO_FROST_PROCESS_POLICY', 'participant policy evidence does not bind the authenticated package and independently derived digest')
	}
}

function validateCommitments(commitments: DemoRoundOneCommitment[], request: DemoRoundTwoRequest): void {
	if (commitments.length !== 4) refuse('DEMO_FROST_PROCESS_TRANSCRIPT', 'round two requires exactly four commitments')
	for (const [index, commitment] of commitments.entries()) {
		exactKeys(commitment, ['participantId', 'sessionId', 'digest', 'hiding', 'binding'], `commitments[${index}]`)
		if (
			commitment.participantId !== PARTICIPANT_IDS[index] ||
			commitment.sessionId !== request.sessionId ||
			commitment.digest !== request.digest
		) {
			refuse('DEMO_FROST_PROCESS_TRANSCRIPT', `commitments[${index}] does not bind the exact roster, session, and digest`)
		}
		requireCompressedKey(commitment.hiding, `commitments[${index}].hiding`)
		requireCompressedKey(commitment.binding, `commitments[${index}].binding`)
	}
	const xCoordinates = commitments.flatMap((commitment) => [commitment.hiding.slice(2), commitment.binding.slice(2)])
	if (new Set(xCoordinates).size !== xCoordinates.length) {
		refuse('DEMO_FROST_PROCESS_TRANSCRIPT', 'all hiding and binding commitments must have distinct x-coordinates')
	}
	requireHex32(request.transcriptHash, 'request.transcriptHash')
	if (demoFrostTranscriptHash(request, commitments) !== request.transcriptHash) {
		refuse('DEMO_FROST_PROCESS_TRANSCRIPT', 'round two transcript hash was not derived from the exact commitments')
	}
}

/**
 * Adapt four real-process transports to the existing settlement participant-port interface.
 *
 * The returned ports validate isolation, transport-attested identity, restart continuity, exact
 * round bindings, and message shape. A separate reviewed implementation must still supply DKG,
 * FROST round computation, durable one-time nonce storage, authenticated transports, and aggregate
 * signature verification/aggregation.
 */
export function createFourSeparatedFrostProcessPorts(options: {
	committeeKeysetId: string
	committeeKeysetVersion: string
	requestTimeoutMs: number
	/** Immutable sensitive policy copied only into the four authenticated round-one requests. */
	policy: DemoFrostParticipantPolicyPackage
	participants: [
		DemoFrostProcessParticipant,
		DemoFrostProcessParticipant,
		DemoFrostProcessParticipant,
		DemoFrostProcessParticipant,
	]
}): [DemoFrostParticipantPort, DemoFrostParticipantPort, DemoFrostParticipantPort, DemoFrostParticipantPort] {
	requireText(options.committeeKeysetId, 'committeeKeysetId')
	requireText(options.committeeKeysetVersion, 'committeeKeysetVersion')
	if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0 || options.requestTimeoutMs > 60_000) {
		refuse('DEMO_FROST_PROCESS_TIMEOUT', 'requestTimeoutMs must be between 1 and 60000')
	}
	const policy = deepFreeze(cloneDemoFrostParticipantPolicy(options.policy))
	const policyPackageDigest = demoFrostParticipantPolicyDigest(policy)
	const enrollments = options.participants.map((participant, index) => canonicalEnrollment(participant.enrollment, index))
	const processIdentities = new Set(enrollments.map((participant) => participant.processIdentity))
	const directories = new Set(enrollments.map((participant) => participant.stateDirectory))
	const verifyingShareXCoordinates = new Set(enrollments.map((participant) => participant.verifyingShare.slice(2)))
	if (processIdentities.size !== 4) refuse('DEMO_FROST_PROCESS_ISOLATION', 'all four process identities must be distinct')
	if (directories.size !== 4) refuse('DEMO_FROST_PROCESS_ISOLATION', 'all four process state directories must be distinct')
	if (verifyingShareXCoordinates.size !== 4) refuse('DEMO_FROST_PROCESS_ROSTER', 'all four public verifying shares must have distinct x-coordinates')
	for (const [index, directory] of enrollments.map((participant) => participant.stateDirectory).entries()) {
		for (const [otherIndex, other] of enrollments.map((participant) => participant.stateDirectory).entries()) {
			if (index !== otherIndex && other.startsWith(`${directory}/`)) {
				refuse('DEMO_FROST_PROCESS_ISOLATION', 'participant state directories must not contain one another')
			}
		}
	}
	const rosterDigest = demoFrostProcessRosterDigest(enrollments)
	const observedInstances = new Map<string, Map<DemoParticipantId, string>>()

	return options.participants.map((participant, index): DemoFrostParticipantPort => {
		const enrollment = enrollments[index]
		const activeRounds = new Map<string, {
			binding: DemoFrostProcessBinding
			peer: DemoFrostObservedProcess
			commitment: DemoRoundOneCommitment
		}>()
		return {
			participantId: enrollment.participantId,
			verifyingShare: enrollment.verifyingShare,
			async roundOne(request): Promise<DemoRoundOneCommitment> {
				validateCoordinatorRequest(request, options.committeeKeysetId, options.committeeKeysetVersion, policy)
				if (activeRounds.has(request.sessionId)) {
					refuse('DEMO_FROST_PROCESS_SESSION_REUSE', `participant ${enrollment.participantId} already opened this session`)
				}
				const binding = bindingFor(enrollment, rosterDigest, policyPackageDigest, request)
				const processRequest: DemoFrostProcessRoundOneRequest = {
					schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1',
					binding,
					policy: deepFreeze(cloneDemoFrostParticipantPolicy(policy)),
				}
				rejectSecretMaterial(processRequest, 'message', true)
				const exchange = await exchangeWithTimeout({
					participantId: enrollment.participantId,
					round: 'round one',
					timeoutMs: options.requestTimeoutMs,
					run: (signal) => participant.transport.roundOne(processRequest, { signal }),
				})
				rejectSecretMaterial(exchange)
				exactKeys(exchange, ['peer', 'message'], 'roundOneExchange')
				const peer = exactPeer(exchange.peer, enrollment, 'roundOneExchange.peer')
				const instances = observedInstances.get(request.sessionId) ?? new Map<DemoParticipantId, string>()
				if ([...instances.values()].includes(peer.processInstanceId)) {
					refuse('DEMO_FROST_PROCESS_ISOLATION', 'two participants reported the same process instance')
				}
				instances.set(enrollment.participantId, peer.processInstanceId)
				observedInstances.set(request.sessionId, instances)
				const response = exchange.message
				exactKeys(response, ['schema', 'binding', 'policyEvidence', 'commitment'], 'roundOneResponse')
				if (response.schema !== 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1') {
					refuse('DEMO_FROST_PROCESS_MESSAGE_SHAPE', 'round one response schema mismatch')
				}
				exactBinding(response.binding, binding, 'roundOneResponse.binding')
				validatePolicyEvidence(response.policyEvidence, policy, policyPackageDigest)
				exactKeys(response.commitment, ['hiding', 'binding'], 'roundOneResponse.commitment')
				requireCompressedKey(response.commitment.hiding, 'roundOneResponse.commitment.hiding')
				requireCompressedKey(response.commitment.binding, 'roundOneResponse.commitment.binding')
				const commitment: DemoRoundOneCommitment = {
					participantId: enrollment.participantId,
					sessionId: request.sessionId,
					digest: request.digest,
					hiding: response.commitment.hiding,
					binding: response.commitment.binding,
				}
				activeRounds.set(request.sessionId, { binding, peer, commitment })
				return commitment
			},
			async roundTwo(request): Promise<DemoSignatureShare> {
				validateCoordinatorRequest(request, options.committeeKeysetId, options.committeeKeysetVersion, policy)
				validateCommitments(request.commitments, request)
				const opened = activeRounds.get(request.sessionId)
				if (!opened) refuse('DEMO_FROST_PROCESS_ROUND_ORDER', 'round two has no accepted round-one evidence for this process')
				const binding = bindingFor(enrollment, rosterDigest, policyPackageDigest, request)
				exactBinding(binding, opened.binding, 'roundTwoRequest.binding')
				const ownCommitment = request.commitments[enrollment.participantId - 1]
				if (JSON.stringify(ownCommitment) !== JSON.stringify(opened.commitment)) {
					refuse('DEMO_FROST_PROCESS_TRANSCRIPT', 'round two changed this participant\'s accepted round-one commitment')
				}
				// Burn the coordinator-side round before crossing the transport boundary. A failed or
				// malformed round-two attempt must never be retried with the same participant nonce.
				activeRounds.delete(request.sessionId)
				const processRequest: DemoFrostProcessRoundTwoRequest = {
					schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_REQUEST_V1',
					binding,
					transcriptHash: request.transcriptHash,
					commitments: request.commitments.map((commitment) => ({ ...commitment })),
				}
				rejectSecretMaterial(processRequest)
				const exchange = await exchangeWithTimeout({
					participantId: enrollment.participantId,
					round: 'round two',
					timeoutMs: options.requestTimeoutMs,
					run: (signal) => participant.transport.roundTwo(processRequest, { signal }),
				})
				rejectSecretMaterial(exchange)
				exactKeys(exchange, ['peer', 'message'], 'roundTwoExchange')
				const peer = exactPeer(exchange.peer, enrollment, 'roundTwoExchange.peer')
				if (!samePeer(peer, opened.peer)) {
					refuse('DEMO_FROST_PROCESS_RESTARTED', 'participant process restarted or changed identity between FROST rounds')
				}
				const response = exchange.message
				exactKeys(response, ['schema', 'binding', 'transcriptHash', 'signatureShare'], 'roundTwoResponse')
				if (response.schema !== 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1') {
					refuse('DEMO_FROST_PROCESS_MESSAGE_SHAPE', 'round two response schema mismatch')
				}
				exactBinding(response.binding, binding, 'roundTwoResponse.binding')
				if (response.transcriptHash !== request.transcriptHash) {
					refuse('DEMO_FROST_PROCESS_TRANSCRIPT', 'round two response transcript hash mismatch')
				}
				requireHex32(response.signatureShare, 'roundTwoResponse.signatureShare')
				return {
					participantId: enrollment.participantId,
					sessionId: request.sessionId,
					digest: request.digest,
					transcriptHash: request.transcriptHash,
					share: response.signatureShare,
				}
			},
		}
	}) as [DemoFrostParticipantPort, DemoFrostParticipantPort, DemoFrostParticipantPort, DemoFrostParticipantPort]
}
