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
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109,
	DemoSignerTerminalIncidentCachedRejection20261109,
} from './demo-signer-terminal-incident-20261109'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110,
	DemoSignerTerminalIncidentCachedRejection20261110,
} from './demo-signer-terminal-incident-20261110'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111,
	DemoSignerTerminalIncidentCachedRejection20261111,
} from './demo-signer-terminal-incident-20261111'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D,
	DemoSignerTerminalIncidentCachedRejection20261111R59d,
} from './demo-signer-terminal-incident-20261111-r59d'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62,
	DemoSignerTerminalIncidentCachedRejection20261111R62,
} from './demo-signer-terminal-incident-20261111-r62'

export const DEMO_SIGNER_RPC_VERSION = 'COCO_DEMO_SIGNER_RPC_V1' as const
const REQUEST_CONTEXT = utf8ToBytes('COCO_DEMO_SIGNER_RPC_REQUEST_V1')
const RESPONSE_CONTEXT = utf8ToBytes('COCO_DEMO_SIGNER_RPC_RESPONSE_V1')
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const X_ONLY = /^[0-9a-f]{64}$/
const MAX_REFUSAL_BYTES = 1_024
const REFUSAL_READ_TIMEOUT_MS = 250
const LOCAL_REFUSAL_REASONS = new Set([
	'ADMISSION_STALE', 'ADMISSION_BINDING', 'ADMISSION_POOL',
	'ABORT_TIME', 'ABORT_BINDING', 'ABORT_LIFECYCLE',
	'MINT_BINDING', 'MINT_SPENT', 'QUORUM_BINDING',
	'TERMINAL_PRE_EFFECT_EXACT_REQUEST_20261110',
	'TERMINAL_PRE_EFFECT_EXACT_REQUEST_20261111',
	'TERMINAL_PRE_EFFECT_EXACT_REQUEST_20261111_R59D',
	'TERMINAL_PRE_EFFECT_WINNER_POLICY_20261111_R62',
])

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
		| { status: 'incident_rejected'; body: typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109
			| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110
			| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111
			| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D }
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

/**
 * Retain only a closed, non-secret refusal class from an unsigned HTTP error.
 * The class is diagnostic-only and never changes retry, quorum, or settlement
 * behavior. Raw bodies and participant-controlled strings are discarded.
 */
function boundedRefusalRead(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	signal: AbortSignal,
): Promise<{ done: boolean; value?: Uint8Array }> {
	return new Promise((resolve, reject) => {
		let settled = false
		const finish = (complete: () => void) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			signal.removeEventListener('abort', aborted)
			complete()
		}
		const aborted = () => finish(() => reject(new Error('refusal body read aborted')))
		const timer = setTimeout(() => finish(() => reject(new Error('refusal body read timed out'))), REFUSAL_READ_TIMEOUT_MS)
		signal.addEventListener('abort', aborted, { once: true })
		if (signal.aborted) { aborted(); return }
		void reader.read().then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error)),
		)
	})
}

async function signerRefusalClass(response: Response, signal: AbortSignal): Promise<string> {
	const fallback = `HTTP_${response.status}`
	if (response.body === null) return fallback
	const reader = response.body.getReader()
	const buffer = new Uint8Array(MAX_REFUSAL_BYTES)
	let used = 0
	try {
		for (;;) {
			const part = await boundedRefusalRead(reader, signal)
			if (part.done) break
			if (!(part.value instanceof Uint8Array) || part.value.byteLength > MAX_REFUSAL_BYTES - used) {
				try { void reader.cancel().catch(() => undefined) } catch { /* diagnostic body only */ }
				return fallback
			}
			buffer.set(part.value, used); used += part.value.byteLength
		}
	} catch {
		try { void reader.cancel().catch(() => undefined) } catch { /* diagnostic body only */ }
		return fallback
	} finally {
		try { reader.releaseLock() } catch { /* already released */ }
	}
	try {
		const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used))) as unknown
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
			|| JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(['error'])) return fallback
		const error = (parsed as { error?: unknown }).error
		if (typeof error !== 'string') return fallback
		const local = /^DEMO_SIGNER_LOCAL_REFUSAL:([A-Z_]+)$/.exec(error)
		if (local !== null && LOCAL_REFUSAL_REASONS.has(local[1]!)) return `LOCAL_${local[1]}`
		if (error === 'signer observation temporarily unavailable'
			|| error === 'DEMO_SIGNER_READ_TEMPORARILY_UNAVAILABLE') return 'READ_UNAVAILABLE'
		if (/^DEMO_SIGNER_RPC_QUARANTINED(?::|$)/.test(error)
			|| /^DEMO_SIGNER_QUARANTINED(?::|$)/.test(error)) return 'QUARANTINED'
		if (/^DEMO_SIGNER_RPC_(?:AUTHENTICATION|AUTHORITY|BINDING)(?::|$)/.test(error)) return 'AUTH_BINDING'
		if (/^DEMO_SIGNER_JOURNAL_CONFLICT(?::|$)/.test(error)) return 'JOURNAL_CONFLICT'
		return fallback
	} catch {
		return fallback
	}
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
		if (claimed.status === 'incident_rejected') {
			if (claimed.body === DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109) {
				throw new DemoSignerTerminalIncidentCachedRejection20261109()
			}
			if (claimed.body === DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110) {
				throw new DemoSignerTerminalIncidentCachedRejection20261110()
			}
			if (claimed.body === DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111) {
				throw new DemoSignerTerminalIncidentCachedRejection20261111()
			}
			if (claimed.body === DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D) {
				throw new DemoSignerTerminalIncidentCachedRejection20261111R59d()
			}
			if (claimed.body === DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62) {
				throw new DemoSignerTerminalIncidentCachedRejection20261111R62()
			}
			throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: cached body differs')
		}
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
		|| options.enrollment.stateDirectoryIdentity !== undefined
			&& pinned.stateDirectoryIdentity !== options.enrollment.stateDirectoryIdentity
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
		if (!http.ok) throw new Error(`DEMO_SIGNER_RPC_REMOTE_REFUSAL:${await signerRefusalClass(http, signal)}`)
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
