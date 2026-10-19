/**
 * Durable, transport-neutral recovery for one exact demo SIG_ALL swap.
 *
 * The store is injected deliberately: there is no in-memory production fallback. Persisted records
 * contain the operation identity, opaque NUT-07-style state references, and the exact blinded
 * outputs, but never proofs, witnesses, secrets, unblinding factors, or mint signatures. A response
 * is represented durably only by a digest and non-bearer metadata.
 *
 * An uncertain call is never retried. Accepted V2 recovery may terminalize only an exact completed
 * response; `safe_to_retry` and legacy `retry_ready` evidence map to manual intervention because the
 * accepted mint contract has no independently verified retry fence. This preserves old durable bytes
 * without turning them into authority for a second mint submission.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { parseP2PKSecret, proofPoint, type BlindedMessage, type BlindedSignature } from './nut-client'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoSigAllSettlementCutoff,
	type DemoSigAllMintPort,
	type DemoSigAllSwapRequest,
} from './demo-sigall-settlement'

export type DemoSigAllAttemptState = 'prepared' | 'attempting' | 'ambiguous' | 'retry_ready' | 'succeeded'

export interface DemoSigAllTerminalMetadata {
	schema: 'COCO_DEMO_SIGALL_TERMINAL_V1'
	requestDigest: string
	responseDigest: string
	outputCount: number
	amountTotal: number
	keysetIds: string[]
	source: 'mint_response' | 'exact_recovery'
	completedAt: number
}

export interface DemoSigAllRecoveryRecord {
	schema: 'COCO_DEMO_SIGALL_RECOVERY_V1'
	revision: number
	scope: string
	operationRoot: string
	requestDigest: string
	mintUrl: string
	operationId: string
	locktime: number
	cashuSigAllDigest: string
	recipientCapabilityDigest: string
	/** Exact compressed 33-byte NUT-07 proof Ys, never proofs or secrets. */
	proofStateRefs: string[]
	/** Exact recipient-created blinded messages. Openings remain solely in the recipient wallet. */
	blindedOutputs: BlindedMessage[]
	state: DemoSigAllAttemptState
	attemptNumber: number
	preparedAt: number
	updatedAt: number
	/** Digest of the authoritative reconciliation/fence receipt; the receipt itself is not retained. */
	reconciliationDigest?: string
	terminal?: DemoSigAllTerminalMetadata
}

/** The backend must make both operations atomic across processes and restarts. */
export interface DemoSigAllRecoveryStore {
	createOrGet(record: DemoSigAllRecoveryRecord): Promise<{ record: DemoSigAllRecoveryRecord; created: boolean }>
	read(scope: string): Promise<DemoSigAllRecoveryRecord | null>
	compareAndSwap(scope: string, expectedRevision: number, next: DemoSigAllRecoveryRecord): Promise<boolean>
}

export interface DemoSigAllReconciliationQuery {
	schema: 'COCO_DEMO_SIGALL_RECONCILIATION_QUERY_V1'
	scope: string
	operationRoot: string
	requestDigest: string
	mintUrl: string
	proofStateRefs: string[]
	blindedOutputs: BlindedMessage[]
}

export type DemoSigAllReconciliation =
	| { status: 'completed'; signatures: BlindedSignature[] }
	| {
		status: 'safe_to_retry'
		/**
		 * An opaque receipt from an authoritative reconciliation barrier. Its digest is persisted.
		 * Returning this status promises the earlier request cannot subsequently commit.
		 */
		reconciliationId: string
	}
	| { status: 'indeterminate'; reasonCode: string }

/** NUT-07/NUT-09-like recovery, abstracted away from HTTP and wallet custody. */
export interface DemoSigAllRecoveryMintStatePort {
	reconcileExact(query: DemoSigAllReconciliationQuery): Promise<DemoSigAllReconciliation>
}

/**
 * Read-only recovery for a response that is already known to have completed. The implementation
 * must never submit or retry the spend. It exists to close the crash window between terminalizing
 * the mint operation and delivering the blinded signatures to the recipient-private journal.
 */
export interface DemoSigAllTerminalResponsePort {
	restoreCompleted(query: DemoSigAllReconciliationQuery): Promise<{ signatures: BlindedSignature[] } | null>
}

export class DemoSigAllRecoveryRefusedError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoSigAllRecoveryRefusedError'
		this.code = code
	}
}

export type DemoSigAllSubmitResult =
	| { status: 'submitted'; signatures: BlindedSignature[]; terminal: DemoSigAllTerminalMetadata }
	| { status: 'terminal_replay'; terminal: DemoSigAllTerminalMetadata }

export type DemoSigAllRecoveryResult =
	| { status: 'not_attempted' }
	| { status: 'retry_ready' }
	| { status: 'retry_authorized'; reconciliationDigest: string }
	| { status: 'recovered'; signatures: BlindedSignature[]; terminal: DemoSigAllTerminalMetadata }
	| { status: 'terminal_replay'; terminal: DemoSigAllTerminalMetadata }
	| { status: 'indeterminate'; reasonCode: string }

