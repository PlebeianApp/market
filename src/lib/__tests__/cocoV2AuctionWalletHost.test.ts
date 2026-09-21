import { describe, expect, test } from 'bun:test'
import {
	CocoAuctionCommandConflictError,
	deriveCocoAuctionBidCommandId,
	MemoryCocoAuctionCommandRepository,
	PlebeianAuctionWalletHost,
	type CocoAuctionBidIntent,
	type CocoAuctionWinnerReceiveInput,
	type CocoAuctionWinnerReleaseInput,
	type CocoAuctionRefundInput,
	type CocoBidPublicationAdapter,
	type CocoEngineBidProjection,
	type CocoEnginePort,
	type SealedCocoBidPublicationMaterial,
	type SealedCocoWinnerReleaseMaterial,
} from '@/lib/coco/auctions'

const ACCOUNT = '1'.repeat(64)
const SELLER = '2'.repeat(64)
const ROOT = '3'.repeat(64)
const EVENT_ID = '4'.repeat(64)
const MINT = 'http://localhost:3338'

const BID_BUSINESS_INTENT: Omit<CocoAuctionBidIntent, 'commandId'> = {
	account: { accountPubkey: ACCOUNT, environmentId: 'auctionsdev' },
	auction: { rootEventId: ROOT, coordinate: `30408:${SELLER}:auction-a` },
	bidderPubkey: ACCOUNT,
	sellerPubkey: SELLER,
	mintUrl: MINT,
	unit: 'sat',
	grossAmount: 32,
	amount: 32,
	locktime: 2_000_000_000,
	createdForEndAt: 1_999_999_000,
}

const COMMAND = deriveCocoAuctionBidCommandId(BID_BUSINESS_INTENT)

const intent = (overrides: Partial<CocoAuctionBidIntent> = {}): CocoAuctionBidIntent => ({
	...BID_BUSINESS_INTENT,
	commandId: COMMAND,
	...overrides,
})

const engineProjection = (operationId = COMMAND, overrides: Partial<CocoEngineBidProjection> = {}): CocoEngineBidProjection => ({
	operationId,
	mintUrl: MINT,
	unit: 'sat',
	grossAmount: 32,
	amount: 32,
	fee: 1,
	locktime: 2_000_000_000,
	recipientPublicAuthority: `02${'5'.repeat(64)}`,
	refundPublicAuthority: `03${'6'.repeat(64)}`,
	conditionFingerprint: 'condition-fingerprint',
	commitmentFingerprint: 'commitment-fingerprint',
	status: 'prepared',
	...overrides,
})

class FakeEngine implements CocoEnginePort {
	prepareCalls = 0
	executeCalls = 0
	cancelCalls = 0
	projection: CocoEngineBidProjection = engineProjection()

	async ensureSellerAuctionAuthority() {
		return { publicP2pkAuthority: 'xpub-public-only' }
	}

	async prepareBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection> {
		this.prepareCalls += 1
		if (!input.operationId) throw new Error('operation id required')
		return { ...this.projection }
	}

	async inspectBid(operationId: string): Promise<CocoEngineBidProjection | null> {
		return { ...this.projection, operationId }
	}

	async cancelPreparedBid(): Promise<void> {
		this.cancelCalls += 1
	}

	async executeBid(operationId: string): Promise<CocoEngineBidProjection> {
		this.executeCalls += 1
		return { ...this.projection, operationId, status: 'executed' }
	}

	async withBidPublicationMaterial<T>(operationId: string, use: (material: SealedCocoBidPublicationMaterial) => Promise<T>): Promise<T> {
		return use({
			operationId,
			mintUrl: MINT,
			unit: 'sat',
			grossAmount: 32,
			amount: 32,
			locktime: 2_000_000_000,
			recipientPublicAuthority: `02${'5'.repeat(64)}`,
			refundPublicAuthority: `03${'6'.repeat(64)}`,
			conditionFingerprint: 'condition-fingerprint',
			commitmentFingerprint: 'commitment-fingerprint',
			lockSecrets: ['publication-only-secret'],
			proofYs: [`02${'7'.repeat(64)}`],
		})
	}

