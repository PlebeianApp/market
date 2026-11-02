/**
 * Test-only NUT-04 funding preparation for Coco demo bids.
 *
 * Every output is born with the canonical bidder-plus-committee NUT-11 `SIG_ALL` condition. This
 * module has no API that accepts an existing proof, so it cannot relabel or upgrade a `SIG_INPUTS`
 * proof. It performs no network calls: quote creation and mint completion are explicit injected
 * ports. Secret openings remain in the caller-owned package and are never placed in either port
 * request.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	buildDemoSigAllSecret,
	demoDenominationKeyDigest,
	type DemoMintCapabilitySeal,
} from './demo-sigall-settlement'
import {
	blindMessage,
	parseP2PKSecret,
	randomScalar,
	randomSecretHex,
	unblindBlindedSignature,
	type BlindedMessage,
	type BlindedSignature,
	type BlindingData,
	type CashuProof,
} from './nut-client'

export const DEMO_SIGALL_TEST_MINT_ORIGIN = 'https://testnut.cashu.space'

export interface DemoSigAllFundingIntent {
	schema: 'COCO_DEMO_SIGALL_FUNDING_INTENT_V1'
	environment: 'test-only'
	operationId: string
	mintUrl: typeof DEMO_SIGALL_TEST_MINT_ORIGIN
	unit: 'sat'
	paymentMethod: 'bolt11'
	amount: number
	/** Exact NUT-04 test-unit range advertised by the approved mint preflight. */
	mintAdvertisedMinAmount: number
	mintAdvertisedMaxAmount: number
	/** Per-request user approval; this may be narrower than the mint-advertised range. */
	approvedMaxAmount: number
	approvedMaxOutputs: number
	createdAt: number
	locktime: number
	bidderPublicKey: string
	committeePublicKey: string
	refundPublicKey: string
	mintSeal: DemoMintCapabilitySeal
}

export interface DemoSigAllFundingPackage {
	schema: 'COCO_DEMO_SIGALL_FUNDING_PACKAGE_V1'
	intent: DemoSigAllFundingIntent
	/** Public active-keyset keys. Their digest must equal the approved mint seal. */
	denominationKeys: Record<string, string>
	outputs: BlindedMessage[]
	/** Wallet-custodied secret openings; never sent through either funding port. */
	openings: BlindingData[]
	fundingRoot: string
}

export interface DemoSigAllFundingQuoteRequest {
	schema: 'COCO_DEMO_SIGALL_FUNDING_QUOTE_REQUEST_V1'
	fundingRoot: string
	intent: DemoSigAllFundingIntent
	outputs: BlindedMessage[]
}

export interface DemoSigAllFundingQuote {
	schema: 'COCO_DEMO_SIGALL_FUNDING_QUOTE_V1'
	fundingRoot: string
	quoteId: string
	paymentRequest: string
	mintUrl: typeof DEMO_SIGALL_TEST_MINT_ORIGIN
	unit: 'sat'
	paymentMethod: 'bolt11'
	amount: number
	state: 'UNPAID' | 'PAID' | 'ISSUED'
}

export interface DemoSigAllMintQuotePort {
	/**
	 * Before external I/O, live adapters must exact-compare the intent's method/unit limits with the
	 * mint's advertised NUT-04 settings and add durable replay, concurrency, timeout, rate-limit,
	 * and backoff policy.
	 */
	createQuote(request: DemoSigAllFundingQuoteRequest): Promise<DemoSigAllFundingQuote>
}

export interface DemoSigAllFundingMintRequest {
	schema: 'COCO_DEMO_SIGALL_FUNDING_MINT_REQUEST_V1'
	fundingRoot: string
	quoteId: string
	mintUrl: typeof DEMO_SIGALL_TEST_MINT_ORIGIN
	unit: 'sat'
	paymentMethod: 'bolt11'
	amount: number
	intent: DemoSigAllFundingIntent
	mintSeal: DemoMintCapabilitySeal
	outputs: BlindedMessage[]
}

export interface DemoSigAllMintOutputPort {
	/** Live adapters must add durable replay, concurrency, timeout, rate-limit, and backoff policy. */
	mintExact(request: DemoSigAllFundingMintRequest): Promise<{ signatures: BlindedSignature[] }>
}

export interface DemoSigAllFundingProofVerificationRequest {
	schema: 'COCO_DEMO_SIGALL_FUNDING_PROOF_VERIFICATION_V1'
	fundingRoot: string
	mintSeal: DemoMintCapabilitySeal
	denominationPublicKey: string
	output: BlindedMessage
	signature: BlindedSignature
	proof: CashuProof
}