export type DemoSigAllRecoveryResultV2 =
	| Exclude<DemoSigAllRecoveryResult, { status: 'retry_ready' | 'retry_authorized' }>
	| { status: 'manual_intervention_required'; operationId: string; reason: 'unverified_retry_fence' }

export interface DemoSigAllDurableRequest {
	scope: string
	operationRoot: string
	request: DemoSigAllSwapRequest
	proofStateRefs: string[]
}

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_POINT = /^(?:02|03)[0-9a-f]{64}$/

function refuse(code: string, message: string): never {
	throw new DemoSigAllRecoveryRefusedError(code, message)
}

function hash(value: string): string {
	return bytesToHex(sha256(utf8ToBytes(value)))
}

function cloneOutputs(outputs: readonly BlindedMessage[]): BlindedMessage[] {
	return outputs.map(({ amount, id, B_ }) => ({ amount, id, B_ }))
}

/** Detach mint-owned response objects before any validation, hashing, or durable-store await. */
function cloneSignatures(signatures: readonly BlindedSignature[]): BlindedSignature[] {
	return signatures.map((signature) => ({
		amount: signature.amount,
		id: signature.id,
		C_: signature.C_,
		...(signature.dleq === undefined ? {} : {
			dleq: {
				e: signature.dleq.e,
				s: signature.dleq.s,
				...(signature.dleq.r === undefined ? {} : { r: signature.dleq.r }),
			},
		}),
	}))
}

function cloneTerminal(terminal: DemoSigAllTerminalMetadata): DemoSigAllTerminalMetadata {
	return { ...terminal, keysetIds: [...terminal.keysetIds] }
}

function cloneRecord(record: DemoSigAllRecoveryRecord): DemoSigAllRecoveryRecord {
	return {
		...record,
		proofStateRefs: [...record.proofStateRefs],
		blindedOutputs: cloneOutputs(record.blindedOutputs),
		terminal: record.terminal === undefined ? undefined : cloneTerminal(record.terminal),
	}
}

function requireText(value: string, field: string): void {
	if (value.length === 0 || value.trim() !== value) refuse('DEMO_SIGALL_RECOVERY_INVALID', `${field} must be non-empty and trimmed`)
}

function canonicalRequest(request: DemoSigAllSwapRequest): Record<string, unknown> {
	return {
		schema: request.schema,
		mintUrl: request.mintUrl,
		operationId: request.operationId,
		locktime: request.locktime,
		packageDigest: request.packageDigest,
		cashuSigAllDigest: request.cashuSigAllDigest,
		recipientCapabilityDigest: request.recipientCapabilityDigest,
		mintSeal: {
			mintUrl: request.mintSeal.mintUrl,
			mintPublicKey: request.mintSeal.mintPublicKey,
			serverVersion: request.mintSeal.serverVersion,
			activeSatKeysetId: request.mintSeal.activeSatKeysetId,
			denominationKeyDigest: request.mintSeal.denominationKeyDigest,
			denominationAmounts: [...request.mintSeal.denominationAmounts],
			inputFeePpk: request.mintSeal.inputFeePpk,
			nuts: [...request.mintSeal.nuts],
		},
		inputs: request.inputs.map((input) => ({
			amount: input.amount,
			id: input.id,
			secret: input.secret,
			C: input.C,
			// A fresh FROST run may produce a different valid Schnorr witness for the exact
			// same SIG_ALL digest. The witness is authorization evidence, not request
			// identity: packageDigest and cashuSigAllDigest already bind every input and
			// output byte it authorizes. Omitting it lets an ambiguous operation reconcile
			// after restart without weakening the immutable spend/package binding.
			dleq: input.dleq === undefined ? null : { e: input.dleq.e, s: input.dleq.s, r: input.dleq.r ?? null },
		})),
		outputs: cloneOutputs(request.outputs),
	}
}

/** Hashes the complete wire-relevant request; the canonical request itself is never persisted here. */
export function demoSigAllExactRequestDigest(request: DemoSigAllSwapRequest): string {
	return hash(JSON.stringify(canonicalRequest(request)))
}

