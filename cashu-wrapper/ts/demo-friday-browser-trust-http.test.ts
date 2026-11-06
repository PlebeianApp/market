import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFridayBrowserAuctionPayoutHttp,
	createDemoFridayBrowserSellerPlanIntentHttp,
	createDemoFridayBrowserSellerPlanHttp,
	createDemoFridayBrowserTrustedAuctionFundingHttp,
	createDemoFridayBrowserTrustedDeploymentHttp,
} from './demo-friday-browser-trust-http'
import type { DemoFridaySellerWinnerPlanEnvelopeV1, DemoFridaySellerWinnerPlanPublicV1 } from './demo-friday-browser-coco-seller-plan'
import type { DemoFridaySellerOpeningRefV1 } from './demo-friday-browser-coco-seller-plan'
import { prepareDemoFridayAuctionPayoutAuthorization, selectDemoFridayAuctionPayout } from './demo-friday-auction-payout-authorization'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'
import { demoDenominationKeyDigest, demoOutputsDigest } from './demo-sigall-settlement'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'

const origin = 'https://172.105.64.142'
const point = (value: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(value.toString(16).padStart(64, '0')), true))
const outputs = [{ amount: 1, id: '00aabbccddeeff11', B_: point(10) }, { amount: 2, id: '00aabbccddeeff11', B_: point(11) }]
const capability = { schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const, network: 'friday-network', chainId: 'friday-chain',
	auctionId: 'auction-1', operationId: 'funding-1', role: 'winner_settlement' as const, mintUrl: origin, unit: 'sat',
	recipientPublicKey: point(12), outputsDigest: demoOutputsDigest(outputs), signature: 'aa'.repeat(64) }
const winnerRequest = { capability, outputs }
// Nutshell advertises the full uint64 power-of-two keyset. The exact digest
// covers every key, while the browser's number[] snapshot excludes unsafe
// denominations such as 2^53.
const keys = { '1': point(20), '2': point(21), '4': point(22), '9007199254740992': point(23) }

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

const plan: DemoFridaySellerWinnerPlanPublicV1 = { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_V1',
	authNetworkId: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1', fundingOperationId: 'funding-1',
	sellerActor: '11'.repeat(32), bidderActor: '22'.repeat(32), bidAmount: 3, canonicalMintUrl: origin,
	activeSatKeysetId: '00aabbccddeeff11', denominationKeyDigest: demoDenominationKeyDigest(keys),
	recipientPublicKey: point(12), recipientPlan: winnerRequest, expiresAt: 2_000 }
const planDigest = bytesToHex(sha256(utf8ToBytes(canonical(plan))))
const registered = { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_REGISTERED_V1' as const,
	status: 'registered' as const, planDigest, plan }

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }

