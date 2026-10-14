import type { EventTemplate } from 'nostr-tools/pure'
import type { Signer, SignedEventLike } from '../../core/ports/signer'
import { AUCTION_BID_KIND, AUCTION_KIND, AUCTION_MIN_BID_LEG_SATS, AUCTION_MIN_BID_SATS, AUCTION_SETTLEMENT_KIND } from './constants'
import type { ParsedAuctionEvent } from './events'
import {
	buildAuctionEventTags,
	buildBidEventTags,
	buildSettlementTags,
	type AuctionEventTagsInput,
	type BidEventTagsInput,
} from './tagBuilders'
import { computeBidFloor } from './validation'

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface AuctionListingWorkflowInput {
	auction: AuctionEventTagsInput
	content: string
	createdAt: number
}

/** Prepare the unsigned listing event. Mint checks, signing, and relay I/O stay with the host. */
export function prepareAuctionListing(input: AuctionListingWorkflowInput): EventTemplate {
	assertUnixSeconds(input.createdAt, 'createdAt')
	assertUnixSeconds(input.auction.startAt, 'startAt')
	assertUnixSeconds(input.auction.endAt, 'endAt')
	assertUnixSeconds(input.auction.maxEndAt, 'maxEndAt')
	if (input.auction.startAt > input.auction.endAt || input.auction.endAt > input.auction.maxEndAt) {
		throw new Error('Auction times must satisfy startAt <= endAt <= maxEndAt')
	}
	if (!Number.isSafeInteger(input.auction.settlementGrace) || input.auction.settlementGrace <= 0) {
		throw new Error('settlementGrace must be a positive safe integer')
	}
	if (!Number.isSafeInteger(input.auction.maxEndAt + input.auction.settlementGrace)) {
		throw new Error('Auction locktime exceeds the safe integer range')
	}
	if (!Number.isSafeInteger(input.auction.reserve) || input.auction.reserve < 0)
		throw new Error('reserve must be a non-negative safe integer')
	if (!Number.isSafeInteger(input.auction.bidIncrement) || input.auction.bidIncrement <= 0) {
		throw new Error('bidIncrement must be a positive safe integer')
	}
	const minBidCurve = input.auction.minBidCurve
	if (
		minBidCurve &&
		(!['none', 'linear', 'exponential'].includes(minBidCurve.shape) ||
			!Number.isFinite(minBidCurve.peakMultiplier) ||
			minBidCurve.peakMultiplier < 1 ||
			minBidCurve.peakMultiplier > 100)
	) {
		throw new Error('minBidCurve must use a supported shape and multiplier from 1 to 100')
	}
	return {
		kind: AUCTION_KIND,
		created_at: input.createdAt,
		content: input.content,
		tags: buildAuctionEventTags(input.auction),
	}
}

export interface AuctionListingPublishPorts<SignedEvent extends SignedEventLike> extends Signer<SignedEvent> {
	assertMintsSupported(mints: readonly string[]): Promise<void>
	publish(event: SignedEvent): Promise<void>
}

export type AuctionListingPublishOutcome =
	| { status: 'published'; eventId: string }
	| { status: 'failed'; phase: 'mint_preflight' | 'event_preparation' | 'sign'; error: string }
	| { status: 'publish_uncertain'; eventId: string; error: string }

/** Execute listing publication in validation → mint preflight → sign → publish order. */
export async function executeAuctionListingWorkflow<SignedEvent extends SignedEventLike>(
	input: AuctionListingWorkflowInput,
	ports: AuctionListingPublishPorts<SignedEvent>,
): Promise<AuctionListingPublishOutcome> {
	return executeAuctionListingTemplateWorkflow(() => prepareAuctionListing(input), input.auction.mints, ports)
}

/** Publish a host-prepared listing without rewriting its protocol tags. */
export async function executeAuctionListingTemplateWorkflow<SignedEvent extends SignedEventLike>(
	prepareTemplate: () => EventTemplate | Promise<EventTemplate>,
	mints: readonly string[],
	ports: AuctionListingPublishPorts<SignedEvent>,
): Promise<AuctionListingPublishOutcome> {
	try {
		await ports.assertMintsSupported(mints)
	} catch (error) {
		return { status: 'failed', phase: 'mint_preflight', error: errorMessage(error) }
	}
	let template: EventTemplate
	try {
		template = await prepareTemplate()
	} catch (error) {
		return { status: 'failed', phase: 'event_preparation', error: errorMessage(error) }
	}
	let event: SignedEvent
	try {
		event = await ports.sign(template)
	} catch (error) {
		return { status: 'failed', phase: 'sign', error: errorMessage(error) }
	}
	try {
		await ports.publish(event)
	} catch (error) {
		return { status: 'publish_uncertain', eventId: event.id, error: errorMessage(error) }
	}
	return { status: 'published', eventId: event.id }
}