function validateDurableRequest(value: DemoSigAllDurableRequest): { requestDigest: string } {
	requireText(value.scope, 'scope')
	if (!HEX_32.test(value.operationRoot) || value.operationRoot !== value.request.packageDigest) {
		refuse('DEMO_SIGALL_RECOVERY_ROOT', 'operation root must be the exact package digest')
	}
	if (value.request.schema !== 'COCO_DEMO_SIGALL_SWAP_V1') refuse('DEMO_SIGALL_RECOVERY_REQUEST', 'unsupported swap schema')
	requireText(value.request.mintUrl, 'request.mintUrl')
	requireText(value.request.operationId, 'request.operationId')
	if (!Number.isSafeInteger(value.request.locktime) || value.request.locktime <= 0) {
		refuse('DEMO_SIGALL_RECOVERY_REQUEST', 'request locktime must be a positive Unix-seconds integer')
	}
	if (!HEX_32.test(value.request.cashuSigAllDigest) || !HEX_32.test(value.request.recipientCapabilityDigest)) {
		refuse('DEMO_SIGALL_RECOVERY_REQUEST', 'request digests must be lowercase 32-byte hex')
	}
	if (value.request.inputs.length === 0 || value.request.outputs.length === 0) {
		refuse('DEMO_SIGALL_RECOVERY_REQUEST', 'inputs and outputs must be non-empty')
	}
	if (value.proofStateRefs.length !== value.request.inputs.length || new Set(value.proofStateRefs).size !== value.proofStateRefs.length || value.proofStateRefs.some((ref) => !COMPRESSED_POINT.test(ref))) {
		refuse('DEMO_SIGALL_RECOVERY_STATE_REFS', 'one unique lowercase compressed NUT-07 proof Y is required per input')
	}
	for (const [index, input] of value.request.inputs.entries()) {
		const parsed = parseP2PKSecret(input.secret)
		const sigflag = parsed?.tags.find(([name]) => name === 'sigflag')?.[1]
		const inputLocktime = Number(parsed?.tags.find(([name]) => name === 'locktime')?.[1])
		if (parsed === null || sigflag !== 'SIG_ALL' || inputLocktime !== value.request.locktime) {
			refuse('DEMO_SIGALL_RECOVERY_REQUEST', `input ${index} does not bind the exact request locktime under SIG_ALL`)
		}
		let expected: string
		try {
			expected = bytesToHex(proofPoint(input).toBytes(true))
		} catch {
			return refuse('DEMO_SIGALL_RECOVERY_STATE_REFS', `input ${index} cannot produce a NUT-07 proof Y`)
		}
		if (value.proofStateRefs[index] !== expected) {
			refuse('DEMO_SIGALL_RECOVERY_STATE_REFS', `proof state reference ${index} is not the NUT-07 Y for its exact input secret`)
		}
	}
	for (const [index, output] of value.request.outputs.entries()) {
		if (!Number.isSafeInteger(output.amount) || output.amount <= 0 || output.id.length === 0 || !COMPRESSED_POINT.test(output.B_)) {
			refuse('DEMO_SIGALL_RECOVERY_OUTPUT', `output ${index} is malformed`)
		}
	}
	return { requestDigest: demoSigAllExactRequestDigest(value.request) }
}

function exactlyOneTag(tags: string[][], name: string, inputIndex: number): string {
	const matches = tags.filter(([tag]) => tag === name)
	if (matches.length !== 1 || matches[0]?.length !== 2 || matches[0]?.[1] === undefined) {
		refuse('DEMO_SIGALL_REFUND_PATH', `input ${inputIndex} must contain exactly one ${name} tag`)
	}
	return matches[0]![1]!
}

/**
 * Prove that a durable submission is the one-signature, distinct-key NUT-11 REFUND path. This is
 * deliberately derived from the exact request bytes rather than a caller-provided mode flag: a
 * late two-signature MAIN witness must never gain access to the post-locktime submitter.
 */
