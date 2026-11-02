/** Participant-local bridge to the separate concrete threshold-three Rust executable. */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	validateDemoFrostParticipantPolicy,
	type DemoFrostParticipantPolicyPorts,
} from './demo-frost-participant-policy'
import type {
	DemoFrostProcessRoundOneRequest,
	DemoFrostProcessRoundOneResponse,
	DemoFrostProcessRoundTwoRequest,
	DemoFrostProcessRoundTwoResponse,
} from './demo-frost-process-boundary'
import { demoFrostTranscriptHash, demoRecipientCapabilityDigest, type DemoParticipantId } from './demo-sigall-settlement'

export const DEMO_FROST_THRESHOLD3_VERSION = 'COCO_DEMO_FROST_PARTICIPANT_3OF4_V1' as const
const HEX_32 = /^[0-9a-f]{64}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const PARTICIPANT_IDS = [1, 2, 3, 4] as const
const OPERATION_ROOT_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_THRESHOLD3_OPERATION_ROOT_V1')

export interface DemoFrostThreshold3RustAuthorization {
	version: typeof DEMO_FROST_THRESHOLD3_VERSION
	dkg_run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	public_key_package_sha256: string
	/** Stable economic operation identity. */
	operation_id: string
	/** Stable economic authorization root. Exact retries share this root. */
	operation_root: string
	/** Fresh nonce/session identity. */
	session_id: string
	policy_package_digest: string
	cashu_sigall_digest: string
	full_package_digest: string
	certified_closure_digest: string
	signed_bid_evidence_digest: string
	committee_locked_proofs_digest: string
	bidder_payout_binding_digest: string
	roster: [1, 2, 3, 4]
	threshold: 3
}

interface RustCommitmentEnvelope {
	version: typeof DEMO_FROST_THRESHOLD3_VERSION
	operation_id: string
	session_id: string
	authorization_digest: string
	participant_id: DemoParticipantId
	hiding_hex: string
	binding_hex: string
}

interface RustShareEnvelope {
	version: typeof DEMO_FROST_THRESHOLD3_VERSION
	operation_id: string
	session_id: string
	authorization_digest: string
	commitments_digest: string
	participant_id: DemoParticipantId
	share_hex: string
}

interface OpenRound {
	binding: DemoFrostProcessRoundOneRequest['binding']
	authorization: DemoFrostThreshold3RustAuthorization
	authorizationDigest: string
}

export interface DemoFrostThreshold3RustParticipantWorkerOptions {
	participantId: DemoParticipantId
	dkgRunId: string
	publicKeyPackageSha256: string
	configPath: string
	stateDirectory: string
	binaryPath: string
	scratchParent: string
	policyPorts: DemoFrostParticipantPolicyPorts
	/** Fail-closed external anchor around each Rust nonce/operation journal mutation. */
	stateGuard?: {
		assertCurrent(): void | Promise<void>
		recordAdvance(): void | Promise<void>
	}
	/** Test seam only. Production must omit this and execute the pinned Rust binary. */
	runCommand?: (command: string[], signal: AbortSignal) => Promise<void>
}

export interface DemoFrostThreshold3ParticipantWorker {
	roundOne(request: DemoFrostProcessRoundOneRequest, signal: AbortSignal): Promise<DemoFrostProcessRoundOneResponse>
	roundTwo(request: DemoFrostProcessRoundTwoRequest, signal: AbortSignal): Promise<DemoFrostProcessRoundTwoResponse>
}

function requireAbsolute(value: string, field: string): void {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) {
		throw new Error(`DEMO_FROST_T3_WORKER_PATH: ${field} must be a dedicated canonical absolute path`)
	}
}

async function defaultRunCommand(command: string[], signal: AbortSignal): Promise<void> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
	const abort = (): void => { child.kill() }
	if (signal.aborted) abort()
	else signal.addEventListener('abort', abort, { once: true })
	try {
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
		if (signal.aborted) throw new Error('threshold-three participant command aborted')
		if (exitCode !== 0) throw new Error(`threshold-three participant command exited ${exitCode}: ${stderr.trim() || 'no diagnostic'}`)
	} finally {
		signal.removeEventListener('abort', abort)
	}
}

async function withScratch<T>(parent: string, run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(parent, 'coco-frost-t3-participant-'))
	await chmod(directory, 0o700)
	try { return await run(directory) }
	finally { await rm(directory, { recursive: true, force: true }) }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
	await chmod(path, 0o600)
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

function lengthPrefix(value: Uint8Array): Uint8Array {
	const prefix = new Uint8Array(4)
	new DataView(prefix.buffer).setUint32(0, value.length, false)
	return concatBytes(prefix, value)
}

