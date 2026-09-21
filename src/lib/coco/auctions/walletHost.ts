import {
	assertCocoAuctionAccountIdentity,
	cocoAuctionBidIntentFingerprint,
	deriveCocoAuctionBidCommandId,
	normalizeCocoAuctionBidIntent,
} from './canonical'
import type { CocoAuctionCommandRecord, CocoAuctionCommandRepository } from './commandRepository'
import { IndexedDbCocoAuctionCommandRepository, projectCocoAuctionCommand } from './commandRepository'
import type { CocoBidPublicationAdapter, CocoEngineBidProjection, CocoEnginePort } from './enginePort'
import { UnavailableCocoV2EnginePort } from './enginePort'
import { assertFakeCocoAuctionMint, readCocoV2AuctionEnvironment, type CocoV2AuctionEnvironment } from './mode'
import type {
	CocoAuctionAccountIdentity,
	CocoAuctionBidIntent,
	CocoAuctionBidProjection,
	CocoAuctionCancelResult,
	CocoAuctionRefundInput,
	CocoAuctionRefundResult,
	CocoAuctionSellerAuthority,
	CocoAuctionWinnerReceiveInput,
	CocoAuctionWinnerReceiveResult,
	CocoAuctionWinnerReleaseInput,
	CocoAuctionWinnerReleaseResult,
} from './types'

const HEX_32 = /^[0-9a-f]{64}$/

export class CocoAuctionCommandConflictError extends Error {
	constructor(commandId: string) {
		super(`Coco Auction command ${commandId} already exists with a different immutable intent`)
		this.name = 'CocoAuctionCommandConflictError'
	}
}

export class CocoAuctionCheckpointCUnavailableError extends Error {
	constructor(action: string) {
		super(
			`${action} is not enabled: Checkpoint C requires the combined reviewed Coco v2 Send-ID, P2PK refund, and atomic Receive candidate`,
		)
		this.name = 'CocoAuctionCheckpointCUnavailableError'
	}
}

export type CocoAuctionMarketRevalidator = (projection: CocoAuctionBidProjection) => Promise<void>

const sameAccount = (left: CocoAuctionAccountIdentity, right: CocoAuctionAccountIdentity): boolean =>
	left.accountPubkey === right.accountPubkey && left.environmentId === right.environmentId

const assertProjectionBinding = (
	intent: CocoAuctionBidIntent,
	operationId: string,
	projection: CocoEngineBidProjection,
): CocoEngineBidProjection => {
	if (projection.operationId !== operationId) throw new Error('Coco returned a different operation identity')
	if (projection.mintUrl !== intent.mintUrl) throw new Error('Coco operation mint does not match the durable command')
	if (projection.unit !== intent.unit) throw new Error('Coco operation unit does not match the durable command')
	if (projection.grossAmount !== intent.grossAmount || projection.amount !== intent.amount) {
		throw new Error('Coco operation amount does not match the durable command')
	}
	if (projection.locktime !== intent.locktime) throw new Error('Coco operation locktime does not match the durable command')
	if (!Number.isSafeInteger(projection.fee) || projection.fee < 0) throw new Error('Coco operation fee projection is invalid')
	if (!projection.recipientPublicAuthority || !projection.refundPublicAuthority) {
		throw new Error('Coco operation is missing public P2PK authority')
	}
	if (!projection.conditionFingerprint || !projection.commitmentFingerprint) {
		throw new Error('Coco operation is missing immutable fingerprints')
	}
	return projection
}

const commandFromIntent = (intent: CocoAuctionBidIntent, intentFingerprint: string, now: number): CocoAuctionCommandRecord => ({
	schemaVersion: 1,
	commandId: intent.commandId,
	operationId: intent.commandId,
	intentFingerprint,
	account: intent.account,
	auction: intent.auction,
	bidderPubkey: intent.bidderPubkey,
	sellerPubkey: intent.sellerPubkey,
	mintUrl: intent.mintUrl,
	unit: intent.unit,
	grossAmount: intent.grossAmount,
	amount: intent.amount,
	locktime: intent.locktime,
	createdForEndAt: intent.createdForEndAt,
	previousBidEventId: intent.previousBidEventId,
	status: 'requested',
	revision: 0,
	createdAt: now,
	updatedAt: now,
})

