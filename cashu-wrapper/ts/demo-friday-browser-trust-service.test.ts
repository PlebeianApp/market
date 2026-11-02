import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { prepareDemoFridaySellerWinnerPlan, type DemoFridaySellerOpeningRefV1 } from './demo-friday-browser-coco-seller-plan'
import {
	createDemoFridayBrowserTrustService,
	demoFridaySellerPlanIntentUnsignedEvent,
	DemoFridaySellerPlanMemoryRegistry,
	type DemoFridayAuthenticatedAuctionV1,
	type DemoFridaySellerPlanIntentContentV1,
} from './demo-friday-browser-trust-service'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'

const bidderSecret = hexToBytes('21'.padStart(64, '0'))
const sellerSecret = hexToBytes('22'.padStart(64, '0'))
const recipientSecret = hexToBytes('23'.padStart(64, '0'))
const bidderActor = bytesToHex(schnorr.getPublicKey(bidderSecret))
const sellerActor = bytesToHex(schnorr.getPublicKey(sellerSecret))
const sellerPaymentPublicKey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true))

function compressed(value: number): string {
	return bytesToHex(secp256k1.getPublicKey(hexToBytes(value.toString(16).padStart(64, '0')), true))
}

const keyset = { id: '00trust', unit: 'sat' as const,
	keys: Object.fromEntries([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024].map((amount, index) => [String(amount), compressed(40 + index)])) }

const deployment = {
	schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1' as const,
	environmentId: 'friday-test', authNetworkId: 'friday-network', chainId: 'friday-chain', genesisSha256: '6'.repeat(64),
	canonicalMintUrl: 'https://172.105.64.142',
	mintSnapshot: { mintUrl: 'https://172.105.64.142', mintPublicKey: compressed(70), serverVersion: 'Nutshell/0.19.2',
		activeSatKeysetId: keyset.id, denominationKeyDigest: demoDenominationKeyDigest(keyset.keys),
		denominationAmounts: Object.keys(keyset.keys).map(Number), inputFeePpk: 0, nuts: [4, 7, 9, 10, 11, 12] },
	keyset, committeePublicKey: compressed(71), committeeKeysetId: 'committee-1',
	committeeKeysetVersion: 'version-1', dkgRunId: 'dkg-1', publicKeyPackageSha256: '7'.repeat(64),
	signerRosterDigest: '8'.repeat(64), participants: [
		{ identifier: 1 as const, verifyingShare: compressed(81) },
		{ identifier: 2 as const, verifyingShare: compressed(82) },
		{ identifier: 3 as const, verifyingShare: compressed(83) },
		{ identifier: 4 as const, verifyingShare: compressed(84) },
	] as [{ identifier: 1; verifyingShare: string }, { identifier: 2; verifyingShare: string },
		{ identifier: 3; verifyingShare: string }, { identifier: 4; verifyingShare: string }],
}

function signed(unsigned: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }, secret: Uint8Array) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), secret)) }
}

function intent(now = 1_000, overrides: Partial<DemoFridaySellerPlanIntentContentV1> = {}) {
	const content: DemoFridaySellerPlanIntentContentV1 = {
		schema: 'PLEBEIAN_FRIDAY_SELLER_PLAN_INTENT_V1', authNetworkId: deployment.authNetworkId,
		chainId: deployment.chainId, auctionId: 'auction-1', fundingOperationId: 'funding-1',
		bidAmount: 600, fullPoolAmount: 600, replacesBidId: '', canonicalMintUrl: deployment.canonicalMintUrl,
		expiresAt: now + 200, ...overrides,
	}
	return signed(demoFridaySellerPlanIntentUnsignedEvent(bidderActor, now, content), bidderSecret)
}

function fixture() {
	let now = 1_000
	let auction: DemoFridayAuthenticatedAuctionV1 = {
		schema: 'PLEBEIAN_FRIDAY_AUTHENTICATED_AUCTION_V1', authNetworkId: deployment.authNetworkId,
		chainId: deployment.chainId, auctionId: 'auction-1', status: 'open', fundingMode: 'threshold_sigall_v1',
		sellerActor, sellerPaymentPublicKey, leaderBidId: '', leaderActor: '', leaderBidAmount: 0,
		stateHeight: 40, appHash: '9'.repeat(64), evidenceDigest: 'a'.repeat(64),
	}
	const registry = new DemoFridaySellerPlanMemoryRegistry()
	const service = createDemoFridayBrowserTrustService({
		deployment: { async readExact() { return structuredClone(deployment) } },
		auctions: { async readExact() { return structuredClone(auction) } }, registry, nowSeconds: () => now,
	})
	return { service, setNow(value: number) { now = value }, setAuction(value: DemoFridayAuthenticatedAuctionV1) { auction = structuredClone(value) }, getAuction() { return structuredClone(auction) } }
}