function validateRefundPath(request: DemoSigAllSwapRequest): void {
	if (request.inputs.length === 0 || request.outputs.length === 0) {
		refuse('DEMO_SIGALL_REFUND_PATH', 'refund inputs and outputs must be non-empty')
	}
	if (demoCashuSigAllDigest(request.inputs, request.outputs) !== request.cashuSigAllDigest) {
		refuse('DEMO_SIGALL_REFUND_PATH', 'refund request digest does not bind the exact inputs and outputs')
	}
	let refundPublicKey = ''
	let mainPublicKey = ''
	let committeePublicKey = ''
	for (const [index, input] of request.inputs.entries()) {
		const parsed = parseP2PKSecret(input.secret)
		if (parsed === null) refuse('DEMO_SIGALL_REFUND_PATH', `input ${index} is not a P2PK proof`)
		const inputCommittee = exactlyOneTag(parsed.tags, 'pubkeys', index)
		const inputRefund = exactlyOneTag(parsed.tags, 'refund', index)
		const locktimeText = exactlyOneTag(parsed.tags, 'locktime', index)
		const sigflag = exactlyOneTag(parsed.tags, 'sigflag', index)
		const locktime = Number(locktimeText)
		if (sigflag !== 'SIG_ALL' || locktime !== request.locktime) {
			refuse('DEMO_SIGALL_REFUND_PATH', `input ${index} is not the exact SIG_ALL refund lock`)
		}
		if (!COMPRESSED_POINT.test(parsed.data)
			|| !COMPRESSED_POINT.test(inputCommittee)
			|| !COMPRESSED_POINT.test(inputRefund)) {
			refuse('DEMO_SIGALL_REFUND_PATH', `input ${index} contains an invalid lock key`)
		}
		if (index === 0) {
			mainPublicKey = parsed.data
			committeePublicKey = inputCommittee
			refundPublicKey = inputRefund
			if (refundPublicKey === mainPublicKey || refundPublicKey === committeePublicKey) {
				refuse('DEMO_SIGALL_REFUND_PATH', 'refund key must be distinct from MAIN authorization keys')
			}
		} else if (parsed.data !== mainPublicKey
			|| inputCommittee !== committeePublicKey
			|| inputRefund !== refundPublicKey) {
			refuse('DEMO_SIGALL_REFUND_PATH', `input ${index} changes the exact refund lock keys`)
		}
		let rebuilt: string
		try {
			rebuilt = buildDemoSigAllSecret({
				nonce: parsed.nonce,
				bidderPublicKey: mainPublicKey,
				committeePublicKey,
				locktime: request.locktime,
				refundPublicKey,
			})
		} catch {
			return refuse('DEMO_SIGALL_REFUND_PATH', `input ${index} has a non-canonical refund lock`)
		}
		if (rebuilt !== input.secret) refuse('DEMO_SIGALL_REFUND_PATH', `input ${index} changes the canonical refund lock`)
		if (index > 0 && input.witness !== undefined) {
			refuse('DEMO_SIGALL_REFUND_PATH', 'only the first refund input may contain a witness')
		}
	}
	const witnessText = request.inputs[0]!.witness
	if (typeof witnessText !== 'string') refuse('DEMO_SIGALL_REFUND_PATH', 'refund witness is missing')
	let witness: unknown
	try { witness = JSON.parse(witnessText) }
	catch { return refuse('DEMO_SIGALL_REFUND_PATH', 'refund witness is not valid JSON') }
	if (typeof witness !== 'object' || witness === null || Array.isArray(witness)
		|| JSON.stringify(Object.keys(witness).sort()) !== JSON.stringify(['signatures'])) {
		refuse('DEMO_SIGALL_REFUND_PATH', 'refund witness must contain only signatures')
	}
	const signatures = (witness as { signatures?: unknown }).signatures
	if (!Array.isArray(signatures) || signatures.length !== 1 || typeof signatures[0] !== 'string' || !HEX_64.test(signatures[0])) {
		refuse('DEMO_SIGALL_REFUND_PATH', 'refund witness must contain exactly one Schnorr signature')
	}
	try {
		if (!schnorr.verify(hexToBytes(signatures[0]), hexToBytes(request.cashuSigAllDigest), hexToBytes(refundPublicKey.slice(2)))) {
			refuse('DEMO_SIGALL_REFUND_PATH', 'refund witness is not signed by the exact refund key')
		}
	} catch (error) {
		if (error instanceof DemoSigAllRecoveryRefusedError) throw error
		refuse('DEMO_SIGALL_REFUND_PATH', 'refund witness signature could not be verified')
	}
}

function initialRecord(value: DemoSigAllDurableRequest, requestDigest: string, now: number): DemoSigAllRecoveryRecord {
	return {
		schema: 'COCO_DEMO_SIGALL_RECOVERY_V1',
		revision: 0,
		scope: value.scope,
		operationRoot: value.operationRoot,
		requestDigest,
		mintUrl: value.request.mintUrl,
		operationId: value.request.operationId,
		locktime: value.request.locktime,
		cashuSigAllDigest: value.request.cashuSigAllDigest,
		recipientCapabilityDigest: value.request.recipientCapabilityDigest,
		proofStateRefs: [...value.proofStateRefs],
		blindedOutputs: cloneOutputs(value.request.outputs),
		state: 'prepared',
		attemptNumber: 0,
		preparedAt: now,
		updatedAt: now,
	}
}

function assertExactIdentity(record: DemoSigAllRecoveryRecord, value: DemoSigAllDurableRequest, requestDigest: string): void {
	if (record.schema !== 'COCO_DEMO_SIGALL_RECOVERY_V1' || record.scope !== value.scope) {
		refuse('DEMO_SIGALL_RECOVERY_CORRUPT', 'stored record schema or scope is invalid')
	}
	if (record.operationRoot !== value.operationRoot) {
		refuse('DEMO_SIGALL_RECOVERY_ROOT_CONFLICT', 'scope is permanently bound to a different operation root')
	}
	if (
		record.requestDigest !== requestDigest ||
		record.mintUrl !== value.request.mintUrl ||
		record.operationId !== value.request.operationId ||
		record.locktime !== value.request.locktime ||
		record.cashuSigAllDigest !== value.request.cashuSigAllDigest ||
		record.recipientCapabilityDigest !== value.request.recipientCapabilityDigest ||
		JSON.stringify(record.proofStateRefs) !== JSON.stringify(value.proofStateRefs) ||
		JSON.stringify(record.blindedOutputs) !== JSON.stringify(value.request.outputs)
	) refuse('DEMO_SIGALL_RECOVERY_REQUEST_CONFLICT', 'same root was presented with a different exact request')
}

async function prepare(
	store: DemoSigAllRecoveryStore,
	value: DemoSigAllDurableRequest,
	now: number,
): Promise<{ record: DemoSigAllRecoveryRecord; requestDigest: string }> {
	const { requestDigest } = validateDurableRequest(value)
	const result = await store.createOrGet(initialRecord(value, requestDigest, now))
	assertExactIdentity(result.record, value, requestDigest)
	return { record: cloneRecord(result.record), requestDigest }
}

