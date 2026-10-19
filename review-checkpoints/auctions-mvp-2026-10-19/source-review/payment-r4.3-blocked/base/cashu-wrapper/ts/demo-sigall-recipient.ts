/**
 * Recipient-private preparation and delivery boundary for Coco demo SIG_ALL outputs.
 *
 * The coordinator-facing request contains only blinded messages and a signed public capability.
 * Output secrets, blinding factors, unblinded proofs, and wallet bearer material stay behind the
 * injected recipient-private ports. This file deliberately performs no network calls.
 *
 * The cryptographic ports are trust boundaries: a production implementation must create real
 * Cashu openings, unblind with the sealed denomination keys, and cryptographically verify every
 * final proof. Passing an opaque handle through these ports is not evidence that DLEQ or proof
 * verification happened; that evidence must come from the concrete implementation and live run.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	type DemoDispositionRole,
	type DemoRecipientCapability,
} from './demo-sigall-settlement'
import type { BlindedMessage } from './nut-client'

const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

export interface DemoRecipientIntent {
	schema: 'COCO_DEMO_RECIPIENT_INTENT_V1'
	network: string
	chainId: string
	auctionId: string
	operationId: string
	role: DemoDispositionRole
	mintUrl: string
	unit: string
	recipientPublicKey: string
	/** Exact ordered denominations the recipient agrees to receive. */
	amounts: number[]
}

export interface DemoRecipientKeyset {
	id: string
	unit: string
	keys: Record<string, string>
}

/** The complete object that may cross from the recipient process to the coordinator. */
export interface DemoRecipientCoordinatorRequest {
	capability: DemoRecipientCapability
	outputs: BlindedMessage[]
}

/** A coordinator/mint delivery remains blinded and carries no recipient opening. */
export interface DemoRecipientBlindedSignature {
	amount: number
	id: string
	C_: string
	dleq?: { e: string; s: string }
}

export interface DemoRecipientCoordinatorResponse {
	schema: 'COCO_DEMO_RECIPIENT_RESPONSE_V1'
	operationId: string
	recipientCapabilityDigest: string
	signatures: DemoRecipientBlindedSignature[]
}

/** Safe receipt: it intentionally contains no proof, token, opening, or wallet payload. */
export interface DemoRecipientImportReceipt {
	schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1'
	operationId: string
	role: DemoDispositionRole
	recipientPublicKey: string
	amount: number
	proofCount: number
	imported: true
	alreadyImported: boolean
}

export interface DemoRecipientRoleBinding {
	network: string
	chainId: string
	auctionId: string
	operationId: string
	role: DemoDispositionRole
	recipientPublicKey: string
}

/**
 * Hooks into authenticated auction state. Winner implementations must bind the seller child chosen
 * by the signed bid; refund implementations must bind the bidder's key.
 */
export interface DemoRecipientRoleBindingPort {
	assertWinnerRecipient(binding: DemoRecipientRoleBinding): Promise<void>
	assertRefundRecipient(binding: DemoRecipientRoleBinding): Promise<void>
}

export interface DemoRecipientCapabilitySignerPort {
	signCapability(request: {
		digest: string
		recipientPublicKey: string
		operationId: string
		role: DemoDispositionRole
	}): Promise<string>
}

/** Runs only in the recipient process and returns an opaque reference to private opening data. */
export interface DemoRecipientOutputFactoryPort<OpeningRef> {
	createRecipientOwnedOutput(request: {
		operationId: string
		index: number
		amount: number
		keysetId: string
	}): Promise<{ message: BlindedMessage; privateOpeningRef: OpeningRef }>
}

/** Runs only in the recipient process. UnblindedRef must never cross the public boundary. */
export interface DemoRecipientUnblindingPort<OpeningRef, UnblindedRef> {
	unblindExact(request: {
		operationId: string
		outputs: BlindedMessage[]
		signatures: DemoRecipientBlindedSignature[]
		privateOpeningRefs: OpeningRef[]
		keyset: DemoRecipientKeyset
	}): Promise<UnblindedRef>
}

