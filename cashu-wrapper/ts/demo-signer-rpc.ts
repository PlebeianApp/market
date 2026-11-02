/**
 * SignerRPCV1 codec and authenticated transport for the fake-money demo.
 *
 * The HTTP endpoint is required to be a ULA reached through a jmcorgan/fips
 * interface. FIPS provides packet privacy/routing; these signatures provide
 * application identity. Neither layer alone authorizes a payment.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoFrostObservedProcess,
	DemoFrostProcessEnrollment,
	DemoFrostProcessExchange,
	DemoFrostProcessRoundOneRequest,
	DemoFrostProcessRoundOneResponse,
	DemoFrostProcessRoundTwoRequest,
	DemoFrostProcessRoundTwoResponse,
	DemoFrostProcessTransport,
} from './demo-frost-process-boundary'
import type { DemoFrostThreshold3ParticipantWorker } from './demo-frost-threshold3-rust-participant-worker'

export const DEMO_SIGNER_RPC_VERSION = 'COCO_DEMO_SIGNER_RPC_V1' as const
const REQUEST_CONTEXT = utf8ToBytes('COCO_DEMO_SIGNER_RPC_REQUEST_V1')
const RESPONSE_CONTEXT = utf8ToBytes('COCO_DEMO_SIGNER_RPC_RESPONSE_V1')
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const X_ONLY = /^[0-9a-f]{64}$/

type Method = 'roundOne' | 'roundTwo'
type RequestPayload = DemoFrostProcessRoundOneRequest | DemoFrostProcessRoundTwoRequest
type ResponsePayload = DemoFrostProcessRoundOneResponse | DemoFrostProcessRoundTwoResponse

export interface DemoSignerRpcRequestV1 {
	version: typeof DEMO_SIGNER_RPC_VERSION
	requestId: string
	method: Method
	participantId: 1 | 2 | 3 | 4
	keysetId: string
	keysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	restartEpoch: number
	journalGeneration: string
	stateDirectoryIdentity: string
	coordinatorIdentity: string
	payloadDigest: string
	payload: RequestPayload
	signature: string
}

export interface DemoSignerRpcResponseV1 {
	version: typeof DEMO_SIGNER_RPC_VERSION
	requestId: string
	method: Method
	participantId: 1 | 2 | 3 | 4
	keysetId: string
	keysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	restartEpoch: number
	journalGeneration: string
	stateDirectoryIdentity: string
	processIdentity: string
	processInstanceId: string
	stateDirectory: string
	verifyingShare: string
	payloadDigest: string
	payload: ResponsePayload
	signerIdentity: string
	signature: string
}

export interface DemoSignerDurableBindingV1 {
	schema: 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1'
	participantId: 1 | 2 | 3 | 4
	keysetId: string
	keysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	restartEpoch: number
	journalGeneration: string
	stateDirectory: string
	stateDirectoryIdentity: string
	processIdentity: string
	verifyingShare: string
}

export interface DemoSignerRpcJournal {
	/** Durable signer identity loaded from the journal, never from request options. */
	readBinding(): Promise<DemoSignerDurableBindingV1>
	/**
	 * Refuse every new signing request while any prior request remains pending.
	 * This is deliberately conservative: a crash after nonce creation
	 * quarantines the signer rather than permitting another session.
	 */
	assertReady(): Promise<void>
	/**
	 * Atomically claim a request. `replay` contains a prior terminal response;
	 * `pending` means a crash occurred after claim and the signer must quarantine
	 * this request rather than regenerate a FROST nonce.
	 */
	claim(requestId: string, requestDigest: string): Promise<
		| { status: 'created' }
		| { status: 'replay'; response: DemoSignerRpcResponseV1 }
		| { status: 'pending' }
	>
	complete(requestId: string, requestDigest: string, response: DemoSignerRpcResponseV1): Promise<void>
}

export interface DemoSignerRpcServerOptions {
	processInstanceId: string
	coordinatorIdentity: string
	signerIdentityPrivateKey: Uint8Array
	worker: DemoFrostThreshold3ParticipantWorker
	journal: DemoSignerRpcJournal
	serialize?<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T>
}

export interface DemoSignerCoordinatorAnchorPort {
	/**
	 * An independent coordinator database pins generation and maximum observed
	 * epoch. It must reject a new journal generation or any epoch regression.
	 */
	assertCurrent(binding: DemoSignerDurableBindingV1): Promise<void>
	/** Bind an epoch to one authenticated live process instance. */
	observeProcess(binding: DemoSignerDurableBindingV1, processInstanceId: string): Promise<void>
}

