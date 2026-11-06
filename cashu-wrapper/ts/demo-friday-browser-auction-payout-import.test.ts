import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createBlindSignature, createDLEQProof, pointFromHex } from '@cashu/cashu-ts'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { importDemoFridayAuctionPayoutWinner } from './demo-friday-browser-auction-payout-import'
import {
	createDemoFridayAuctionPayoutAuthority,
	DemoFridayAuctionPayoutRegistrySqlite,
	DemoFridayAuctionPayoutRollbackAnchorSqlite,
} from './demo-friday-auction-payout-runtime'
import { prepareDemoFridayAuctionPayoutAuthorization } from './demo-friday-auction-payout-authorization'
import type { DemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import type { DemoFridayBrowserPaymentStatePort, DemoFridayBrowserOpeningRefV1 } from './demo-friday-browser-payment-state'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'
import { demoRecipientCapabilityDigest, demoDenominationKeyDigest } from './demo-sigall-settlement'

const mintUrl = 'https://172.105.64.142'
const sellerSecret = hexToBytes('11'.padStart(64, '0'))
const recipientSecret = hexToBytes('12'.padStart(64, '0'))
const sellerActor = bytesToHex(schnorr.getPublicKey(sellerSecret))
const recipientPublicKey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true))
const amounts = Array.from({ length: 16 }, (_, index) => 2 ** index)
const mintSecret = (amount: number) => hexToBytes((amounts.indexOf(amount) + 41).toString(16).padStart(64, '0'))
const keyset = { id: '00aabbccddeeff11', unit: 'sat' as const,
	keys: Object.fromEntries(amounts.map((amount) => [String(amount), bytesToHex(secp256k1.getPublicKey(mintSecret(amount), true))])) }

function signed(unsigned: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, unsigned.pubkey, unsigned.created_at,
		unsigned.kind, unsigned.tags, unsigned.content]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), sellerSecret)) }
}

class MemoryState {
	readonly rows = new Map<string, DemoRecipientPrivateRecord<DemoFridayBrowserOpeningRefV1>>()
	readonly acks = new Map<string, any>()
	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() }
	async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>): Promise<T> { return run() }
	async load(scope: string) { return structuredClone(this.rows.get(scope) ?? null) }
	async savePrepared(scope: string, record: DemoRecipientPrivateRecord<DemoFridayBrowserOpeningRefV1>) {
		const prior = this.rows.get(scope)
		if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error('journal conflict')
		this.rows.set(scope, structuredClone(record))
	}
	async markImported(scope: string, requestDigest: string, responseDigest: string) {
		const prior = this.rows.get(scope)
		if (prior === undefined || prior.requestDigest !== requestDigest) throw new Error('journal absent')
		this.rows.set(scope, { ...prior, importedResponseDigest: responseDigest })
	}
	async loadSellerTerminalAck(identity: { fundingOperationId: string }) {
		return structuredClone(this.acks.get(identity.fundingOperationId) ?? null)
	}
	async saveSellerTerminalAck(record: { fundingOperationId: string }) {
		const prior = this.acks.get(record.fundingOperationId)
		if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error('ack conflict')
		this.acks.set(record.fundingOperationId, structuredClone(record))
	}
}