/**
 * Must perform real cryptographic verification against the exact output plan and denomination
 * keys. It must reject rather than return a handle when any proof is invalid.
 */
export interface DemoRecipientProofVerifierPort<UnblindedRef, VerifiedRef> {
	verifyExact(request: {
		operationId: string
		unblindedRef: UnblindedRef
		outputs: BlindedMessage[]
		keyset: DemoRecipientKeyset
	}): Promise<VerifiedRef>
}

/** The wallet must durably deduplicate idempotencyKey before applying the verified bearer value. */
export interface DemoRecipientWalletPort<VerifiedRef> {
	importVerified(request: {
		idempotencyKey: string
		operationId: string
		role: DemoDispositionRole
		recipientPublicKey: string
		verifiedRef: VerifiedRef
	}): Promise<void>
}

/** Recipient-private durable record. This type must never be serialized to the coordinator. */
export interface DemoRecipientPrivateRecord<OpeningRef> {
	schema: 'COCO_DEMO_RECIPIENT_PRIVATE_RECORD_V1'
	scope: string
	intentDigest: string
	requestDigest: string
	keysetDigest: string
	coordinatorRequest: DemoRecipientCoordinatorRequest
	privateOpeningRefs: OpeningRef[]
	importedResponseDigest?: string
}

/**
 * The implementation must serialize runExclusive across processes/restarts and commit each save
 * durably before returning. That is required for safe restart behavior; an in-memory map is not.
 */
export interface DemoRecipientPrivateJournalPort<OpeningRef> {
	runExclusive<T>(scope: string, run: () => Promise<T>): Promise<T>
	load(scope: string): Promise<DemoRecipientPrivateRecord<OpeningRef> | null>
	savePrepared(scope: string, record: DemoRecipientPrivateRecord<OpeningRef>): Promise<void>
	markImported(scope: string, requestDigest: string, responseDigest: string): Promise<void>
}

export class DemoRecipientRefusedError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoRecipientRefusedError'
		this.code = code
	}
}

function refuse(code: string, message: string): never {
	throw new DemoRecipientRefusedError(code, message)
}

function hashText(value: string): string {
	return bytesToHex(sha256(utf8ToBytes(value)))
}

function requireText(value: string, field: string): void {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
		refuse('DEMO_RECIPIENT_INVALID_TEXT', `${field} must be non-empty and trimmed`)
	}
}

function requirePoint(value: string, field: string): void {
	if (!COMPRESSED_KEY.test(value)) refuse('DEMO_RECIPIENT_INVALID_POINT', `${field} must be lowercase compressed secp256k1 hex`)
}

function requireExactHttpsOrigin(value: string): void {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		return refuse('DEMO_RECIPIENT_MINT_ORIGIN', 'mintUrl must be an exact HTTPS origin')
	}
	if (url.protocol !== 'https:' || value !== url.origin || url.username !== '' || url.password !== '' || url.port !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		refuse('DEMO_RECIPIENT_MINT_ORIGIN', 'mintUrl must be an exact HTTPS origin')
	}
}

function validateIntent(intent: DemoRecipientIntent): void {
	if (intent.schema !== 'COCO_DEMO_RECIPIENT_INTENT_V1') refuse('DEMO_RECIPIENT_SCHEMA', 'unsupported recipient intent')
	for (const [field, value] of Object.entries({
		network: intent.network,
		chainId: intent.chainId,
		auctionId: intent.auctionId,
		operationId: intent.operationId,
		unit: intent.unit,
	})) requireText(value, field)
	if (intent.unit !== 'sat') refuse('DEMO_RECIPIENT_UNIT', 'the demo recipient boundary supports only sat')
	if (intent.role !== 'winner_settlement' && intent.role !== 'refund') refuse('DEMO_RECIPIENT_ROLE', 'unsupported disposition role')
	requireExactHttpsOrigin(intent.mintUrl)
	requirePoint(intent.recipientPublicKey, 'recipientPublicKey')
	if (intent.amounts.length === 0 || intent.amounts.some((amount) => !Number.isSafeInteger(amount) || amount <= 0)) {
		refuse('DEMO_RECIPIENT_AMOUNT', 'amounts must contain positive safe integers')
	}
	const total = intent.amounts.reduce((sum, amount) => sum + amount, 0)
	if (!Number.isSafeInteger(total)) refuse('DEMO_RECIPIENT_AMOUNT', 'output total must be a safe integer')
}

