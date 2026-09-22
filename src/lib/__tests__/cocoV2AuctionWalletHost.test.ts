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
	sellerPublicAuthority: 'xpub-public-only',
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
	sellerPublicAuthority: 'xpub-public-only',
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

	async inspectBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection | null> {
		return { ...this.projection, operationId: input.operationId }
	}

	async cancelPreparedBid(): Promise<void> {
		this.cancelCalls += 1
	}

	async executeBid(input: CocoAuctionBidIntent & { operationId: string }): Promise<CocoEngineBidProjection> {
		this.executeCalls += 1
		return { ...this.projection, operationId: input.operationId, status: 'executed' }
	}

	async withBidPublicationMaterial<T>(
		input: CocoAuctionBidIntent & { operationId: string },
		use: (material: SealedCocoBidPublicationMaterial) => Promise<T>,
	): Promise<T> {
		return use({
			operationId: input.operationId,
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
	failPrepareOnce = false
	seenMaterial: SealedCocoBidPublicationMaterial | null = null
	publicationCreatedAt: number[] = []

	async prepare(
		material: SealedCocoBidPublicationMaterial,
		_intent: CocoAuctionBidIntent,
		publicationCreatedAt: number,
	): Promise<{ eventId: string }> {
		this.prepareCalls += 1
		this.seenMaterial = material
		this.publicationCreatedAt.push(publicationCreatedAt)
		if (this.failPrepareOnce) {
			this.failPrepareOnce = false
			throw new Error('crash before publication cache')
		}
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

	test('crash immediately after EXECUTE freezes the logical event and does not invoke execute again', async () => {
		let now = 1_800_000_000_000
		const engine = new FakeEngine()
		const commands = new MemoryCocoAuctionCommandRepository()
		const host = new PlebeianAuctionWalletHost(
			engine,
			commands,
			{ environmentId: 'auctionsdev', monetaryMode: 'fake', fakeMintAllowlist: [MINT] },
			() => now,
		)
		const publisher = new FakePublisher()
		publisher.failPrepareOnce = true
		await expect(host.executeBid(intent(), async () => {}, publisher)).rejects.toThrow('crash before publication cache')
		expect(engine.executeCalls).toBe(1)
		now += 60_000
		const reloaded = new PlebeianAuctionWalletHost(
			engine,
			commands,
			{ environmentId: 'auctionsdev', monetaryMode: 'fake', fakeMintAllowlist: [MINT] },
			() => now,
		)
		await reloaded.executeBid(intent(), async () => {}, publisher)
		expect(engine.executeCalls).toBe(1)
		expect(publisher.publicationCreatedAt).toEqual([1_800_000_000, 1_800_000_000])
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

	test('Coco mode routes normal bids to Coco and blocks the remaining legacy monetary publishers', async () => {
		const previousPublicMode = process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE
		const previousEnvironment = process.env.BUN_PUBLIC_COCO_ENVIRONMENT_ID
		const previousMonetaryMode = process.env.BUN_PUBLIC_COCO_MONETARY_MODE
		const previousAllowlist = process.env.BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST
		process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE = 'coco-v2'
		process.env.BUN_PUBLIC_COCO_ENVIRONMENT_ID = 'auctionsdev'
		process.env.BUN_PUBLIC_COCO_MONETARY_MODE = 'fake'
		process.env.BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST = MINT
		try {
			const { publishAuctionBid, publishAuctionSettlement, publishBidderPathRelease, republishAuctionBid } =
				await import('@/publish/auctions')
			await expect(publishAuctionBid({} as never)).rejects.toThrow('Canonical Auction identity is required')
			await expect(republishAuctionBid(EVENT_ID)).rejects.toThrow('Legacy Auction monetary action')
			await expect(publishBidderPathRelease({ bidEventId: EVENT_ID })).rejects.toThrow('Legacy Auction monetary action')
			await expect(publishAuctionSettlement({ auctionEventId: ROOT })).rejects.toThrow('Legacy Auction monetary action')
		} finally {
			if (previousPublicMode === undefined) delete process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE
			else process.env.BUN_PUBLIC_AUCTION_MONETARY_MODE = previousPublicMode
			if (previousEnvironment === undefined) delete process.env.BUN_PUBLIC_COCO_ENVIRONMENT_ID
			else process.env.BUN_PUBLIC_COCO_ENVIRONMENT_ID = previousEnvironment
			if (previousMonetaryMode === undefined) delete process.env.BUN_PUBLIC_COCO_MONETARY_MODE
			else process.env.BUN_PUBLIC_COCO_MONETARY_MODE = previousMonetaryMode
			if (previousAllowlist === undefined) delete process.env.BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST
			else process.env.BUN_PUBLIC_COCO_FAKE_MINT_ALLOWLIST = previousAllowlist
		}
	})
})