/** Wallet-local cryptographic proof validation; no permissive default is supplied. */
export interface DemoSigAllFundingProofVerifier {
	verifyExact(request: DemoSigAllFundingProofVerificationRequest): Promise<boolean>
}

export class DemoSigAllFundingRefusedError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoSigAllFundingRefusedError'
		this.code = code
	}
}

const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const HEX_32 = /^[0-9a-f]{64}$/

function refuse(code: string, message: string): never {
	throw new DemoSigAllFundingRefusedError(code, message)
}

function requireText(value: string, field: string): void {
	if (value.length === 0 || value.trim() !== value) refuse('DEMO_SIGALL_FUNDING_TEXT', `${field} must be non-empty and trimmed`)
}

function requireCompressedKey(value: string, field: string): void {
	if (!COMPRESSED_KEY.test(value)) refuse('DEMO_SIGALL_FUNDING_KEY', `${field} must be lowercase compressed secp256k1 hex`)
	try {
		secp256k1.Point.fromHex(value).assertValidity()
	} catch {
		refuse('DEMO_SIGALL_FUNDING_KEY', `${field} must encode a valid secp256k1 point`)
	}
}

function requireFundingWindow(intent: DemoSigAllFundingIntent, nowSeconds: number): void {
	if (!Number.isSafeInteger(nowSeconds) || nowSeconds < intent.createdAt || nowSeconds >= intent.locktime) {
		refuse('DEMO_SIGALL_FUNDING_LOCKTIME', 'funding I/O must occur after package creation and before the approved bidder refund locktime')
	}
}

function canonicalOutputs(outputs: BlindedMessage[]): BlindedMessage[] {
	return outputs.map((output, index) => {
		if (!Number.isSafeInteger(output.amount) || output.amount <= 0) refuse('DEMO_SIGALL_FUNDING_AMOUNT', `outputs[${index}].amount must be positive`)
		requireText(output.id, `outputs[${index}].id`)
		requireCompressedKey(output.B_, `outputs[${index}].B_`)
		return { amount: output.amount, id: output.id, B_: output.B_ }
	})
}

function cloneSeal(seal: DemoMintCapabilitySeal): DemoMintCapabilitySeal {
	return {
		...seal,
		denominationAmounts: [...seal.denominationAmounts],
		nuts: [...seal.nuts],
	}
}

function cloneIntent(intent: DemoSigAllFundingIntent): DemoSigAllFundingIntent {
	return { ...intent, mintSeal: cloneSeal(intent.mintSeal) }
}

function clonePackage(value: DemoSigAllFundingPackage): DemoSigAllFundingPackage {
	return {
		schema: value.schema,
		intent: cloneIntent(value.intent),
		denominationKeys: { ...value.denominationKeys },
		outputs: canonicalOutputs(value.outputs),
		openings: value.openings.map((opening) => ({ ...opening })),
		fundingRoot: value.fundingRoot,
	}
}

function fundingRoot(intent: DemoSigAllFundingIntent, outputs: BlindedMessage[]): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify({
		schema: 'COCO_DEMO_SIGALL_FUNDING_ROOT_V1',
		intent,
		outputs: canonicalOutputs(outputs),
	}))))
}

/** Power-of-two split without JavaScript's signed 32-bit bitwise truncation. */
function canonicalAmountParts(amount: number): number[] {
	let remaining = BigInt(amount)
	let bit = 1n
	const parts: number[] = []
	while (remaining > 0n) {
		if ((remaining & 1n) === 1n) parts.push(Number(bit))
		remaining >>= 1n
		bit <<= 1n
	}
	return parts
}

