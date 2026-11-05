/** Live-capable, request-derived MAIN/REFUND mint adapter. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'

import { createOriginBoundMintFetch, createPinnedMintTransportFetch } from './coco-rail'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoDenominationKeyDigest,
	demoSigAllSettlementCutoff,
	type DemoMintCapabilitySeal,
	type DemoSigAllMintPort,
	type DemoSigAllSwapRequest,
} from './demo-sigall-settlement'
import { CashuMintClient, parseP2PKSecret } from './nut-client'

const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

export type DemoSigAllSpendPath = 'MAIN' | 'REFUND'

export class DemoSigAllLiveMintRefusedError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoSigAllLiveMintRefusedError'
	}
}

function refuse(code: string, message: string): never { throw new DemoSigAllLiveMintRefusedError(code, message) }

function oneTag(tags: string[][], name: string, index: number): string {
	const matches = tags.filter(([tag]) => tag === name)
	if (matches.length !== 1 || matches[0]?.length !== 2 || matches[0]?.[1] === undefined) refuse('DEMO_SIGALL_LIVE_PATH', `input ${index} must contain exactly one ${name} tag`)
	return matches[0]![1]!
}

function verify(signature: string, digest: string, compressedKey: string): boolean {
	if (!HEX_64.test(signature) || !COMPRESSED_KEY.test(compressedKey)) return false
	try { return schnorr.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(compressedKey.slice(2))) }
	catch { return false }
}

/** Classify only from canonical lock and witness bytes; no caller-provided mode is trusted. */
export function classifyDemoSigAllSpendPath(requestValue: DemoSigAllSwapRequest): DemoSigAllSpendPath {
	let request: DemoSigAllSwapRequest
	try { request = structuredClone(requestValue) }
	catch { return refuse('DEMO_SIGALL_LIVE_PATH', 'request must be cloneable') }
	if (request.schema !== 'COCO_DEMO_SIGALL_SWAP_V1' || request.inputs.length === 0 || request.outputs.length === 0) refuse('DEMO_SIGALL_LIVE_PATH', 'request shape is invalid')
	if (demoCashuSigAllDigest(request.inputs, request.outputs) !== request.cashuSigAllDigest) refuse('DEMO_SIGALL_LIVE_PATH', 'request digest differs from exact inputs and outputs')
	let bidder = ''
	let committee = ''
	let refund = ''
	for (const [index, input] of request.inputs.entries()) {
		const parsed = parseP2PKSecret(input.secret)
		if (parsed === null) refuse('DEMO_SIGALL_LIVE_PATH', `input ${index} is not P2PK`)
		const inputCommittee = oneTag(parsed.tags, 'pubkeys', index)
		const inputRefund = oneTag(parsed.tags, 'refund', index)
		const locktime = Number(oneTag(parsed.tags, 'locktime', index))
		const sigflag = oneTag(parsed.tags, 'sigflag', index)
		const nSigs = oneTag(parsed.tags, 'n_sigs', index)
		if (!COMPRESSED_KEY.test(parsed.data) || !COMPRESSED_KEY.test(inputCommittee) || !COMPRESSED_KEY.test(inputRefund)
			|| locktime !== request.locktime || sigflag !== 'SIG_ALL' || nSigs !== '2') {
			refuse('DEMO_SIGALL_LIVE_PATH', `input ${index} is not the exact bidder-plus-committee lock`)
		}
		if (index === 0) {
			bidder = parsed.data
			committee = inputCommittee
			refund = inputRefund
			if (new Set([bidder.slice(2), committee.slice(2), refund.slice(2)]).size !== 3) refuse('DEMO_SIGALL_LIVE_PATH', 'bidder, committee, and refund keys must be distinct')
		} else if (parsed.data !== bidder || inputCommittee !== committee || inputRefund !== refund) {
			refuse('DEMO_SIGALL_LIVE_PATH', `input ${index} changes lock keys`)
		}
		let rebuilt: string
		try { rebuilt = buildDemoSigAllSecret({ nonce: parsed.nonce, bidderPublicKey: bidder, committeePublicKey: committee, refundPublicKey: refund, locktime: request.locktime }) }
		catch { return refuse('DEMO_SIGALL_LIVE_PATH', `input ${index} lock is noncanonical`) }
		if (rebuilt !== input.secret) refuse('DEMO_SIGALL_LIVE_PATH', `input ${index} changes canonical lock bytes`)
		if (index > 0 && input.witness !== undefined) refuse('DEMO_SIGALL_LIVE_PATH', 'only input zero may contain the transaction witness')
	}
	const witnessText = request.inputs[0]!.witness
	if (typeof witnessText !== 'string') refuse('DEMO_SIGALL_LIVE_PATH', 'transaction witness is missing')
	let witness: unknown
	try { witness = JSON.parse(witnessText) }
	catch { return refuse('DEMO_SIGALL_LIVE_PATH', 'transaction witness is invalid JSON') }
	if (typeof witness !== 'object' || witness === null || Array.isArray(witness)
		|| JSON.stringify(Object.keys(witness).sort()) !== JSON.stringify(['signatures'])) refuse('DEMO_SIGALL_LIVE_PATH', 'witness must contain only signatures')
	const signatures = (witness as { signatures?: unknown }).signatures
	if (!Array.isArray(signatures) || signatures.some((value) => typeof value !== 'string')) refuse('DEMO_SIGALL_LIVE_PATH', 'witness signatures are malformed')
	if (signatures.length === 1 && verify(signatures[0] as string, request.cashuSigAllDigest, refund)) return 'REFUND'
	if (signatures.length === 2 && verify(signatures[0] as string, request.cashuSigAllDigest, bidder)
		&& verify(signatures[1] as string, request.cashuSigAllDigest, committee)) return 'MAIN'
	return refuse('DEMO_SIGALL_LIVE_PATH', 'witness is neither exact MAIN nor exact REFUND')
}

