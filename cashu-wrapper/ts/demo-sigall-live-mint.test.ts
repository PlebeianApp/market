import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	classifyDemoSigAllSpendPath,
	createCashuMintSigAllBranchAwarePort,
} from './demo-sigall-live-mint'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoDenominationKeyDigest,
	demoSigAllSettlementCutoff,
	type DemoSigAllSwapRequest,
} from './demo-sigall-settlement'

const scalar = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (privateKey: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))
const sign = (digest: string, privateKey: string): string => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(privateKey)))
const BIDDER_PRIVATE = scalar(1)
const COMMITTEE_PRIVATE = scalar(2)
const REFUND_PRIVATE = scalar(3)
const BIDDER_PUBLIC = publicKey(BIDDER_PRIVATE)
const COMMITTEE_PUBLIC = publicKey(COMMITTEE_PRIVATE)
const REFUND_PUBLIC = publicKey(REFUND_PRIVATE)
const MINT_URL = 'https://mint.example'
const KEYSET = 'keyset-1'
const LOCKTIME = 2_000_000_000
const MINT_KEY = publicKey(scalar(20))

function request(path: 'MAIN' | 'REFUND'): DemoSigAllSwapRequest {
	const inputs: DemoSigAllSwapRequest['inputs'] = [{
		amount: 1,
		id: KEYSET,
		secret: buildDemoSigAllSecret({ nonce: '01'.repeat(32), bidderPublicKey: BIDDER_PUBLIC, committeePublicKey: COMMITTEE_PUBLIC, refundPublicKey: REFUND_PUBLIC, locktime: LOCKTIME }),
		C: publicKey(scalar(30)),
	}]
	const outputs = [{ amount: 1, id: KEYSET, B_: publicKey(scalar(40)) }]
	const digest = demoCashuSigAllDigest(inputs, outputs)
	inputs[0]!.witness = JSON.stringify({ signatures: path === 'MAIN'
		? [sign(digest, BIDDER_PRIVATE), sign(digest, COMMITTEE_PRIVATE)]
		: [sign(digest, REFUND_PRIVATE)] })
	return {
		schema: 'COCO_DEMO_SIGALL_SWAP_V1', mintUrl: MINT_URL, operationId: 'operation-1', locktime: LOCKTIME,
		packageDigest: '44'.repeat(32), cashuSigAllDigest: digest, recipientCapabilityDigest: '55'.repeat(32),
		mintSeal: {
			mintUrl: MINT_URL, mintPublicKey: MINT_KEY, serverVersion: 'test-mint', activeSatKeysetId: KEYSET,
			denominationKeyDigest: demoDenominationKeyDigest({ 1: MINT_KEY }), denominationAmounts: [1], inputFeePpk: 0, nuts: [7, 10, 11],
		}, inputs, outputs,
	}
}

function scriptedFetch(calls: string[], origins?: string[]): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
		calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
		origins?.push(url.origin)
		const json = (body: unknown): Response => {
			const response = Response.json(body)
			Object.defineProperty(response, 'url', { value: url.href })
			return response
		}
		if (url.pathname === '/v1/info') return json({ version: 'test-mint', pubkey: MINT_KEY, nuts: { 7: { supported: true }, 10: { supported: true }, 11: { supported: true } } })
		if (url.pathname === '/v1/keysets') return json({ keysets: [{ id: KEYSET, unit: 'sat', active: true, input_fee_ppk: 0 }] })
		if (url.pathname === `/v1/keys/${KEYSET}`) return json({ keysets: [{ id: KEYSET, unit: 'sat', keys: { 1: MINT_KEY } }] })
		if (url.pathname === '/v1/swap') return json({ signatures: [{ amount: 1, id: KEYSET, C_: publicKey(scalar(50)) }] })
		const response = new Response('unexpected', { status: 500 })
		Object.defineProperty(response, 'url', { value: url.href })
		return response
	}) as typeof fetch
}