function validateKeyset(keyset: DemoRecipientKeyset, intent: DemoRecipientIntent): string {
	requireText(keyset.id, 'keyset.id')
	if (keyset.unit !== intent.unit) refuse('DEMO_RECIPIENT_KEYSET', 'keyset unit differs from recipient intent')
	const entries = Object.entries(keyset.keys)
	if (entries.length === 0) refuse('DEMO_RECIPIENT_KEYSET', 'keyset must contain denomination keys')
	for (const [denomination, publicKey] of entries) {
		const amount = Number(denomination)
		if (!Number.isSafeInteger(amount) || amount <= 0 || String(amount) !== denomination) {
			refuse('DEMO_RECIPIENT_KEYSET', `invalid denomination ${denomination}`)
		}
		requirePoint(publicKey, `keyset.keys[${denomination}]`)
	}
	for (const amount of intent.amounts) {
		if (!keyset.keys[String(amount)]) refuse('DEMO_RECIPIENT_KEYSET', `missing denomination key for ${amount}`)
	}
	return demoDenominationKeyDigest(keyset.keys)
}

function roleBinding(intent: DemoRecipientIntent): DemoRecipientRoleBinding {
	return {
		network: intent.network,
		chainId: intent.chainId,
		auctionId: intent.auctionId,
		operationId: intent.operationId,
		role: intent.role,
		recipientPublicKey: intent.recipientPublicKey,
	}
}

async function assertRoleBinding(port: DemoRecipientRoleBindingPort, intent: DemoRecipientIntent): Promise<void> {
	if (intent.role === 'winner_settlement') await port.assertWinnerRecipient(roleBinding(intent))
	else await port.assertRefundRecipient(roleBinding(intent))
}

function canonicalIntent(intent: DemoRecipientIntent, keyset: DemoRecipientKeyset, keysetDigest: string): Record<string, unknown> {
	return {
		schema: intent.schema,
		network: intent.network,
		chainId: intent.chainId,
		auctionId: intent.auctionId,
		operationId: intent.operationId,
		role: intent.role,
		mintUrl: intent.mintUrl,
		unit: intent.unit,
		recipientPublicKey: intent.recipientPublicKey,
		amounts: [...intent.amounts],
		keysetId: keyset.id,
		keysetDigest,
	}
}

function scopeFor(intent: DemoRecipientIntent): string {
	return `${intent.network}\u0000${intent.chainId}\u0000${intent.auctionId}\u0000${intent.operationId}`
}

function cloneCoordinatorRequest(request: DemoRecipientCoordinatorRequest): DemoRecipientCoordinatorRequest {
	return {
		capability: { ...request.capability },
		outputs: request.outputs.map((output) => ({ ...output })),
	}
}

function canonicalPublicRequest(request: DemoRecipientCoordinatorRequest): Record<string, unknown> {
	return {
		capability: { ...request.capability },
		outputs: request.outputs.map((output) => ({ amount: output.amount, id: output.id, B_: output.B_ })),
	}
}

function requestDigest(intentDigest: string, request: DemoRecipientCoordinatorRequest): string {
	return hashText(JSON.stringify({ intentDigest, request: canonicalPublicRequest(request) }))
}