	async releaseWinner<T>(
		_input: CocoAuctionWinnerReleaseInput,
		_use: (material: SealedCocoWinnerReleaseMaterial) => Promise<T>,
	): Promise<{ operationId: string; result: T }> {
		throw new Error('not used')
	}

	async receiveWinner(_input: CocoAuctionWinnerReceiveInput): Promise<{ operationId: string; state: 'finalized' }> {
		throw new Error('not used')
	}

	async refundLosingBid(_input: CocoAuctionRefundInput): Promise<{ operationId: string; state: 'refunded' }> {
		throw new Error('not used')
	}
}

class FakePublisher implements CocoBidPublicationAdapter {
	prepareCalls = 0
	publishCalls = 0
	failPublishOnce = false
	seenMaterial: SealedCocoBidPublicationMaterial | null = null

	async prepare(material: SealedCocoBidPublicationMaterial): Promise<{ eventId: string }> {
		this.prepareCalls += 1
		this.seenMaterial = material
		return { eventId: EVENT_ID }
	}

	async publish(eventId: string): Promise<void> {
		expect(eventId).toBe(EVENT_ID)
		this.publishCalls += 1
		if (this.failPublishOnce) {
			this.failPublishOnce = false
			throw new Error('relay unavailable')
		}
	}
}

const setup = () => {
	const engine = new FakeEngine()
	const commands = new MemoryCocoAuctionCommandRepository()
	const host = new PlebeianAuctionWalletHost(engine, commands, {
		environmentId: 'auctionsdev',
		monetaryMode: 'fake',
		fakeMintAllowlist: [MINT],
	})
	return { engine, commands, host }
}

