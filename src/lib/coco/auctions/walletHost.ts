import {
	assertCocoAuctionAccountIdentity,
	assertCocoAuctionReference,
	cocoAuctionBidIntentFingerprint,
	deriveCocoAuctionCommandId,
	deriveCocoAuctionBidCommandId,
	fingerprintCocoAuctionValue,
	normalizeCocoAuctionBidIntent,
} from './canonical'
import type { CocoAuctionCommandRecord, CocoAuctionCommandRepository } from './commandRepository'
import { IndexedDbCocoAuctionCommandRepository, projectCocoAuctionCommand } from './commandRepository'
import type {
	CocoBidPublicationAdapter,
	CocoEngineBidProjection,
	CocoEnginePort,
	CocoSettlementPublicationAdapter,
	CocoWinnerReleasePublicationAdapter,
} from './enginePort'
import { CocoV2AuctionEnginePort } from './cocoEngine'
import { cocoRuntimeRegistry } from '@/lib/coco/runtime'
import type { CocoAuctionLifecycleRecord, CocoAuctionLifecycleRepository } from './lifecycleRepository'
import { IndexedDbCocoAuctionLifecycleRepository } from './lifecycleRepository'
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

export type CocoAuctionMarketRevalidator = (projection: CocoAuctionBidProjection) => Promise<void>
export type CocoAuctionLifecycleRevalidator = () => Promise<void>

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
	if (projection.sellerPublicAuthority !== intent.sellerPublicAuthority) {
		throw new Error('Coco operation seller authority does not match the durable command')
	}
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
	sellerPublicAuthority: intent.sellerPublicAuthority,
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
		private readonly lifecycles: CocoAuctionLifecycleRepository = new IndexedDbCocoAuctionLifecycleRepository(),
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

	async getBidProjection(input: { commandId: string; account: CocoAuctionAccountIdentity }): Promise<CocoAuctionBidProjection | null> {
		const account = this.requireAccount(input.account)
		const record = await this.commands.get(input.commandId)
		if (!record) return null
		if (!sameAccount(record.account, account)) throw new Error('Coco Auction command belongs to another account or environment')
		if (!record.conditionFingerprint) return null
		return projectCocoAuctionCommand(record)
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
		await this.engine.cancelPreparedBid(record.operationId, account)
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
		const executing = await this.commands.update(intent.commandId, (current) => ({
			...current,
			status: 'executing',
			publicationCreatedAt: current.publicationCreatedAt ?? Math.floor(this.now() / 1000),
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))

		const executed =
			projection.status === 'executed'
				? assertProjectionBinding(intent, intent.commandId, projection)
				: assertProjectionBinding(intent, intent.commandId, await this.engine.executeBid({ ...intent, operationId: intent.commandId }))
		await this.storeProjection(intent.commandId, executed, 'executed')

		// Bearer-adjacent protocol material is scoped to this callback and is
		// never returned by the host or stored in the Market command database.
		const preparedEvent = await this.engine.withBidPublicationMaterial({ ...intent, operationId: intent.commandId }, async (material) => {
			if (material.operationId !== intent.commandId) throw new Error('Bid publication material belongs to another Coco operation')
			if (
				material.conditionFingerprint !== executed.conditionFingerprint ||
				material.commitmentFingerprint !== executed.commitmentFingerprint
			) {
				throw new Error('Bid publication material does not match the exact executed Coco operation')
			}
			if (!executing.publicationCreatedAt) throw new Error('Coco Auction publication timestamp was not frozen before execute')
			return publisher.prepare(material, intent, executing.publicationCreatedAt)
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

	async releaseWinner(
		input: CocoAuctionWinnerReleaseInput,
		revalidate: CocoAuctionLifecycleRevalidator,
		publisher: CocoWinnerReleasePublicationAdapter,
	): Promise<CocoAuctionWinnerReleaseResult> {
		const normalized = this.requireWinnerRelease(input)
		const fingerprint = fingerprintCocoAuctionValue(normalized)
		let record = await this.createLifecycle(normalized, 'winner-release', normalized.sendOperationId, fingerprint)
		if (record.status === 'published' && record.publicationEventId) {
			return this.projectRelease(record)
		}
		if (record.status === 'publication_ready' && record.publicationEventId) {
			await publisher.publish(record.publicationEventId)
			record = await this.markLifecyclePublished(record.commandId, record.publicationEventId)
			return this.projectRelease(record)
		}

		await revalidate()
		record = await this.lifecycles.update(record.commandId, (current) => ({
			...current,
			status: 'releasing',
			publicationCreatedAt: current.publicationCreatedAt ?? Math.floor(this.now() / 1000),
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))
		const released = await this.engine.releaseWinner(normalized, async (material) => {
			if (material.operationId !== normalized.sendOperationId) throw new Error('Winner release used a different Coco Send')
			if (!record.publicationCreatedAt) throw new Error('Path-release publication timestamp was not frozen before release')
			return publisher.prepare(material, normalized, record.publicationCreatedAt)
		})
		if (released.operationId !== normalized.sendOperationId) throw new Error('Winner release returned a different Coco Send')
		if (!HEX_32.test(released.result.eventId.toLowerCase())) throw new Error('Prepared kind-1025 event id is invalid')
		record = await this.lifecycles.update(record.commandId, (current) => ({
			...current,
			status: 'publication_ready',
			publicationEventId: released.result.eventId.toLowerCase(),
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))
		await publisher.publish(record.publicationEventId!)
		record = await this.markLifecyclePublished(record.commandId, record.publicationEventId!)
		return this.projectRelease(record)
	}

	async receiveWinner(
		input: CocoAuctionWinnerReceiveInput,
		encodedToken: string,
		revalidate: CocoAuctionLifecycleRevalidator,
		publisher: CocoSettlementPublicationAdapter,
	): Promise<CocoAuctionWinnerReceiveResult> {
		const normalized = this.requireWinnerReceive(input)
		const fingerprint = fingerprintCocoAuctionValue(normalized)
		let record = await this.createLifecycle(normalized, 'winner-receive', normalized.commandId, fingerprint)
		if (record.status === 'published' && record.publicationEventId) return this.projectReceive(record)
		if (record.status === 'publication_ready' && record.publicationEventId) {
			await publisher.publish(record.publicationEventId)
			record = await this.markLifecyclePublished(record.commandId, record.publicationEventId)
			return this.projectReceive(record)
		}

		await revalidate()
		if (record.status !== 'received') {
			record = await this.lifecycles.update(record.commandId, (current) => ({
				...current,
				status: 'receiving',
				publicationCreatedAt: current.publicationCreatedAt ?? Math.floor(this.now() / 1000),
				revision: current.revision + 1,
				updatedAt: this.now(),
			}))
			const received = await this.engine.receiveWinner(normalized, encodedToken)
			if (received.operationId !== normalized.commandId || received.state !== 'finalized') {
				throw new Error('Coco Receive did not authoritatively finalize the exact settlement operation')
			}
			record = await this.lifecycles.update(record.commandId, (current) => ({
				...current,
				status: 'received',
				revision: current.revision + 1,
				updatedAt: this.now(),
			}))
		}
		if (!record.publicationCreatedAt) throw new Error('Settlement publication timestamp was not frozen before Coco Receive')
		const prepared = await publisher.prepare(normalized, record.publicationCreatedAt)
		if (!HEX_32.test(prepared.eventId.toLowerCase())) throw new Error('Prepared kind-1024 event id is invalid')
		record = await this.lifecycles.update(record.commandId, (current) => ({
			...current,
			status: 'publication_ready',
			publicationEventId: prepared.eventId.toLowerCase(),
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))
		await publisher.publish(record.publicationEventId!)
		record = await this.markLifecyclePublished(record.commandId, record.publicationEventId!)
		return this.projectReceive(record)
	}

	async refundLosingBid(input: CocoAuctionRefundInput, revalidate: CocoAuctionLifecycleRevalidator): Promise<CocoAuctionRefundResult> {
		const normalized = this.requireRefund(input)
		const fingerprint = fingerprintCocoAuctionValue(normalized)
		let record = await this.createLifecycle(normalized, 'loser-refund', normalized.sendOperationId, fingerprint)
		if (record.status === 'refunded') return { commandId: record.commandId, operationId: record.operationId, status: 'refunded' }
		await revalidate()
		record = await this.lifecycles.update(record.commandId, (current) => ({
			...current,
			status: 'refunding',
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))
		const refunded = await this.engine.refundLosingBid(normalized)
		if (refunded.operationId !== normalized.sendOperationId || refunded.state !== 'refunded') {
			throw new Error('Coco did not refund the exact original Send operation')
		}
		record = await this.lifecycles.update(record.commandId, (current) => ({
			...current,
			status: 'refunded',
			revision: current.revision + 1,
			updatedAt: this.now(),
		}))
		return { commandId: record.commandId, operationId: record.operationId, status: 'refunded' }
	}

	private async createLifecycle(
		input: CocoAuctionWinnerReleaseInput | CocoAuctionWinnerReceiveInput | CocoAuctionRefundInput,
		kind: CocoAuctionLifecycleRecord['kind'],
		operationId: string,
		intentFingerprint: string,
	): Promise<CocoAuctionLifecycleRecord> {
		const now = this.now()
		const bidEventId = 'winningBidEventId' in input ? input.winningBidEventId : input.bidEventId
		const sendOperationId = 'sendOperationId' in input ? input.sendOperationId : input.senderOperationId
		const candidate: CocoAuctionLifecycleRecord = {
			schemaVersion: 1,
			commandId: input.commandId,
			kind,
			operationId,
			intentFingerprint,
			account: input.account,
			auction: input.auction,
			bidEventId,
			sendOperationId,
			...('pathReleaseEventId' in input ? { pathReleaseEventId: input.pathReleaseEventId } : {}),
			...('mintUrl' in input
				? { mintUrl: input.mintUrl, unit: input.unit, amount: input.amount, conditionFingerprint: input.conditionFingerprint }
				: {}),
			status: 'requested',
			revision: 0,
			createdAt: now,
			updatedAt: now,
		}
		const claimed = await this.lifecycles.createOrGet(candidate)
		if (
			claimed.record.kind !== kind ||
			claimed.record.operationId !== operationId ||
			claimed.record.intentFingerprint !== intentFingerprint ||
			!sameAccount(claimed.record.account, input.account)
		) {
			throw new CocoAuctionCommandConflictError(input.commandId)
		}
		return claimed.record
	}

	private async markLifecyclePublished(commandId: string, eventId: string): Promise<CocoAuctionLifecycleRecord> {
		return this.lifecycles.update(commandId, (current) => {
			if (current.publicationEventId !== eventId) throw new Error('Coco Auction lifecycle publication identity changed')
			return { ...current, status: 'published', revision: current.revision + 1, updatedAt: this.now() }
		})
	}

	private projectRelease(record: CocoAuctionLifecycleRecord): CocoAuctionWinnerReleaseResult {
		if (!record.publicationEventId) throw new Error('Winner release has no kind-1025 event')
		return {
			commandId: record.commandId,
			operationId: record.operationId,
			pathReleaseEventId: record.publicationEventId,
			status: 'released',
		}
	}

	private projectReceive(record: CocoAuctionLifecycleRecord): CocoAuctionWinnerReceiveResult {
		if (!record.publicationEventId) throw new Error('Winner Receive has no kind-1024 event')
		return {
			commandId: record.commandId,
			operationId: record.operationId,
			settlementEventId: record.publicationEventId,
			status: 'published',
		}
	}

	private requireWinnerRelease(input: CocoAuctionWinnerReleaseInput): CocoAuctionWinnerReleaseInput {
		const account = this.requireAccount(input.account)
		const auction = assertCocoAuctionReference(input.auction)
		if (!HEX_32.test(input.winningBidEventId) || !HEX_32.test(input.winningBidderPubkey) || !HEX_32.test(input.sellerPubkey)) {
			throw new Error('Winner release event identities are invalid')
		}
		if (!input.sendOperationId) throw new Error('Winner release requires the exact Coco Send operation')
		const normalized = { ...input, account, auction }
		const expected = deriveCocoAuctionCommandId('winner-release', {
			account,
			auction,
			winningBidEventId: input.winningBidEventId,
			winningBidderPubkey: input.winningBidderPubkey,
			sellerPubkey: input.sellerPubkey,
			sendOperationId: input.sendOperationId,
		})
		if (input.commandId !== expected) throw new CocoAuctionCommandConflictError(input.commandId)
		return normalized
	}

	private requireWinnerReceive(input: CocoAuctionWinnerReceiveInput): CocoAuctionWinnerReceiveInput {
		const account = this.requireAccount(input.account)
		const auction = assertCocoAuctionReference(input.auction)
		const mintUrl = assertFakeCocoAuctionMint(input.mintUrl, this.environment)
		if (account.accountPubkey !== input.sellerPubkey) throw new Error('Winner Receive account is not the Auction seller')
		if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.unit !== 'sat')
			throw new Error('Winner Receive amount is invalid')
		if (!HEX_32.test(input.winningBidEventId) || !HEX_32.test(input.pathReleaseEventId)) {
			throw new Error('Winner Receive event identities are invalid')
		}
		const normalized = { ...input, account, auction, mintUrl, unit: 'sat' as const }
		const expected = deriveCocoAuctionCommandId('winner-receive', {
			account,
			auction,
			winningBidEventId: input.winningBidEventId,
			pathReleaseEventId: input.pathReleaseEventId,
			senderOperationId: input.senderOperationId,
			mintUrl,
			unit: 'sat',
			amount: input.amount,
			conditionFingerprint: input.conditionFingerprint,
			tokenFingerprint: input.tokenFingerprint,
		})
		if (input.commandId !== expected) throw new CocoAuctionCommandConflictError(input.commandId)
		return normalized
	}

	private requireRefund(input: CocoAuctionRefundInput): CocoAuctionRefundInput {
		const account = this.requireAccount(input.account)
		const auction = assertCocoAuctionReference(input.auction)
		if (account.accountPubkey !== input.bidderPubkey) throw new Error('Refund account is not the original bidder')
		if (!input.sendOperationId || !HEX_32.test(input.bidEventId) || !Number.isSafeInteger(input.locktime)) {
			throw new Error('Refund binding is invalid')
		}
		const normalized = { ...input, account, auction }
		const expected = deriveCocoAuctionCommandId('loser-refund', {
			account,
			auction,
			bidEventId: input.bidEventId,
			bidderPubkey: input.bidderPubkey,
			sendOperationId: input.sendOperationId,
			locktime: input.locktime,
		})
		if (input.commandId !== expected) throw new CocoAuctionCommandConflictError(input.commandId)
		return normalized
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
				new CocoV2AuctionEnginePort(cocoRuntimeRegistry),
				new IndexedDbCocoAuctionCommandRepository(),
				readCocoV2AuctionEnvironment(),
				Date.now,
				new IndexedDbCocoAuctionLifecycleRepository(),
			),
		)
	}
	return configuredHost
}

export const resetPlebeianWalletHostForTests = (): void => {
	configuredHost = null
}