// ---------------------------------------------------------------------------
// Funded bidding
// ---------------------------------------------------------------------------

export interface AuctionBidPreviousLeg {
	id: string
	bidderPubkey: string
	auctionRootEventId: string
	auctionCoordinate: string
	amount: number
	locktime: number
}

export interface AuctionBidPlan {
	auctionRootEventId: string
	auctionCoordinate: string
	sellerPubkey: string
	amount: number
	legAmount: number
	minimumAmount: number
	/** Advisory only: anti-snipe selection floor, not a bid-validity gate. */
	suggestedAmount: number
	locktime: number
	previousBidId?: string
	createdForEndAt: number
}

/** Validate the auction window, current bid floor, and cumulative rebid chain before funding. */
export function planAuctionBid(input: {
	auction: ParsedAuctionEvent
	bidderPubkey: string
	amount: number
	topBid: number
	now: number
	previousLeg?: AuctionBidPreviousLeg
}): AuctionBidPlan {
	const { auction } = input
	assertUnixSeconds(input.now, 'now')
	if (!input.bidderPubkey.trim()) throw new Error('Bidder pubkey is required')
	if (!Number.isSafeInteger(input.amount) || input.amount < AUCTION_MIN_BID_SATS) {
		throw new Error(`Bid amount must be an integer of at least ${AUCTION_MIN_BID_SATS} sats`)
	}
	if (input.now < auction.startAt) throw new Error('Auction has not started yet')
	if (input.now > auction.maxEndAt) throw new Error('Auction has reached its hard bidding cutoff')
	if (!Number.isSafeInteger(input.topBid) || input.topBid < 0) throw new Error('Top bid must be a non-negative safe integer')
	const minimumAmount = Math.max(AUCTION_MIN_BID_SATS, auction.startingBid)
	const suggestedAmount = computeBidFloor({ auction, topBid: input.topBid, atSeconds: input.now })
	if (input.amount < minimumAmount) throw new Error(`Bid amount must be at least ${minimumAmount} sats`)

	const previous = input.previousLeg
	if (previous) {
		if (previous.bidderPubkey.toLowerCase() !== input.bidderPubkey.toLowerCase())
			throw new Error('Previous bid leg belongs to a different bidder')
		if (previous.auctionRootEventId !== auction.rootEventId || previous.auctionCoordinate !== auction.coordinate) {
			throw new Error('Previous bid leg belongs to a different auction')
		}
		if (!Number.isSafeInteger(previous.amount) || previous.amount < 0 || input.amount <= previous.amount) {
			throw new Error('Rebid amount must exceed the previous bid amount')
		}
	}
	const legAmount = input.amount - (previous?.amount ?? 0)
	if (!Number.isSafeInteger(legAmount) || legAmount < AUCTION_MIN_BID_LEG_SATS) {
		throw new Error(`Bid raise must be an integer of at least ${AUCTION_MIN_BID_LEG_SATS} sats`)
	}
	const locktime = auction.maxEndAt + auction.settlementGrace
	if (!Number.isSafeInteger(locktime) || locktime <= auction.maxEndAt) throw new Error('Auction locktime is invalid')
	if (previous && previous.locktime !== locktime)
		throw new Error('Previous bid leg has a different locktime; refusing to create a broken bid chain')

	return {
		auctionRootEventId: auction.rootEventId,
		auctionCoordinate: auction.coordinate,
		sellerPubkey: auction.sellerPubkey,
		amount: input.amount,
		legAmount,
		minimumAmount,
		suggestedAmount,
		locktime,
		...(previous ? { previousBidId: previous.id } : {}),
		createdForEndAt: auction.maxEndAt,
	}
}