export function demoFrostThreshold3OperationRoot(authorization: Omit<DemoFrostThreshold3RustAuthorization, 'operation_root' | 'session_id'>): string {
	const framed = [
		authorization.dkg_run_id, authorization.committee_keyset_id, authorization.committee_keyset_version,
		authorization.public_key_package_sha256, authorization.operation_id, authorization.policy_package_digest,
		authorization.cashu_sigall_digest, authorization.full_package_digest, authorization.certified_closure_digest,
		authorization.signed_bid_evidence_digest, authorization.committee_locked_proofs_digest,
		authorization.bidder_payout_binding_digest,
	].map((value) => lengthPrefix(utf8ToBytes(value)))
	const roster = new Uint8Array(10)
	const view = new DataView(roster.buffer)
	for (const [index, id] of authorization.roster.entries()) view.setUint16(index * 2, id, false)
	view.setUint16(8, authorization.threshold, false)
	return bytesToHex(sha256(concatBytes(OPERATION_ROOT_CONTEXT, ...framed, roster)))
}

export function demoFrostThreshold3AuthorizationForRequest(
	options: Pick<DemoFrostThreshold3RustParticipantWorkerOptions, 'dkgRunId' | 'publicKeyPackageSha256'>,
	request: DemoFrostProcessRoundOneRequest,
): DemoFrostThreshold3RustAuthorization {
	const { policy } = request
	const stable: Omit<DemoFrostThreshold3RustAuthorization, 'operation_root' | 'session_id'> = {
		version: DEMO_FROST_THRESHOLD3_VERSION,
		dkg_run_id: options.dkgRunId,
		committee_keyset_id: request.binding.committeeKeysetId,
		committee_keyset_version: request.binding.committeeKeysetVersion,
		public_key_package_sha256: options.publicKeyPackageSha256,
		operation_id: policy.operationId,
		policy_package_digest: request.binding.policyPackageDigest,
		cashu_sigall_digest: request.binding.digest,
		full_package_digest: request.binding.packageDigest,
		certified_closure_digest: policy.certifiedClosure.evidenceDigest,
		signed_bid_evidence_digest: policy.signedBid.evidenceDigest,
		committee_locked_proofs_digest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
		bidder_payout_binding_digest: demoRecipientCapabilityDigest(policy.recipientCapability),
		roster: [1, 2, 3, 4],
		threshold: 3,
	}
	return { ...stable, operation_root: demoFrostThreshold3OperationRoot(stable), session_id: request.binding.sessionId }
}

function validateRoundTwo(request: DemoFrostProcessRoundTwoRequest, opened: OpenRound, participantId: DemoParticipantId): void {
	if (JSON.stringify(opened.binding) !== JSON.stringify(request.binding)) {
		throw new Error('DEMO_FROST_T3_WORKER_ROUND_ORDER: no exact accepted round-one binding')
	}
	if (request.commitments.length !== 3) throw new Error('PAYMENT_BLOCKED_MISSING_PARTICIPANT: threshold-three signing requires three commitments')
	const ids = request.commitments.map((value) => value.participantId)
	if (!ids.includes(participantId) || new Set(ids).size !== 3 || ids.some((id, index) => !PARTICIPANT_IDS.includes(id) || (index > 0 && ids[index - 1]! >= id))) {
		throw new Error('DEMO_FROST_T3_WORKER_TRANSCRIPT: commitment subset must be three distinct enrolled participants in order')
	}
	const xCoordinates: string[] = []
	for (const commitment of request.commitments) {
		if (commitment.sessionId !== opened.binding.sessionId || commitment.digest !== opened.binding.digest
			|| !COMPRESSED_KEY.test(commitment.hiding) || !COMPRESSED_KEY.test(commitment.binding)) {
			throw new Error('DEMO_FROST_T3_WORKER_TRANSCRIPT: malformed or mismatched commitment')
		}
		xCoordinates.push(commitment.hiding.slice(2), commitment.binding.slice(2))
	}
	if (new Set(xCoordinates).size !== xCoordinates.length) throw new Error('DEMO_FROST_T3_WORKER_TRANSCRIPT: duplicate nonce commitment')
	if (request.transcriptHash !== demoFrostTranscriptHash(request.binding, request.commitments)) {
		throw new Error('DEMO_FROST_T3_WORKER_TRANSCRIPT: coordinator transcript mismatch')
	}
}

