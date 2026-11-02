/** Authenticated FundingAbortV1 policy/FROST RPC carried only over a FIPS ULA. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type { DemoFundingAbortParticipantPolicyRequestV1 } from './demo-funding-abort-participant-policy'
import type {
	DemoFundingAbortParticipantEvidenceV1,
	DemoFrostFundingAbortCommitmentV1,
	DemoFrostFundingAbortShareV1,
} from './demo-frost-threshold3-funding-abort'
import { DEMO_FIPS_SIGNER_PLAINTEXT_PROBE } from './demo-fips-admission-rpc'

import { runDemoSignerV1LocalAttempt, type DemoSignerLocalAttempt, type DemoSignerLocalJournal } from './demo-signer-v1-local-attempt'
import { DemoSignerCachedRejection, type DemoSignerPureContext, type DemoSignerPureReason } from './demo-signer-pure-policy'
import type { DemoSignerJournalInspection } from './demo-signer-rpc-journal-v2'

export const DEMO_FIPS_FUNDING_ABORT_RPC_VERSION = 'COCO_DEMO_FIPS_FUNDING_ABORT_RPC_V1' as const
const REQUEST_CONTEXT = utf8ToBytes('COCO_DEMO_FIPS_FUNDING_ABORT_RPC_REQUEST_V1')
const RESPONSE_CONTEXT = utf8ToBytes('COCO_DEMO_FIPS_FUNDING_ABORT_RPC_RESPONSE_V1')
const PAYLOAD_CONTEXT = utf8ToBytes('COCO_DEMO_FIPS_FUNDING_ABORT_RPC_PAYLOAD_V1')
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

export type DemoFipsFundingAbortMethod = 'policy' | 'commit' | 'share'

export interface DemoFipsFundingAbortPolicyPayloadV1 {
	schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_POLICY_PAYLOAD_V1'
	request: DemoFundingAbortParticipantPolicyRequestV1
}

export interface DemoFipsFundingAbortCommitPayloadV1 {
	schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_COMMIT_PAYLOAD_V1'
	request: DemoFundingAbortParticipantPolicyRequestV1
	participantEvidence: [DemoFundingAbortParticipantEvidenceV1, DemoFundingAbortParticipantEvidenceV1,
		DemoFundingAbortParticipantEvidenceV1]
	sessionId: string
}

export interface DemoFipsFundingAbortSharePayloadV1 extends Omit<DemoFipsFundingAbortCommitPayloadV1, 'schema'> {
	schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_SHARE_PAYLOAD_V1'
	commitments: [DemoFrostFundingAbortCommitmentV1, DemoFrostFundingAbortCommitmentV1,
		DemoFrostFundingAbortCommitmentV1]
}

export type DemoFipsFundingAbortPayloadV1 = DemoFipsFundingAbortPolicyPayloadV1
	| DemoFipsFundingAbortCommitPayloadV1 | DemoFipsFundingAbortSharePayloadV1
export type DemoFipsFundingAbortResultV1 = DemoFundingAbortParticipantEvidenceV1
	| DemoFrostFundingAbortCommitmentV1 | DemoFrostFundingAbortShareV1

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

export interface DemoFipsFundingAbortRpcBindingV1 extends CommonBinding {
	coordinatorIdentity: string
	signerIdentity: string
}

export interface DemoFipsFundingAbortRpcRequestV1 extends CommonBinding {
	version: typeof DEMO_FIPS_FUNDING_ABORT_RPC_VERSION
	requestId: string
	method: DemoFipsFundingAbortMethod
	coordinatorIdentity: string
	payloadDigest: string
	payload: DemoFipsFundingAbortPayloadV1
	signature: string
}

export interface DemoFipsFundingAbortRpcResponseV1 extends CommonBinding {
	version: typeof DEMO_FIPS_FUNDING_ABORT_RPC_VERSION
	requestId: string
	method: DemoFipsFundingAbortMethod
	processInstanceId: string
	signerIdentity: string
	payloadDigest: string
	payload: DemoFipsFundingAbortResultV1
	signature: string
}

export interface DemoFipsFundingAbortRpcJournal {
	assertReady(): Promise<void>
	claim(requestId: string, requestDigest: string): Promise<{ status: 'created' } | { status: 'pending' }
		| { status: 'replay'; response: DemoFipsFundingAbortRpcResponseV1 } | { status: 'rejected'; body: string }>
	complete(requestId: string, requestDigest: string, response: DemoFipsFundingAbortRpcResponseV1): Promise<void>
	inspect?(id: string, digest: string): Promise<DemoSignerJournalInspection<DemoFipsFundingAbortRpcResponseV1>>
	rejectNoEffect?(id: string, digest: string, reason: DemoSignerPureReason, witness: string): Promise<never>
}

/** A transport failure may select a fresh durable FROST attempt. Policy refusals may not. */
export class DemoFipsFundingAbortRpcUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options); this.name = 'DemoFipsFundingAbortRpcUnavailableError'
	}
}