/** Build the unsigned kind-1023 event from a validated bid plan and mint lock result. */
export function createAuctionBidTemplate(
	plan: AuctionBidPlan,
	input: {
		mint: string
		refundPubkey: string
		childPubkey: string
		lockSecrets: string[]
		proofYs: string[]
		dleqProofs: NonNullable<BidEventTagsInput['dleqProofs']>
		bidNonce: string
		createdAt: number
		note?: string
	},
): EventTemplate {
	assertUnixSeconds(input.createdAt, 'createdAt')
	if (!input.mint.trim()) throw new Error('Bid mint is required')
	if (!input.refundPubkey.trim() || !input.childPubkey.trim()) throw new Error('Bid lock pubkeys are required')
	if (!input.bidNonce.trim()) throw new Error('Bid nonce is required')
	if (!input.dleqProofs.length) throw new Error('DLEQ proof is required for every funded auction bid')
	return {
		kind: AUCTION_BID_KIND,
		created_at: input.createdAt,
		content: JSON.stringify({ type: 'auction_bid_v1', amount: plan.amount, mint: input.mint }),
		tags: buildBidEventTags({
			auctionRootEventId: plan.auctionRootEventId,
			auctionCoordinate: plan.auctionCoordinate,
			sellerPubkey: plan.sellerPubkey,
			amount: plan.amount,
			mint: input.mint,
			locktime: plan.locktime,
			refundPubkey: input.refundPubkey,
			childPubkey: input.childPubkey,
			lockSecrets: input.lockSecrets,
			proofYs: input.proofYs,
			dleqProofs: input.dleqProofs,
			createdForEndAt: plan.createdForEndAt,
			bidNonce: input.bidNonce,
			prevBidId: plan.previousBidId,
			note: input.note,
		}),
	}
}

export type AuctionLockOutcome<Funding> =
	| { status: 'locked'; funding: Funding }
	| { status: 'not_locked'; error: string }
	| { status: 'unknown'; error: string }

export interface AuctionBidPublication<Event, Recovery> {
	event: Event
	recovery: Recovery
}

export interface AuctionBidWorkflowPorts<Intent, Funding, Event, SignedEvent extends SignedEventLike, Recovery> {
	/** Generate a fresh path and per-leg refund authority; do not lock funds here. */
	prepareLock(plan: AuctionBidPlan): Promise<{ intent: Intent; preLockRecovery: Recovery }>
	/** Must durably confirm the recovery record before lockFunds is called. */
	persistPreLockRecovery(record: Recovery): Promise<void>
	/** Return `unknown` unless the adapter can prove that no mint mutation occurred. */
	lockFunds(intent: Intent, plan: AuctionBidPlan): Promise<AuctionLockOutcome<Funding>>
	removePreLockRecovery?(record: Recovery): Promise<void>
	createPublication(input: { plan: AuctionBidPlan; intent: Intent; funding: Funding }): Promise<AuctionBidPublication<Event, Recovery>>
	/** Persist proofs/refund authority and the exact rebroadcastable event before signing. */
	persistFundedPublication(publication: AuctionBidPublication<Event, Recovery>): Promise<void>
	/**
	 * Signs the workflow's own `Event` shape (produced by `createPublication`), not a
	 * plain `EventTemplate` — richer than `Signer`'s contract, so this stays bespoke.
	 */
	sign(event: Event): Promise<SignedEvent>
	persistSignedEvent(event: SignedEvent, recovery: Recovery): Promise<void>
	publish(event: SignedEvent): Promise<void>
}

export type AuctionBidWorkflowOutcome<SignedEvent> =
	| { status: 'failed_before_lock'; error: string }
	| { status: 'lock_outcome_uncertain'; error: string }
	| { status: 'locked_recovery_only'; error: string }
	| { status: 'publish_retryable'; event?: unknown; signedEvent?: SignedEvent; error: string }
	| { status: 'published'; eventId: string }

/**
 * Run one funded-bid attempt. A lock is never repeated after it may have
 * succeeded: pre-lock persistence is mandatory, and post-lock failures return
 * recovery-only or exact-event-retry outcomes.
 */