function frame(value: Uint8Array): Uint8Array {
	const size = new Uint8Array(4)
	new DataView(size.buffer).setUint32(0, value.length, false)
	return concatBytes(size, value)
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new Error('DEMO_SIGNER_RPC_CANONICAL: non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') throw new Error('DEMO_SIGNER_RPC_CANONICAL: unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function digest(context: Uint8Array, value: unknown): string {
	return bytesToHex(sha256(concatBytes(context, frame(utf8ToBytes(canonicalJson(value))))))
}

function unsignedRequest(value: DemoSignerRpcRequestV1): Omit<DemoSignerRpcRequestV1, 'signature'> {
	const { signature: _signature, ...unsigned } = value
	return unsigned
}

function unsignedResponse(value: DemoSignerRpcResponseV1): Omit<DemoSignerRpcResponseV1, 'signature'> {
	const { signature: _signature, ...unsigned } = value
	return unsigned
}

export function demoSignerRpcRequestDigest(value: DemoSignerRpcRequestV1): string {
	return digest(REQUEST_CONTEXT, unsignedRequest(value))
}

export function demoSignerRpcResponseDigest(value: DemoSignerRpcResponseV1): string {
	return digest(RESPONSE_CONTEXT, unsignedResponse(value))
}

function exactKeys(value: unknown, expected: string[], label: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		throw new Error(`DEMO_SIGNER_RPC_SHAPE: ${label} contains missing or unexpected fields`)
	}
}

function validateCommon(value: DemoSignerRpcRequestV1 | DemoSignerRpcResponseV1): void {
	if (value.version !== DEMO_SIGNER_RPC_VERSION || !HEX_32.test(value.requestId)
		|| ![1, 2, 3, 4].includes(value.participantId) || value.keysetId.length === 0
		|| value.keysetVersion.length === 0 || value.dkgRunId.length === 0
		|| !HEX_32.test(value.publicKeyPackageSha256) || !HEX_32.test(value.signerRosterDigest)
		|| !Number.isSafeInteger(value.restartEpoch) || value.restartEpoch < 1
		|| !HEX_32.test(value.journalGeneration) || !HEX_32.test(value.stateDirectoryIdentity)
		|| !HEX_32.test(value.payloadDigest) || !HEX_64.test(value.signature)) {
		throw new Error('DEMO_SIGNER_RPC_BINDING: malformed request/response binding')
	}
	if (value.payloadDigest !== digest(utf8ToBytes('COCO_DEMO_SIGNER_RPC_PAYLOAD_V1'), value.payload)) {
		throw new Error('DEMO_SIGNER_RPC_PAYLOAD: payload digest mismatch')
	}
}

function validateDurableBinding(value: DemoSignerDurableBindingV1): DemoSignerDurableBindingV1 {
	if (value.schema !== 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1' || ![1, 2, 3, 4].includes(value.participantId)
		|| value.keysetId.length === 0 || value.keysetVersion.length === 0 || value.dkgRunId.length === 0
		|| !HEX_32.test(value.publicKeyPackageSha256) || !HEX_32.test(value.signerRosterDigest)
		|| !Number.isSafeInteger(value.restartEpoch) || value.restartEpoch < 1
		|| !HEX_32.test(value.journalGeneration) || !HEX_32.test(value.stateDirectoryIdentity)
		|| !value.stateDirectory.startsWith('/') || value.processIdentity.length === 0
		|| !/^(?:02|03)[0-9a-f]{64}$/.test(value.verifyingShare)) {
		throw new Error('DEMO_SIGNER_RPC_DURABLE_BINDING: signer durable metadata is malformed')
	}
	return structuredClone(value)
}