export interface DemoFipsFundingAbortRpcClient {
	call(method: 'policy', payload: DemoFipsFundingAbortPolicyPayloadV1,
		signal: AbortSignal): Promise<DemoFundingAbortParticipantEvidenceV1>
	call(method: 'commit', payload: DemoFipsFundingAbortCommitPayloadV1,
		signal: AbortSignal): Promise<DemoFrostFundingAbortCommitmentV1>
	call(method: 'share', payload: DemoFipsFundingAbortSharePayloadV1,
		signal: AbortSignal): Promise<DemoFrostFundingAbortShareV1>
}

function frame(value: Uint8Array): Uint8Array {
	const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, value.length, false)
	return concatBytes(length, value)
}

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new Error('DEMO_FIPS_ABORT_CANONICAL: non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') throw new Error('DEMO_FIPS_ABORT_CANONICAL: unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function digest(context: Uint8Array, value: unknown): string {
	return bytesToHex(sha256(concatBytes(context, frame(utf8ToBytes(canonical(value))))))
}

function unsignedRequest(value: DemoFipsFundingAbortRpcRequestV1): Omit<DemoFipsFundingAbortRpcRequestV1, 'signature'> {
	const { signature: _signature, ...unsigned } = value; return unsigned
}
function unsignedResponse(value: DemoFipsFundingAbortRpcResponseV1): Omit<DemoFipsFundingAbortRpcResponseV1, 'signature'> {
	const { signature: _signature, ...unsigned } = value; return unsigned
}
export function demoFipsFundingAbortRequestDigest(value: DemoFipsFundingAbortRpcRequestV1): string {
	return digest(REQUEST_CONTEXT, unsignedRequest(value))
}
export function demoFipsFundingAbortResponseDigest(value: DemoFipsFundingAbortRpcResponseV1): string {
	return digest(RESPONSE_CONTEXT, unsignedResponse(value))
}
function exactPayloadDigest(value: unknown): string { return digest(PAYLOAD_CONTEXT, value) }

function exactBinding(value: CommonBinding): void {
	if (![1, 2, 3, 4].includes(value.participantId) || value.network.length === 0 || value.chainId.length === 0
		|| value.committeeKeysetId.length === 0 || value.committeeKeysetVersion.length === 0 || value.dkgRunId.length === 0
		|| !HEX_32.test(value.publicKeyPackageSha256) || !HEX_32.test(value.signerRosterDigest)) {
		throw new Error('DEMO_FIPS_ABORT_BINDING: malformed network, chain, DKG, roster, or restart binding')
	}
}

function sameBinding(left: CommonBinding, right: CommonBinding): boolean {
	return left.participantId === right.participantId && left.network === right.network && left.chainId === right.chainId
		&& left.committeeKeysetId === right.committeeKeysetId
		&& left.committeeKeysetVersion === right.committeeKeysetVersion && left.dkgRunId === right.dkgRunId
		&& left.publicKeyPackageSha256 === right.publicKeyPackageSha256
		&& left.signerRosterDigest === right.signerRosterDigest
}