export async function executeFundedAuctionBidWorkflow<Intent, Funding, Event, SignedEvent extends SignedEventLike, Recovery>(
	plan: AuctionBidPlan,
	ports: AuctionBidWorkflowPorts<Intent, Funding, Event, SignedEvent, Recovery>,
): Promise<AuctionBidWorkflowOutcome<SignedEvent>> {
	let prepared: { intent: Intent; preLockRecovery: Recovery }
	try {
		prepared = await ports.prepareLock(plan)
		await ports.persistPreLockRecovery(prepared.preLockRecovery)
	} catch (error) {
		return { status: 'failed_before_lock', error: errorMessage(error) }
	}

	let lock: AuctionLockOutcome<Funding>
	try {
		lock = await ports.lockFunds(prepared.intent, plan)
	} catch (error) {
		return { status: 'lock_outcome_uncertain', error: errorMessage(error) }
	}
	if (lock.status === 'not_locked') {
		try {
			await ports.removePreLockRecovery?.(prepared.preLockRecovery)
		} catch {
			// A stale recovery record is safer than losing a potentially needed key.
		}
		return { status: 'failed_before_lock', error: lock.error }
	}
	if (lock.status === 'unknown') return { status: 'lock_outcome_uncertain', error: lock.error }

	let publication: AuctionBidPublication<Event, Recovery>
	try {
		publication = await ports.createPublication({ plan, intent: prepared.intent, funding: lock.funding })
		await ports.persistFundedPublication(publication)
		try {
			await ports.removePreLockRecovery?.(prepared.preLockRecovery)
		} catch {
			// The complete funded record is durable; retaining a stale pre-lock record is harmless.
		}
	} catch (error) {
		return { status: 'locked_recovery_only', error: errorMessage(error) }
	}

	let signed: SignedEvent
	try {
		signed = await ports.sign(publication.event)
		await ports.persistSignedEvent(signed, publication.recovery)
	} catch (error) {
		return { status: 'publish_retryable', event: publication.event, error: errorMessage(error) }
	}
	try {
		await ports.publish(signed)
	} catch (error) {
		return { status: 'publish_retryable', event: publication.event, signedEvent: signed, error: errorMessage(error) }
	}
	return { status: 'published', eventId: signed.id }
}

/** Retry a persisted bid using its exact event; this API intentionally has no wallet/lock port. */
export async function retryAuctionBidPublish<Event, SignedEvent extends SignedEventLike, Recovery>(ports: {
	load(): Promise<{ event: Event; signedEvent?: SignedEvent; recovery: Recovery }>
	sign(event: Event): Promise<SignedEvent>
	persistSignedEvent(event: SignedEvent, recovery: Recovery): Promise<void>
	publish(event: SignedEvent): Promise<void>
}): Promise<{ status: 'published'; eventId: string } | { status: 'retryable'; event?: Event; signedEvent?: SignedEvent; error: string }> {
	let saved: { event: Event; signedEvent?: SignedEvent; recovery: Recovery }
	try {
		saved = await ports.load()
	} catch (error) {
		return { status: 'retryable', error: errorMessage(error) }
	}
	let signed = saved.signedEvent
	try {
		if (!signed) {
			signed = await ports.sign(saved.event)
			await ports.persistSignedEvent(signed, saved.recovery)
		}
		await ports.publish(signed)
		return { status: 'published', eventId: signed.id }
	} catch (error) {
		return { status: 'retryable', event: saved.event, ...(signed ? { signedEvent: signed } : {}), error: errorMessage(error) }
	}
}

// ---------------------------------------------------------------------------
// Bidder path release
// ---------------------------------------------------------------------------

export interface AuctionPathReleaseLeg<Template> {
	bidEventId: string
	amount: number
	template: Template
}

export interface AuctionPathReleaseProgress {
	bidEventId: string
	status: 'pending' | 'published' | 'publish_uncertain'
	eventId?: string
	recoveryRecorded: boolean
}

export interface AuctionPathReleaseWorkflowPorts<Template, SignedEvent extends SignedEventLike> {
	sign(template: Template): Promise<SignedEvent>
	publish(event: SignedEvent): Promise<void>
	markReleased(bidEventId: string): void | Promise<void>
}

export type AuctionPathReleaseWorkflowOutcome =
	| {
			status: 'published'
			pathReleaseEventId: string
			legsReleased: number
			cumulativeBidAmount: number
			progress: AuctionPathReleaseProgress[]
	  }
	| {
			status: 'failed' | 'partial'
			failedBidEventId: string
			failedPhase: 'sign' | 'record_release'
			error: string
			pathReleaseEventId?: string
			legsReleased: number
			cumulativeBidAmount: number
			progress: AuctionPathReleaseProgress[]
	  }
	| {
			status: 'publish_uncertain'
			failedBidEventId: string
			attemptedEventId: string
			error: string
			pathReleaseEventId?: string
			legsReleased: number
			cumulativeBidAmount: number
			progress: AuctionPathReleaseProgress[]
	  }

