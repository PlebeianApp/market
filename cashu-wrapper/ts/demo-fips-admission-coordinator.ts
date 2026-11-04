/** Coordinator adapters for real remote admission signing over FIPS RPC. */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type { DemoFipsAdmissionCommitPayloadV1, DemoFipsAdmissionRpcClient, DemoFipsAdmissionSharePayloadV1 } from './demo-fips-admission-rpc'
import {
	DEMO_FROST_ADMISSION_VERSION,
	demoFrostAdmissionAuthorization,
	demoFrostAdmissionAuthorizationDigest,
	demoFrostAdmissionTranscriptHash,
	type DemoAdmissionSigningSessionStore,
	type DemoFrostAdmissionRustAggregate,
	type DemoFrostAdmissionRustCommitment,
	type DemoFrostAdmissionRustShare,
} from './demo-frost-threshold3-admission'
import type {
	DemoAdmissionParticipantPolicyRequestV1,
	DemoAdmissionParticipantPorts,
	DemoIntegratedAdmissionThreshold3AuthorizationV1,
	DemoIntegratedAdmissionThreshold3Port,
} from './demo-integrated-admission-service'
import type { DemoIntegratedAdmissionPolicyEvidenceV1 } from './demo-integrated-admission-policy'
import {
	demoIntegratedFundingAnyAdmissionSignatureDigest,
	demoIntegratedFundingAnyReceiptDigest,
} from './demo-integrated-admission-receipt-any'

type ParticipantId = 1 | 2 | 3 | 4
type Three<T> = [T, T, T]
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED = /^(?:02|03)[0-9a-f]{64}$/

async function privateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' }); await chmod(path, 0o600)
}
async function scratch<T>(parent: string, run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(parent, 'admission-aggregate-')); await chmod(directory, 0o700)
	try { return await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}
export interface DemoFipsAdmissionAggregateDiagnosticV1 {
	schema: 'DEMO_FIPS_ADMISSION_AGGREGATE_DIAGNOSTIC_V1'
	category: 'PUBLIC_PACKAGE_HASH' | 'PUBLIC_PACKAGE_DECODE' | 'AUTHORIZATION'
		| 'SHARE_SET' | 'AGGREGATE_VERIFY' | 'FILESYSTEM' | 'OTHER'
	stderrSha256: string
	stderrBytes: number
}

/**
 * Convert the child diagnostic into a bounded, non-sensitive category. The
 * raw stderr can contain implementation paths and is never logged or returned.
 */
export function demoFipsAdmissionAggregateDiagnostic(stderr: string): DemoFipsAdmissionAggregateDiagnosticV1 {
	const bytes = utf8ToBytes(stderr)
	const lower = stderr.toLowerCase()
	const category = lower.includes('public key package hash mismatch') ? 'PUBLIC_PACKAGE_HASH'
		: lower.includes('public key package') || lower.includes('deserialize') || lower.includes('postcard') ? 'PUBLIC_PACKAGE_DECODE'
			: lower.includes('authorization') ? 'AUTHORIZATION'
				: lower.includes('share') || lower.includes('participant') ? 'SHARE_SET'
					: lower.includes('signature') || lower.includes('verify') ? 'AGGREGATE_VERIFY'
						: lower.includes('permission denied') || lower.includes('no such file') || lower.includes('os error') ? 'FILESYSTEM'
							: 'OTHER'
	return {
		schema: 'DEMO_FIPS_ADMISSION_AGGREGATE_DIAGNOSTIC_V1', category,
		stderrSha256: bytesToHex(sha256(bytes)), stderrBytes: bytes.length,
	}
}

async function command(argv: string[]): Promise<void> {
	const child = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
	const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
	if (code !== 0) {
		const diagnostic = demoFipsAdmissionAggregateDiagnostic(stderr)
		console.error(JSON.stringify({ ...diagnostic, exitCode: code }))
		throw new Error(`DEMO_FIPS_ADMISSION_AGGREGATE_COMMAND: exit ${code}: ${diagnostic.category}:${diagnostic.stderrSha256}`)
	}
}

