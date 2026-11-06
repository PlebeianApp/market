import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayAuctionPayoutCatalogAmounts,
	prepareDemoFridayAuctionPayoutAuthorization,
	selectDemoFridayAuctionPayout,
	verifyDemoFridayAuctionPayoutAuthorization,
	verifyDemoFridayAuctionPayoutSelection,
	type DemoFridayAuctionPayoutAuthorizationEnvelopeV1,
	type DemoFridayAuctionPayoutLiveAuctionV1,
} from './demo-friday-auction-payout-authorization'
import type { DemoFridaySellerOpeningRefV1 } from './demo-friday-browser-coco-seller-plan'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'

const actorSecret = hexToBytes('31'.padStart(64, '0'))
const sellerActor = bytesToHex(schnorr.getPublicKey(actorSecret))
const recipientSecret = hexToBytes('32'.padStart(64, '0'))
const bidderA = '4'.repeat(64), bidderB = '5'.repeat(64)
const now = 1_000

function compressed(value: number): string {
	return bytesToHex(secp256k1.getPublicKey(hexToBytes(value.toString(16).padStart(64, '0')), true))
}

function signed(unsigned: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), actorSecret)) }
}

function clone<T>(value: T): T { return structuredClone(value) }

function fixture() {
	const keyset = { id: '00auction', unit: 'sat' as const,
		keys: Object.fromEntries([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768]
			.map((amount, index) => [String(amount), compressed(80 + index)])) }
	const rows = new Map<string, DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>>()
	const recipient = createDemoFridayPaymentSignerFromSecret(recipientSecret)
	const controls = { nostrSigns: 0, recipientSigns: 0 }
	const scope = {
		schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1' as const,
		authNetworkId: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1',
		sellerActor, sellerPaymentPublicKey: '' as string,
		canonicalMintUrl: 'https://172.105.64.142', activeSatKeysetId: keyset.id,
		denominationKeyDigest: demoDenominationKeyDigest(keyset.keys),
		startingBid: 100, minIncrement: 10, reserve: 0,
		originalEndTime: 4_600, maximumEndTime: 5_200, maximumPayout: 50_000,
		validFrom: now, validUntil: 5_800,
	}
	const journal = {
		async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() },
		async load(scopeValue: string) { return clone(rows.get(scopeValue) ?? null) },
		async savePrepared(scopeValue: string, record: DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>) {
			rows.set(scopeValue, clone(record))
		},
		async markImported() { throw new Error('unused') },
	}
	return { keyset, rows, recipient, controls, scope, journal }
}

async function prepared() {
	const held = fixture()
	held.scope.sellerPaymentPublicKey = await held.recipient.getPublicKey()
	const envelope = await prepareDemoFridayAuctionPayoutAuthorization({
		scope: held.scope, keyset: held.keyset, journal: held.journal,
		recipientKey: {
			getPublicKey: () => held.recipient.getPublicKey(),
			async signRecipientCapability(value) {
				held.controls.recipientSigns += 1
				return held.recipient.signRecipientCapability(value)
			},
		},
		nostr: {
			async getPublicKey() { return sellerActor },
			async signEvent(value) { held.controls.nostrSigns += 1; return signed(value) },
		},
		nowSeconds: now,
	})
	const auction: DemoFridayAuctionPayoutLiveAuctionV1 = {
		auctionId: 'auction-1', sellerActor, sellerPaymentPublicKey: held.scope.sellerPaymentPublicKey,
		status: 'open', startingBid: 100, minIncrement: 10, reserve: 0,
		originalEndTime: 4_600, endTime: 4_600,
		leaderBidId: '', leaderActor: '', leaderBidAmount: 0,
		stateHeight: 20, appHash: 'a'.repeat(64),
	}
	return { ...held, envelope, auction }
}