export function supportedNutNumbers(value: unknown): number[] {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
	const supported: number[] = []
	for (const [rawNut, rawSettings] of Object.entries(value as Record<string, unknown>)) {
		if (!/^(?:0|[1-9][0-9]*)$/.test(rawNut) || rawSettings === null || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) continue
		const nut = Number(rawNut)
		const settings = rawSettings as Record<string, unknown>
		if (nut === 4) {
			if (settings.disabled === false && Array.isArray(settings.methods) && settings.methods.some((method) => method !== null && typeof method === 'object'
				&& (method as Record<string, unknown>).method === 'bolt11' && (method as Record<string, unknown>).unit === 'sat')) supported.push(nut)
		} else if (Number.isSafeInteger(nut) && settings.supported === true) supported.push(nut)
	}
	return supported.sort((left, right) => left - right)
}

function enforceTime(path: DemoSigAllSpendPath, request: DemoSigAllSwapRequest, nowSeconds: () => number): void {
	const now = nowSeconds()
	if (path === 'MAIN' && now >= demoSigAllSettlementCutoff(request.locktime)) refuse('DEMO_SIGALL_LIVE_MAIN_CUTOFF', 'MAIN is closed at or after the settlement cutoff')
	if (path === 'REFUND' && now < request.locktime) refuse('DEMO_SIGALL_LIVE_REFUND_NOT_EXPIRED', 'REFUND is unavailable before locktime')
}