function validateStoredRecord<OpeningRef>(record: DemoRecipientPrivateRecord<OpeningRef>, expectedScope: string): void {
	if (record.schema !== 'COCO_DEMO_RECIPIENT_PRIVATE_RECORD_V1' || record.scope !== expectedScope) {
		refuse('DEMO_RECIPIENT_JOURNAL_CORRUPT', 'private journal scope or schema mismatch')
	}
	if (!HEX_32.test(record.intentDigest) || !HEX_32.test(record.requestDigest) || !HEX_32.test(record.keysetDigest)) {
		refuse('DEMO_RECIPIENT_JOURNAL_CORRUPT', 'private journal digest is malformed')
	}
	if (requestDigest(record.intentDigest, record.coordinatorRequest) !== record.requestDigest) {
		refuse('DEMO_RECIPIENT_JOURNAL_CORRUPT', 'stored coordinator request no longer matches its digest')
	}
	if (record.privateOpeningRefs.length !== record.coordinatorRequest.outputs.length) {
		refuse('DEMO_RECIPIENT_JOURNAL_CORRUPT', 'stored opening count differs from output count')
	}
	if (record.importedResponseDigest !== undefined && !HEX_32.test(record.importedResponseDigest)) {
		refuse('DEMO_RECIPIENT_JOURNAL_CORRUPT', 'stored response digest is malformed')
	}
}

function verifyCapabilitySignature(capability: DemoRecipientCapability): void {
	if (!HEX_64.test(capability.signature)) refuse('DEMO_RECIPIENT_SIGNATURE', 'capability signature must be 64 lowercase hex bytes')
	try {
		const digest = demoRecipientCapabilityDigest(capability)
		if (!schnorr.verify(hexToBytes(capability.signature), hexToBytes(digest), hexToBytes(capability.recipientPublicKey.slice(2)))) {
			refuse('DEMO_RECIPIENT_SIGNATURE', 'capability signature is not from the selected recipient')
		}
	} catch (error) {
		if (error instanceof DemoRecipientRefusedError) throw error
		refuse('DEMO_RECIPIENT_SIGNATURE', 'capability signature could not be verified')
	}
}

export async function prepareDemoSigAllRecipientOutputs<OpeningRef>(options: {
	intent: DemoRecipientIntent
	keyset: DemoRecipientKeyset
	roleBinding: DemoRecipientRoleBindingPort
	signer: DemoRecipientCapabilitySignerPort
	outputFactory: DemoRecipientOutputFactoryPort<OpeningRef>
	journal: DemoRecipientPrivateJournalPort<OpeningRef>
}): Promise<DemoRecipientCoordinatorRequest> {
	let intent: DemoRecipientIntent
	let keyset: DemoRecipientKeyset
	try {
		intent = structuredClone(options.intent)
		keyset = structuredClone(options.keyset)
	} catch {
		return refuse('DEMO_RECIPIENT_NOT_CLONEABLE', 'recipient intent and keyset must be immutable cloneable data')
	}
	const roleBinding = options.roleBinding
	const signer = options.signer
	const outputFactory = options.outputFactory
	const journal = options.journal
	validateIntent(intent)
	const keysetDigest = validateKeyset(keyset, intent)
	const intentDigest = hashText(JSON.stringify(canonicalIntent(intent, keyset, keysetDigest)))
	const scope = scopeFor(intent)
	return journal.runExclusive(scope, async () => {
		await assertRoleBinding(roleBinding, intent)
		const existing = await journal.load(scope)
		if (existing) {
			validateStoredRecord(existing, scope)
			if (existing.intentDigest !== intentDigest || existing.keysetDigest !== keysetDigest) {
				refuse('DEMO_RECIPIENT_OPERATION_CONFLICT', 'operation already prepared for a different recipient intent or keyset')
			}
			return cloneCoordinatorRequest(existing.coordinatorRequest)
		}

		const prepared = await Promise.all(intent.amounts.map(async (amount, index) => {
			const output = await outputFactory.createRecipientOwnedOutput({
				operationId: intent.operationId,
				index,
				amount,
				keysetId: keyset.id,
			})
			if (output.message.amount !== amount || output.message.id !== keyset.id) {
				refuse('DEMO_RECIPIENT_OUTPUT_SCOPE', `output ${index} differs from the exact amount or keyset request`)
			}
			requirePoint(output.message.B_, `outputs[${index}].B_`)
			return output
		}))
		const outputs = prepared.map(({ message }) => ({ ...message }))
		if (new Set(outputs.map(({ B_ }) => B_)).size !== outputs.length) {
			refuse('DEMO_RECIPIENT_DUPLICATE_OUTPUT', 'every blinded message must be unique')
		}
		const capabilityBase: DemoRecipientCapability = {
			schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1',
			network: intent.network,
			chainId: intent.chainId,
			auctionId: intent.auctionId,
			operationId: intent.operationId,
			role: intent.role,
			mintUrl: intent.mintUrl,
			unit: intent.unit,
			recipientPublicKey: intent.recipientPublicKey,
			outputsDigest: demoOutputsDigest(outputs),
			signature: '00'.repeat(64),
		}
		const digest = demoRecipientCapabilityDigest(capabilityBase)
		const signature = await signer.signCapability({
			digest,
			recipientPublicKey: intent.recipientPublicKey,
			operationId: intent.operationId,
			role: intent.role,
		})
		const coordinatorRequest: DemoRecipientCoordinatorRequest = {
			capability: { ...capabilityBase, signature },
			outputs,
		}
		verifyCapabilitySignature(coordinatorRequest.capability)
		const exactRequestDigest = requestDigest(intentDigest, coordinatorRequest)
		await journal.savePrepared(scope, {
			schema: 'COCO_DEMO_RECIPIENT_PRIVATE_RECORD_V1',
			scope,
			intentDigest,
			requestDigest: exactRequestDigest,
			keysetDigest,
			coordinatorRequest: cloneCoordinatorRequest(coordinatorRequest),
			privateOpeningRefs: prepared.map(({ privateOpeningRef }) => privateOpeningRef),
		})
		return cloneCoordinatorRequest(coordinatorRequest)
	})
}