export function createDemoFipsFundingAbortRpcHandler(options: {
	binding: DemoFipsFundingAbortRpcBindingV1
	processInstanceId: string
	signerIdentityPrivateKey: Uint8Array
	policy(payload: DemoFipsFundingAbortPolicyPayloadV1, signal: AbortSignal, prepared?: unknown): Promise<DemoFundingAbortParticipantEvidenceV1>
	commit(payload: DemoFipsFundingAbortCommitPayloadV1, signal: AbortSignal, prepared?: unknown): Promise<DemoFrostFundingAbortCommitmentV1>
	share(payload: DemoFipsFundingAbortSharePayloadV1, signal: AbortSignal, prepared?: unknown): Promise<DemoFrostFundingAbortShareV1>
	revalidate(method: DemoFipsFundingAbortMethod, payload: DemoFipsFundingAbortPayloadV1,
		cached: DemoFipsFundingAbortResultV1, signal: AbortSignal, context?: DemoSignerPureContext): Promise<void>
	journal: DemoFipsFundingAbortRpcJournal
	localAttempt?: DemoSignerLocalAttempt
	preflight?(method: DemoFipsFundingAbortMethod, payload: DemoFipsFundingAbortPayloadV1, context: DemoSignerPureContext): Promise<unknown>
}): (body: unknown, signal: AbortSignal) => Promise<DemoFipsFundingAbortRpcResponseV1> {
	exactBinding(options.binding)
	if (!HEX_32.test(options.binding.coordinatorIdentity) || !HEX_32.test(options.binding.signerIdentity)
		|| options.processInstanceId.length === 0
		|| bytesToHex(schnorr.getPublicKey(options.signerIdentityPrivateKey)) !== options.binding.signerIdentity) {
		throw new Error('DEMO_FIPS_ABORT_IDENTITY: signer or coordinator identity is malformed')
	}
	return async (body, signal) => {
		if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('DEMO_FIPS_ABORT_SHAPE: request is not an object')
		if (Object.keys(body).sort().join(',') !== [
			'version', 'requestId', 'method', 'participantId', 'network', 'chainId', 'committeeKeysetId',
			'committeeKeysetVersion', 'dkgRunId', 'publicKeyPackageSha256', 'signerRosterDigest',
			'coordinatorIdentity', 'payloadDigest', 'payload', 'signature',
		].sort().join(',')) throw new Error('DEMO_FIPS_ABORT_SHAPE: request fields differ from V1')
		const request = structuredClone(body) as DemoFipsFundingAbortRpcRequestV1
		if (request.version !== DEMO_FIPS_FUNDING_ABORT_RPC_VERSION || !HEX_32.test(request.requestId)
			|| !['policy', 'commit', 'share'].includes(request.method)
			|| request.coordinatorIdentity !== options.binding.coordinatorIdentity || !sameBinding(request, options.binding)
			|| request.payloadDigest !== exactPayloadDigest(request.payload) || !HEX_64.test(request.signature)
			|| !schnorr.verify(hexToBytes(request.signature), hexToBytes(demoFipsFundingAbortRequestDigest(request)),
				hexToBytes(request.coordinatorIdentity))) throw new Error('DEMO_FIPS_ABORT_AUTHENTICATION: request is invalid')
		const requestDigest = demoFipsFundingAbortRequestDigest(request)
		const perform = async (prepared?: unknown): Promise<DemoFipsFundingAbortRpcResponseV1> => {
		const result = request.method === 'policy'
			? await options.policy(request.payload as DemoFipsFundingAbortPolicyPayloadV1, signal, prepared)
			: request.method === 'commit'
				? await options.commit(request.payload as DemoFipsFundingAbortCommitPayloadV1, signal, prepared)
				: await options.share(request.payload as DemoFipsFundingAbortSharePayloadV1, signal, prepared)
		const response: DemoFipsFundingAbortRpcResponseV1 = {
			version: DEMO_FIPS_FUNDING_ABORT_RPC_VERSION, requestId: request.requestId, method: request.method,
			participantId: options.binding.participantId, network: options.binding.network, chainId: options.binding.chainId,
			committeeKeysetId: options.binding.committeeKeysetId,
			committeeKeysetVersion: options.binding.committeeKeysetVersion, dkgRunId: options.binding.dkgRunId,
			publicKeyPackageSha256: options.binding.publicKeyPackageSha256,
			signerRosterDigest: options.binding.signerRosterDigest, processInstanceId: options.processInstanceId,
			signerIdentity: options.binding.signerIdentity, payloadDigest: exactPayloadDigest(result), payload: structuredClone(result),
			signature: '',
		}
		response.signature = bytesToHex(schnorr.sign(hexToBytes(demoFipsFundingAbortResponseDigest(response)),
			options.signerIdentityPrivateKey))
		await options.journal.complete(request.requestId, requestDigest, structuredClone(response))
		return response
		}
		if (options.localAttempt !== undefined) {
			if (options.preflight === undefined || options.journal.inspect === undefined || options.journal.rejectNoEffect === undefined) throw new Error('SIGNER_LOCAL_CONTRACT_REQUIRED')
			return runDemoSignerV1LocalAttempt({ id: request.requestId, digest: demoFipsFundingAbortRequestDigest(request), signal,
				local: options.localAttempt, journal: options.journal as DemoSignerLocalJournal<DemoFipsFundingAbortRpcResponseV1>,
				preflight: (context) => options.preflight!(request.method, request.payload, context), perform,
				replay: (response, context) => options.revalidate(request.method, request.payload, response.payload, signal, context),
			})
		}
		await options.journal.assertReady()
		const claimed = await options.journal.claim(request.requestId, requestDigest)
		if (claimed.status === 'replay') {
			// A completed journal row proves what this signer returned, not that the
			// mint/proof-use state is still safe. Re-run only the local safety policy;
			// never ask Rust to create another nonce, commitment, or share.
			await options.revalidate(request.method, request.payload, claimed.response.payload, signal)
			return structuredClone(claimed.response)
		}
		if (claimed.status === 'rejected') throw new DemoSignerCachedRejection(claimed.body)
		if (claimed.status === 'pending') throw new Error('DEMO_FIPS_ABORT_QUARANTINED: interrupted request remains pending')
		return perform()
	}
}