export class PlebeianAuctionWalletHost {
	private readonly preparing = new Map<string, { fingerprint: string; promise: Promise<CocoAuctionBidProjection> }>()
	private readonly executing = new Map<string, { fingerprint: string; promise: Promise<CocoAuctionBidProjection> }>()

	constructor(
		private readonly engine: CocoEnginePort,
		private readonly commands: CocoAuctionCommandRepository,
		private readonly environment: CocoV2AuctionEnvironment,
		private readonly now: () => number = Date.now,
	) {}

	async ensureSellerAuctionAuthority(accountInput: CocoAuctionAccountIdentity): Promise<CocoAuctionSellerAuthority> {
		const account = this.requireAccount(accountInput)
		const authority = await this.engine.ensureSellerAuctionAuthority(account)
		if (!authority.publicP2pkAuthority) throw new Error('Coco returned no public seller Auction authority')
		return { account, publicP2pkAuthority: authority.publicP2pkAuthority, status: 'ready' }
	}

	async prepareBid(input: CocoAuctionBidIntent): Promise<CocoAuctionBidProjection> {
		const intent = this.requireBidIntent(input)
		const intentFingerprint = cocoAuctionBidIntentFingerprint(intent)
		const inFlight = this.preparing.get(intent.commandId)
		if (inFlight) {
			if (inFlight.fingerprint !== intentFingerprint) throw new CocoAuctionCommandConflictError(intent.commandId)
			return inFlight.promise
		}
		const promise = this.prepareBidOnce(intent, intentFingerprint)
		this.preparing.set(intent.commandId, { fingerprint: intentFingerprint, promise })
		try {
			return await promise
		} finally {
			if (this.preparing.get(intent.commandId)?.promise === promise) this.preparing.delete(intent.commandId)
		}
	}