describe('offline seller catalog terminal import', () => {
	test('authorizes once, selects bids while seller is absent, fences one winner, and imports only its payout', async () => {
		const state = new MemoryState(), now = 1_000
		let recipientSignatures = 0, nostrSignatures = 0
		const authorization = await prepareDemoFridayAuctionPayoutAuthorization({
			scope: { schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1', authNetworkId: 'network', chainId: 'chain',
				auctionId: 'auction-1', sellerActor, sellerPaymentPublicKey: recipientPublicKey,
				canonicalMintUrl: mintUrl, activeSatKeysetId: keyset.id,
				denominationKeyDigest: demoDenominationKeyDigest(keyset.keys), startingBid: 100, minIncrement: 100,
				reserve: 0, originalEndTime: 4_600, maximumEndTime: 6_400, maximumPayout: 50_000,
				validFrom: now, validUntil: 7_300 },
			keyset, journal: state,
			recipientKey: { async getPublicKey() { return recipientPublicKey }, async signRecipientCapability(value) {
				recipientSignatures += 1; return bytesToHex(schnorr.sign(hexToBytes(value.digest), recipientSecret))
			} },
			nostr: { async getPublicKey() { return sellerActor }, async signEvent(value) {
				nostrSignatures += 1; return signed(value)
			} }, nowSeconds: now,
		})
		const registryDb = new Database(':memory:'), anchorDb = new Database(':memory:')
		const registry = new DemoFridayAuctionPayoutRegistrySqlite(registryDb, 'deployment',
			new DemoFridayAuctionPayoutRollbackAnchorSqlite(anchorDb, true))
		let auction = { auctionId: 'auction-1', sellerActor, sellerPaymentPublicKey: recipientPublicKey,
			status: 'open' as const, startingBid: 100, minIncrement: 100, reserve: 0,
			originalEndTime: 4_600, endTime: 4_600, leaderBidId: '', leaderActor: '', leaderBidAmount: 0,
			stateHeight: 10, appHash: 'aa'.repeat(32) }
		const authority = createDemoFridayAuctionPayoutAuthority({ keyset, registry,
			auctions: { async readExact() { return structuredClone(auction) } }, nowSeconds: () => now })
		await authority.registerExact(authorization)
		const first = (await authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1',
			bidderActor: '21'.repeat(32), bidAmount: 100, replacesBidId: '' }))!
		auction = { ...auction, leaderBidId: '31'.repeat(32), leaderActor: first.bidderActor,
			leaderBidAmount: first.bidAmount, stateHeight: 11, appHash: 'bb'.repeat(32) }
		const winner = (await authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-2',
			bidderActor: '22'.repeat(32), bidAmount: 300, replacesBidId: auction.leaderBidId }))!
		expect({ recipientSignatures, nostrSignatures }).toEqual({ recipientSignatures: 1, nostrSignatures: 1 })
		const claim = await authority.claimWinnerExact({ selection: winner, outcome: {
			schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_OUTCOME_V1', auctionId: 'auction-1',
			winnerFundingOperationId: 'funding-2', winnerActor: winner.bidderActor, winningAmount: 300,
			stateHeight: 20, appHash: 'cc'.repeat(32), closedAt: 4_600,
		} })
		await expect(authority.claimWinnerExact({ selection: first, outcome: {
			schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_OUTCOME_V1', auctionId: 'auction-1',
			winnerFundingOperationId: 'funding-1', winnerActor: first.bidderActor, winningAmount: 100,
			stateHeight: 20, appHash: 'cc'.repeat(32), closedAt: 4_600,
		} })).rejects.toThrow(/another winner/)

		let walletImports = 0, acknowledgements = 0
		const wallet = { actor: sellerActor, mintUrl, seedLocation: 'indexeddb',
			async importTerminalToken() { walletImports += 1; return { operationId: 'funding-2', state: 'finalized' as const } },
			sellerRecipientKey: { async getPublicKey() { return recipientPublicKey },
				async signRecipientCapability() { throw new Error('seller must not reauthorize at settlement') },
				async signTerminalAck(value: { digest: string }) { return bytesToHex(schnorr.sign(hexToBytes(value.digest), recipientSecret)) } },
		} as unknown as DemoFridayBrowserCocoWallet
		const signatures = winner.outputs.map((output) => {
			const point = pointFromHex(output.B_), secret = mintSecret(output.amount)
			const signature = createBlindSignature(point, secret, output.id), dleq = createDLEQProof(point, secret)
			return { amount: output.amount, id: output.id, C_: signature.C_.toHex(true),
				dleq: { e: bytesToHex(dleq.e), s: bytesToHex(dleq.s) } }
		})
		const terminal = { async readNoticeExact() { return { schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1' as const,
			actor: sellerActor, network: 'network', chainId: 'chain', auctionId: 'auction-1', operationId: 'funding-2',
			role: 'winner_settlement' as const, mintUrl, amount: 300,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(authorization.authorization.recipientCatalog.capability), signatures } },
			async acknowledgeExact() { acknowledgements += 1 } }
		const receipt = await importDemoFridayAuctionPayoutWinner({ actor: sellerActor, environmentId: 'deployment',
			authorization, winner: claim, keyset, state: state as unknown as DemoFridayBrowserPaymentStatePort,
			wallet, terminal })
		expect(receipt).toMatchObject({ amount: 300, operationId: 'funding-2', imported: true, alreadyImported: false })
		expect({ walletImports, acknowledgements }).toEqual({ walletImports: 1, acknowledgements: 1 })
		const replay = await importDemoFridayAuctionPayoutWinner({ actor: sellerActor, environmentId: 'deployment',
			authorization, winner: claim, keyset, state: state as unknown as DemoFridayBrowserPaymentStatePort,
			wallet, terminal })
		expect(replay?.alreadyImported).toBe(true)
		expect({ walletImports, acknowledgements }).toEqual({ walletImports: 1, acknowledgements: 2 })
		registryDb.close(false); anchorDb.close(false)
	})
})
