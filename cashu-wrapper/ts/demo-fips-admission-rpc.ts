/** Authenticated admission-policy/FROST RPC carried only over a FIPS ULA. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoFrostAdmissionRustCommitment,
	DemoFrostAdmissionRustShare,
} from './demo-frost-threshold3-admission'
import type { DemoAdmissionParticipantPolicyRequestV1 } from './demo-integrated-admission-service'
import type { DemoIntegratedAdmissionPolicyEvidenceV1 } from './demo-integrated-admission-policy'

import { runDemoSignerV1LocalAttempt, type DemoSignerLocalAttempt, type DemoSignerLocalJournal } from './demo-signer-v1-local-attempt'
import { DemoSignerCachedRejection, type DemoSignerPureContext, type DemoSignerPureReason } from './demo-signer-pure-policy'
import type { DemoSignerJournalInspection } from './demo-signer-rpc-journal-v2'

export const DEMO_FIPS_ADMISSION_RPC_VERSION = 'COCO_DEMO_FIPS_ADMISSION_RPC_V1' as const
export const DEMO_FIPS_SIGNER_PLAINTEXT_PROBE = 'PLEBEIAN-FRIDAY-SIGNER-TRANSPORT-V1' as const
const REQUEST_CONTEXT = utf8ToBytes('COCO_DEMO_FIPS_ADMISSION_RPC_REQUEST_V1')
const RESPONSE_CONTEXT = utf8ToBytes('COCO_DEMO_FIPS_ADMISSION_RPC_RESPONSE_V1')
const PAYLOAD_CONTEXT = utf8ToBytes('COCO_DEMO_FIPS_ADMISSION_RPC_PAYLOAD_V1')
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

export type DemoFipsAdmissionMethod = 'policy' | 'commit' | 'share'

export interface DemoFipsAdmissionPolicyPayloadV1 {
	schema: 'COCO_DEMO_FIPS_ADMISSION_POLICY_PAYLOAD_V1'
	request: DemoAdmissionParticipantPolicyRequestV1
}

export interface DemoFipsAdmissionCommitPayloadV1 {
	schema: 'COCO_DEMO_FIPS_ADMISSION_COMMIT_PAYLOAD_V1'
	request: DemoAdmissionParticipantPolicyRequestV1
	participantEvidence: [DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1, DemoIntegratedAdmissionPolicyEvidenceV1]
	sessionId: string
}

export interface DemoFipsAdmissionSharePayloadV1 extends Omit<DemoFipsAdmissionCommitPayloadV1, 'schema'> {
	schema: 'COCO_DEMO_FIPS_ADMISSION_SHARE_PAYLOAD_V1'
	commitments: [DemoFrostAdmissionRustCommitment, DemoFrostAdmissionRustCommitment, DemoFrostAdmissionRustCommitment]
}

export type DemoFipsAdmissionPayloadV1 =
	| DemoFipsAdmissionPolicyPayloadV1
	| DemoFipsAdmissionCommitPayloadV1
	| DemoFipsAdmissionSharePayloadV1

export type DemoFipsAdmissionResultV1 =
	| DemoIntegratedAdmissionPolicyEvidenceV1
	| DemoFrostAdmissionRustCommitment
	| DemoFrostAdmissionRustShare

export interface DemoFipsAdmissionRpcClient {
	call(method: 'policy', payload: DemoFipsAdmissionPolicyPayloadV1, signal: AbortSignal): Promise<DemoIntegratedAdmissionPolicyEvidenceV1>
	call(method: 'commit', payload: DemoFipsAdmissionCommitPayloadV1, signal: AbortSignal): Promise<DemoFrostAdmissionRustCommitment>
	call(method: 'share', payload: DemoFipsAdmissionSharePayloadV1, signal: AbortSignal): Promise<DemoFrostAdmissionRustShare>
}

interface CommonBinding {
	participantId: 1 | 2 | 3 | 4
	network: string
	chainId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
}

export interface DemoFipsAdmissionRpcRequestV1 extends CommonBinding {
	version: typeof DEMO_FIPS_ADMISSION_RPC_VERSION
	requestId: string
	method: DemoFipsAdmissionMethod
	coordinatorIdentity: string
	payloadDigest: string
	payload: DemoFipsAdmissionPayloadV1
	signature: string
}

export interface DemoFipsAdmissionRpcResponseV1 extends CommonBinding {
	version: typeof DEMO_FIPS_ADMISSION_RPC_VERSION
	requestId: string
	method: DemoFipsAdmissionMethod
	processInstanceId: string
	signerIdentity: string
	payloadDigest: string
	payload: DemoFipsAdmissionResultV1
	signature: string
}

export interface DemoFipsAdmissionRpcBindingV1 extends CommonBinding {
	coordinatorIdentity: string
	signerIdentity: string
}

export interface DemoFipsAdmissionRpcJournal {
	assertReady(): Promise<void>
	claim(requestId: string, requestDigest: string): Promise<
		| { status: 'created' }
		| { status: 'pending' }
		| { status: 'replay'; response: DemoFipsAdmissionRpcResponseV1 }
		| { status: 'rejected'; body: string }
	>
	complete(requestId: string, requestDigest: string, response: DemoFipsAdmissionRpcResponseV1): Promise<void>
	inspect?(id: string, digest: string): Promise<DemoSignerJournalInspection<DemoFipsAdmissionRpcResponseV1>>
	rejectNoEffect?(id: string, digest: string, reason: DemoSignerPureReason, witness: string): Promise<never>
}

function frame(value: Uint8Array): Uint8Array {
	const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, value.length, false)
	return concatBytes(size, value)
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new Error('DEMO_FIPS_ADMISSION_CANONICAL: non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') throw new Error('DEMO_FIPS_ADMISSION_CANONICAL: unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function digest(context: Uint8Array, value: unknown): string {
	return bytesToHex(sha256(concatBytes(context, frame(utf8ToBytes(canonicalJson(value))))))
}

function unsignedRequest(value: DemoFipsAdmissionRpcRequestV1): Omit<DemoFipsAdmissionRpcRequestV1, 'signature'> {
	const { signature: _signature, ...unsigned } = value; return unsigned
}

function unsignedResponse(value: DemoFipsAdmissionRpcResponseV1): Omit<DemoFipsAdmissionRpcResponseV1, 'signature'> {
	const { signature: _signature, ...unsigned } = value; return unsigned
}

export function demoFipsAdmissionRequestDigest(value: DemoFipsAdmissionRpcRequestV1): string {
	return digest(REQUEST_CONTEXT, unsignedRequest(value))
}

export function demoFipsAdmissionResponseDigest(value: DemoFipsAdmissionRpcResponseV1): string {
	return digest(RESPONSE_CONTEXT, unsignedResponse(value))
}

function payloadDigest(value: unknown): string { return digest(PAYLOAD_CONTEXT, value) }

function exactBinding(value: CommonBinding): void {
	if (![1, 2, 3, 4].includes(value.participantId) || value.network.length === 0 || value.chainId.length === 0
		|| value.committeeKeysetId.length === 0 || value.committeeKeysetVersion.length === 0 || value.dkgRunId.length === 0
		|| !HEX_32.test(value.publicKeyPackageSha256) || !HEX_32.test(value.signerRosterDigest)) {
		throw new Error('DEMO_FIPS_ADMISSION_BINDING: malformed network, chain, DKG, roster, or restart binding')
	}
}

function sameBinding(left: CommonBinding, right: CommonBinding): boolean {
	return left.participantId === right.participantId && left.network === right.network && left.chainId === right.chainId
		&& left.committeeKeysetId === right.committeeKeysetId && left.committeeKeysetVersion === right.committeeKeysetVersion
		&& left.dkgRunId === right.dkgRunId && left.publicKeyPackageSha256 === right.publicKeyPackageSha256
		&& left.signerRosterDigest === right.signerRosterDigest
}

export function createDemoFipsAdmissionRpcHandler(options: {
	binding: DemoFipsAdmissionRpcBindingV1
	processInstanceId: string
	signerIdentityPrivateKey: Uint8Array
	policy(payload: DemoFipsAdmissionPolicyPayloadV1, signal: AbortSignal, prepared?: unknown): Promise<DemoIntegratedAdmissionPolicyEvidenceV1>
	commit(payload: DemoFipsAdmissionCommitPayloadV1, signal: AbortSignal, prepared?: unknown): Promise<DemoFrostAdmissionRustCommitment>
	share(payload: DemoFipsAdmissionSharePayloadV1, signal: AbortSignal, prepared?: unknown): Promise<DemoFrostAdmissionRustShare>
	journal: DemoFipsAdmissionRpcJournal
	localAttempt?: DemoSignerLocalAttempt
	preflight?(method: DemoFipsAdmissionMethod, payload: DemoFipsAdmissionPayloadV1, context: DemoSignerPureContext): Promise<unknown>
}): (body: unknown, signal: AbortSignal) => Promise<DemoFipsAdmissionRpcResponseV1> {
	exactBinding(options.binding)
	if (!HEX_32.test(options.binding.coordinatorIdentity) || !HEX_32.test(options.binding.signerIdentity)
		|| options.processInstanceId.length === 0
		|| bytesToHex(schnorr.getPublicKey(options.signerIdentityPrivateKey)) !== options.binding.signerIdentity) {
		throw new Error('DEMO_FIPS_ADMISSION_IDENTITY: signer or coordinator identity is malformed')
	}
	return async (body, signal) => {
		if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('DEMO_FIPS_ADMISSION_SHAPE: request is not an object')
		if (Object.keys(body).sort().join(',') !== [
			'version', 'requestId', 'method', 'participantId', 'network', 'chainId', 'committeeKeysetId',
			'committeeKeysetVersion', 'dkgRunId', 'publicKeyPackageSha256', 'signerRosterDigest',
			'coordinatorIdentity', 'payloadDigest', 'payload', 'signature',
		].sort().join(',')) throw new Error('DEMO_FIPS_ADMISSION_SHAPE: request fields differ from V1')
		const request = structuredClone(body) as DemoFipsAdmissionRpcRequestV1
		if (request.version !== DEMO_FIPS_ADMISSION_RPC_VERSION || !HEX_32.test(request.requestId)
			|| !['policy', 'commit', 'share'].includes(request.method) || request.coordinatorIdentity !== options.binding.coordinatorIdentity
			|| !sameBinding(request, options.binding) || !HEX_32.test(request.payloadDigest)
			|| request.payloadDigest !== payloadDigest(request.payload) || !HEX_64.test(request.signature)
			|| !schnorr.verify(hexToBytes(request.signature), hexToBytes(demoFipsAdmissionRequestDigest(request)), hexToBytes(request.coordinatorIdentity))) {
			throw new Error('DEMO_FIPS_ADMISSION_AUTHENTICATION: request signature or exact binding is invalid')
		}
		const requestDigest = demoFipsAdmissionRequestDigest(request)
		const perform = async (prepared?: unknown): Promise<DemoFipsAdmissionRpcResponseV1> => {
		const result = request.method === 'policy'
			? await options.policy(request.payload as DemoFipsAdmissionPolicyPayloadV1, signal, prepared)
			: request.method === 'commit'
				? await options.commit(request.payload as DemoFipsAdmissionCommitPayloadV1, signal, prepared)
				: await options.share(request.payload as DemoFipsAdmissionSharePayloadV1, signal, prepared)
		const response: DemoFipsAdmissionRpcResponseV1 = {
			version: DEMO_FIPS_ADMISSION_RPC_VERSION, requestId: request.requestId, method: request.method,
			participantId: options.binding.participantId, network: options.binding.network, chainId: options.binding.chainId,
			committeeKeysetId: options.binding.committeeKeysetId, committeeKeysetVersion: options.binding.committeeKeysetVersion,
			dkgRunId: options.binding.dkgRunId, publicKeyPackageSha256: options.binding.publicKeyPackageSha256,
			signerRosterDigest: options.binding.signerRosterDigest,
			processInstanceId: options.processInstanceId, signerIdentity: options.binding.signerIdentity,
			payloadDigest: payloadDigest(result), payload: structuredClone(result), signature: '',
		}
		response.signature = bytesToHex(schnorr.sign(hexToBytes(demoFipsAdmissionResponseDigest(response)), options.signerIdentityPrivateKey))
		await options.journal.complete(request.requestId, requestDigest, structuredClone(response))
		return response
		}
		if (options.localAttempt !== undefined) {
			if (options.preflight === undefined || options.journal.inspect === undefined || options.journal.rejectNoEffect === undefined) throw new Error('SIGNER_LOCAL_CONTRACT_REQUIRED')
			return runDemoSignerV1LocalAttempt({ id: request.requestId, digest: demoFipsAdmissionRequestDigest(request), signal,
				local: options.localAttempt, journal: options.journal as DemoSignerLocalJournal<DemoFipsAdmissionRpcResponseV1>,
				preflight: (context) => options.preflight!(request.method, request.payload, context), perform,
			})
		}
		await options.journal.assertReady()
		const claimed = await options.journal.claim(request.requestId, requestDigest)
		if (claimed.status === 'replay') return structuredClone(claimed.response)
		if (claimed.status === 'rejected') throw new DemoSignerCachedRejection(claimed.body)
		if (claimed.status === 'pending') throw new Error('DEMO_FIPS_ADMISSION_QUARANTINED: interrupted request remains pending')
		return perform()
	}
}

export function createDemoFipsAdmissionRpcClient(options: {
	endpoint: string
	binding: DemoFipsAdmissionRpcBindingV1
	coordinatorIdentityPrivateKey: Uint8Array
	fetchImpl?: typeof fetch
}): DemoFipsAdmissionRpcClient {
	exactBinding(options.binding)
	if (!/^http:\/\/\[(?:fc|fd)[0-9a-f:]+\]:39101\/v1\/admission$/i.test(options.endpoint)
		|| bytesToHex(schnorr.getPublicKey(options.coordinatorIdentityPrivateKey)) !== options.binding.coordinatorIdentity
		|| !HEX_32.test(options.binding.signerIdentity)) {
		throw new Error('DEMO_FIPS_ADMISSION_CLIENT: endpoint or identity binding is invalid')
	}
	const fetchImpl = options.fetchImpl ?? fetch
	return Object.freeze({
		async call(method: DemoFipsAdmissionMethod, payload: DemoFipsAdmissionPayloadV1, signal: AbortSignal): Promise<DemoFipsAdmissionResultV1> {
			const unsigned = {
				version: DEMO_FIPS_ADMISSION_RPC_VERSION, requestId: payloadDigest({ method, payload }), method,
				participantId: options.binding.participantId, network: options.binding.network, chainId: options.binding.chainId,
				committeeKeysetId: options.binding.committeeKeysetId, committeeKeysetVersion: options.binding.committeeKeysetVersion,
				dkgRunId: options.binding.dkgRunId, publicKeyPackageSha256: options.binding.publicKeyPackageSha256,
				signerRosterDigest: options.binding.signerRosterDigest,
				coordinatorIdentity: options.binding.coordinatorIdentity, payloadDigest: payloadDigest(payload), payload,
			} satisfies Omit<DemoFipsAdmissionRpcRequestV1, 'signature'>
			const request: DemoFipsAdmissionRpcRequestV1 = { ...unsigned, signature: '' }
			request.signature = bytesToHex(schnorr.sign(hexToBytes(demoFipsAdmissionRequestDigest(request)), options.coordinatorIdentityPrivateKey))
			const http = await fetchImpl(options.endpoint, {
				method: 'POST', headers: {
					'content-type': 'application/json', 'x-plebeian-fips-plaintext-probe': DEMO_FIPS_SIGNER_PLAINTEXT_PROBE,
				}, body: JSON.stringify(request), signal,
			})
			if (!http.ok) throw new Error(`DEMO_FIPS_ADMISSION_HTTP: signer refused with ${http.status}`)
			const response = await http.json() as DemoFipsAdmissionRpcResponseV1
			if (response.version !== DEMO_FIPS_ADMISSION_RPC_VERSION || response.requestId !== request.requestId
				|| response.method !== method || !sameBinding(response, options.binding)
				|| response.signerIdentity !== options.binding.signerIdentity || !HEX_32.test(response.payloadDigest)
				|| response.payloadDigest !== payloadDigest(response.payload) || !HEX_64.test(response.signature)
				|| !schnorr.verify(hexToBytes(response.signature), hexToBytes(demoFipsAdmissionResponseDigest(response)), hexToBytes(response.signerIdentity))) {
				throw new Error('DEMO_FIPS_ADMISSION_RESPONSE: response signature or exact binding is invalid')
			}
			return structuredClone(response.payload)
		},
	}) as DemoFipsAdmissionRpcClient
}