describe('PlebeianWalletHost.auctions command boundary', () => {
	test('same command twice and a double-click resolve to one prepared operation', async () => {
		const { engine, host } = setup()
		const [first, second] = await Promise.all([host.prepareBid(intent()), host.prepareBid(intent())])
		const third = await host.prepareBid(intent())
		expect(first.operationId).toBe(COMMAND)
		expect(second.operationId).toBe(COMMAND)
		expect(third.operationId).toBe(COMMAND)
		expect(engine.prepareCalls).toBe(1)
	})

	test('same command ID with conflicting immutable intent fails before Coco', async () => {
		const { engine, host } = setup()
		await host.prepareBid(intent())
		await expect(host.prepareBid(intent({ amount: 16 }))).rejects.toBeInstanceOf(CocoAuctionCommandConflictError)
		expect(engine.prepareCalls).toBe(1)
	})

	test('reload after PREPARE reuses durable Market metadata without another reservation', async () => {
		const { engine, commands, host } = setup()
		await host.prepareBid(intent())
		const reloaded = new PlebeianAuctionWalletHost(engine, commands, {
			environmentId: 'auctionsdev',
			monetaryMode: 'fake',
			fakeMintAllowlist: [MINT],
		})
		const result = await reloaded.prepareBid(intent())
		expect(result.status).toBe('prepared')
		expect(engine.prepareCalls).toBe(1)
	})

	test('CANCEL after restart releases the exact prepared operation and is idempotent', async () => {
		const { engine, commands, host } = setup()
		await host.prepareBid(intent())
		const reloaded = new PlebeianAuctionWalletHost(engine, commands, {
			environmentId: 'auctionsdev',
			monetaryMode: 'fake',
			fakeMintAllowlist: [MINT],
		})
		await reloaded.cancelPreparedBid({ commandId: COMMAND, account: intent().account })
		await reloaded.cancelPreparedBid({ commandId: COMMAND, account: intent().account })
		expect(engine.cancelCalls).toBe(1)
	})

	test('crash after EXECUTE before publication retries the cached event and never spends again', async () => {
		const { engine, commands, host } = setup()
		const publisher = new FakePublisher()
		publisher.failPublishOnce = true
		await expect(host.executeBid(intent(), async () => {}, publisher)).rejects.toThrow('relay unavailable')
		expect(engine.executeCalls).toBe(1)
		expect(publisher.prepareCalls).toBe(1)

		const reloaded = new PlebeianAuctionWalletHost(engine, commands, {
			environmentId: 'auctionsdev',
			monetaryMode: 'fake',
			fakeMintAllowlist: [MINT],
		})
		const result = await reloaded.executeBid(intent(), async () => {}, publisher)
		expect(result.status).toBe('published')
		expect(result.publicationEventId).toBe(EVENT_ID)
		expect(engine.executeCalls).toBe(1)
		expect(publisher.prepareCalls).toBe(1)
		expect(publisher.publishCalls).toBe(2)
	})

	test('Market command state contains no Proof, token, private key, witness, or publication secret', async () => {
		const { commands, host } = setup()
		const publisher = new FakePublisher()
		await host.executeBid(intent(), async () => {}, publisher)
		const stored = JSON.stringify(await commands.get(COMMAND))
		expect(stored).not.toContain('publication-only-secret')
		expect(stored).not.toMatch(/proofs|encodedToken|privateKey|privkey|witness|seed|outputData/i)
	})

	test('exact operation binding rejects amount, mint, unit, locktime, and sibling-operation mutation', async () => {
		for (const projection of [
			engineProjection(COMMAND, { amount: 31 }),
			engineProjection(COMMAND, { mintUrl: 'http://localhost:9999' }),
			engineProjection(COMMAND, { unit: 'sat', grossAmount: 31 }),
			engineProjection(COMMAND, { locktime: 2_000_000_001 }),
			engineProjection('sibling-operation'),
		]) {
			const { engine, host } = setup()
			engine.projection = projection
			await expect(host.prepareBid(intent())).rejects.toThrow()
		}
	})

	test('wrong account/environment and non-allowlisted production mint fail closed before Coco', async () => {
		const { engine, host } = setup()
		await expect(host.prepareBid(intent({ account: { accountPubkey: ACCOUNT, environmentId: 'production' } }))).rejects.toThrow(
			'another environment',
		)
		await expect(host.prepareBid(intent({ account: { accountPubkey: '8'.repeat(64), environmentId: 'auctionsdev' } }))).rejects.toThrow(
			'does not match',
		)
		await expect(host.prepareBid(intent({ mintUrl: 'https://mint.example.com' }))).rejects.toThrow('fake-mint allowlist')
		expect(engine.prepareCalls).toBe(0)
	})

	test('Market revalidation runs after PREPARE and before EXECUTE', async () => {
		const { engine, host } = setup()
		const publisher = new FakePublisher()
		const order: string[] = []
		const originalExecute = engine.executeBid.bind(engine)
		engine.executeBid = async (operationId) => {
			order.push('execute')
			return originalExecute(operationId)
		}
		await host.executeBid(
			intent(),
			async () => {
				order.push('revalidate')
			},
			publisher,
		)
		expect(order).toEqual(['revalidate', 'execute'])
	})

	test('Coco mode blocks every legacy Auction monetary publisher before it can mutate NIP-60', async () => {
		const previousPublicMode = process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE
		process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE = 'coco-v2'
		try {
			const { publishAuctionBid, publishAuctionSettlement, publishBidderPathRelease, republishAuctionBid } =
				await import('@/publish/auctions')
			await expect(publishAuctionBid({} as never)).rejects.toThrow('Legacy Auction monetary action')
			await expect(republishAuctionBid(EVENT_ID)).rejects.toThrow('Legacy Auction monetary action')
			await expect(publishBidderPathRelease({ bidEventId: EVENT_ID })).rejects.toThrow('Legacy Auction monetary action')
			await expect(publishAuctionSettlement({ auctionEventId: ROOT })).rejects.toThrow('Legacy Auction monetary action')
		} finally {
			if (previousPublicMode === undefined) delete process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE
			else process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE = previousPublicMode
		}
	})
})
