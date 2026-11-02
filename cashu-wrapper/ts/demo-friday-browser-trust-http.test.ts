import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFridayBrowserSellerPlanIntentHttp,
	createDemoFridayBrowserSellerPlanHttp,
	createDemoFridayBrowserTrustedAuctionFundingHttp,
	createDemoFridayBrowserTrustedDeploymentHttp,
} from './demo-friday-browser-trust-http'
import type { DemoFridaySellerWinnerPlanEnvelopeV1, DemoFridaySellerWinnerPlanPublicV1 } from './demo-friday-browser-coco-seller-plan'
import { demoDenominationKeyDigest, demoOutputsDigest } from './demo-sigall-settlement'

const origin = 'https://172.105.64.142'
const point = (value: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(value.toString(16).padStart(64, '0')), true))
const outputs = [{ amount: 1, id: '00aabbccddeeff11', B_: point(10) }, { amount: 2, id: '00aabbccddeeff11', B_: point(11) }]
const capability = { schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const, network: 'friday-network', chainId: 'friday-chain',
	auctionId: 'auction-1', operationId: 'funding-1', role: 'winner_settlement' as const, mintUrl: origin, unit: 'sat',
	recipientPublicKey: point(12), outputsDigest: demoOutputsDigest(outputs), signature: 'aa'.repeat(64) }
const winnerRequest = { capability, outputs }
const keys = { '1': point(20), '2': point(21), '4': point(22) }

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
})