/** Publish a prevalidated bidder chain in order, retaining confirmed progress on later failure. */
export async function executeAuctionPathReleaseWorkflow<Template, SignedEvent extends SignedEventLike>(
	legs: readonly AuctionPathReleaseLeg<Template>[],
	ports: AuctionPathReleaseWorkflowPorts<Template, SignedEvent>,
): Promise<AuctionPathReleaseWorkflowOutcome> {
	if (legs.length === 0) throw new Error('Auction path-release chain cannot be empty')
	const seenBidIds = new Set<string>()
	for (const leg of legs) {
		if (!leg.bidEventId.trim() || seenBidIds.has(leg.bidEventId))
			throw new Error('Auction path-release chain has a missing or duplicate bid id')
		if (!Number.isSafeInteger(leg.amount) || leg.amount <= 0)
			throw new Error('Auction path-release leg amount must be a positive safe integer')
		seenBidIds.add(leg.bidEventId)
	}

	let progress: AuctionPathReleaseProgress[] = legs.map(({ bidEventId }) => ({
		bidEventId,
		status: 'pending',
		recoveryRecorded: false,
	}))
	let pathReleaseEventId: string | undefined
	let legsReleased = 0
	let cumulativeBidAmount = 0

	const failure = (bidEventId: string, failedPhase: 'sign' | 'record_release', error: unknown): AuctionPathReleaseWorkflowOutcome => ({
		status: legsReleased > 0 ? 'partial' : 'failed',
		failedBidEventId: bidEventId,
		failedPhase,
		error: errorMessage(error),
		...(pathReleaseEventId ? { pathReleaseEventId } : {}),
		legsReleased,
		cumulativeBidAmount,
		progress,
	})

	for (const leg of legs) {
		let signed: SignedEvent
		try {
			signed = await ports.sign(leg.template)
		} catch (error) {
			return failure(leg.bidEventId, 'sign', error)
		}

		try {
			await ports.publish(signed)
		} catch (error) {
			progress = progress.map((entry) =>
				entry.bidEventId === leg.bidEventId ? { ...entry, status: 'publish_uncertain', eventId: signed.id } : entry,
			)
			return {
				status: 'publish_uncertain',
				failedBidEventId: leg.bidEventId,
				attemptedEventId: signed.id,
				error: errorMessage(error),
				...(pathReleaseEventId ? { pathReleaseEventId } : {}),
				legsReleased,
				cumulativeBidAmount,
				progress,
			}
		}

		pathReleaseEventId = signed.id
		legsReleased++
		cumulativeBidAmount += leg.amount
		progress = progress.map((entry) =>
			entry.bidEventId === leg.bidEventId ? { ...entry, status: 'published', eventId: signed.id } : entry,
		)
		try {
			await ports.markReleased(leg.bidEventId)
			progress = progress.map((entry) => (entry.bidEventId === leg.bidEventId ? { ...entry, recoveryRecorded: true } : entry))
		} catch (error) {
			return failure(leg.bidEventId, 'record_release', error)
		}
	}

	return {
		status: 'published',
		pathReleaseEventId: pathReleaseEventId!,
		legsReleased,
		cumulativeBidAmount,
		progress,
	}
}

// ---------------------------------------------------------------------------
// Seller settlement
// ---------------------------------------------------------------------------

export interface AuctionSettlementLeg<RedemptionData = unknown> {
	bidEventId: string
	amount: number
	locktime: number
	redemptionData: RedemptionData
}

export type AuctionSettlementPlan<RedemptionData = unknown> =
	| {
			status: 'settled'
			auction: ParsedAuctionEvent
			closeAt: number
			createdAt: number
			winningBidId: string
			winnerPubkey: string
			finalAmount: number
			pathReleaseEventId: string
			legs: AuctionSettlementLeg<RedemptionData>[]
	  }
	| {
			status: 'reserve_not_met'
			auction: ParsedAuctionEvent
			closeAt: number
			createdAt: number
			reason: string
	  }