export function createDemoFipsAdmissionParticipantPort(
	participantId: ParticipantId,
	client: DemoFipsAdmissionRpcClient,
): DemoAdmissionParticipantPorts {
	return Object.freeze({
		participantId,
		async validateExact(request: DemoAdmissionParticipantPolicyRequestV1) {
			const abort = new AbortController()
			return client.call('policy', { schema: 'COCO_DEMO_FIPS_ADMISSION_POLICY_PAYLOAD_V1', request }, abort.signal)
		},
	})
}

export function createDemoFipsAdmissionThreshold3Port(options: {
	clients: [DemoFipsAdmissionRpcClient, DemoFipsAdmissionRpcClient, DemoFipsAdmissionRpcClient, DemoFipsAdmissionRpcClient]
	sessions: DemoAdmissionSigningSessionStore
	binaryPath: string
	publicKeyPackagePath: string
	scratchParent: string
	committeePublicKey: string
}): DemoIntegratedAdmissionThreshold3Port {
	return Object.freeze({
		async signExact(request: Parameters<DemoIntegratedAdmissionThreshold3Port['signExact']>[0]) {
			const evidence = structuredClone(request.participantEvidence)
				.sort((a: DemoIntegratedAdmissionPolicyEvidenceV1, b: DemoIntegratedAdmissionPolicyEvidenceV1) => a.participantId - b.participantId) as typeof request.participantEvidence
			const selected = evidence.map(({ participantId }: DemoIntegratedAdmissionPolicyEvidenceV1) => participantId) as [ParticipantId, ParticipantId, ParticipantId]
			if (evidence.length !== 3 || new Set(selected).size !== 3 || selected.some((id) => ![1, 2, 3, 4].includes(id))) {
				throw new Error('DEMO_FIPS_ADMISSION_QUORUM: exact three-member policy quorum required')
			}
			const receiptDigest = demoIntegratedFundingAnyReceiptDigest(request.receipt)
			const provisional = demoFrostAdmissionAuthorization(request.receipt, evidence, '00'.repeat(32))
			const binding = {
				operationId: provisional.operation_id, operationRoot: provisional.operation_root,
				receiptDigest, participantIds: selected,
			}
			const claimed = await options.sessions.claim(binding)
			if (claimed.completed !== undefined) return claimed.completed
			if (!HEX_32.test(claimed.sessionId)) throw new Error('DEMO_FIPS_ADMISSION_SESSION: invalid durable session')
			const authorization = demoFrostAdmissionAuthorization(request.receipt, evidence, claimed.sessionId)
			if (authorization.operation_root !== binding.operationRoot) throw new Error('DEMO_FIPS_ADMISSION_SESSION: session changed operation root')
			const abort = new AbortController()
			const base: DemoFipsAdmissionCommitPayloadV1 = {
				schema: 'COCO_DEMO_FIPS_ADMISSION_COMMIT_PAYLOAD_V1', request: {
					receipt: structuredClone(request.receipt), bundle: structuredClone(request.bundle),
					nowSeconds: request.nowSeconds, dkgBinding: structuredClone(request.dkgBinding),
				},
				participantEvidence: evidence, sessionId: claimed.sessionId,
			}
			const commitments = await Promise.all(selected.map(async (id) => {
				const value = await options.clients[id - 1].call('commit', base, abort.signal) as DemoFrostAdmissionRustCommitment
				await options.sessions.observeParticipant(value.durable_binding)
				return value
			})) as Three<DemoFrostAdmissionRustCommitment>
			const authDigest = demoFrostAdmissionAuthorizationDigest(authorization)
			if (commitments.some((value, index) => value.version !== DEMO_FROST_ADMISSION_VERSION
				|| value.operation_id !== authorization.operation_id || value.session_id !== authorization.session_id
				|| value.authorization_digest !== authDigest || value.participant_id !== selected[index]
				|| !COMPRESSED.test(value.hiding_hex) || !COMPRESSED.test(value.binding_hex))) {
				throw new Error('DEMO_FIPS_ADMISSION_COMMITMENT: signer returned another authorization')
			}
			const sharePayload: DemoFipsAdmissionSharePayloadV1 = {
				...base, schema: 'COCO_DEMO_FIPS_ADMISSION_SHARE_PAYLOAD_V1', commitments,
			}
			const shares = await Promise.all(selected.map(async (id) => {
				const value = await options.clients[id - 1].call('share', sharePayload, abort.signal) as DemoFrostAdmissionRustShare
				await options.sessions.observeParticipant(value.durable_binding)
				return value
			})) as Three<DemoFrostAdmissionRustShare>
			const transcriptHash = demoFrostAdmissionTranscriptHash(authDigest, commitments)
			if (shares.some((value, index) => value.operation_id !== authorization.operation_id
				|| value.session_id !== authorization.session_id || value.authorization_digest !== authDigest
				|| value.commitments_digest !== transcriptHash || value.participant_id !== selected[index]
				|| !HEX_32.test(value.share_hex))) throw new Error('DEMO_FIPS_ADMISSION_SHARE: signer returned another transcript')
			const aggregate = await scratch(options.scratchParent, async (directory) => {
				const authPath = join(directory, 'authorization.json'); const requestPath = join(directory, 'aggregate.json')
				const outputPath = join(directory, 'signature.json')
				await privateJson(authPath, authorization)
				await privateJson(requestPath, {
					version: DEMO_FROST_ADMISSION_VERSION, operation_id: authorization.operation_id,
					session_id: authorization.session_id,
					commitments: commitments.map((value) => ({ participant_id: value.participant_id, hiding_hex: value.hiding_hex, binding_hex: value.binding_hex })),
					shares: shares.map((value) => ({ participant_id: value.participant_id, share_hex: value.share_hex })),
				})
				await command([options.binaryPath, 'admission-aggregate', authPath, options.publicKeyPackagePath, requestPath, outputPath])
				return JSON.parse(await readFile(outputPath, 'utf8')) as DemoFrostAdmissionRustAggregate
			})
			const signatureDigest = demoIntegratedFundingAnyAdmissionSignatureDigest(request.receipt, authorization.participant_evidence_digest)
			if (aggregate.operation_root !== authorization.operation_root || aggregate.session_id !== authorization.session_id
				|| aggregate.authorization_digest !== authDigest || aggregate.commitments_digest !== transcriptHash
				|| aggregate.receipt_digest !== receiptDigest || aggregate.admission_signature_digest !== signatureDigest
				|| JSON.stringify(aggregate.participant_ids) !== JSON.stringify(selected) || !HEX_64.test(aggregate.signature_hex)
				|| !schnorr.verify(hexToBytes(aggregate.signature_hex), hexToBytes(signatureDigest), hexToBytes(options.committeePublicKey.slice(2)))) {
				throw new Error('DEMO_FIPS_ADMISSION_AGGREGATE: threshold signature differs from exact admission')
			}
			const result: DemoIntegratedAdmissionThreshold3AuthorizationV1 = {
				schema: 'COCO_DEMO_INTEGRATED_ADMISSION_THRESHOLD3_AUTHORIZATION_V1', domain: DEMO_FROST_ADMISSION_VERSION,
				receiptDigest, signatureDigest, receiptBytesSha256: authorization.receipt_sha256,
				participantEvidenceDigest: authorization.participant_evidence_digest,
				operationRoot: authorization.operation_root, sessionId: authorization.session_id,
				bidIntentId: authorization.bid_intent_id, dkgRunId: authorization.dkg_run_id,
				publicKeyPackageSha256: authorization.public_key_package_sha256,
				signerRosterDigest: authorization.signer_roster_digest, participantIds: selected,
				transcriptHash, validFrom: authorization.valid_from, validUntil: authorization.valid_until,
				committeeSignature: aggregate.signature_hex,
			}
			await options.sessions.complete({ ...binding, sessionId: claimed.sessionId }, result)
			return result
		},
	})
}