export function createDemoFrostThreshold3RustParticipantWorker(
	options: DemoFrostThreshold3RustParticipantWorkerOptions,
): DemoFrostThreshold3ParticipantWorker {
	const { participantId, dkgRunId, publicKeyPackageSha256, configPath, stateDirectory, binaryPath, scratchParent } = options
	const runCommand = options.runCommand ?? defaultRunCommand
	for (const [field, value] of Object.entries({ configPath, stateDirectory, binaryPath, scratchParent })) requireAbsolute(value, field)
	if (!PARTICIPANT_IDS.includes(participantId)) throw new Error('DEMO_FROST_T3_WORKER_ROSTER: participant id must be one of [1,2,3,4]')
	if (!HEX_32.test(publicKeyPackageSha256)) throw new Error('DEMO_FROST_T3_WORKER_KEYSET: invalid public key package hash')
	const policyPorts: DemoFrostParticipantPolicyPorts = Object.freeze({
		closureVerifier: Object.freeze({ verifyAndDerive: options.policyPorts.closureVerifier.verifyAndDerive.bind(options.policyPorts.closureVerifier) }),
		signedBidVerifier: Object.freeze({ verifyAndDerive: options.policyPorts.signedBidVerifier.verifyAndDerive.bind(options.policyPorts.signedBidVerifier) }),
		proofUse: Object.freeze({ assertExclusive: options.policyPorts.proofUse.assertExclusive.bind(options.policyPorts.proofUse) }),
	})
	const openRounds = new Map<string, OpenRound>()

	return {
		async roundOne(request, signal) {
			const exact = structuredClone(request)
			if (exact.binding.participantId !== participantId) throw new Error('DEMO_FROST_T3_WORKER_BINDING: request addressed to another participant')
			if (openRounds.has(exact.binding.sessionId)) throw new Error('DEMO_FROST_T3_WORKER_SESSION_REUSE: session already open')
			if (demoFrostParticipantPolicyDigest(exact.policy) !== exact.binding.policyPackageDigest) throw new Error('DEMO_FROST_T3_WORKER_POLICY: policy digest mismatch')
			const policyEvidence = await validateDemoFrostParticipantPolicy({
				policy: exact.policy,
				expectedPackageDigest: exact.binding.packageDigest,
				expectedCashuSigAllDigest: exact.binding.digest,
				ports: policyPorts,
			})
			const authorization = demoFrostThreshold3AuthorizationForRequest({ dkgRunId, publicKeyPackageSha256 }, exact)
			await options.stateGuard?.assertCurrent()
			const commitment = await withScratch(scratchParent, async (directory) => {
				const authorizationPath = join(directory, 'authorization.json')
				const outputPath = join(directory, 'commitment.json')
				await writePrivateJson(authorizationPath, authorization)
				await runCommand([binaryPath, 'sign-commit', configPath, stateDirectory, authorizationPath, outputPath], signal)
				return readJson<RustCommitmentEnvelope>(outputPath)
			})
			await options.stateGuard?.recordAdvance()
			if (commitment.version !== DEMO_FROST_THRESHOLD3_VERSION || commitment.operation_id !== authorization.operation_id
				|| commitment.session_id !== authorization.session_id
				|| commitment.participant_id !== participantId || !HEX_32.test(commitment.authorization_digest)
				|| !COMPRESSED_KEY.test(commitment.hiding_hex) || !COMPRESSED_KEY.test(commitment.binding_hex)) {
				throw new Error('DEMO_FROST_T3_WORKER_COMMITMENT: malformed or mismatched Rust commitment')
			}
			openRounds.set(exact.binding.sessionId, { binding: { ...exact.binding }, authorization, authorizationDigest: commitment.authorization_digest })
			return {
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1',
				binding: { ...exact.binding },
				policyEvidence,
				commitment: { hiding: commitment.hiding_hex, binding: commitment.binding_hex },
			}
		},

		async roundTwo(request, signal) {
			const exact = structuredClone(request)
			const opened = openRounds.get(exact.binding.sessionId)
			if (!opened) throw new Error('DEMO_FROST_T3_WORKER_ROUND_ORDER: no exact accepted round-one binding')
			validateRoundTwo(exact, opened, participantId)
			openRounds.delete(exact.binding.sessionId)
			await options.stateGuard?.assertCurrent()
			const share = await withScratch(scratchParent, async (directory) => {
				const authorizationPath = join(directory, 'authorization.json')
				const commitmentPath = join(directory, 'commitments.json')
				const outputPath = join(directory, 'share.json')
				await writePrivateJson(authorizationPath, opened.authorization)
				await writePrivateJson(commitmentPath, {
					version: DEMO_FROST_THRESHOLD3_VERSION,
					entries: exact.commitments.map((commitment) => ({
						version: DEMO_FROST_THRESHOLD3_VERSION,
						operation_id: opened.authorization.operation_id,
						session_id: opened.authorization.session_id,
						authorization_digest: opened.authorizationDigest,
						participant_id: commitment.participantId,
						hiding_hex: commitment.hiding,
						binding_hex: commitment.binding,
					})),
				})
				await runCommand([binaryPath, 'sign-share', configPath, stateDirectory, authorizationPath, commitmentPath, outputPath], signal)
				return readJson<RustShareEnvelope>(outputPath)
			})
			await options.stateGuard?.recordAdvance()
			if (share.version !== DEMO_FROST_THRESHOLD3_VERSION || share.operation_id !== opened.authorization.operation_id
				|| share.session_id !== opened.authorization.session_id
				|| share.authorization_digest !== opened.authorizationDigest || share.participant_id !== participantId
				|| !HEX_32.test(share.commitments_digest) || !HEX_32.test(share.share_hex)) {
				throw new Error('DEMO_FROST_T3_WORKER_SHARE: malformed or mismatched Rust share')
			}
			return {
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1',
				binding: { ...exact.binding },
				transcriptHash: exact.transcriptHash,
				signatureShare: share.share_hex,
			}
		},
	}
}