export function planAuctionSettlement<RedemptionData>(input: AuctionSettlementPlan<RedemptionData>): AuctionSettlementPlan<RedemptionData> {
	assertUnixSeconds(input.closeAt, 'closeAt')
	assertUnixSeconds(input.createdAt, 'createdAt')
	if (input.closeAt < input.auction.maxEndAt) throw new Error('Auction has not ended; settlement cannot be planned')
	if (input.status === 'reserve_not_met') {
		if (input.auction.reserve <= 0) throw new Error('An auction without a positive reserve cannot close as reserve_not_met')
		if (!input.reason.trim()) throw new Error('Reserve-not-met settlement reason is required')
		return input
	}
	if (!input.winningBidId || !input.winnerPubkey || !input.pathReleaseEventId) throw new Error('Winner, bid, and path release are required')
	if (!Number.isSafeInteger(input.finalAmount) || input.finalAmount <= 0)
		throw new Error('Final settlement amount must be a positive safe integer')
	if (input.auction.reserve > 0 && input.finalAmount < input.auction.reserve)
		throw new Error('Winning amount does not meet the auction reserve')
	if (!input.legs.length) throw new Error('Settlement chain contains no legs')
	const ids = new Set<string>()
	let sum = 0
	for (const leg of input.legs) {
		if (!leg.bidEventId || ids.has(leg.bidEventId)) throw new Error('Settlement chain contains a missing or duplicate bid event id')
		ids.add(leg.bidEventId)
		if (!Number.isSafeInteger(leg.amount) || leg.amount < AUCTION_MIN_BID_LEG_SATS) throw new Error('Settlement leg amount is invalid')
		if (!Number.isSafeInteger(leg.locktime) || leg.locktime !== input.auction.maxEndAt + input.auction.settlementGrace) {
			throw new Error('Settlement leg locktime does not match the auction locktime')
		}
		sum += leg.amount
		if (!Number.isSafeInteger(sum)) throw new Error('Settlement chain amount exceeds the safe integer range')
	}
	if (input.legs[input.legs.length - 1].bidEventId !== input.winningBidId) {
		throw new Error('Settlement chain must end at the canonical winning bid')
	}
	if (sum !== input.finalAmount) throw new Error(`Settlement chain total ${sum} does not equal winning amount ${input.finalAmount}`)
	return input
}

export type AuctionLegState = 'unspent' | 'redeemed_by_seller' | 'partial' | 'unknown'

export interface AuctionSettlementWorkflowPorts<RedemptionData> {
	/** Must validate the complete chain (P2PK, token binding, DLEQ/NUT-7, etc.) before any redemption. */
	preflightAll(legs: readonly AuctionSettlementLeg<RedemptionData>[]): Promise<void>
	/** `redeemed_by_seller` requires evidence that distinguishes seller redemption from bidder refund. */
	inspectLeg(leg: AuctionSettlementLeg<RedemptionData>): Promise<AuctionLegState>
	redeemLeg(leg: AuctionSettlementLeg<RedemptionData>): Promise<void>
	/** Recheck no eligible winner and no existing settled outcome before publishing reserve_not_met. */
	assertReserveNotMet(auction: ParsedAuctionEvent, reason: string): Promise<void>
	publish(template: EventTemplate): Promise<{ eventId: string }>
}

export type AuctionSettlementWorkflowOutcome =
	| { status: 'published'; eventId: string; redeemedBidIds: string[] }
	| { status: 'failed'; phase: 'preflight' | 'leg_inspection' | 'redemption' | 'reserve_guard'; error: string; redeemedBidIds: string[] }
	| { status: 'publish_uncertain'; template: EventTemplate; redeemedBidIds: string[]; error: string }