function validateResponse(
	response: DemoRecipientCoordinatorResponse,
	record: DemoRecipientPrivateRecord<unknown>,
): string {
	if (response.schema !== 'COCO_DEMO_RECIPIENT_RESPONSE_V1') refuse('DEMO_RECIPIENT_RESPONSE_SCHEMA', 'unsupported recipient response')
	const capability = record.coordinatorRequest.capability
	if (response.operationId !== capability.operationId) refuse('DEMO_RECIPIENT_RESPONSE_SCOPE', 'response operation differs from prepared operation')
	if (!HEX_32.test(response.recipientCapabilityDigest) || response.recipientCapabilityDigest !== demoRecipientCapabilityDigest(capability)) {
		refuse('DEMO_RECIPIENT_WRONG_RECIPIENT', 'response is not bound to this recipient capability')
	}
	const outputs = record.coordinatorRequest.outputs
	if (response.signatures.length !== outputs.length) refuse('DEMO_RECIPIENT_RESPONSE_COUNT', 'mint withheld or added a blinded signature')
	const points = new Set<string>()
	for (const [index, signature] of response.signatures.entries()) {
		const output = outputs[index]
		if (signature.amount !== output.amount || signature.id !== output.id) {
			refuse('DEMO_RECIPIENT_RESPONSE_MUTATED', `signature ${index} differs from the exact requested amount or keyset`)
		}
		requirePoint(signature.C_, `signatures[${index}].C_`)
		if (points.has(signature.C_)) refuse('DEMO_RECIPIENT_RESPONSE_MUTATED', 'mint returned duplicate blinded signatures')
		points.add(signature.C_)
		if (signature.dleq && (!HEX_32.test(signature.dleq.e) || !HEX_32.test(signature.dleq.s))) {
			refuse('DEMO_RECIPIENT_RESPONSE_MUTATED', `signature ${index} has malformed public DLEQ scalars`)
		}
	}
	return hashText(JSON.stringify({
		schema: response.schema,
		operationId: response.operationId,
		recipientCapabilityDigest: response.recipientCapabilityDigest,
		signatures: response.signatures.map((signature) => ({
			amount: signature.amount,
			id: signature.id,
			C_: signature.C_,
			...(signature.dleq ? { dleq: { e: signature.dleq.e, s: signature.dleq.s } } : {}),
		})),
	}))
}