describe('auction-scoped offline seller payout authorization', () => {
	test('signs once, keeps openings private, and selects many exact bid payouts without the seller', async () => {
		const held = await prepared()
		try {
			expect(held.controls).toEqual({ nostrSigns: 1, recipientSigns: 1 })
			expect(demoFridayAuctionPayoutCatalogAmounts(50_000, held.keyset))
				.toEqual([32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1])
			const first = selectDemoFridayAuctionPayout({ authorization: held.envelope, keyset: held.keyset,
				nowSeconds: 1_100, auction: held.auction,
				request: { auctionId: 'auction-1', fundingOperationId: 'funding-a', bidderActor: bidderA,
					bidAmount: 111, replacesBidId: '' } })
			expect(first.outputs.map(({ amount }) => amount)).toEqual([64, 32, 8, 4, 2, 1])
			expect(first.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(111)
			expect(verifyDemoFridayAuctionPayoutSelection(first, { authorization: held.envelope,
				keyset: held.keyset, nowSeconds: 1_100, auction: held.auction })).toEqual(first)

			const leaderBidId = 'b'.repeat(64)
			const secondAuction = { ...held.auction, leaderBidId, leaderActor: bidderA, leaderBidAmount: 111, stateHeight: 21 }
			const second = selectDemoFridayAuctionPayout({ authorization: held.envelope, keyset: held.keyset,
				nowSeconds: 1_101, auction: secondAuction,
				request: { auctionId: 'auction-1', fundingOperationId: 'funding-b', bidderActor: bidderB,
					bidAmount: 50_000, replacesBidId: leaderBidId } })
			expect(second.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(50_000)
			expect(held.controls).toEqual({ nostrSigns: 1, recipientSigns: 1 })

			const publicJson = JSON.stringify(held.envelope)
			const privateRecord = [...held.rows.values()][0]!
			for (const opening of privateRecord.privateOpeningRefs) {
				expect(publicJson).not.toContain(opening.secret)
				expect(publicJson).not.toContain(opening.r)
			}
			expect(publicJson).not.toContain(bytesToHex(recipientSecret))
		} finally { held.recipient.dispose() }
	})

	test('fails closed on changed payout identity, auction terms, stale leader, self-bid, cap, and expiry', async () => {
		const held = await prepared()
		try {
			const base = { authorization: held.envelope, keyset: held.keyset, nowSeconds: 1_100, auction: held.auction,
				request: { auctionId: 'auction-1', fundingOperationId: 'funding-a', bidderActor: bidderA,
					bidAmount: 111, replacesBidId: '' } }
			for (const changed of [
				{ ...base, auction: { ...held.auction, sellerPaymentPublicKey: compressed(70) } },
				{ ...base, auction: { ...held.auction, minIncrement: 11 } },
				{ ...base, request: { ...base.request, bidderActor: sellerActor } },
				{ ...base, request: { ...base.request, bidAmount: 50_001 } },
				{ ...base, nowSeconds: 5_801 },
			]) expect(() => selectDemoFridayAuctionPayout(changed)).toThrow(/DEMO_FRIDAY_AUCTION_PAYOUT/)

			const stale = { ...held.auction, leaderBidId: 'c'.repeat(64), leaderActor: bidderB, leaderBidAmount: 200 }
			expect(() => selectDemoFridayAuctionPayout({ ...base, auction: stale,
				request: { ...base.request, bidderActor: bidderA, bidAmount: 210, replacesBidId: 'd'.repeat(64) } }))
				.toThrow(/stale|policy/)
		} finally { held.recipient.dispose() }
	})

	test('rejects catalog, capability, authorization, and selection tampering', async () => {
		const held = await prepared()
		try {
			const mutations: Array<(value: DemoFridayAuctionPayoutAuthorizationEnvelopeV1) => void> = [
				(value) => { value.authorization.recipientCatalog.outputs[0]!.B_ = compressed(74) },
				(value) => { value.authorization.recipientCatalog.capability.signature = '0'.repeat(128) },
				(value) => { value.authorization.sellerPaymentPublicKey = compressed(75) },
				(value) => { value.sellerAuthorization.sig = '0'.repeat(128) },
			]
			for (const mutate of mutations) {
				const changed = clone(held.envelope); mutate(changed)
				expect(() => verifyDemoFridayAuctionPayoutAuthorization(changed, held.keyset, 1_100))
					.toThrow(/DEMO_FRIDAY_AUCTION_PAYOUT/)
			}
			const selection = selectDemoFridayAuctionPayout({ authorization: held.envelope, keyset: held.keyset,
				nowSeconds: 1_100, auction: held.auction,
				request: { auctionId: 'auction-1', fundingOperationId: 'funding-a', bidderActor: bidderA,
					bidAmount: 111, replacesBidId: '' } })
			selection.outputs[0]!.amount += 1
			expect(() => verifyDemoFridayAuctionPayoutSelection(selection, { authorization: held.envelope,
				keyset: held.keyset, nowSeconds: 1_100, auction: held.auction })).toThrow(/changed/)
		} finally { held.recipient.dispose() }
	})

	test('replays the exact prepared catalog without additional signatures or openings', async () => {
		const held = await prepared()
		try {
			const before = clone([...held.rows.values()])
			const replay = await prepareDemoFridayAuctionPayoutAuthorization({
				scope: held.scope, keyset: held.keyset, journal: held.journal,
				recipientKey: {
					getPublicKey: () => held.recipient.getPublicKey(),
					async signRecipientCapability(value) {
						held.controls.recipientSigns += 1
						return held.recipient.signRecipientCapability(value)
					},
				},
				nostr: { async getPublicKey() { return sellerActor }, async signEvent(value) {
					held.controls.nostrSigns += 1; return signed(value)
				} },
				nowSeconds: now,
			})
			expect(replay.authorization).toEqual(held.envelope.authorization)
			expect(replay.authorizationDigest).toBe(held.envelope.authorizationDigest)
			expect(replay.sellerAuthorization.id).toBe(held.envelope.sellerAuthorization.id)
			expect(clone([...held.rows.values()])).toEqual(before)
			// Recipient capability is replayed from the private journal. The one
			// Nostr event remains explicit consent for each create/recover call.
			expect(held.controls).toEqual({ nostrSigns: 2, recipientSigns: 1 })
		} finally { held.recipient.dispose() }
	})
})