/** Validate all legs first, resume already-redeemed legs, then publish the terminal settlement event. */
export async function executeAuctionSettlementWorkflow<RedemptionData>(
	input: AuctionSettlementPlan<RedemptionData>,
	ports: AuctionSettlementWorkflowPorts<RedemptionData>,
): Promise<AuctionSettlementWorkflowOutcome> {
	const plan = planAuctionSettlement(input)
	if (plan.status === 'reserve_not_met') {
		try {
			await ports.assertReserveNotMet(plan.auction, plan.reason)
		} catch (error) {
			return { status: 'failed', phase: 'reserve_guard', error: errorMessage(error), redeemedBidIds: [] }
		}
		const template: EventTemplate = {
			kind: AUCTION_SETTLEMENT_KIND,
			created_at: plan.createdAt,
			content: '',
			tags: buildSettlementTags({
				auctionRootEventId: plan.auction.rootEventId,
				auctionCoordinate: plan.auction.coordinate,
				status: 'reserve_not_met',
				closeAt: plan.closeAt,
				finalAmount: 0,
				reason: plan.reason,
			}),
		}
		return publishSettlementTemplate(template, [], ports)
	}

	try {
		await ports.preflightAll(plan.legs)
	} catch (error) {
		return { status: 'failed', phase: 'preflight', error: errorMessage(error), redeemedBidIds: [] }
	}

	const redeemedBidIds: string[] = []
	for (const leg of plan.legs) {
		let state: AuctionLegState
		try {
			state = await ports.inspectLeg(leg)
		} catch (error) {
			return { status: 'failed', phase: 'leg_inspection', error: errorMessage(error), redeemedBidIds }
		}
		if (state === 'redeemed_by_seller') {
			redeemedBidIds.push(leg.bidEventId)
			continue
		}
		if (state !== 'unspent') {
			return {
				status: 'failed',
				phase: 'leg_inspection',
				error:
					state === 'partial'
						? `Settlement leg ${leg.bidEventId} is partially spent`
						: `Settlement leg ${leg.bidEventId} state is unconfirmed`,
				redeemedBidIds,
			}
		}
		try {
			await ports.redeemLeg(leg)
			redeemedBidIds.push(leg.bidEventId)
		} catch (error) {
			return { status: 'failed', phase: 'redemption', error: errorMessage(error), redeemedBidIds }
		}
	}

	const template: EventTemplate = {
		kind: AUCTION_SETTLEMENT_KIND,
		created_at: plan.createdAt,
		content: '',
		tags: buildSettlementTags({
			auctionRootEventId: plan.auction.rootEventId,
			auctionCoordinate: plan.auction.coordinate,
			status: 'settled',
			closeAt: plan.closeAt,
			finalAmount: plan.finalAmount,
			winningBidId: plan.winningBidId,
			winnerPubkey: plan.winnerPubkey,
			pathReleaseEventId: plan.pathReleaseEventId,
			payouts: plan.legs.map((leg) => ({ bidEventId: leg.bidEventId, amount: leg.amount, status: 'redeemed' })),
		}),
	}
	return publishSettlementTemplate(template, redeemedBidIds, ports)
}

async function publishSettlementTemplate<RedemptionData>(
	template: EventTemplate,
	redeemedBidIds: string[],
	ports: AuctionSettlementWorkflowPorts<RedemptionData>,
): Promise<AuctionSettlementWorkflowOutcome> {
	try {
		const result = await ports.publish(template)
		return { status: 'published', eventId: result.eventId, redeemedBidIds }
	} catch (error) {
		return { status: 'publish_uncertain', template, redeemedBidIds, error: errorMessage(error) }
	}
}

// ---------------------------------------------------------------------------
// Private winner shipping claim
// ---------------------------------------------------------------------------

export interface AuctionClaimDeliveryDetails {
	name: string
	firstLineOfAddress: string
	city: string
	zipPostcode: string
	country: string
	additionalInformation?: string
}

export interface AuctionWinnerClaimInput {
	orderId: string
	auctionCoordinate: string
	auctionEventId: string
	settlementEventId: string
	buyerPubkey: string
	sellerPubkey: string
	finalAmount: number
	shippingAddress: AuctionClaimDeliveryDetails
	email?: string
	phone?: string
	notes?: string
	createdAt: number
}

export type AuctionWinnerClaimPayload = Omit<AuctionWinnerClaimInput, 'createdAt'>

export interface PreparedAuctionWinnerClaim {
	payload: AuctionWinnerClaimPayload
	marker: EventTemplate
}