async function registerPlan(subject: ReturnType<typeof fixture>) {
	const challenge = await subject.service.issueSellerPlanChallengeExact(intent())
	const rows = new Map<string, DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>>()
	const recipient = createDemoFridayPaymentSignerFromSecret(recipientSecret)
	try {
		const envelope = await prepareDemoFridaySellerWinnerPlan({
			challenge, keyset, nowSeconds: 1_000,
			journal: {
				async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() },
				async load(scope) { return structuredClone(rows.get(scope) ?? null) },
				async savePrepared(scope, record) { rows.set(scope, structuredClone(record)) },
				async markImported() { throw new Error('unused') },
			},
			recipientKey: recipient,
			nostr: { async getPublicKey() { return sellerActor }, async signEvent(value) { return signed(value, sellerSecret) } },
		})
		return await subject.service.registerSellerPlanExact(envelope)
	} finally { recipient.dispose() }
}

describe('Friday fixed browser trust service', () => {
	test('derives challenge and trusted funding only from signed intent, fixed deployment, and authenticated auction', async () => {
		const subject = fixture()
		const envelope = await registerPlan(subject)
		expect((await subject.service.readSellerPlanChallengeExact({ sellerActor, auctionId: 'auction-1',
			fundingOperationId: 'funding-1' })).bidderActor).toBe(bidderActor)
		expect((await subject.service.readSellerPlanExact({ sellerActor, auctionId: 'auction-1',
			fundingOperationId: 'funding-1' }))?.planDigest).toBe(envelope.planDigest)
		const trusted = await subject.service.readAuctionFundingExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1', fullPoolAmount: 600 })
		expect(trusted.leaderBidId).toBe('')
		expect(trusted.winnerRequest).toEqual(envelope.plan.recipientPlan)
		await subject.service.assertRegisteredWinnerExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1',
			bidderActor, bidAmount: 600, winnerRequest: trusted.winnerRequest })
	})

	test('rejects unsigned/request-substituted identity, expiry, replay conflict, and changed consensus leader', async () => {
		const unsigned = intent()
		unsigned.sig = '0'.repeat(128)
		await expect(fixture().service.issueSellerPlanChallengeExact(unsigned)).rejects.toThrow(/signature/)

		const expired = fixture(); expired.setNow(1_301)
		await expect(expired.service.issueSellerPlanChallengeExact(intent())).rejects.toThrow(/expired/)

		const replay = fixture()
		await replay.service.issueSellerPlanChallengeExact(intent())
		await expect(replay.service.issueSellerPlanChallengeExact(intent(1_000, { bidAmount: 601, fullPoolAmount: 601 })))
			.rejects.toThrow(/another challenge/)

		const changed = fixture()
		await registerPlan(changed)
		changed.setAuction({ ...changed.getAuction(), leaderBidId: 'b'.repeat(64), leaderActor: 'c'.repeat(64), leaderBidAmount: 500 })
		await expect(changed.service.readAuctionFundingExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1', fullPoolAmount: 600 }))
			.rejects.toThrow(/changed after seller challenge/)
	})

	test('seller registration is immutable and exact winner capability cannot be substituted', async () => {
		const subject = fixture(), envelope = await registerPlan(subject)
		// Discovery includes a registered plan until expiry so an accepted
		// registration with a lost HTTP response can be recovered by the seller.
		expect((await subject.service.listSellerPlanChallengesExact(sellerActor)).map((entry) => entry.fundingOperationId))
			.toEqual(['funding-1'])
		expect(await subject.service.registerSellerPlanExact(envelope)).toEqual(envelope)
		const changed = structuredClone(envelope)
		changed.plan.recipientPlan.outputs[0]!.amount += 1
		await expect(subject.service.registerSellerPlanExact(changed)).rejects.toThrow()
		const winner = structuredClone(envelope.plan.recipientPlan)
		winner.outputs[0]!.B_ = compressed(90)
		await expect(subject.service.assertRegisteredWinnerExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1',
			bidderActor, bidAmount: 600, winnerRequest: winner })).rejects.toThrow()
	})

	test('rejects a seller payout key that differs before any winner plan can register or fund', async () => {
		const subject = fixture()
		subject.setAuction({ ...subject.getAuction(), sellerPaymentPublicKey: compressed(72) })
		await expect(registerPlan(subject)).rejects.toThrow(/recipient identity differs/)
	})
})