async function cas(
	store: DemoSigAllRecoveryStore,
	current: DemoSigAllRecoveryRecord,
	patch: Partial<DemoSigAllRecoveryRecord>,
	now: number,
): Promise<DemoSigAllRecoveryRecord> {
	const next = cloneRecord({ ...current, ...patch, revision: current.revision + 1, updatedAt: now })
	if (!await store.compareAndSwap(current.scope, current.revision, next)) {
		refuse('DEMO_SIGALL_RECOVERY_STALE', 'another process changed the operation record')
	}
	return next
}

function validateResponse(outputs: readonly BlindedMessage[], signatures: readonly BlindedSignature[]): void {
	if (signatures.length !== outputs.length) refuse('DEMO_SIGALL_RECOVERY_RESPONSE', 'response signature count differs from the exact outputs')
	for (const [index, signature] of signatures.entries()) {
		const output = outputs[index]!
		if (signature.amount !== output.amount || signature.id !== output.id || !COMPRESSED_POINT.test(signature.C_)) {
			refuse('DEMO_SIGALL_RECOVERY_RESPONSE', `response signature ${index} does not match the exact output`)
		}
		if (signature.dleq !== undefined && (!HEX_32.test(signature.dleq.e) || !HEX_32.test(signature.dleq.s))) {
			refuse('DEMO_SIGALL_RECOVERY_RESPONSE', `response signature ${index} has malformed DLEQ scalars`)
		}
	}
}

export function demoSigAllResponseDigest(signatures: readonly BlindedSignature[]): string {
	return hash(JSON.stringify(signatures.map((signature) => ({
		amount: signature.amount,
		id: signature.id,
		C_: signature.C_,
		dleq: signature.dleq === undefined ? null : { e: signature.dleq.e, s: signature.dleq.s },
	}))))
}

function terminalMetadata(
	record: DemoSigAllRecoveryRecord,
	signatures: readonly BlindedSignature[],
	source: DemoSigAllTerminalMetadata['source'],
	now: number,
): DemoSigAllTerminalMetadata {
	return {
		schema: 'COCO_DEMO_SIGALL_TERMINAL_V1',
		requestDigest: record.requestDigest,
		responseDigest: demoSigAllResponseDigest(signatures),
		outputCount: signatures.length,
		amountTotal: signatures.reduce((total, signature) => total + signature.amount, 0),
		keysetIds: [...new Set(signatures.map((signature) => signature.id))].sort(),
		source,
		completedAt: now,
	}
}

function validatedTerminal(record: DemoSigAllRecoveryRecord): DemoSigAllTerminalMetadata {
	const terminal = record.terminal
	if (record.state !== 'succeeded' || terminal === undefined) {
		refuse('DEMO_SIGALL_RECOVERY_NOT_TERMINAL', 'completed-response restore requires a succeeded terminal record')
	}
	const expectedKeysets = [...new Set(record.blindedOutputs.map((output) => output.id))].sort()
	const expectedAmount = record.blindedOutputs.reduce((total, output) => total + output.amount, 0)
	if (terminal.schema !== 'COCO_DEMO_SIGALL_TERMINAL_V1'
		|| !HEX_32.test(record.requestDigest)
		|| terminal.requestDigest !== record.requestDigest
		|| !HEX_32.test(terminal.responseDigest)
		|| terminal.outputCount !== record.blindedOutputs.length
		|| terminal.amountTotal !== expectedAmount
		|| JSON.stringify(terminal.keysetIds) !== JSON.stringify(expectedKeysets)
		|| (terminal.source !== 'mint_response' && terminal.source !== 'exact_recovery')
		|| !Number.isSafeInteger(terminal.completedAt) || terminal.completedAt < 0) {
		refuse('DEMO_SIGALL_RECOVERY_CORRUPT', 'succeeded record has inconsistent terminal metadata')
	}
	return cloneTerminal(terminal)
}

/**
 * Make one exact submission. Only `prepared` admits the first attempt. Legacy `retry_ready` records
 * remain readable for recovery, but never authorize a submission. All uncertain failures become
 * `ambiguous`.
 */