/** Prepare a private claim payload and a PII-free public kind-16 marker. */
export function prepareAuctionWinnerClaim(input: AuctionWinnerClaimInput): PreparedAuctionWinnerClaim {
	assertUnixSeconds(input.createdAt, 'createdAt')
	for (const [name, value] of Object.entries({
		orderId: input.orderId,
		auctionCoordinate: input.auctionCoordinate,
		auctionEventId: input.auctionEventId,
		settlementEventId: input.settlementEventId,
	})) {
		if (!value.trim()) throw new Error(`${name} is required`)
	}
	if (!isHexPubkey(input.buyerPubkey) || !isHexPubkey(input.sellerPubkey)) throw new Error('Buyer and seller must be 32-byte hex pubkeys')
	if (!isEventId(input.auctionEventId) || !isEventId(input.settlementEventId))
		throw new Error('Auction and settlement ids must be 32-byte hex event ids')
	if (!Number.isSafeInteger(input.finalAmount) || input.finalAmount <= 0) throw new Error('Claim amount must be a positive safe integer')
	for (const field of ['name', 'firstLineOfAddress', 'city', 'zipPostcode', 'country'] as const) {
		if (!input.shippingAddress[field].trim()) throw new Error(`Shipping ${field} is required`)
	}
	const coordinateParts = input.auctionCoordinate.split(':')
	if (
		coordinateParts.length !== 3 ||
		coordinateParts[0] !== String(AUCTION_KIND) ||
		coordinateParts[1].toLowerCase() !== input.sellerPubkey.toLowerCase()
	) {
		throw new Error('Auction coordinate does not belong to the seller')
	}
	const { createdAt: _createdAt, ...claimFields } = input
	const payload: AuctionWinnerClaimPayload = { ...claimFields, shippingAddress: { ...input.shippingAddress } }
	return {
		payload,
		marker: {
			kind: 16,
			created_at: input.createdAt,
			content: '',
			tags: [
				['p', input.sellerPubkey],
				['subject', 'auction-claim'],
				['type', '1'],
				['order', input.orderId],
				['amount', String(input.finalAmount)],
				['a', input.auctionCoordinate],
				['e', input.auctionEventId],
				['e', input.settlementEventId, '', 'settlement'],
			],
		},
	}
}

export interface AuctionWinnerClaimPorts<PrivateDelivery, SignedMarker extends SignedEventLike> {
	createPrivateDelivery(payload: AuctionWinnerClaimPayload): Promise<PrivateDelivery>
	publishPrivateDelivery(delivery: PrivateDelivery): Promise<{ eventId: string; acceptedRelays: string[] }>
	signMarker(marker: EventTemplate): Promise<SignedMarker>
	publishMarker(marker: SignedMarker, relayUrls: readonly string[]): Promise<void>
}

export type AuctionWinnerClaimOutcome =
	| { status: 'published'; markerEventId: string; privateDeliveryEventId: string }
	| { status: 'failed'; phase: 'private_delivery_prepare' | 'private_delivery_publish'; error: string }
	| {
			status: 'partial'
			phase: 'marker_sign' | 'marker_publish'
			privateDeliveryEventId: string
			acceptedRelays: string[]
			error: string
	  }

/** Publish encrypted delivery details first, then the public marker only to relays that accepted the private wrap. */
export async function executeAuctionWinnerClaimWorkflow<PrivateDelivery, SignedMarker extends SignedEventLike>(
	input: AuctionWinnerClaimInput,
	ports: AuctionWinnerClaimPorts<PrivateDelivery, SignedMarker>,
): Promise<AuctionWinnerClaimOutcome> {
	const prepared = prepareAuctionWinnerClaim(input)
	let delivery: PrivateDelivery
	try {
		delivery = await ports.createPrivateDelivery(prepared.payload)
	} catch (error) {
		return { status: 'failed', phase: 'private_delivery_prepare', error: errorMessage(error) }
	}
	let privateResult: { eventId: string; acceptedRelays: string[] }
	try {
		privateResult = await ports.publishPrivateDelivery(delivery)
		if (privateResult.acceptedRelays.length === 0) throw new Error('No private relay accepted the encrypted claim')
	} catch (error) {
		return { status: 'failed', phase: 'private_delivery_publish', error: errorMessage(error) }
	}
	let marker: SignedMarker
	try {
		marker = await ports.signMarker(prepared.marker)
	} catch (error) {
		return {
			status: 'partial',
			phase: 'marker_sign',
			privateDeliveryEventId: privateResult.eventId,
			acceptedRelays: [...privateResult.acceptedRelays],
			error: errorMessage(error),
		}
	}
	try {
		await ports.publishMarker(marker, privateResult.acceptedRelays)
	} catch (error) {
		return {
			status: 'partial',
			phase: 'marker_publish',
			privateDeliveryEventId: privateResult.eventId,
			acceptedRelays: [...privateResult.acceptedRelays],
			error: errorMessage(error),
		}
	}
	return { status: 'published', markerEventId: marker.id, privateDeliveryEventId: privateResult.eventId }
}

function assertUnixSeconds(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive Unix timestamp in seconds`)
}

function isHexPubkey(value: string): boolean {
	return /^[0-9a-f]{64}$/i.test(value)
}

function isEventId(value: string): boolean {
	return /^[0-9a-f]{64}$/i.test(value)
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export type { AuctionEventTagsInput, BidEventTagsInput }