	private async prepareBidOnce(intent: CocoAuctionBidIntent, intentFingerprint: string): Promise<CocoAuctionBidProjection> {
		const now = this.now()
		const claimed = await this.commands.createOrGet(commandFromIntent(intent, intentFingerprint, now))
		this.assertExistingCommand(claimed.record, intent, intentFingerprint)

		if (claimed.record.status === 'cancelled') throw new Error('Cancelled Coco Auction commands cannot be prepared again')
		if (claimed.record.conditionFingerprint) return projectCocoAuctionCommand(claimed.record)

		await this.commands.update(intent.commandId, (current) => ({
			...current,
			status: 'preparing',
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))

		// The durable Market record exists before Coco is touched. A crash after
		// Coco commits but before the update below retries the exact same ID.
		const prepared = assertProjectionBinding(
			intent,
			intent.commandId,
			await this.engine.prepareBid({ ...intent, operationId: intent.commandId }),
		)
		const stored = await this.storeProjection(intent.commandId, prepared, 'prepared')
		return projectCocoAuctionCommand(stored)
	}

	async cancelPreparedBid(input: { commandId: string; account: CocoAuctionAccountIdentity }): Promise<CocoAuctionCancelResult> {
		const account = this.requireAccount(input.account)
		const record = await this.requireCommand(input.commandId)
		if (!sameAccount(record.account, account)) throw new Error('Coco Auction command belongs to another account or environment')
		if (record.status === 'cancelled') return { commandId: record.commandId, operationId: record.operationId, status: 'cancelled' }
		if (record.status !== 'requested' && record.status !== 'preparing' && record.status !== 'prepared') {
			throw new Error(`Coco Auction command cannot be cancelled from ${record.status}`)
		}
		await this.commands.update(record.commandId, (current) => ({
			...current,
			status: 'cancelling',
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))
		await this.engine.cancelPreparedBid(record.operationId)
		const cancelled = await this.commands.update(record.commandId, (current) => ({
			...current,
			status: 'cancelled',
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))
		return { commandId: cancelled.commandId, operationId: cancelled.operationId, status: 'cancelled' }
	}

	async executeBid(
		input: CocoAuctionBidIntent,
		revalidate: CocoAuctionMarketRevalidator,
		publisher: CocoBidPublicationAdapter,
	): Promise<CocoAuctionBidProjection> {
		const intent = this.requireBidIntent(input)
		const fingerprint = cocoAuctionBidIntentFingerprint(intent)
		const inFlight = this.executing.get(intent.commandId)
		if (inFlight) {
			if (inFlight.fingerprint !== fingerprint) throw new CocoAuctionCommandConflictError(intent.commandId)
			return inFlight.promise
		}
		const promise = this.executeBidOnce(intent, revalidate, publisher)
		this.executing.set(intent.commandId, { fingerprint, promise })
		try {
			return await promise
		} finally {
			if (this.executing.get(intent.commandId)?.promise === promise) this.executing.delete(intent.commandId)
		}
	}

	private async executeBidOnce(
		intent: CocoAuctionBidIntent,
		revalidate: CocoAuctionMarketRevalidator,
		publisher: CocoBidPublicationAdapter,
	): Promise<CocoAuctionBidProjection> {
		let projection = await this.prepareBid(intent)

		if (projection.status === 'published') return projection
		if (projection.status === 'cancelled') throw new Error('Cancelled Coco Auction commands cannot execute')
		if (projection.status === 'publication_ready') return this.publishPreparedEvent(intent.commandId, publisher)

		// Market canonical state is re-read immediately before the monetary
		// transition. Render-time UI state is never accepted as authority.
		await revalidate(projection)
		await this.commands.update(intent.commandId, (current) => ({
			...current,
			status: 'executing',
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))

		const executed = assertProjectionBinding(intent, intent.commandId, await this.engine.executeBid(intent.commandId))
		await this.storeProjection(intent.commandId, executed, 'executed')

		// Bearer-adjacent protocol material is scoped to this callback and is
		// never returned by the host or stored in the Market command database.
		const preparedEvent = await this.engine.withBidPublicationMaterial(intent.commandId, async (material) => {
			if (material.operationId !== intent.commandId) throw new Error('Bid publication material belongs to another Coco operation')
			if (
				material.conditionFingerprint !== executed.conditionFingerprint ||
				material.commitmentFingerprint !== executed.commitmentFingerprint
			) {
				throw new Error('Bid publication material does not match the exact executed Coco operation')
			}
			return publisher.prepare(material, intent)
		})
		if (!HEX_32.test(preparedEvent.eventId.toLowerCase())) throw new Error('Prepared kind-1023 event id is invalid')
		await this.commands.update(intent.commandId, (current) => ({
			...current,
			status: 'publication_ready',
			publicationEventId: preparedEvent.eventId.toLowerCase(),
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))

		projection = await this.publishPreparedEvent(intent.commandId, publisher)
		return projection
	}

	async releaseWinner(_input: CocoAuctionWinnerReleaseInput, ..._args: readonly unknown[]): Promise<CocoAuctionWinnerReleaseResult> {
		throw new CocoAuctionCheckpointCUnavailableError('Winner release')
	}

	async receiveWinner(_input: CocoAuctionWinnerReceiveInput): Promise<CocoAuctionWinnerReceiveResult> {
		throw new CocoAuctionCheckpointCUnavailableError('Winner Receive')
	}

	async refundLosingBid(_input: CocoAuctionRefundInput): Promise<CocoAuctionRefundResult> {
		throw new CocoAuctionCheckpointCUnavailableError('Loser refund')
	}

	private requireAccount(input: CocoAuctionAccountIdentity): CocoAuctionAccountIdentity {
		const account = assertCocoAuctionAccountIdentity(input)
		if (account.environmentId !== this.environment.environmentId) {
			throw new Error('Coco Auction account belongs to another environment')
		}
		if (this.environment.monetaryMode !== 'fake') throw new Error('Real funds are forbidden in the Coco v2 Auction candidate')
		return account
	}

	private requireBidIntent(input: CocoAuctionBidIntent): CocoAuctionBidIntent {
		const account = this.requireAccount(input.account)
		const mintUrl = assertFakeCocoAuctionMint(input.mintUrl, this.environment)
		const normalized = normalizeCocoAuctionBidIntent({ ...input, account, mintUrl })
		const { commandId: _commandId, ...businessIntent } = normalized
		if (deriveCocoAuctionBidCommandId(businessIntent) !== normalized.commandId) {
			throw new CocoAuctionCommandConflictError(normalized.commandId)
		}
		return normalized
	}

	private assertExistingCommand(record: CocoAuctionCommandRecord, intent: CocoAuctionBidIntent, fingerprint: string): void {
		if (record.intentFingerprint !== fingerprint || record.operationId !== intent.commandId) {
			throw new CocoAuctionCommandConflictError(intent.commandId)
		}
		if (!sameAccount(record.account, intent.account)) throw new Error('Coco Auction command belongs to another account or environment')
	}

	private async requireCommand(commandId: string): Promise<CocoAuctionCommandRecord> {
		const record = await this.commands.get(commandId)
		if (!record) throw new Error('Coco Auction command does not exist')
		return record
	}

	private async storeProjection(
		commandId: string,
		projection: CocoEngineBidProjection,
		status: 'prepared' | 'executed',
	): Promise<CocoAuctionCommandRecord> {
		return this.commands.update(commandId, (current) => ({
			...current,
			fee: projection.fee,
			recipientPublicAuthority: projection.recipientPublicAuthority,
			refundPublicAuthority: projection.refundPublicAuthority,
			conditionFingerprint: projection.conditionFingerprint,
			commitmentFingerprint: projection.commitmentFingerprint,
			status,
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))
	}

	private async publishPreparedEvent(commandId: string, publisher: CocoBidPublicationAdapter): Promise<CocoAuctionBidProjection> {
		const record = await this.requireCommand(commandId)
		if (record.status === 'published') return projectCocoAuctionCommand(record)
		if (record.status !== 'publication_ready' || !record.publicationEventId) {
			throw new Error('Coco Auction command has no exact prepared kind-1023 event')
		}
		await publisher.publish(record.publicationEventId)
		const published = await this.commands.update(commandId, (current) => {
			if (current.publicationEventId !== record.publicationEventId) throw new Error('Coco Auction publication identity changed')
			return { ...current, status: 'published', revision: current.revision + 1, updatedAt: this.now() }
		})
		return projectCocoAuctionCommand(published)
	}
}

export class PlebeianWalletHost {
	readonly auctions: PlebeianAuctionWalletHost

	constructor(auctions: PlebeianAuctionWalletHost) {
		this.auctions = auctions
	}
}

let configuredHost: PlebeianWalletHost | null = null

export const configurePlebeianWalletHost = (host: PlebeianWalletHost): void => {
	if (configuredHost && configuredHost !== host) throw new Error('PlebeianWalletHost is already configured')
	configuredHost = host
}

export const getPlebeianWalletHost = (): PlebeianWalletHost => {
	if (!configuredHost) {
		configuredHost = new PlebeianWalletHost(
			new PlebeianAuctionWalletHost(
				new UnavailableCocoV2EnginePort(),
				new IndexedDbCocoAuctionCommandRepository(),
				readCocoV2AuctionEnvironment(),
			),
		)
	}
	return configuredHost
}

export const resetPlebeianWalletHostForTests = (): void => {
	configuredHost = null
}
