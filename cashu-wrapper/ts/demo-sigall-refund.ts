/**
 * Bidder-wallet-local post-locktime recovery for the demo SIG_ALL rail.
 *
 * This executor must be constructed and run inside the bidder's own wallet process. The refund
 * private key, Cashu witness, recipient openings, and imported proofs never enter the public
 * auction coordinator or any validator capability. The mint necessarily receives the witness.
 *
 * A mint response is not reported as a completed refund until the exact blinded signatures have
 * also passed recipient-private unblinding, verification, and idempotent wallet import. Ambiguous
 * responses enter the shared durable recovery journal and can never be submitted again until an
 * authoritative reconciliation fence permits it.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	acceptDemoSigAllRecipientResponse,
	type DemoRecipientImportReceipt,
	type DemoRecipientIntent,
	type DemoRecipientKeyset,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientProofVerifierPort,
	type DemoRecipientRoleBindingPort,
	type DemoRecipientUnblindingPort,
	type DemoRecipientWalletPort,
} from './demo-sigall-recipient'
import {
	reconcileDemoSigAllSwap,
	restoreDemoSigAllTerminalResponse,
	submitDemoSigAllRefundSwap,
	type DemoSigAllDurableRequest,
	type DemoSigAllRecoveryMintStatePort,
	type DemoSigAllRecoveryStore,
	type DemoSigAllTerminalMetadata,
	type DemoSigAllTerminalResponsePort,
} from './demo-sigall-recovery'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	type DemoMintCapabilitySeal,
	type DemoRecipientCapability,
	type DemoSigAllMintPort,
	type DemoSigAllSwapRequest,
} from './demo-sigall-settlement'
import { parseP2PKSecret, proofPoint, type BlindedSignature, type CashuProof } from './nut-client'

const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const SIGNATURE = /^[0-9a-f]{128}$/
const BIDDER_LOCAL_REFUND_EXECUTOR = Symbol('COCO_DEMO_BIDDER_LOCAL_REFUND_EXECUTOR')

export interface DemoBidderLocalRefundPackage {
	schema: 'COCO_DEMO_BIDDER_LOCAL_REFUND_PACKAGE_V1'
	network: string
	chainId: string
	auctionId: string
	operationId: string
	mintUrl: string
	unit: 'sat'
	inputFee: number
	mintSeal: DemoMintCapabilitySeal
	inputs: CashuProof[]
	outputs: DemoSigAllSwapRequest['outputs']
	recipientCapability: DemoRecipientCapability
}

export type DemoBidderLocalRefundMintPort = DemoSigAllMintPort

export interface DemoBidderLocalRefundSignerPort {
	readonly publicKey: string
	signExactDigest(request: {
		schema: 'COCO_DEMO_BIDDER_LOCAL_REFUND_SIGN_REQUEST_V1'
		operationId: string
		digest: string
	}): Promise<string>
}

export interface DemoBidderLocalRefundSuccess {
	status: 'refunded'
	deliverySource: 'mint_response' | 'exact_recovery' | 'terminal_restore'
	terminal: DemoSigAllTerminalMetadata
	recipient: DemoRecipientImportReceipt
}

export type DemoBidderLocalRefundRecoveryResult = DemoBidderLocalRefundSuccess | {
	status: 'not_attempted' | 'retry_ready'
} | {
	status: 'retry_authorized'
	reconciliationDigest: string
} | {
	status: 'indeterminate'
	reasonCode: string
}

export interface DemoBidderLocalRefundExecutor {
	readonly [BIDDER_LOCAL_REFUND_EXECUTOR]: true
	refundExact(value: DemoBidderLocalRefundPackage): Promise<DemoBidderLocalRefundSuccess>
	recoverExact(value: DemoBidderLocalRefundPackage): Promise<DemoBidderLocalRefundRecoveryResult>
}

export class DemoBidderLocalRefundRefusedError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoBidderLocalRefundRefusedError'
	}
}

function refuse(code: string, message: string): never {
	throw new DemoBidderLocalRefundRefusedError(code, message)
}

function hash(value: unknown): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))
}

function requireKey(value: string, field: string): void {
	if (!COMPRESSED_KEY.test(value)) refuse('DEMO_REFUND_KEY', `${field} is not a compressed public key`)
}

function oneTag(tags: string[][], name: string, field: string): string {
	const matches = tags.filter(([tag]) => tag === name)
	if (matches.length !== 1 || matches[0]?.length !== 2 || matches[0]?.[1] === undefined) {
		refuse('DEMO_REFUND_LOCK', `${field} must contain exactly one ${name} value`)
	}
	return matches[0]![1]!
}

function lockFacts(inputs: CashuProof[]): {
	locktime: number
	mainPublicKey: string
	committeePublicKey: string
	refundPublicKey: string
} {
	if (inputs.length === 0) refuse('DEMO_REFUND_INPUTS', 'at least one input is required')
	const first = parseP2PKSecret(inputs[0]!.secret)
	if (first === null) refuse('DEMO_REFUND_LOCK', 'input is not a P2PK proof')
	const mainPublicKey = first.data
	const committeePublicKey = oneTag(first.tags, 'pubkeys', 'input lock')
	const refundPublicKey = oneTag(first.tags, 'refund', 'input lock')
	const locktime = Number(oneTag(first.tags, 'locktime', 'input lock'))
	requireKey(mainPublicKey, 'mainPublicKey')
	requireKey(committeePublicKey, 'committeePublicKey')
	requireKey(refundPublicKey, 'refundPublicKey')
	if (refundPublicKey === mainPublicKey || refundPublicKey === committeePublicKey) {
		refuse('DEMO_REFUND_KEY', 'refund key must be distinct from MAIN authorization keys')
	}
	if (!Number.isSafeInteger(locktime) || locktime <= 0) refuse('DEMO_REFUND_LOCK', 'locktime is invalid')
	const secrets = new Set<string>()
	for (const [index, input] of inputs.entries()) {
		const parsed = parseP2PKSecret(input.secret)
		if (parsed === null) refuse('DEMO_REFUND_LOCK', `inputs[${index}] is not P2PK`)
		let rebuilt: string
		try {
			rebuilt = buildDemoSigAllSecret({
				nonce: parsed.nonce,
				bidderPublicKey: mainPublicKey,
				committeePublicKey,
				locktime,
				refundPublicKey,
			})
		} catch (error) {
			return refuse('DEMO_REFUND_LOCK', error instanceof Error ? error.message : 'lock is invalid')
		}
		if (rebuilt !== input.secret) refuse('DEMO_REFUND_LOCK', `inputs[${index}] changes the exact lock`)
		if (secrets.has(input.secret)) refuse('DEMO_REFUND_INPUTS', 'proof secrets must be unique')
		secrets.add(input.secret)
	}
	return { locktime, mainPublicKey, committeePublicKey, refundPublicKey }
}

function verifySignature(signature: string, digest: string, publicKey: string): boolean {
	if (!SIGNATURE.test(signature)) return false
	try {
		return schnorr.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(publicKey.slice(2)))
	} catch {
		return false
	}
}

function scopeFor(refund: DemoBidderLocalRefundPackage): string {
	return `${refund.network}\u0000${refund.chainId}\u0000${refund.auctionId}\u0000${refund.operationId}`
}

function recipientResponse(
	operationId: string,
	recipientCapabilityDigest: string,
	signatures: readonly BlindedSignature[],
) {
	return {
		schema: 'COCO_DEMO_RECIPIENT_RESPONSE_V1' as const,
		operationId,
		recipientCapabilityDigest,
		signatures: signatures.map((signature) => ({
			amount: signature.amount,
			id: signature.id,
			C_: signature.C_,
			...(signature.dleq === undefined ? {} : { dleq: { e: signature.dleq.e, s: signature.dleq.s } }),
		})),
	}
}

export function createDemoBidderLocalRefundExecutor<OpeningRef, UnblindedRef, VerifiedRef>(options: {
	signer: DemoBidderLocalRefundSignerPort
	mint: DemoBidderLocalRefundMintPort
	recoveryStore: DemoSigAllRecoveryStore
	recovery: DemoSigAllRecoveryMintStatePort
	terminalResponse: DemoSigAllTerminalResponsePort
	recipientKeyset: DemoRecipientKeyset
	recipientRoleBinding: DemoRecipientRoleBindingPort
	recipientUnblinder: DemoRecipientUnblindingPort<OpeningRef, UnblindedRef>
	recipientVerifier: DemoRecipientProofVerifierPort<UnblindedRef, VerifiedRef>
	recipientWallet: DemoRecipientWalletPort<VerifiedRef>
	recipientJournal: DemoRecipientPrivateJournalPort<OpeningRef>
	now?: () => number
	nowSeconds?: () => number
}): DemoBidderLocalRefundExecutor {
	requireKey(options.signer.publicKey, 'signer.publicKey')
	const signer = Object.freeze({
		publicKey: options.signer.publicKey,
		signExactDigest: options.signer.signExactDigest.bind(options.signer),
	})
	const mint = Object.freeze({ swapExact: options.mint.swapExact.bind(options.mint) })
	const recoveryStore = options.recoveryStore
	const recovery = options.recovery
	const terminalResponse = options.terminalResponse
	const recipientKeyset = structuredClone(options.recipientKeyset)
	const recipientRoleBinding = options.recipientRoleBinding
	const recipientUnblinder = options.recipientUnblinder
	const recipientVerifier = options.recipientVerifier
	const recipientWallet = options.recipientWallet
	const recipientJournal = options.recipientJournal
	const now = options.now ?? Date.now
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))

	async function prepare(value: DemoBidderLocalRefundPackage): Promise<{
		value: DemoSigAllDurableRequest
		intent: DemoRecipientIntent
		keyset: DemoRecipientKeyset
	}> {
		let refund: DemoBidderLocalRefundPackage
		try { refund = structuredClone(value) }
		catch { return refuse('DEMO_REFUND_PACKAGE', 'refund package must be cloneable') }
		if (refund.schema !== 'COCO_DEMO_BIDDER_LOCAL_REFUND_PACKAGE_V1') refuse('DEMO_REFUND_PACKAGE', 'unsupported package schema')
		if (refund.unit !== 'sat' || !Number.isSafeInteger(refund.inputFee) || refund.inputFee < 0) {
			refuse('DEMO_REFUND_PACKAGE', 'refund unit or fee is invalid')
		}
		if (refund.mintUrl.replace(/\/+$/, '') !== refund.mintSeal.mintUrl.replace(/\/+$/, '')) {
			refuse('DEMO_REFUND_MINT', 'refund mint differs from the sealed mint')
		}
		const facts = lockFacts(refund.inputs)
		if (facts.refundPublicKey !== signer.publicKey) refuse('DEMO_REFUND_KEY', 'local signer is not the exact refund key')
		if (nowSeconds() < facts.locktime) refuse('DEMO_REFUND_NOT_EXPIRED', 'refund path is not active before locktime')
		if (refund.inputs.some((input) => input.id !== refund.mintSeal.activeSatKeysetId)
			|| refund.outputs.some((output) => output.id !== refund.mintSeal.activeSatKeysetId)) {
			refuse('DEMO_REFUND_KEYSET', 'refund inputs or outputs differ from the sealed keyset')
		}
		if (refund.inputs.some((input) => !Number.isSafeInteger(input.amount) || input.amount <= 0)
			|| refund.outputs.some((output) => !Number.isSafeInteger(output.amount) || output.amount <= 0)) {
			refuse('DEMO_REFUND_BALANCE', 'refund amounts must be positive safe integers')
		}
		const inputTotal = refund.inputs.reduce((sum, input) => sum + input.amount, 0)
		const outputTotal = refund.outputs.reduce((sum, output) => sum + output.amount, 0)
		if (!Number.isSafeInteger(inputTotal) || !Number.isSafeInteger(outputTotal)
			|| outputTotal + refund.inputFee !== inputTotal) {
			refuse('DEMO_REFUND_BALANCE', 'refund outputs and fee do not consume the exact inputs')
		}
		const capability = refund.recipientCapability
		if (capability.schema !== 'COCO_DEMO_RECIPIENT_CAPABILITY_V1'
			|| capability.network !== refund.network
			|| capability.chainId !== refund.chainId
			|| capability.auctionId !== refund.auctionId
			|| capability.operationId !== refund.operationId
			|| capability.role !== 'refund'
			|| capability.mintUrl.replace(/\/+$/, '') !== refund.mintUrl.replace(/\/+$/, '')
			|| capability.unit !== refund.unit
			|| capability.recipientPublicKey !== facts.refundPublicKey
			|| capability.outputsDigest !== demoOutputsDigest(refund.outputs)
			|| !verifySignature(capability.signature, demoRecipientCapabilityDigest(capability), facts.refundPublicKey)) {
			refuse('DEMO_REFUND_RECIPIENT', 'refund key did not authorize the exact bidder-controlled outputs')
		}
		const keyset = structuredClone(recipientKeyset)
		if (keyset.id !== refund.mintSeal.activeSatKeysetId
			|| keyset.unit !== refund.unit
			|| demoDenominationKeyDigest(keyset.keys) !== refund.mintSeal.denominationKeyDigest
			|| refund.outputs.some((output) => keyset.keys[String(output.amount)] === undefined)) {
			refuse('DEMO_REFUND_KEYSET', 'recipient keyset differs from the sealed refund denominations')
		}
		let proofStateRefs: string[]
		try {
			proofStateRefs = refund.inputs.map((input) => bytesToHex(proofPoint(input).toBytes(true)))
		} catch {
			return refuse('DEMO_REFUND_INPUTS', 'refund input cannot produce an exact proof state reference')
		}
		const cashuSigAllDigest = demoCashuSigAllDigest(refund.inputs, refund.outputs)
		const signature = await signer.signExactDigest({
			schema: 'COCO_DEMO_BIDDER_LOCAL_REFUND_SIGN_REQUEST_V1',
			operationId: refund.operationId,
			digest: cashuSigAllDigest,
		})
		if (!verifySignature(signature, cashuSigAllDigest, facts.refundPublicKey)) {
			refuse('DEMO_REFUND_SIGNATURE', 'bidder-local refund signature is invalid')
		}
		if (nowSeconds() < facts.locktime) refuse('DEMO_REFUND_NOT_EXPIRED', 'locktime changed before refund preparation')
		const packageDigest = hash({
			schema: refund.schema,
			network: refund.network,
			chainId: refund.chainId,
			auctionId: refund.auctionId,
			operationId: refund.operationId,
			mintUrl: refund.mintUrl.replace(/\/+$/, ''),
			unit: refund.unit,
			inputFee: refund.inputFee,
			mintSeal: refund.mintSeal,
			inputs: refund.inputs.map(({ amount, id, secret, C }) => ({ amount, id, secret, C })),
			outputs: refund.outputs,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(capability),
		})
		const request: DemoSigAllSwapRequest = {
			schema: 'COCO_DEMO_SIGALL_SWAP_V1',
			mintUrl: refund.mintUrl.replace(/\/+$/, ''),
			operationId: refund.operationId,
			locktime: facts.locktime,
			packageDigest,
			cashuSigAllDigest,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(capability),
			mintSeal: structuredClone(refund.mintSeal),
			inputs: refund.inputs.map((input, index) => index === 0
				? { ...input, witness: JSON.stringify({ signatures: [signature] }) }
				: { ...input, witness: undefined }),
			outputs: refund.outputs.map((output) => ({ ...output })),
		}
		return {
			value: {
				scope: scopeFor(refund),
				operationRoot: packageDigest,
				request,
				proofStateRefs,
			},
			intent: {
				schema: 'COCO_DEMO_RECIPIENT_INTENT_V1',
				network: refund.network,
				chainId: refund.chainId,
				auctionId: refund.auctionId,
				operationId: refund.operationId,
				role: 'refund',
				mintUrl: request.mintUrl,
				unit: refund.unit,
				recipientPublicKey: facts.refundPublicKey,
				amounts: refund.outputs.map((output) => output.amount),
			},
			keyset,
		}
	}

	async function deliver(
		prepared: Awaited<ReturnType<typeof prepare>>,
		signatures: readonly BlindedSignature[],
		terminal: DemoSigAllTerminalMetadata,
		deliverySource: DemoBidderLocalRefundSuccess['deliverySource'],
	): Promise<DemoBidderLocalRefundSuccess> {
		const recipient = await acceptDemoSigAllRecipientResponse({
			intent: prepared.intent,
			keyset: prepared.keyset,
			response: recipientResponse(
				prepared.value.request.operationId,
				prepared.value.request.recipientCapabilityDigest,
				signatures,
			),
			roleBinding: recipientRoleBinding,
			unblinder: recipientUnblinder,
			verifier: recipientVerifier,
			wallet: recipientWallet,
			journal: recipientJournal,
		})
		return { status: 'refunded', deliverySource, terminal: structuredClone(terminal), recipient }
	}

	async function restoreAndDeliver(
		prepared: Awaited<ReturnType<typeof prepare>>,
		terminal: DemoSigAllTerminalMetadata,
	): Promise<DemoBidderLocalRefundSuccess> {
		const signatures = await restoreDemoSigAllTerminalResponse({
			store: recoveryStore,
			recovery: terminalResponse,
			value: prepared.value,
			now,
		})
		return deliver(prepared, signatures, terminal, 'terminal_restore')
	}

	return {
		[BIDDER_LOCAL_REFUND_EXECUTOR]: true,
		async refundExact(value) {
			const prepared = await prepare(value)
			const result = await submitDemoSigAllRefundSwap({
				store: recoveryStore,
				mint,
				value: prepared.value,
				now,
				nowSeconds,
			})
			if (result.status === 'submitted') {
				return deliver(prepared, result.signatures, result.terminal, 'mint_response')
			}
			return restoreAndDeliver(prepared, result.terminal)
		},
		async recoverExact(value) {
			const prepared = await prepare(value)
			const result = await reconcileDemoSigAllSwap({
				store: recoveryStore,
				recovery,
				value: prepared.value,
				now,
			})
			if (result.status === 'recovered') {
				return deliver(prepared, result.signatures, result.terminal, 'exact_recovery')
			}
			if (result.status === 'terminal_replay') {
				return restoreAndDeliver(prepared, result.terminal)
			}
			return result
		},
	}
}