function validateSeal(intent: DemoSigAllFundingIntent, denominationKeys: Record<string, string>): number[] {
	const seal = intent.mintSeal
	if (seal.mintUrl !== intent.mintUrl) refuse('DEMO_SIGALL_FUNDING_MINT_SEAL', 'mint seal origin differs from the funding intent')
	requireText(seal.mintPublicKey, 'mintSeal.mintPublicKey')
	requireText(seal.serverVersion, 'mintSeal.serverVersion')
	requireText(seal.activeSatKeysetId, 'mintSeal.activeSatKeysetId')
	if (!HEX_32.test(seal.denominationKeyDigest)) refuse('DEMO_SIGALL_FUNDING_MINT_SEAL', 'mint denomination key digest is malformed')
	for (const [rawAmount, key] of Object.entries(denominationKeys)) {
		const amount = Number(rawAmount)
		if (!Number.isSafeInteger(amount) || amount <= 0 || rawAmount !== String(amount)) {
			refuse('DEMO_SIGALL_FUNDING_MINT_SEAL', `denomination key ${rawAmount} is not canonical positive decimal`)
		}
		requireCompressedKey(key, `denominationKeys[${rawAmount}]`)
	}
	if (seal.denominationKeyDigest !== demoDenominationKeyDigest(denominationKeys)) {
		refuse('DEMO_SIGALL_FUNDING_MINT_SEAL', 'denomination keys differ from the approved mint seal')
	}
	if (!Number.isSafeInteger(seal.inputFeePpk) || seal.inputFeePpk < 0 || seal.inputFeePpk > 100) {
		refuse('DEMO_SIGALL_FUNDING_MINT_SEAL', 'sealed input fee must be between 0 and 100 ppk')
	}
	const denominationAmounts = Object.keys(denominationKeys).map(Number).sort((left, right) => left - right)
	if (
		denominationAmounts.length === 0
		|| denominationAmounts.some((amount, index) => !Number.isSafeInteger(amount) || amount <= 0 || (index > 0 && denominationAmounts[index - 1] === amount))
		|| JSON.stringify(denominationAmounts) !== JSON.stringify(seal.denominationAmounts)
	) refuse('DEMO_SIGALL_FUNDING_MINT_SEAL', 'active keyset denominations differ from the approved mint seal')
	if (
		seal.nuts.length === 0
		|| seal.nuts.some((nut, index) => !Number.isSafeInteger(nut) || nut < 0 || (index > 0 && seal.nuts[index - 1] >= nut))
		|| !seal.nuts.includes(4)
		|| !seal.nuts.includes(10)
		|| !seal.nuts.includes(11)
	) refuse('DEMO_SIGALL_FUNDING_MINT_SEAL', 'approved canonical mint capabilities must include NUT-04, NUT-10, and NUT-11')
	return denominationAmounts
}

function validateIntent(intent: DemoSigAllFundingIntent, denominationKeys: Record<string, string>): number[] {
	if (intent.schema !== 'COCO_DEMO_SIGALL_FUNDING_INTENT_V1' || intent.environment !== 'test-only') {
		refuse('DEMO_SIGALL_FUNDING_SCHEMA', 'only the test-only funding intent is supported')
	}
	requireText(intent.operationId, 'operationId')
	if (intent.mintUrl !== DEMO_SIGALL_TEST_MINT_ORIGIN) refuse('DEMO_SIGALL_FUNDING_ORIGIN', 'funding is pinned to the approved Testnut origin')
	if (intent.unit !== 'sat') refuse('DEMO_SIGALL_FUNDING_UNIT', 'only the approved test sat unit is supported')
	if (intent.paymentMethod !== 'bolt11') refuse('DEMO_SIGALL_FUNDING_METHOD', 'only the approved NUT-04 bolt11 test method is supported')
	if (!Number.isSafeInteger(intent.amount) || intent.amount <= 0) refuse('DEMO_SIGALL_FUNDING_AMOUNT', 'amount must be a positive safe integer')
	if (
		!Number.isSafeInteger(intent.mintAdvertisedMinAmount)
		|| !Number.isSafeInteger(intent.mintAdvertisedMaxAmount)
		|| intent.mintAdvertisedMinAmount <= 0
		|| intent.mintAdvertisedMaxAmount < intent.mintAdvertisedMinAmount
	) refuse('DEMO_SIGALL_FUNDING_CAP', 'mint-advertised limits must be a finite positive range')
	if (intent.amount < intent.mintAdvertisedMinAmount || intent.amount > intent.mintAdvertisedMaxAmount) {
		refuse('DEMO_SIGALL_FUNDING_CAP', 'amount is outside the approved mint-advertised range')
	}
	if (!Number.isSafeInteger(intent.approvedMaxAmount) || intent.approvedMaxAmount <= 0 || intent.approvedMaxAmount > intent.mintAdvertisedMaxAmount) {
		refuse('DEMO_SIGALL_FUNDING_CAP', 'approvedMaxAmount must be finite and no greater than the mint-advertised maximum')
	}
	if (intent.amount > intent.approvedMaxAmount) refuse('DEMO_SIGALL_FUNDING_CAP', 'amount exceeds its approved request cap')
	if (!Number.isSafeInteger(intent.approvedMaxOutputs) || intent.approvedMaxOutputs <= 0) {
		refuse('DEMO_SIGALL_FUNDING_CAP', 'approvedMaxOutputs must be a finite positive per-request cap')
	}
	if (!Number.isSafeInteger(intent.createdAt) || intent.createdAt <= 0 || !Number.isSafeInteger(intent.locktime) || intent.locktime <= intent.createdAt) {
		refuse('DEMO_SIGALL_FUNDING_LOCKTIME', 'locktime must be later than the package creation time')
	}
	requireCompressedKey(intent.bidderPublicKey, 'bidderPublicKey')
	requireCompressedKey(intent.committeePublicKey, 'committeePublicKey')
	requireCompressedKey(intent.refundPublicKey, 'refundPublicKey')
	// NUT-11 compares public keys by x-coordinate. Opposite compressed parity does not create a
	// second signer and would make this n_sigs=2 condition unspendable at a conforming mint.
	if (intent.bidderPublicKey.slice(2) === intent.committeePublicKey.slice(2)) {
		refuse('DEMO_SIGALL_FUNDING_KEYS', 'bidder and committee keys must have distinct x-coordinates')
	}
	if (
		intent.refundPublicKey.slice(2) === intent.bidderPublicKey.slice(2)
		|| intent.refundPublicKey.slice(2) === intent.committeePublicKey.slice(2)
	) {
		refuse('DEMO_SIGALL_FUNDING_REFUND', 'refund, bidder, and committee keys must have distinct x-coordinates')
	}
	return validateSeal(intent, denominationKeys)
}