export async function acceptDemoSigAllRecipientResponse<OpeningRef, UnblindedRef, VerifiedRef>(options: {
	intent: DemoRecipientIntent
	keyset: DemoRecipientKeyset
	response: DemoRecipientCoordinatorResponse
	roleBinding: DemoRecipientRoleBindingPort
	unblinder: DemoRecipientUnblindingPort<OpeningRef, UnblindedRef>
	verifier: DemoRecipientProofVerifierPort<UnblindedRef, VerifiedRef>
	wallet: DemoRecipientWalletPort<VerifiedRef>
	journal: DemoRecipientPrivateJournalPort<OpeningRef>
}): Promise<DemoRecipientImportReceipt> {
	let intent: DemoRecipientIntent
	let keyset: DemoRecipientKeyset
	let response: DemoRecipientCoordinatorResponse
	try {
		intent = structuredClone(options.intent)
		keyset = structuredClone(options.keyset)
		response = structuredClone(options.response)
	} catch {
		return refuse('DEMO_RECIPIENT_NOT_CLONEABLE', 'recipient intent, keyset, and response must be immutable cloneable data')
	}
	const roleBinding = options.roleBinding
	const unblinder = options.unblinder
	const verifier = options.verifier
	const wallet = options.wallet
	const journal = options.journal
	validateIntent(intent)
	const keysetDigest = validateKeyset(keyset, intent)
	const intentDigest = hashText(JSON.stringify(canonicalIntent(intent, keyset, keysetDigest)))
	const scope = scopeFor(intent)
	return journal.runExclusive(scope, async () => {
		await assertRoleBinding(roleBinding, intent)
		const record = await journal.load(scope)
		if (!record) refuse('DEMO_RECIPIENT_NOT_PREPARED', 'recipient has no private opening record for this operation')
		validateStoredRecord(record, scope)
		if (record.intentDigest !== intentDigest || record.keysetDigest !== keysetDigest) {
			refuse('DEMO_RECIPIENT_OPERATION_CONFLICT', 'delivery intent or keyset differs from the prepared request')
		}
		verifyCapabilitySignature(record.coordinatorRequest.capability)
		const responseDigest = validateResponse(response, record)
		if (record.importedResponseDigest !== undefined) {
			if (record.importedResponseDigest !== responseDigest) {
				refuse('DEMO_RECIPIENT_RESPONSE_CONFLICT', 'operation was already imported from a different response')
			}
			return buildReceipt(record.coordinatorRequest, true)
		}

		const unblindedRef = await unblinder.unblindExact({
			operationId: intent.operationId,
			outputs: record.coordinatorRequest.outputs.map((output) => ({ ...output })),
			signatures: response.signatures.map((signature) => ({ ...signature, dleq: signature.dleq ? { ...signature.dleq } : undefined })),
			privateOpeningRefs: [...record.privateOpeningRefs],
			keyset: { ...keyset, keys: { ...keyset.keys } },
		})
		const verifiedRef = await verifier.verifyExact({
			operationId: intent.operationId,
			unblindedRef,
			outputs: record.coordinatorRequest.outputs.map((output) => ({ ...output })),
			keyset: { ...keyset, keys: { ...keyset.keys } },
		})
		const idempotencyKey = hashText(`COCO_DEMO_RECIPIENT_IMPORT_V1\u0000${record.requestDigest}`)
		await wallet.importVerified({
			idempotencyKey,
			operationId: intent.operationId,
			role: intent.role,
			recipientPublicKey: intent.recipientPublicKey,
			verifiedRef,
		})
		await journal.markImported(scope, record.requestDigest, responseDigest)
		return buildReceipt(record.coordinatorRequest, false)
	})
}

function buildReceipt(request: DemoRecipientCoordinatorRequest, alreadyImported: boolean): DemoRecipientImportReceipt {
	return {
		schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1',
		operationId: request.capability.operationId,
		role: request.capability.role,
		recipientPublicKey: request.capability.recipientPublicKey,
		amount: request.outputs.reduce((sum, output) => sum + output.amount, 0),
		proofCount: request.outputs.length,
		imported: true,
		alreadyImported,
	}
}