export async function submitDemoSigAllSwap(options: {
	store: DemoSigAllRecoveryStore
	mint: DemoSigAllMintPort
	value: DemoSigAllDurableRequest
	now?: () => number
	nowSeconds?: () => number
}): Promise<DemoSigAllSubmitResult> {
	let value: DemoSigAllDurableRequest
	try {
		value = structuredClone(options.value)
	} catch {
		return refuse('DEMO_SIGALL_RECOVERY_NOT_CLONEABLE', 'durable request must be immutable cloneable data')
	}
	const store = options.store
	const mint = options.mint
	const clock = options.now ?? Date.now
	const clockSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
	let { record } = await prepare(store, value, clock())
	if (record.state === 'succeeded') {
		return { status: 'terminal_replay', terminal: validatedTerminal(record) }
	}
	if (record.state === 'attempting' || record.state === 'ambiguous' || record.state === 'retry_ready') {
		refuse('DEMO_SIGALL_RECOVERY_AMBIGUOUS', 'exact reconciliation is required before any resubmission')
	}
	const settlementCutoff = demoSigAllSettlementCutoff(value.request.locktime)
	if (clockSeconds() >= settlementCutoff) {
		refuse('DEMO_SIGALL_RECOVERY_CUTOFF', 'exact request reached the settlement safety cutoff before attempt admission')
	}
	if (record.state !== 'prepared') refuse('DEMO_SIGALL_RECOVERY_CORRUPT', 'unsupported attempt state')
	record = await cas(store, record, {
		state: 'attempting',
		attemptNumber: record.attemptNumber + 1,
		reconciliationDigest: undefined,
	}, clock())
	if (clockSeconds() >= settlementCutoff) {
		// No mint I/O occurred, but the accepted V2 policy has no retry fence. Preserve the
		// admitted attempt as ambiguous rather than minting a local retry capability.
		await cas(store, record, { state: 'ambiguous', reconciliationDigest: undefined }, clock())
		refuse('DEMO_SIGALL_RECOVERY_CUTOFF', 'durable attempt preparation reached the settlement safety cutoff before mint I/O')
	}
	let signatures: BlindedSignature[]
	try {
		const result = await mint.swapExact(structuredClone(value.request))
		// The mint adapter may retain and later mutate its response. Detach it before the
		// terminal CAS yields so the committed digest and returned bytes stay identical.
		signatures = cloneSignatures(result.signatures)
		validateResponse(record.blindedOutputs, signatures)
	} catch (error) {
		await cas(store, record, { state: 'ambiguous' }, clock()).catch(() => undefined)
		if (error instanceof DemoSigAllRecoveryRefusedError) throw error
		return refuse('DEMO_SIGALL_RECOVERY_AMBIGUOUS', 'mint outcome is uncertain; exact reconciliation is mandatory')
	}
	const terminal = terminalMetadata(record, signatures, 'mint_response', clock())
	await cas(store, record, { state: 'succeeded', terminal }, clock())
	return { status: 'submitted', signatures, terminal }
}

/**
 * Make one exact post-locktime REFUND submission. Unlike the MAIN submitter, this path is admitted
 * only after parsing and cryptographically verifying the one-signature refund witness. The durable
 * state machine is otherwise identical: an uncertain mint response becomes ambiguous, never an
 * implicit retry, and a terminal record is replayed without another spend call.
 */
export async function submitDemoSigAllRefundSwap(options: {
	store: DemoSigAllRecoveryStore
	mint: DemoSigAllMintPort
	value: DemoSigAllDurableRequest
	now?: () => number
	nowSeconds?: () => number
}): Promise<DemoSigAllSubmitResult> {
	let value: DemoSigAllDurableRequest
	try {
		value = structuredClone(options.value)
	} catch {
		return refuse('DEMO_SIGALL_RECOVERY_NOT_CLONEABLE', 'durable refund request must be immutable cloneable data')
	}
	const store = options.store
	const mint = options.mint
	const clock = options.now ?? Date.now
	const clockSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
	validateRefundPath(value.request)
	if (clockSeconds() < value.request.locktime) {
		refuse('DEMO_SIGALL_REFUND_NOT_EXPIRED', 'refund path is not active before locktime')
	}
	let { record } = await prepare(store, value, clock())
	if (record.state === 'succeeded') {
		return { status: 'terminal_replay', terminal: validatedTerminal(record) }
	}
	if (record.state === 'attempting' || record.state === 'ambiguous' || record.state === 'retry_ready') {
		refuse('DEMO_SIGALL_RECOVERY_AMBIGUOUS', 'exact reconciliation is required before any refund resubmission')
	}
	if (record.state !== 'prepared') {
		refuse('DEMO_SIGALL_RECOVERY_CORRUPT', 'unsupported refund attempt state')
	}
	record = await cas(store, record, {
		state: 'attempting',
		attemptNumber: record.attemptNumber + 1,
		reconciliationDigest: undefined,
	}, clock())
	validateRefundPath(value.request)
	if (clockSeconds() < value.request.locktime) {
		// A backward-moving clock is not retry authority. Keep the admitted attempt fail-closed.
		await cas(store, record, { state: 'ambiguous', reconciliationDigest: undefined }, clock())
		refuse('DEMO_SIGALL_REFUND_NOT_EXPIRED', 'clock moved before locktime prior to refund mint I/O')
	}
	let signatures: BlindedSignature[]
	try {
		const result = await mint.swapExact(structuredClone(value.request))
		signatures = cloneSignatures(result.signatures)
		validateResponse(record.blindedOutputs, signatures)
	} catch (error) {
		await cas(store, record, { state: 'ambiguous' }, clock()).catch(() => undefined)
		if (error instanceof DemoSigAllRecoveryRefusedError) throw error
		return refuse('DEMO_SIGALL_RECOVERY_AMBIGUOUS', 'refund mint outcome is uncertain; exact reconciliation is mandatory')
	}
	const terminal = terminalMetadata(record, signatures, 'mint_response', clock())
	await cas(store, record, { state: 'succeeded', terminal }, clock())
	return { status: 'submitted', signatures, terminal }
}