/** Revalidate a package at every port boundary, including all secret/output openings. */
export function validateDemoSigAllFundingPackage(value: DemoSigAllFundingPackage): void {
	if (value.schema !== 'COCO_DEMO_SIGALL_FUNDING_PACKAGE_V1') refuse('DEMO_SIGALL_FUNDING_SCHEMA', 'unsupported funding package')
	const denominations = validateIntent(value.intent, value.denominationKeys)
	const expectedParts = canonicalAmountParts(value.intent.amount)
	if (expectedParts.length === 0 || expectedParts.length > value.intent.approvedMaxOutputs) {
		refuse('DEMO_SIGALL_FUNDING_CAP', 'the canonical amount split exceeds the approved output cap')
	}
	if (expectedParts.some((amount) => !denominations.includes(amount))) {
		refuse('DEMO_SIGALL_FUNDING_DENOMINATION', 'the active keyset cannot represent the exact funding amount')
	}
	if (value.outputs.length !== expectedParts.length || value.openings.length !== expectedParts.length) {
		refuse('DEMO_SIGALL_FUNDING_OUTPUTS', 'outputs and wallet openings must exactly match the canonical amount split')
	}
	const seenSecrets = new Set<string>()
	const seenNonces = new Set<string>()
	const seenPoints = new Set<string>()
	for (const [index, amount] of expectedParts.entries()) {
		const output = value.outputs[index]
		const opening = value.openings[index]
		if (output.amount !== amount || output.id !== value.intent.mintSeal.activeSatKeysetId) {
			refuse('DEMO_SIGALL_FUNDING_OUTPUTS', `output ${index} differs from the exact active-keyset amount split`)
		}
		const parsed = parseP2PKSecret(opening.secret)
		if (!parsed) refuse('DEMO_SIGALL_FUNDING_LOCK', `opening ${index} is not a NUT-10 P2PK secret`)
		if (!HEX_32.test(parsed.nonce)) refuse('DEMO_SIGALL_FUNDING_NONCE', `opening ${index} nonce is not 32 lowercase hex bytes`)
		const exactSecret = buildDemoSigAllSecret({
			nonce: parsed.nonce,
			bidderPublicKey: value.intent.bidderPublicKey,
			committeePublicKey: value.intent.committeePublicKey,
			locktime: value.intent.locktime,
			refundPublicKey: value.intent.refundPublicKey,
		})
		if (opening.secret !== exactSecret) {
			const sigflag = parsed.tags.find(([name]) => name === 'sigflag')?.[1]
			if (sigflag !== 'SIG_ALL') refuse('DEMO_SIGALL_FUNDING_EXISTING_LOCK', 'an existing non-SIG_ALL lock cannot be upgraded during funding')
			refuse('DEMO_SIGALL_FUNDING_LOCK', `opening ${index} is not the exact bidder-plus-committee funding lock`)
		}
		if (typeof opening.r !== 'bigint' || opening.r <= 0n || opening.r >= secp256k1.Point.Fn.ORDER) {
			refuse('DEMO_SIGALL_FUNDING_BLINDING', `opening ${index} has an invalid blinding scalar`)
		}
		const exactBlinding = blindMessage(opening.secret, opening.r)
		if (opening.B_ !== exactBlinding.B_ || output.B_ !== exactBlinding.B_) {
			refuse('DEMO_SIGALL_FUNDING_OPENING', `opening ${index} does not open the exact blinded output`)
		}
		if (seenSecrets.has(opening.secret) || seenNonces.has(parsed.nonce)) {
			refuse('DEMO_SIGALL_FUNDING_DUPLICATE_SECRET', 'every issued proof must have a unique nonce and secret')
		}
		if (seenPoints.has(output.B_)) refuse('DEMO_SIGALL_FUNDING_DUPLICATE_OUTPUT', 'every blinded output must be unique')
		seenSecrets.add(opening.secret)
		seenNonces.add(parsed.nonce)
		seenPoints.add(output.B_)
	}
	if (value.fundingRoot !== fundingRoot(value.intent, value.outputs)) {
		refuse('DEMO_SIGALL_FUNDING_ROOT', 'funding root does not bind the exact intent and outputs')
	}
}

