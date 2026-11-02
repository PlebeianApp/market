/**
 * Participant-local bridge from the authenticated process protocol to the Rust
 * FROST nonce journal. Instantiate this inside each participant process, never
 * in the auction coordinator. Policy evidence is verified before `sign-commit`
 * is invoked and only public commitments/signature shares leave this worker.
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

const PARTICIPANT_VERSION = 'COCO_DEMO_FROST_PARTICIPANT_V1'
const HEX_32 = /^[0-9a-f]{64}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const PARTICIPANT_IDS = [1, 2, 3, 4] as const

export interface DemoFrostRustAuthorization {
	version: typeof PARTICIPANT_VERSION
	dkg_run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	public_key_package_sha256: string
	operation_id: string
	policy_package_digest: string
	cashu_sigall_digest: string
	full_package_digest: string
	certified_closure_digest: string
	signed_bid_evidence_digest: string
	committee_locked_proofs_digest: string
	bidder_payout_binding_digest: string
	roster: [1, 2, 3, 4]
	threshold: 4
}

interface RustCommitmentEnvelope {
	version: typeof PARTICIPANT_VERSION
	operation_id: string
	authorization_digest: string
	participant_id: DemoParticipantId
	hiding_hex: string
	binding_hex: string
}

interface RustShareEnvelope {
	version: typeof PARTICIPANT_VERSION
	operation_id: string
	authorization_digest: string
	commitments_digest: string
	participant_id: DemoParticipantId
	share_hex: string
}

interface OpenRound {
	binding: DemoFrostProcessRoundOneRequest['binding']
	authorization: DemoFrostRustAuthorization
	authorizationDigest: string
}

export interface DemoFrostRustParticipantWorkerOptions {
	participantId: DemoParticipantId
	dkgRunId: string
	publicKeyPackageSha256: string
	configPath: string
	stateDirectory: string
	binaryPath: string
	scratchParent: string
	policyPorts: DemoFrostParticipantPolicyPorts
	/** Test seam only. Production must omit this and execute the pinned Rust binary. */
	runCommand?: (command: string[], signal: AbortSignal) => Promise<void>
}

export interface DemoFrostParticipantWorker {
	roundOne(request: DemoFrostProcessRoundOneRequest, signal: AbortSignal): Promise<DemoFrostProcessRoundOneResponse>
	roundTwo(request: DemoFrostProcessRoundTwoRequest, signal: AbortSignal): Promise<DemoFrostProcessRoundTwoResponse>
}

function requireAbsolute(value: string, field: string): void {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) {
		throw new Error(`DEMO_FROST_WORKER_PATH: ${field} must be a dedicated canonical absolute path`)
	}
}

function exactBinding(
	left: DemoFrostProcessRoundOneRequest['binding'],
	right: DemoFrostProcessRoundOneRequest['binding'],
): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function validateRoundTwoRequest(
	request: DemoFrostProcessRoundTwoRequest,
	opened: OpenRound,
): void {
	if (!exactBinding(opened.binding, request.binding)) {
		throw new Error('DEMO_FROST_WORKER_ROUND_ORDER: no exact accepted round-one binding')
	}
	if (request.commitments.length !== 4) {
		throw new Error('PAYMENT_BLOCKED_MISSING_PARTICIPANT: participant requires all four commitments')
	}
	const xCoordinates: string[] = []
	for (const [index, commitment] of request.commitments.entries()) {
		if (commitment.participantId !== PARTICIPANT_IDS[index]
			|| commitment.sessionId !== opened.binding.sessionId
			|| commitment.digest !== opened.binding.digest
			|| !COMPRESSED_KEY.test(commitment.hiding)
			|| !COMPRESSED_KEY.test(commitment.binding)) {
			throw new Error('DEMO_FROST_WORKER_TRANSCRIPT: malformed or mismatched commitment roster')
		}
		xCoordinates.push(commitment.hiding.slice(2), commitment.binding.slice(2))
	}
	if (new Set(xCoordinates).size !== xCoordinates.length) {
		throw new Error('DEMO_FROST_WORKER_TRANSCRIPT: duplicate nonce commitment')
	}
	if (request.transcriptHash !== demoFrostTranscriptHash(request.binding, request.commitments)) {
		throw new Error('DEMO_FROST_WORKER_TRANSCRIPT: coordinator transcript mismatch')
	}
}