/**
 * Reconcile an uncertain attempt. This function can recover exact signatures or durably authorize
 * a later retry, but it never invokes the spend port itself.
 */
export async function reconcileDemoSigAllSwap(options: {
	store: DemoSigAllRecoveryStore
	recovery: DemoSigAllRecoveryMintStatePort
	value: DemoSigAllDurableRequest
	now?: () => number
}): Promise<DemoSigAllRecoveryResult> {
	let value: DemoSigAllDurableRequest
	try {
		value = structuredClone(options.value)
	} catch {
		return refuse('DEMO_SIGALL_RECOVERY_NOT_CLONEABLE', 'durable request must be immutable cloneable data')
	}
	const store = options.store
	const recovery = options.recovery
	const clock = options.now ?? Date.now
	let { record } = await prepare(store, value, clock())
	if (record.state === 'succeeded') {
		return { status: 'terminal_replay', terminal: validatedTerminal(record) }
	}
	if (record.state === 'prepared') return { status: 'not_attempted' }
	if (record.state !== 'attempting' && record.state !== 'ambiguous' && record.state !== 'retry_ready') refuse('DEMO_SIGALL_RECOVERY_CORRUPT', 'unsupported attempt state')
	const result = await recovery.reconcileExact({
		schema: 'COCO_DEMO_SIGALL_RECONCILIATION_QUERY_V1',
		scope: record.scope,
		operationRoot: record.operationRoot,
		requestDigest: record.requestDigest,
		mintUrl: record.mintUrl,
		proofStateRefs: [...record.proofStateRefs],
		blindedOutputs: cloneOutputs(record.blindedOutputs),
	})
	if (result.status === 'indeterminate') {
		requireText(result.reasonCode, 'reasonCode')
		if (record.state === 'retry_ready') {
			return { status: 'indeterminate', reasonCode: 'unverified_retry_fence' }
		}
		if (record.state === 'attempting') record = await cas(store, record, { state: 'ambiguous' }, clock())
		return { status: 'indeterminate', reasonCode: result.reasonCode }
	}
	if (result.status === 'safe_to_retry') {
		requireText(result.reconciliationId, 'reconciliationId')
		return { status: 'indeterminate', reasonCode: 'unverified_retry_fence' }
	}
	// As with a direct mint response, reconciliation output remains externally owned until cloned.
	const signatures = cloneSignatures(result.signatures)
	validateResponse(record.blindedOutputs, signatures)
	const terminal = terminalMetadata(record, signatures, 'exact_recovery', clock())
	await cas(store, record, { state: 'succeeded', terminal }, clock())
	return { status: 'recovered', signatures, terminal }
}

/**
 * Accepted V2 public recovery surface. The V1-compatible function above keeps its historical
 * TypeScript union for adjacent callers, but it no longer creates retry authority. This wrapper
 * converts the fail-closed compatibility reason into the exact V2 manual result.
 */
export async function reconcileDemoSigAllSwapV2(
	options: Parameters<typeof reconcileDemoSigAllSwap>[0],
): Promise<DemoSigAllRecoveryResultV2> {
	const operationId = structuredClone(options.value.request.operationId)
	const result = await reconcileDemoSigAllSwap(options)
	if (result.status === 'retry_ready' || result.status === 'retry_authorized'
		|| (result.status === 'indeterminate' && result.reasonCode === 'unverified_retry_fence')) {
		return { status: 'manual_intervention_required', operationId, reason: 'unverified_retry_fence' }
	}
	return result
}

/**
 * Restore blinded signatures after a succeeded operation without making another spend attempt.
 * The exact restored response must hash to the terminal response digest already committed by the
 * recovery store. This returns bearer-adjacent protocol material only in memory.
 */
export async function restoreDemoSigAllTerminalResponse(options: {
	store: DemoSigAllRecoveryStore
	recovery: DemoSigAllTerminalResponsePort
	value: DemoSigAllDurableRequest
	now?: () => number
}): Promise<BlindedSignature[]> {
	let value: DemoSigAllDurableRequest
	try {
		value = structuredClone(options.value)
	} catch {
		return refuse('DEMO_SIGALL_RECOVERY_NOT_CLONEABLE', 'durable request must be immutable cloneable data')
	}
	const store = options.store
	const recovery = options.recovery
	const clock = options.now ?? Date.now
	const { record } = await prepare(store, value, clock())
	const terminal = validatedTerminal(record)
	const restored = await recovery.restoreCompleted({
		schema: 'COCO_DEMO_SIGALL_RECONCILIATION_QUERY_V1',
		scope: record.scope,
		operationRoot: record.operationRoot,
		requestDigest: record.requestDigest,
		mintUrl: record.mintUrl,
		proofStateRefs: [...record.proofStateRefs],
		blindedOutputs: cloneOutputs(record.blindedOutputs),
	})
	if (restored === null) {
		refuse('DEMO_SIGALL_RECOVERY_TERMINAL_UNAVAILABLE', 'mint cannot restore the completed exact response')
	}
	validateResponse(record.blindedOutputs, restored.signatures)
	if (demoSigAllResponseDigest(restored.signatures) !== terminal.responseDigest) {
		refuse('DEMO_SIGALL_RECOVERY_TERMINAL_CONFLICT', 'restored response differs from committed terminal metadata')
	}
	return restored.signatures.map((signature) => ({
		...signature,
		dleq: signature.dleq === undefined ? undefined : { ...signature.dleq },
	}))
}