export function prepareDemoSigAllFunding(options: {
	intent: DemoSigAllFundingIntent
	denominationKeys: Record<string, string>
	nextNonce?: (index: number) => string
	nextBlindingScalar?: (index: number) => bigint
}): DemoSigAllFundingPackage {
	validateIntent(options.intent, options.denominationKeys)
	const exactIntent = cloneIntent(options.intent)
	const outputs: BlindedMessage[] = []
	const openings: BlindingData[] = []
	for (const [index, amount] of canonicalAmountParts(exactIntent.amount).entries()) {
		const nonce = options.nextNonce?.(index) ?? randomSecretHex()
		const secret = buildDemoSigAllSecret({
			nonce,
			bidderPublicKey: exactIntent.bidderPublicKey,
			committeePublicKey: exactIntent.committeePublicKey,
			locktime: exactIntent.locktime,
			refundPublicKey: exactIntent.refundPublicKey,
		})
		const opening = blindMessage(secret, options.nextBlindingScalar?.(index) ?? randomScalar())
		openings.push(opening)
		outputs.push({ amount, id: exactIntent.mintSeal.activeSatKeysetId, B_: opening.B_ })
	}
	const prepared: DemoSigAllFundingPackage = {
		schema: 'COCO_DEMO_SIGALL_FUNDING_PACKAGE_V1',
		intent: exactIntent,
		denominationKeys: { ...options.denominationKeys },
		outputs,
		openings,
		fundingRoot: fundingRoot(exactIntent, outputs),
	}
	validateDemoSigAllFundingPackage(prepared)
	return prepared
}

export async function requestDemoSigAllFundingQuote(
	prepared: DemoSigAllFundingPackage,
	quotePort: DemoSigAllMintQuotePort,
	nowSeconds: number | (() => number) = () => Math.floor(Date.now() / 1000),
): Promise<DemoSigAllFundingQuote> {
	const exact = clonePackage(prepared)
	const clock = typeof nowSeconds === 'function' ? nowSeconds : () => nowSeconds
	validateDemoSigAllFundingPackage(exact)
	requireFundingWindow(exact.intent, clock())
	const quote = await quotePort.createQuote({
		schema: 'COCO_DEMO_SIGALL_FUNDING_QUOTE_REQUEST_V1',
		fundingRoot: exact.fundingRoot,
		intent: cloneIntent(exact.intent),
		outputs: canonicalOutputs(exact.outputs),
	})
	if (quote.schema !== 'COCO_DEMO_SIGALL_FUNDING_QUOTE_V1') refuse('DEMO_SIGALL_FUNDING_QUOTE', 'unsupported quote response')
	if (
		quote.fundingRoot !== exact.fundingRoot
		|| quote.mintUrl !== exact.intent.mintUrl
		|| quote.unit !== exact.intent.unit
		|| quote.paymentMethod !== exact.intent.paymentMethod
		|| quote.amount !== exact.intent.amount
	) refuse('DEMO_SIGALL_FUNDING_QUOTE', 'quote does not bind the exact funding request')
	requireText(quote.quoteId, 'quote.quoteId')
	requireText(quote.paymentRequest, 'quote.paymentRequest')
	if (quote.state !== 'UNPAID' && quote.state !== 'PAID') refuse('DEMO_SIGALL_FUNDING_QUOTE', 'new funding quote must be UNPAID or PAID')
	requireFundingWindow(exact.intent, clock())
	return { ...quote }
}