describe('branch-aware live SIG_ALL mint adapter', () => {
	test('derives MAIN versus REFUND only from exact canonical witness bytes', () => {
		expect(classifyDemoSigAllSpendPath(request('MAIN'))).toBe('MAIN')
		expect(classifyDemoSigAllSpendPath(request('REFUND'))).toBe('REFUND')
		const malicious = request('REFUND')
		malicious.inputs[0]!.witness = request('MAIN').inputs[0]!.witness
		expect(classifyDemoSigAllSpendPath(malicious)).toBe('MAIN')
		const extra = request('REFUND')
		extra.inputs[0]!.witness = JSON.stringify({ signatures: [sign(extra.cashuSigAllDigest, REFUND_PRIVATE)], mode: 'REFUND' })
		expect(() => classifyDemoSigAllSpendPath(extra)).toThrow(/witness must contain only signatures/)
	})

	test('post-locktime REFUND reaches the strict injected transport and late MAIN never does', async () => {
		const refundCalls: string[] = []
		const refundPort = createCashuMintSigAllBranchAwarePort({ mintUrl: MINT_URL, fetchImpl: scriptedFetch(refundCalls), nowSeconds: () => LOCKTIME })
		await expect(refundPort.swapExact(request('REFUND'))).resolves.toMatchObject({ signatures: [{ amount: 1, id: KEYSET }] })
		expect(refundCalls).toContain('POST /v1/swap')

		for (const now of [demoSigAllSettlementCutoff(LOCKTIME), LOCKTIME - 1, LOCKTIME, LOCKTIME + 1]) {
			const calls: string[] = []
			const port = createCashuMintSigAllBranchAwarePort({ mintUrl: MINT_URL, fetchImpl: scriptedFetch(calls), nowSeconds: () => now })
			await expect(port.swapExact(request('MAIN'))).rejects.toMatchObject({ code: 'DEMO_SIGALL_LIVE_MAIN_CUTOFF' })
			expect(calls).toEqual([])
		}
	})

	test('preserves the public Cashu identity while all server I/O uses the pinned FIPS transport', async () => {
		const calls: string[] = [], origins: string[] = []
		const port = createCashuMintSigAllBranchAwarePort({
			mintUrl: MINT_URL, transportMintUrl: 'http://[fd42::1]:3438',
			fetchImpl: scriptedFetch(calls, origins), nowSeconds: () => LOCKTIME,
		})
		await expect(port.swapExact(request('REFUND'))).resolves.toMatchObject({ signatures: [{ amount: 1 }] })
		expect(calls).toContain('POST /v1/swap')
		expect(new Set(origins)).toEqual(new Set(['http://[fd42::1]:3438']))
	})

	test('pre-locktime REFUND and clock-crossing MAIN fail before swap', async () => {
		const earlyCalls: string[] = []
		const early = createCashuMintSigAllBranchAwarePort({ mintUrl: MINT_URL, fetchImpl: scriptedFetch(earlyCalls), nowSeconds: () => LOCKTIME - 1 })
		await expect(early.swapExact(request('REFUND'))).rejects.toMatchObject({ code: 'DEMO_SIGALL_LIVE_REFUND_NOT_EXPIRED' })
		expect(earlyCalls).toEqual([])

		const crossingCalls: string[] = []
		let reads = 0
		const crossing = createCashuMintSigAllBranchAwarePort({
			mintUrl: MINT_URL, fetchImpl: scriptedFetch(crossingCalls),
			nowSeconds: () => reads++ === 0 ? demoSigAllSettlementCutoff(LOCKTIME) - 1 : demoSigAllSettlementCutoff(LOCKTIME),
		})
		await expect(crossing.swapExact(request('MAIN'))).rejects.toMatchObject({ code: 'DEMO_SIGALL_LIVE_MAIN_CUTOFF' })
		expect(crossingCalls).not.toContain('POST /v1/swap')
	})
})