export function createDemoSignerRpcHandler(options: DemoSignerRpcServerOptions): (body: unknown, signal: AbortSignal) => Promise<DemoSignerRpcResponseV1> {
	const signerIdentity = bytesToHex(schnorr.getPublicKey(options.signerIdentityPrivateKey))
	return async (body, signal) => {
		const binding = validateDurableBinding(await options.journal.readBinding())
		if (options.processInstanceId.length === 0 || options.processInstanceId.trim() !== options.processInstanceId) {
			throw new Error('DEMO_SIGNER_RPC_PROCESS_INSTANCE: signer process instance is invalid')
		}
		exactKeys(body, [
			'version', 'requestId', 'method', 'participantId', 'keysetId', 'keysetVersion', 'dkgRunId',
			'publicKeyPackageSha256', 'signerRosterDigest', 'restartEpoch', 'journalGeneration', 'stateDirectoryIdentity',
			'coordinatorIdentity', 'payloadDigest', 'payload', 'signature',
		], 'request')
		const request = structuredClone(body) as unknown as DemoSignerRpcRequestV1
		validateCommon(request)
		if (request.coordinatorIdentity !== options.coordinatorIdentity || !X_ONLY.test(request.coordinatorIdentity)
			|| request.participantId !== binding.participantId || request.keysetId !== binding.keysetId
			|| request.keysetVersion !== binding.keysetVersion || request.dkgRunId !== binding.dkgRunId
			|| request.publicKeyPackageSha256 !== binding.publicKeyPackageSha256
			|| request.signerRosterDigest !== binding.signerRosterDigest
			|| request.restartEpoch !== binding.restartEpoch || request.journalGeneration !== binding.journalGeneration
			|| request.stateDirectoryIdentity !== binding.stateDirectoryIdentity) {
			throw new Error('DEMO_SIGNER_RPC_AUTHORITY: request targets another roster, keyset, or restart epoch')
		}
		if (!schnorr.verify(hexToBytes(request.signature), hexToBytes(demoSignerRpcRequestDigest(request)), hexToBytes(request.coordinatorIdentity))) {
			throw new Error('DEMO_SIGNER_RPC_AUTHENTICATION: coordinator signature is invalid')
		}
		const execute = async (): Promise<DemoSignerRpcResponseV1> => {
		await options.journal.assertReady()
		const requestDigest = demoSignerRpcRequestDigest(request)
		const claimed = await options.journal.claim(request.requestId, requestDigest)
		if (claimed.status === 'replay') return structuredClone(claimed.response)
		if (claimed.status === 'pending') {
			throw new Error('DEMO_SIGNER_RPC_QUARANTINED: request was interrupted after durable claim')
		}
		const payload = request.method === 'roundOne'
			? await options.worker.roundOne(request.payload as DemoFrostProcessRoundOneRequest, signal)
			: await options.worker.roundTwo(request.payload as DemoFrostProcessRoundTwoRequest, signal)
		const response: DemoSignerRpcResponseV1 = {
			version: DEMO_SIGNER_RPC_VERSION, requestId: request.requestId, method: request.method,
			participantId: binding.participantId, keysetId: binding.keysetId, keysetVersion: binding.keysetVersion,
			dkgRunId: binding.dkgRunId, publicKeyPackageSha256: binding.publicKeyPackageSha256,
			signerRosterDigest: binding.signerRosterDigest, restartEpoch: binding.restartEpoch,
			journalGeneration: binding.journalGeneration, stateDirectoryIdentity: binding.stateDirectoryIdentity,
			processIdentity: binding.processIdentity, processInstanceId: options.processInstanceId,
			stateDirectory: binding.stateDirectory, verifyingShare: binding.verifyingShare,
			payloadDigest: digest(utf8ToBytes('COCO_DEMO_SIGNER_RPC_PAYLOAD_V1'), payload),
			payload, signerIdentity, signature: '',
		}
		response.signature = bytesToHex(schnorr.sign(hexToBytes(demoSignerRpcResponseDigest(response)), options.signerIdentityPrivateKey))
		await options.journal.complete(request.requestId, requestDigest, structuredClone(response))
		return response
		}
		return options.serialize ? options.serialize(signal, execute) : execute()
	}
}

export interface DemoSignerRpcTransportOptions {
	endpoint: string
	enrollment: DemoFrostProcessEnrollment
	signerBinding: DemoSignerDurableBindingV1
	anchor: DemoSignerCoordinatorAnchorPort
	coordinatorIdentityPrivateKey: Uint8Array
	signerIdentity: string
	fetchImpl?: typeof fetch
}

function requireFipsUlaEndpoint(endpoint: string): URL {
	let parsed: URL
	try { parsed = new URL(endpoint) }
	catch { throw new Error('DEMO_SIGNER_RPC_ENDPOINT: endpoint is not a URL') }
	if (parsed.protocol !== 'http:' || !parsed.hostname.includes(':')
		|| !/^(?:fc|fd)/i.test(parsed.hostname.replaceAll('[', '').replaceAll(']', ''))
		|| parsed.pathname !== '/v1/frost' || parsed.username !== '' || parsed.password !== '') {
		throw new Error('DEMO_SIGNER_RPC_ENDPOINT: signer RPC must use an exact FIPS-routed IPv6 ULA /v1/frost endpoint')
	}
	return parsed
}