function exactSeal(clientUrl: string, info: { pubkey?: unknown; version?: unknown; nuts?: unknown }, keyset: {
	id: string; keys: Record<string, string>
}, inputFeePpk: number): DemoMintCapabilitySeal {
	const exactAmounts = Object.keys(keyset.keys).map((amount) => {
		if (!/^[1-9][0-9]*$/.test(amount)) refuse('DEMO_SIGALL_LIVE_DRIFT', 'mint denomination is not canonical')
		const value = BigInt(amount)
		if (value > 0xffff_ffff_ffff_ffffn) refuse('DEMO_SIGALL_LIVE_DRIFT', 'mint denomination exceeds uint64')
		return value
	}).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
	const denominationAmounts = exactAmounts
		.filter((amount) => amount <= BigInt(Number.MAX_SAFE_INTEGER))
		.map(Number)
	if (denominationAmounts.length === 0) refuse('DEMO_SIGALL_LIVE_DRIFT', 'mint has no safely representable denomination')
	return {
		mintUrl: clientUrl,
		mintPublicKey: typeof info.pubkey === 'string' ? info.pubkey : '',
		serverVersion: typeof info.version === 'string' ? info.version : '',
		activeSatKeysetId: keyset.id,
		denominationKeyDigest: demoDenominationKeyDigest(keyset.keys),
		// The browser snapshot retains exact uint64 strings in the digest but exposes
		// only integers JavaScript can represent without rounding. Keep the live
		// preflight byte-for-byte aligned with that public seal.
		denominationAmounts,
		inputFeePpk,
		nuts: supportedNutNumbers(info.nuts),
	}
}

export function createCashuMintSigAllBranchAwarePort(options: {
	mintUrl: string
	transportMintUrl?: string
	fetchImpl?: typeof fetch
	nowSeconds?: () => number
}): DemoSigAllMintPort {
	const strictFetch = options.transportMintUrl === undefined
		? createOriginBoundMintFetch(options.mintUrl, options.fetchImpl ?? fetch)
		: createPinnedMintTransportFetch(options.mintUrl, options.transportMintUrl, options.fetchImpl ?? fetch)
	const client = new CashuMintClient({ mintUrl: options.mintUrl, fetchImpl: strictFetch })
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
	return Object.freeze({
		async swapExact(requestValue: DemoSigAllSwapRequest) {
			const request = structuredClone(requestValue)
			if (request.mintUrl.replace(/\/+$/, '') !== client.mintUrl) refuse('DEMO_SIGALL_LIVE_ORIGIN', 'request mint differs from pinned origin')
			const path = classifyDemoSigAllSpendPath(request)
			enforceTime(path, request, nowSeconds)
			const [info, keysets] = await Promise.all([client.info(), client.keysets()])
			const active = keysets.keysets.filter((entry) => entry.active && entry.unit === 'sat')
			if (active.length !== 1) refuse('DEMO_SIGALL_LIVE_DRIFT', 'mint must advertise exactly one active sat keyset')
			const keysResponse = await client.keys(active[0]!.id)
			const keyset = keysResponse.keysets.find((entry) => entry.id === active[0]!.id && entry.unit === 'sat')
			if (!keyset) refuse('DEMO_SIGALL_LIVE_DRIFT', 'active sat keyset keys are missing')
			const seal = exactSeal(client.mintUrl, info, keyset, active[0]!.input_fee_ppk ?? 0)
			if (JSON.stringify(seal) !== JSON.stringify(request.mintSeal)) refuse('DEMO_SIGALL_LIVE_DRIFT', 'live mint facts differ from approved seal')
			// Reclassify immutable bytes and recheck the branch-specific clock immediately before I/O.
			if (classifyDemoSigAllSpendPath(request) !== path) refuse('DEMO_SIGALL_LIVE_PATH', 'request path changed during preflight')
			enforceTime(path, request, nowSeconds)
			const result = await client.swap(request.inputs, request.outputs)
			if (result.signatures.length !== request.outputs.length) refuse('DEMO_SIGALL_LIVE_RESPONSE', 'mint returned wrong signature count')
			for (const [index, signature] of result.signatures.entries()) {
				const output = request.outputs[index]!
				if (signature.amount !== output.amount || signature.id !== output.id || !COMPRESSED_KEY.test(signature.C_)) refuse('DEMO_SIGALL_LIVE_RESPONSE', `signature ${index} differs from requested output`)
			}
			return result
		},
	})
}