/** Complete a paid quote and unblind fresh proofs into the caller-owned wallet package. */
export async function mintDemoSigAllFundingOutputs(options: {
	prepared: DemoSigAllFundingPackage
	paidQuote: DemoSigAllFundingQuote
	mintPort: DemoSigAllMintOutputPort
	proofVerifier: DemoSigAllFundingProofVerifier
	nowSeconds?: number | (() => number)
}): Promise<{ fundingRoot: string; quoteId: string; proofs: CashuProof[] }> {
	const prepared = clonePackage(options.prepared)
	const mintPort = options.mintPort
	const proofVerifier = options.proofVerifier
	validateDemoSigAllFundingPackage(prepared)
	const paidQuote = { ...options.paidQuote }
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
	const clock = typeof nowSeconds === 'function' ? nowSeconds : () => nowSeconds
	requireFundingWindow(prepared.intent, clock())
	if (
		paidQuote.schema !== 'COCO_DEMO_SIGALL_FUNDING_QUOTE_V1'
		|| paidQuote.state !== 'PAID'
		|| paidQuote.fundingRoot !== prepared.fundingRoot
		|| paidQuote.mintUrl !== prepared.intent.mintUrl
		|| paidQuote.unit !== prepared.intent.unit
		|| paidQuote.paymentMethod !== prepared.intent.paymentMethod
		|| paidQuote.amount !== prepared.intent.amount
	) refuse('DEMO_SIGALL_FUNDING_QUOTE', 'mint completion requires the exact paid funding quote')
	requireText(paidQuote.quoteId, 'paidQuote.quoteId')
	const result = await mintPort.mintExact({
		schema: 'COCO_DEMO_SIGALL_FUNDING_MINT_REQUEST_V1',
		fundingRoot: prepared.fundingRoot,
		quoteId: paidQuote.quoteId,
		mintUrl: prepared.intent.mintUrl,
		unit: prepared.intent.unit,
		paymentMethod: prepared.intent.paymentMethod,
		amount: prepared.intent.amount,
		intent: cloneIntent(prepared.intent),
		mintSeal: cloneSeal(prepared.intent.mintSeal),
		outputs: canonicalOutputs(prepared.outputs),
	})
	requireFundingWindow(prepared.intent, clock())
	// A response without DLEQ cannot prove C_ authenticity locally. This boundary checks exact shape
	// and unblinds; a live port still needs the pinned mint, durable recovery, and proof-spend evidence.
	if (result.signatures.length !== prepared.outputs.length) refuse('DEMO_SIGALL_FUNDING_MINT_RESPONSE', 'mint returned the wrong signature count')
	const proofs: CashuProof[] = []
	for (const [index, signature] of result.signatures.entries()) {
		const output = prepared.outputs[index]
		if (signature.amount !== output.amount || signature.id !== output.id || !COMPRESSED_KEY.test(signature.C_)) {
			refuse('DEMO_SIGALL_FUNDING_MINT_RESPONSE', `mint signature ${index} does not bind the requested amount and active keyset`)
		}
		requireCompressedKey(signature.C_, `signatures[${index}].C_`)
		const denominationPublicKey = prepared.denominationKeys[String(output.amount)]
		const proof = unblindBlindedSignature(
			signature,
			prepared.openings[index],
			denominationPublicKey,
		)
		const verified = await proofVerifier.verifyExact({
			schema: 'COCO_DEMO_SIGALL_FUNDING_PROOF_VERIFICATION_V1',
			fundingRoot: prepared.fundingRoot,
			mintSeal: cloneSeal(prepared.intent.mintSeal),
			denominationPublicKey,
			output: { ...output },
			signature: { ...signature, ...(signature.dleq ? { dleq: { ...signature.dleq } } : {}) },
			proof: { ...proof, ...(proof.dleq ? { dleq: { ...proof.dleq } } : {}) },
		})
		requireFundingWindow(prepared.intent, clock())
		if (!verified) refuse('DEMO_SIGALL_FUNDING_PROOF_INVALID', `final proof ${index} failed wallet-local cryptographic verification`)
		proofs.push(proof)
	}
	requireFundingWindow(prepared.intent, clock())
	return { fundingRoot: prepared.fundingRoot, quoteId: paidQuote.quoteId, proofs }
}