export function createDemoSignerRpcTransport(options: DemoSignerRpcTransportOptions): DemoFrostProcessTransport {
	const endpoint = requireFipsUlaEndpoint(options.endpoint)
	const coordinatorIdentity = bytesToHex(schnorr.getPublicKey(options.coordinatorIdentityPrivateKey))
	const pinned = validateDurableBinding(options.signerBinding)
	if (!X_ONLY.test(options.signerIdentity) || options.enrollment.participantId < 1 || options.enrollment.participantId > 4
		|| pinned.participantId !== options.enrollment.participantId
		|| pinned.processIdentity !== options.enrollment.processIdentity
		|| pinned.stateDirectory !== options.enrollment.stateDirectory
		|| pinned.verifyingShare !== options.enrollment.verifyingShare) {
		throw new Error('DEMO_SIGNER_RPC_ENROLLMENT: invalid signer identity or participant')
	}
	const fetchImpl = options.fetchImpl ?? fetch
	const exchange = async <T extends ResponsePayload>(method: Method, payload: RequestPayload, signal: AbortSignal): Promise<DemoFrostProcessExchange<T>> => {
		await options.anchor.assertCurrent(structuredClone(pinned))
		const unsigned = {
			version: DEMO_SIGNER_RPC_VERSION, requestId: bytesToHex(sha256(utf8ToBytes(canonicalJson({ method, payload })))),
			method, participantId: pinned.participantId, keysetId: pinned.keysetId,
			keysetVersion: pinned.keysetVersion, dkgRunId: pinned.dkgRunId,
			publicKeyPackageSha256: pinned.publicKeyPackageSha256, signerRosterDigest: pinned.signerRosterDigest,
			restartEpoch: pinned.restartEpoch, journalGeneration: pinned.journalGeneration,
			stateDirectoryIdentity: pinned.stateDirectoryIdentity, coordinatorIdentity,
			payloadDigest: digest(utf8ToBytes('COCO_DEMO_SIGNER_RPC_PAYLOAD_V1'), payload), payload,
		} as Omit<DemoSignerRpcRequestV1, 'signature'>
		const request = { ...unsigned, signature: '' } as DemoSignerRpcRequestV1
		request.signature = bytesToHex(schnorr.sign(hexToBytes(demoSignerRpcRequestDigest(request)), options.coordinatorIdentityPrivateKey))
		const http = await fetchImpl(endpoint, {
			method: 'POST', headers: {
				'content-type': 'application/json',
				'x-plebeian-fips-plaintext-probe': 'PLEBEIAN-FRIDAY-SIGNER-TRANSPORT-V1',
			}, body: JSON.stringify(request), signal,
		})
		if (!http.ok) throw new Error(`DEMO_SIGNER_RPC_HTTP: signer refused with ${http.status}`)
		const response = await http.json() as DemoSignerRpcResponseV1
		exactKeys(response, [
			'version', 'requestId', 'method', 'participantId', 'keysetId', 'keysetVersion', 'dkgRunId',
			'publicKeyPackageSha256', 'signerRosterDigest', 'restartEpoch', 'journalGeneration', 'stateDirectoryIdentity',
			'processIdentity', 'processInstanceId', 'stateDirectory', 'verifyingShare', 'payloadDigest',
			'payload', 'signerIdentity', 'signature',
		], 'response')
		validateCommon(response)
		if (response.requestId !== request.requestId || response.method !== method
			|| response.participantId !== pinned.participantId || response.keysetId !== pinned.keysetId
			|| response.keysetVersion !== pinned.keysetVersion || response.dkgRunId !== pinned.dkgRunId
			|| response.publicKeyPackageSha256 !== pinned.publicKeyPackageSha256
			|| response.signerRosterDigest !== pinned.signerRosterDigest
			|| response.restartEpoch !== pinned.restartEpoch || response.journalGeneration !== pinned.journalGeneration
			|| response.stateDirectoryIdentity !== pinned.stateDirectoryIdentity
			|| response.processIdentity !== options.enrollment.processIdentity
			|| response.stateDirectory !== options.enrollment.stateDirectory
			|| response.verifyingShare !== options.enrollment.verifyingShare
			|| response.signerIdentity !== options.signerIdentity) {
			throw new Error('DEMO_SIGNER_RPC_RESPONSE: response differs from the pinned enrollment')
		}
		if (!schnorr.verify(hexToBytes(response.signature), hexToBytes(demoSignerRpcResponseDigest(response)), hexToBytes(options.signerIdentity))) {
			throw new Error('DEMO_SIGNER_RPC_AUTHENTICATION: signer response signature is invalid')
		}
		await options.anchor.observeProcess(structuredClone(pinned), response.processInstanceId)
		const peer: DemoFrostObservedProcess = {
			...options.enrollment, processInstanceId: response.processInstanceId, restartCounter: response.restartEpoch,
		}
		return { peer, message: structuredClone(response.payload) as T }
	}
	return {
		roundOne: (request, { signal }) => exchange<DemoFrostProcessRoundOneResponse>('roundOne', request, signal),
		roundTwo: (request, { signal }) => exchange<DemoFrostProcessRoundTwoResponse>('roundTwo', request, signal),
	}
}