export function createDemoFipsFundingAbortRpcClient(options: {
	endpoint: string
	binding: DemoFipsFundingAbortRpcBindingV1
	coordinatorIdentityPrivateKey: Uint8Array
	fetchImpl?: typeof fetch
}): DemoFipsFundingAbortRpcClient {
	exactBinding(options.binding)
	if (!/^http:\/\/\[(?:fc|fd)[0-9a-f:]+\]:39101\/v1\/funding-abort$/i.test(options.endpoint)
		|| bytesToHex(schnorr.getPublicKey(options.coordinatorIdentityPrivateKey)) !== options.binding.coordinatorIdentity
		|| !HEX_32.test(options.binding.signerIdentity)) throw new Error('DEMO_FIPS_ABORT_CLIENT: endpoint or identity is invalid')
	const fetchImpl = options.fetchImpl ?? fetch
	return Object.freeze({
		async call(method: DemoFipsFundingAbortMethod, payload: DemoFipsFundingAbortPayloadV1,
			signal: AbortSignal): Promise<DemoFipsFundingAbortResultV1> {
			const unsigned = {
				version: DEMO_FIPS_FUNDING_ABORT_RPC_VERSION, requestId: exactPayloadDigest({ method, payload }), method,
				participantId: options.binding.participantId, network: options.binding.network, chainId: options.binding.chainId,
				committeeKeysetId: options.binding.committeeKeysetId,
				committeeKeysetVersion: options.binding.committeeKeysetVersion, dkgRunId: options.binding.dkgRunId,
				publicKeyPackageSha256: options.binding.publicKeyPackageSha256,
				signerRosterDigest: options.binding.signerRosterDigest,
				coordinatorIdentity: options.binding.coordinatorIdentity, payloadDigest: exactPayloadDigest(payload), payload,
			} satisfies Omit<DemoFipsFundingAbortRpcRequestV1, 'signature'>
			const request: DemoFipsFundingAbortRpcRequestV1 = { ...unsigned, signature: '' }
			request.signature = bytesToHex(schnorr.sign(hexToBytes(demoFipsFundingAbortRequestDigest(request)),
				options.coordinatorIdentityPrivateKey))
			let http: Response
			try {
				http = await fetchImpl(options.endpoint, { method: 'POST', headers: {
					'content-type': 'application/json', 'x-plebeian-fips-plaintext-probe': DEMO_FIPS_SIGNER_PLAINTEXT_PROBE,
				}, body: JSON.stringify(request), signal })
			} catch (cause) {
				throw new DemoFipsFundingAbortRpcUnavailableError('DEMO_FIPS_ABORT_UNAVAILABLE: signer transport failed',
					{ cause: cause instanceof Error ? cause : undefined })
			}
			if (!http.ok) {
				if ([502, 503, 504].includes(http.status)) {
					throw new DemoFipsFundingAbortRpcUnavailableError(`DEMO_FIPS_ABORT_UNAVAILABLE: signer returned ${http.status}`)
				}
				throw new Error(`DEMO_FIPS_ABORT_HTTP: signer refused with ${http.status}`)
			}
			const response = await http.json() as DemoFipsFundingAbortRpcResponseV1
			if (response.version !== DEMO_FIPS_FUNDING_ABORT_RPC_VERSION || response.requestId !== request.requestId
				|| response.method !== method || !sameBinding(response, options.binding)
				|| response.signerIdentity !== options.binding.signerIdentity
				|| response.payloadDigest !== exactPayloadDigest(response.payload) || !HEX_64.test(response.signature)
				|| !schnorr.verify(hexToBytes(response.signature), hexToBytes(demoFipsFundingAbortResponseDigest(response)),
					hexToBytes(response.signerIdentity))) throw new Error('DEMO_FIPS_ABORT_RESPONSE: response is invalid')
			return structuredClone(response.payload)
		},
	}) as DemoFipsFundingAbortRpcClient
}