/**
 * Restore a response from an already-succeeded durable root without reconstructing the bearer
 * request or re-entering the spend/committee path. This is the post-locktime delivery path: it is
 * strictly read-only and validates the recovered response against the terminal digest and exact
 * public blinded outputs already committed before the original mint call.
 */
export async function restoreDemoSigAllTerminalByIdentity(options: {
	store: DemoSigAllRecoveryStore
	recovery: DemoSigAllTerminalResponsePort
	scope: string
	operationRoot: string
}): Promise<{ terminal: DemoSigAllTerminalMetadata; signatures: BlindedSignature[] }> {
	const scope = options.scope
	const operationRoot = options.operationRoot
	const store = options.store
	const recovery = options.recovery
	requireText(scope, 'scope')
	if (!HEX_32.test(operationRoot)) refuse('DEMO_SIGALL_RECOVERY_ROOT', 'operation root must be 32 lowercase hex bytes')
	const stored = await store.read(scope)
	if (stored === null) refuse('DEMO_SIGALL_RECOVERY_NOT_TERMINAL', 'completed-response restore requires a succeeded terminal record')
	const record = cloneRecord(stored)
	if (record.schema !== 'COCO_DEMO_SIGALL_RECOVERY_V1' || record.scope !== scope) {
		refuse('DEMO_SIGALL_RECOVERY_CORRUPT', 'stored record schema or scope is invalid')
	}
	if (record.operationRoot !== operationRoot) {
		refuse('DEMO_SIGALL_RECOVERY_ROOT_CONFLICT', 'scope is permanently bound to a different operation root')
	}
	const terminal = validatedTerminal(record)
	if (record.proofStateRefs.length === 0
		|| new Set(record.proofStateRefs).size !== record.proofStateRefs.length
		|| record.proofStateRefs.some((ref) => !COMPRESSED_POINT.test(ref))) {
		refuse('DEMO_SIGALL_RECOVERY_CORRUPT', 'terminal record has malformed proof state references')
	}
	for (const [index, output] of record.blindedOutputs.entries()) {
		if (!Number.isSafeInteger(output.amount) || output.amount <= 0 || output.id.length === 0 || !COMPRESSED_POINT.test(output.B_)) {
			refuse('DEMO_SIGALL_RECOVERY_CORRUPT', `terminal record output ${index} is malformed`)
		}
	}
	const restored = await recovery.restoreCompleted({
		schema: 'COCO_DEMO_SIGALL_RECONCILIATION_QUERY_V1',
		scope: record.scope,
		operationRoot: record.operationRoot,
		requestDigest: record.requestDigest,
		mintUrl: record.mintUrl,
		proofStateRefs: [...record.proofStateRefs],
		blindedOutputs: cloneOutputs(record.blindedOutputs),
	})
	if (restored === null) refuse('DEMO_SIGALL_RECOVERY_TERMINAL_UNAVAILABLE', 'mint cannot restore the completed exact response')
	validateResponse(record.blindedOutputs, restored.signatures)
	if (demoSigAllResponseDigest(restored.signatures) !== terminal.responseDigest) {
		refuse('DEMO_SIGALL_RECOVERY_TERMINAL_CONFLICT', 'restored response differs from committed terminal metadata')
	}
	return {
		terminal,
		signatures: restored.signatures.map((signature) => ({
			...signature,
			dleq: signature.dleq === undefined ? undefined : { ...signature.dleq },
		})),
	}
}

/** Read sanitized terminal metadata for an exact scope/root; no spend or mint read is performed. */
export async function readDemoSigAllTerminal(options: {
	store: DemoSigAllRecoveryStore
	scope: string
	operationRoot: string
}): Promise<DemoSigAllTerminalMetadata | null> {
	const scope = options.scope
	const operationRoot = options.operationRoot
	const store = options.store
	requireText(scope, 'scope')
	if (!HEX_32.test(operationRoot)) refuse('DEMO_SIGALL_RECOVERY_ROOT', 'operation root must be 32 lowercase hex bytes')
	const record = await store.read(scope)
	if (record === null) return null
	if (record.schema !== 'COCO_DEMO_SIGALL_RECOVERY_V1' || record.scope !== scope) {
		refuse('DEMO_SIGALL_RECOVERY_CORRUPT', 'stored record schema or scope is invalid')
	}
	if (record.operationRoot !== operationRoot) {
		refuse('DEMO_SIGALL_RECOVERY_ROOT_CONFLICT', 'scope is permanently bound to a different operation root')
	}
	if (record.state !== 'succeeded') return null
	return validatedTerminal(record)
}