describe('Friday trusted browser same-origin HTTP ports', () => {
	test('maps only the fixed deployment, auction and seller-plan endpoints', async () => {
		const calls: Array<{ path: string; body: unknown; credentials: RequestCredentials | undefined; requestOrigin: string | null }> = []
		const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input)); const body = JSON.parse(String(init?.body)) as unknown
			calls.push({ path: url.pathname, body, credentials: init?.credentials,
				requestOrigin: new Headers(init?.headers).get('origin') })
			if (url.pathname === '/api/friday/deployment') return json({
				schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1', environmentId: 'friday-live',
				authNetworkId: 'friday-network', chainId: 'friday-chain', genesisSha256: '55'.repeat(32), canonicalMintUrl: origin,
				mintSnapshot: { mintUrl: origin, mintPublicKey: point(30), serverVersion: 'Nutshell/0.19.2',
					activeSatKeysetId: '00aabbccddeeff11', denominationKeyDigest: demoDenominationKeyDigest(keys),
					denominationAmounts: [1, 2, 4], inputFeePpk: 0, nuts: [4, 7, 9, 10, 11, 12] },
				keyset: { id: '00aabbccddeeff11', unit: 'sat', keys }, committeePublicKey: point(31),
				committeeKeysetId: 'committee-keyset', committeeKeysetVersion: 'v1', dkgRunId: 'dkg-run-1',
				publicKeyPackageSha256: '33'.repeat(32), signerRosterDigest: '44'.repeat(32),
				participants: [1, 2, 3, 4].map((identifier) => ({ identifier, verifyingShare: point(40 + identifier) })),
			})
			if (url.pathname === '/api/friday/auction-funding/read') return json({ schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1',
				auctionId: 'auction-1', leaderBidId: '', leaderActor: '', leaderBidAmount: 0,
				sellerPaymentPublicKey: point(12), winnerRequest })
			if (url.pathname === '/api/friday/seller-plan/challenge' || url.pathname === '/api/friday/seller-plan/intent') return json({ schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1',
				authNetworkId: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1', fundingOperationId: 'funding-1',
				sellerActor: '11'.repeat(32), bidderActor: '22'.repeat(32), bidAmount: 3,
				sellerPaymentPublicKey: point(12), canonicalMintUrl: origin,
				activeSatKeysetId: '00aabbccddeeff11', denominationKeyDigest: demoDenominationKeyDigest(keys), expiresAt: 2_000 })
			if (url.pathname === '/api/friday/seller-plan/pending') return json({
				schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_PENDING_RESULT_V1', challenges: [{
					schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1', authNetworkId: 'friday-network',
					chainId: 'friday-chain', auctionId: 'auction-1', fundingOperationId: 'funding-1',
					sellerActor: '11'.repeat(32), bidderActor: '22'.repeat(32), bidAmount: 3,
					sellerPaymentPublicKey: point(12),
					canonicalMintUrl: origin, activeSatKeysetId: '00aabbccddeeff11',
					denominationKeyDigest: demoDenominationKeyDigest(keys), expiresAt: 2_000,
				}],
			})
			if (url.pathname === '/api/friday/seller-plan/read') return json({ schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_READ_RESULT_V1', registered })
			if (url.pathname === '/api/friday/seller-plan/register') return json(registered)
			throw new Error(`unexpected path ${url.pathname}`)
		}
		const deployment = await createDemoFridayBrowserTrustedDeploymentHttp({ origin, fetchImpl }).readExact()
		expect(deployment.keyset.id).toBe('00aabbccddeeff11')
		const auction = await createDemoFridayBrowserTrustedAuctionFundingHttp({ origin, fetchImpl }).readExact({
			auctionId: 'auction-1', fundingOperationId: 'funding-1', fullPoolAmount: 3,
		})
		expect(auction.winnerRequest.outputs).toHaveLength(2)
		const plans = createDemoFridayBrowserSellerPlanHttp({ origin, fetchImpl })
		expect(await plans.listPendingExact('11'.repeat(32))).toHaveLength(1)
		expect((await createDemoFridayBrowserSellerPlanIntentHttp({ origin, fetchImpl }).issueExact({
			id: '77'.repeat(32), sig: '88'.repeat(64), pubkey: '22'.repeat(32), created_at: 1_900,
			kind: 28_649, tags: [], content: '{}',
		} as never)).bidAmount).toBe(3)
		expect((await plans.challengeExact({ sellerActor: '11'.repeat(32), auctionId: 'auction-1', fundingOperationId: 'funding-1' })).bidAmount).toBe(3)
		expect((await plans.readExact({ sellerActor: '11'.repeat(32), auctionId: 'auction-1', fundingOperationId: 'funding-1' }))?.planDigest).toBe(planDigest)
		const envelope = { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_ENVELOPE_V1', planDigest, plan,
			sellerAuthorization: { id: '55'.repeat(32), sig: '66'.repeat(64), pubkey: plan.sellerActor, created_at: 1_900,
				kind: 28_648, tags: [], content: '{}' } } satisfies DemoFridaySellerWinnerPlanEnvelopeV1
		expect((await plans.registerExact(envelope)).plan.auctionId).toBe('auction-1')
		expect(calls.map(({ path }) => path)).toEqual(['/api/friday/deployment', '/api/friday/auction-funding/read',
			'/api/friday/seller-plan/pending',
			'/api/friday/seller-plan/intent',
			'/api/friday/seller-plan/challenge', '/api/friday/seller-plan/read', '/api/friday/seller-plan/register'])
		expect(calls.every(({ credentials, requestOrigin }) => credentials === 'same-origin' && requestOrigin === origin)).toBe(true)
		expect(calls[0]?.body).toEqual({ schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_READ_V1' })
	})

	test('rejects cross-identity, extra-field and non-HTTPS responses before returning trusted data', async () => {
		const auction = createDemoFridayBrowserTrustedAuctionFundingHttp({ origin, fetchImpl: async () => json({
			schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1', auctionId: 'auction-other', leaderBidId: '',
			leaderActor: '', leaderBidAmount: 0, sellerPaymentPublicKey: point(12), winnerRequest,
		}) })
		await expect(auction.readExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1', fullPoolAmount: 3 }))
			.rejects.toThrow(/differs from the exact request/)
		const plans = createDemoFridayBrowserSellerPlanHttp({ origin, fetchImpl: async () => json({
			schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_READ_RESULT_V1', registered, extra: true,
		}) })
		await expect(plans.readExact({ sellerActor: '11'.repeat(32), auctionId: 'auction-1', fundingOperationId: 'funding-1' }))
			.rejects.toThrow(/unexpected fields/)
		expect(() => createDemoFridayBrowserTrustedDeploymentHttp({ origin: 'http://127.0.0.1' })).toThrow(/HTTPS origin/)
	})

	test('accepts canonical-equivalent key order for an exact auction payout selection', async () => {
		const sellerSecret = hexToBytes('13'.padStart(64, '0'))
		const sellerActor = bytesToHex(schnorr.getPublicKey(sellerSecret))
		const recipient = createDemoFridayPaymentSignerFromSecret(hexToBytes('12'.padStart(64, '0')))
		const rows = new Map<string, DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>>()
		try {
			const keyset = { id: '00aabbccddeeff11', unit: 'sat' as const, keys }
			const sellerPaymentPublicKey = await recipient.getPublicKey()
			const sign = (unsigned: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) => {
				const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
					0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
				]))))
				return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), sellerSecret)) }
			}
			const authorization = await prepareDemoFridayAuctionPayoutAuthorization({
				scope: {
					schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1', authNetworkId: 'friday-network',
					chainId: 'friday-chain', auctionId: 'auction-order', sellerActor, sellerPaymentPublicKey,
					canonicalMintUrl: origin, activeSatKeysetId: keyset.id,
					denominationKeyDigest: demoDenominationKeyDigest(keyset.keys), startingBid: 1, minIncrement: 1,
					reserve: 0, originalEndTime: 4_600, maximumEndTime: 5_200, maximumPayout: 3,
					validFrom: 1_000, validUntil: 5_800,
				},
				keyset,
				journal: {
					async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() },
					async load(scope) { return structuredClone(rows.get(scope) ?? null) },
					async savePrepared(scope, record) { rows.set(scope, structuredClone(record)) },
					async markImported() { throw new Error('unused') },
				},
				recipientKey: recipient,
				nostr: { async getPublicKey() { return sellerActor }, async signEvent(value) { return sign(value) } },
				nowSeconds: 1_000,
			})
			const selection = selectDemoFridayAuctionPayout({
				authorization, keyset, nowSeconds: 1_100,
				auction: {
					auctionId: 'auction-order', sellerActor, sellerPaymentPublicKey, status: 'open',
					startingBid: 1, minIncrement: 1, reserve: 0, originalEndTime: 4_600, endTime: 4_600,
					leaderBidId: '', leaderActor: '', leaderBidAmount: 0, stateHeight: 20, appHash: 'a'.repeat(64),
				},
				request: { auctionId: 'auction-order', fundingOperationId: 'funding-order',
					bidderActor: '4'.repeat(64), bidAmount: 3, replacesBidId: '' },
			})
			const sortedOutputKeys = selection.outputs.map((output) => ({ B_: output.B_, amount: output.amount, id: output.id }))
			const result = await createDemoFridayBrowserTrustedAuctionFundingHttp({ origin, fetchImpl: async () => json({
				schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1', auctionId: 'auction-order',
				leaderBidId: '', leaderActor: '', leaderBidAmount: 0, sellerPaymentPublicKey,
				winnerRequest: { capability: structuredClone(authorization.authorization.recipientCatalog.capability),
					outputs: sortedOutputKeys },
				winnerAuctionPayout: { authorization, selection: { ...selection, outputs: sortedOutputKeys }, keyset },
			}) }).readExact({ auctionId: 'auction-order', fundingOperationId: 'funding-order', fullPoolAmount: 3 })
			expect(result.winnerRequest.outputs.map(({ amount }) => amount)).toEqual([2, 1])
			expect(result.winnerAuctionPayout?.selection.selectionDigest).toBe(selection.selectionDigest)
		} finally { recipient.dispose() }
	})

	test('maps exact auction authorization and winner discovery without accepting a partial claim', async () => {
		const authorization = { schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_ENVELOPE_V1',
			authorizationDigest: 'a'.repeat(64), authorization: { auctionId: 'auction-1' },
			sellerAuthorization: { id: 'b'.repeat(64) } }
		const selection = {
			schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SELECTION_V1', authorizationDigest: 'a'.repeat(64),
			catalogOperationId: 'c'.repeat(64), auctionId: 'auction-1', fundingOperationId: 'funding-1',
			bidderActor: 'd'.repeat(64), bidAmount: 3, replacesBidId: '', stateHeight: 41,
			appHash: 'e'.repeat(64), selectedAt: 1_100, selectedIndexes: [0, 1], outputs,
			recipientPublicKey: point(12), selectionDigest: 'f'.repeat(64),
		}
		const winner = { schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_CLAIM_V1', auctionId: 'auction-1',
			authorizationDigest: 'a'.repeat(64), fundingOperationId: 'funding-1',
			selectionDigest: 'f'.repeat(64), selection, outcomeHeight: 50, closedAt: 2_100 }
		const calls: string[] = []
		const payout = createDemoFridayBrowserAuctionPayoutHttp({ origin, fetchImpl: async (input) => {
			const path = new URL(String(input)).pathname
			calls.push(path)
			if (path.endsWith('/register')) return json(authorization)
			if (path.endsWith('/read')) return json({ schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_READ_RESULT_V1', authorization })
			if (path.endsWith('/winner')) return json({ schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_READ_RESULT_V1', winner })
			throw new Error(`unexpected path ${path}`)
		} })
		expect((await payout.registerExact(authorization as never)).authorizationDigest).toBe('a'.repeat(64))
		expect((await payout.readExact('auction-1'))?.authorizationDigest).toBe('a'.repeat(64))
		expect((await payout.readWinnerExact('auction-1'))?.selection.bidAmount).toBe(3)
		expect(calls).toEqual(['/api/friday/auction-payout/register', '/api/friday/auction-payout/read',
			'/api/friday/auction-payout/winner'])

		const partial = createDemoFridayBrowserAuctionPayoutHttp({ origin, fetchImpl: async () => json({
			schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_READ_RESULT_V1', winner: {
				schema: winner.schema, auctionId: winner.auctionId, authorizationDigest: winner.authorizationDigest,
				fundingOperationId: winner.fundingOperationId, selectionDigest: winner.selectionDigest,
			},
		}) })
		await expect(partial.readWinnerExact('auction-1')).rejects.toThrow(/unexpected fields/)
	})
})