async function defaultRunCommand(command: string[], signal: AbortSignal): Promise<void> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
	let forcedKill: ReturnType<typeof setTimeout> | undefined
	const abort = (): void => {
		child.kill()
		forcedKill = setTimeout(() => child.kill(9), 1_000)
		forcedKill.unref()
	}
	if (signal.aborted) abort()
	else signal.addEventListener('abort', abort, { once: true })
	try {
		const [exitCode, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		])
		if (signal.aborted) throw new Error('participant command aborted')
		if (exitCode !== 0) {
			throw new Error(`participant command exited ${exitCode}: ${stderr.trim() || 'no diagnostic'}`)
		}
	} finally {
		signal.removeEventListener('abort', abort)
		if (forcedKill !== undefined) clearTimeout(forcedKill)
	}
}

async function withScratch<T>(parent: string, run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(parent, 'coco-frost-participant-'))
	await chmod(directory, 0o700)
	try {
		return await run(directory)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
	await chmod(path, 0o600)
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

export function demoFrostRustAuthorizationForRequest(
	options: Pick<DemoFrostRustParticipantWorkerOptions, 'dkgRunId' | 'publicKeyPackageSha256'>,
	request: DemoFrostProcessRoundOneRequest,
): DemoFrostRustAuthorization {
	const { policy } = request
	return {
		version: PARTICIPANT_VERSION,
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
		threshold: 4,
	}
}

export function createDemoFrostRustParticipantWorker(
	options: DemoFrostRustParticipantWorkerOptions,
): DemoFrostParticipantWorker {
	const participantId = options.participantId
	const dkgRunId = options.dkgRunId
	const publicKeyPackageSha256 = options.publicKeyPackageSha256
	const configPath = options.configPath
	const stateDirectory = options.stateDirectory
	const binaryPath = options.binaryPath
	const scratchParent = options.scratchParent
	const runCommand = options.runCommand ?? defaultRunCommand
	const closureVerifier = options.policyPorts.closureVerifier.verifyAndDerive.bind(options.policyPorts.closureVerifier)
	const signedBidVerifier = options.policyPorts.signedBidVerifier.verifyAndDerive.bind(options.policyPorts.signedBidVerifier)
	const assertExclusive = options.policyPorts.proofUse.assertExclusive.bind(options.policyPorts.proofUse)
	const policyPorts: DemoFrostParticipantPolicyPorts = {
		closureVerifier: { verifyAndDerive: closureVerifier },
		signedBidVerifier: { verifyAndDerive: signedBidVerifier },
		proofUse: { assertExclusive },
	}
	for (const [field, value] of Object.entries({
		configPath,
		stateDirectory,
		binaryPath,
		scratchParent,
	})) requireAbsolute(value, field)
	if (!HEX_32.test(publicKeyPackageSha256)) throw new Error('DEMO_FROST_WORKER_KEYSET: invalid public key package hash')
	if (!Number.isInteger(participantId) || participantId < 1 || participantId > 4) {
		throw new Error('DEMO_FROST_WORKER_ROSTER: participant id must be one of [1,2,3,4]')
	}
	const openRounds = new Map<string, OpenRound>()

	return {
		async roundOne(request, signal) {
			const exactRequest = structuredClone(request)
			if (exactRequest.binding.participantId !== participantId) {
				throw new Error('DEMO_FROST_WORKER_BINDING: request is addressed to another participant')
			}
			if (openRounds.has(exactRequest.binding.sessionId)) {
				throw new Error('DEMO_FROST_WORKER_SESSION_REUSE: signing session is already open')
			}
			const policyPackageDigest = demoFrostParticipantPolicyDigest(exactRequest.policy)
			if (policyPackageDigest !== exactRequest.binding.policyPackageDigest) {
				throw new Error('DEMO_FROST_WORKER_POLICY: policy package digest mismatch')
			}
			const policyEvidence = await validateDemoFrostParticipantPolicy({
				policy: exactRequest.policy,
				expectedPackageDigest: exactRequest.binding.packageDigest,
				expectedCashuSigAllDigest: exactRequest.binding.digest,
				ports: policyPorts,
			})
			const authorization = demoFrostRustAuthorizationForRequest({ dkgRunId, publicKeyPackageSha256 }, exactRequest)
			const commitment = await withScratch(scratchParent, async (directory) => {
				const authorizationPath = join(directory, 'authorization.json')
				const outputPath = join(directory, 'commitment.json')
				await writePrivateJson(authorizationPath, authorization)
				await runCommand([
					binaryPath,
					'sign-commit',
					configPath,
					stateDirectory,
					authorizationPath,
					outputPath,
				], signal)
				return readJson<RustCommitmentEnvelope>(outputPath)
			})
			if (commitment.version !== PARTICIPANT_VERSION
				|| commitment.operation_id !== authorization.operation_id
				|| commitment.participant_id !== participantId
				|| !HEX_32.test(commitment.authorization_digest)
				|| !COMPRESSED_KEY.test(commitment.hiding_hex)
				|| !COMPRESSED_KEY.test(commitment.binding_hex)) {
				throw new Error('DEMO_FROST_WORKER_COMMITMENT: Rust participant returned a malformed or mismatched commitment')
			}
			openRounds.set(exactRequest.binding.sessionId, {
				binding: { ...exactRequest.binding },
				authorization,
				authorizationDigest: commitment.authorization_digest,
			})
			return {
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1',
				binding: { ...exactRequest.binding },
				policyEvidence,
				commitment: { hiding: commitment.hiding_hex, binding: commitment.binding_hex },
			}
		},

		async roundTwo(request, signal) {
			const exactRequest = structuredClone(request)
			const opened = openRounds.get(exactRequest.binding.sessionId)
			if (!opened) {
				throw new Error('DEMO_FROST_WORKER_ROUND_ORDER: no exact accepted round-one binding')
			}
			validateRoundTwoRequest(exactRequest, opened)
			openRounds.delete(exactRequest.binding.sessionId)
			const share = await withScratch(scratchParent, async (directory) => {
				const authorizationPath = join(directory, 'authorization.json')
				const commitmentPath = join(directory, 'commitments.json')
				const outputPath = join(directory, 'share.json')
				await writePrivateJson(authorizationPath, opened.authorization)
				await writePrivateJson(commitmentPath, {
					version: PARTICIPANT_VERSION,
					entries: exactRequest.commitments.map((commitment) => ({
						version: PARTICIPANT_VERSION,
						operation_id: opened.authorization.operation_id,
						authorization_digest: opened.authorizationDigest,
						participant_id: commitment.participantId,
						hiding_hex: commitment.hiding,
						binding_hex: commitment.binding,
					})),
				})
				await runCommand([
					binaryPath,
					'sign-share',
					configPath,
					stateDirectory,
					authorizationPath,
					commitmentPath,
					outputPath,
				], signal)
				return readJson<RustShareEnvelope>(outputPath)
			})
			if (share.version !== PARTICIPANT_VERSION
				|| share.operation_id !== opened.authorization.operation_id
				|| share.authorization_digest !== opened.authorizationDigest
				|| share.participant_id !== participantId
				|| !HEX_32.test(share.commitments_digest)
				|| !HEX_32.test(share.share_hex)) {
				throw new Error('DEMO_FROST_WORKER_SHARE: Rust participant returned a malformed or mismatched share')
			}
			return {
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1',
				binding: { ...exactRequest.binding },
				transcriptHash: exactRequest.transcriptHash,
				signatureShare: share.share_hex,
			}
		},
	}
}
