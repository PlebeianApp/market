import type { Event } from 'nostr-tools'
import { MAX_REPLACEMENT_CHAIN_DEPTH } from '../../server/auction-validator/state'
import { verifyNostrEventSignature } from '../nostr/event-signature'
import type { NostrEventLike } from '../nostr/eventLike'
import { parseBidEvent } from '../schemas/auction/bidEvent'
import { AuctionMultipartyAuthorizationError } from './multipartyAuthorization'
import { AuctionMultipartyAuthorizationCryptoError, authenticateMultipartyRoot } from './multipartyAuthorizationCrypto'
import { AUCTION_MULTIPARTY_MAX_GROSS_SATS } from './multipartyAllocator'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from './multipartySchedule'

const HEX64 = /^[0-9a-f]{64}$/
const NIP01_HEX64 = /^[0-9a-fA-F]{64}$/
const NIP01_SIGNATURE_HEX128 = /^[0-9a-fA-F]{128}$/
const CANONICAL_POSITIVE_INTEGER = /^[1-9][0-9]*$/
const MAX_GROSS_SATS_DECIMAL = AUCTION_MULTIPARTY_MAX_GROSS_SATS.toString()
const UTF8_ENCODER = new TextEncoder()

// The existing 63-event cap composes with the per-event envelope ceilings below;
// no separate chain-byte budget is needed for deterministic bounded admission.
export const AUCTION_MULTIPARTY_MAX_PREDECESSOR_EVENTS = MAX_REPLACEMENT_CHAIN_DEPTH - 1
export const AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS = 256
export const AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENTS = 16
export const AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENT_UTF8_BYTES = 4_096
export const AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS_UTF8_BYTES = 65_536
export const AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_CONTENT_UTF8_BYTES = 4_096

export type AuctionMultipartyBidLegContextErrorCode =
	| 'bid_leg_input_invalid'
	| 'bid_leg_root_invalid'
	| 'bid_leg_root_profile_unsupported'
	| 'bid_leg_root_signature_invalid'
	| 'bid_leg_bidder_pubkey_invalid'
	| 'bid_leg_current_gross_sats_invalid'
	| 'bid_leg_predecessor_event_id_invalid'
	| 'bid_leg_predecessor_events_invalid'
	| 'bid_leg_predecessor_chain_too_long'
	| 'bid_leg_first_bid_predecessors_forbidden'
	| 'bid_leg_predecessor_missing'
	| 'bid_leg_predecessor_event_shape_invalid'
	| 'bid_leg_predecessor_event_duplicate'
	| 'bid_leg_predecessor_amount_invalid'
	| 'bid_leg_predecessor_event_invalid'
	| 'bid_leg_predecessor_signature_invalid'
	| 'bid_leg_predecessor_root_mismatch'
	| 'bid_leg_predecessor_coordinate_mismatch'
	| 'bid_leg_predecessor_seller_mismatch'
	| 'bid_leg_predecessor_bidder_mismatch'
	| 'bid_leg_predecessor_event_unavailable'
	| 'bid_leg_predecessor_self_reference'
	| 'bid_leg_predecessor_parent_unavailable'
	| 'bid_leg_predecessor_cycle'
	| 'bid_leg_predecessor_amount_not_increasing'
	| 'bid_leg_predecessor_not_chain_head'
	| 'bid_leg_predecessor_chain_disconnected'
	| 'bid_leg_current_amount_not_increasing'
	| 'bid_leg_context_provenance_invalid'

export class AuctionMultipartyBidLegContextError extends Error {
	readonly code: AuctionMultipartyBidLegContextErrorCode

	constructor(code: AuctionMultipartyBidLegContextErrorCode) {
		super(code)
		this.name = 'AuctionMultipartyBidLegContextError'
		this.code = code
	}
}

const fail = (code: AuctionMultipartyBidLegContextErrorCode): never => {
	throw new AuctionMultipartyBidLegContextError(code)
}

export interface BuildValidatedMultipartyBidLegContextInput {
	readonly rootEvent: NostrEventLike
	readonly bidderPubkey: string
	readonly currentGrossSats: bigint
	readonly predecessorEventId: string | null
	readonly predecessorEvents: readonly NostrEventLike[]
}

const VALIDATED_MULTIPARTY_BID_LEG_CONTEXT: unique symbol = Symbol('auction-multiparty-validated-bid-leg-context')

const validatedMultipartyBidLegContexts = new WeakSet<object>()

export interface ValidatedMultipartyBidLegContext {
	readonly [VALIDATED_MULTIPARTY_BID_LEG_CONTEXT]: true
	readonly profile: typeof AUCTION_MULTIPARTY_SETTLEMENT_POLICY
	readonly auctionRootEventId: string
	readonly auctionCoordinate: string
	readonly bidderPubkey: string
	readonly currentGrossSats: bigint
	readonly predecessorEventId: string | null
	readonly predecessorGrossSats: bigint | null
	readonly principalSats: bigint
}

interface ValidatedPredecessor {
	readonly id: string
	readonly prevBidId: string | null
	readonly grossSats: bigint
}

interface ExactPredecessorEnvelope extends NostrEventLike {
	readonly created_at: number
	readonly sig: string
}

interface BidLegInputSnapshot {
	readonly rootEvent: unknown
	readonly bidderPubkey: unknown
	readonly currentGrossSats: unknown
	readonly predecessorEventId: unknown
	readonly predecessorEvents: readonly unknown[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== 'object' || value === null) return false

	try {
		return !Array.isArray(value)
	} catch {
		return false
	}
}

const snapshotInputContainer = (input: unknown): BidLegInputSnapshot => {
	const data = isRecord(input) ? input : fail('bid_leg_input_invalid')

	let rootEvent: unknown
	let bidderPubkey: unknown
	let currentGrossSats: unknown
	let predecessorEventId: unknown
	let callerPredecessorEvents: unknown

	try {
		rootEvent = data.rootEvent
		bidderPubkey = data.bidderPubkey
		currentGrossSats = data.currentGrossSats
		predecessorEventId = data.predecessorEventId
		callerPredecessorEvents = data.predecessorEvents
	} catch {
		return fail('bid_leg_input_invalid')
	}

	let callerPredecessorArray: unknown[]
	let predecessorCount: number

	try {
		callerPredecessorArray = Array.isArray(callerPredecessorEvents) ? callerPredecessorEvents : fail('bid_leg_predecessor_events_invalid')
		predecessorCount = callerPredecessorArray.length
	} catch {
		return fail('bid_leg_predecessor_events_invalid')
	}

	if (!Number.isSafeInteger(predecessorCount) || predecessorCount < 0) {
		fail('bid_leg_predecessor_events_invalid')
	}

	if (predecessorCount > AUCTION_MULTIPARTY_MAX_PREDECESSOR_EVENTS) {
		fail('bid_leg_predecessor_chain_too_long')
	}

	const predecessorEvents: unknown[] = new Array<unknown>(predecessorCount)

	try {
		for (let index = 0; index < predecessorCount; index++) {
			predecessorEvents[index] = callerPredecessorArray[index]
		}
	} catch {
		return fail('bid_leg_predecessor_events_invalid')
	}

	return Object.freeze({
		rootEvent,
		bidderPubkey,
		currentGrossSats,
		predecessorEventId,
		predecessorEvents: Object.freeze(predecessorEvents),
	})
}

const snapshotExactPredecessorEnvelope = (event: unknown): ExactPredecessorEnvelope => {
	const record = isRecord(event) ? event : fail('bid_leg_predecessor_event_shape_invalid')

	try {
		const id = record.id
		const pubkey = record.pubkey
		const kind = record.kind
		const createdAt = record.created_at
		const callerTags = record.tags
		const content = record.content
		const signature = record.sig

		const ownedId = typeof id === 'string' && NIP01_HEX64.test(id) ? id : fail('bid_leg_predecessor_event_shape_invalid')
		const ownedPubkey = typeof pubkey === 'string' && NIP01_HEX64.test(pubkey) ? pubkey : fail('bid_leg_predecessor_event_shape_invalid')
		const ownedKind = typeof kind === 'number' && Number.isSafeInteger(kind) ? kind : fail('bid_leg_predecessor_event_shape_invalid')
		const ownedCreatedAt =
			typeof createdAt === 'number' && Number.isSafeInteger(createdAt) && createdAt >= 0
				? createdAt
				: fail('bid_leg_predecessor_event_shape_invalid')
		const callerTagArray = Array.isArray(callerTags) ? callerTags : fail('bid_leg_predecessor_event_shape_invalid')
		const ownedContent = typeof content === 'string' ? content : fail('bid_leg_predecessor_event_shape_invalid')
		const ownedSignature =
			typeof signature === 'string' && NIP01_SIGNATURE_HEX128.test(signature) ? signature : fail('bid_leg_predecessor_event_shape_invalid')

		const tagCount = callerTagArray.length
		if (!Number.isSafeInteger(tagCount) || tagCount < 0 || tagCount > AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS) {
			fail('bid_leg_predecessor_event_shape_invalid')
		}

		if (
			ownedContent.length > AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_CONTENT_UTF8_BYTES ||
			UTF8_ENCODER.encode(ownedContent).byteLength > AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_CONTENT_UTF8_BYTES
		) {
			fail('bid_leg_predecessor_event_shape_invalid')
		}

		const ownedTags: string[][] = new Array<string[]>(tagCount)
		let aggregateTagBytes = 0

		for (let tagIndex = 0; tagIndex < tagCount; tagIndex++) {
			const callerTag = callerTagArray[tagIndex]
			if (!Array.isArray(callerTag)) fail('bid_leg_predecessor_event_shape_invalid')

			const elementCount = callerTag.length
			if (!Number.isSafeInteger(elementCount) || elementCount < 1 || elementCount > AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENTS) {
				fail('bid_leg_predecessor_event_shape_invalid')
			}

			const ownedTag: string[] = new Array<string>(elementCount)

			for (let elementIndex = 0; elementIndex < elementCount; elementIndex++) {
				const element = callerTag[elementIndex]
				if (typeof element !== 'string') fail('bid_leg_predecessor_event_shape_invalid')
				if (element.length > AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENT_UTF8_BYTES) {
					fail('bid_leg_predecessor_event_shape_invalid')
				}

				const elementBytes = UTF8_ENCODER.encode(element).byteLength
				if (elementBytes > AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAG_ELEMENT_UTF8_BYTES) {
					fail('bid_leg_predecessor_event_shape_invalid')
				}

				aggregateTagBytes += elementBytes
				if (aggregateTagBytes > AUCTION_MULTIPARTY_BID_ENVELOPE_MAX_TAGS_UTF8_BYTES) {
					fail('bid_leg_predecessor_event_shape_invalid')
				}

				ownedTag[elementIndex] = element
			}

			ownedTags[tagIndex] = Object.freeze(ownedTag) as string[]
		}

		return Object.freeze({
			id: ownedId,
			pubkey: ownedPubkey,
			kind: ownedKind,
			created_at: ownedCreatedAt,
			tags: Object.freeze(ownedTags) as string[][],
			content: ownedContent,
			sig: ownedSignature,
		})
	} catch {
		return fail('bid_leg_predecessor_event_shape_invalid')
	}
}

const authenticateRoot = (rootEvent: unknown): ReturnType<typeof authenticateMultipartyRoot> => {
	try {
		return authenticateMultipartyRoot(rootEvent as NostrEventLike)
	} catch (error) {
		if (error instanceof AuctionMultipartyAuthorizationError && error.code === 'root_profile_unsupported') {
			return fail('bid_leg_root_profile_unsupported')
		}

		if (
			error instanceof AuctionMultipartyAuthorizationCryptoError &&
			(error.code === 'crypto_nostr_event_invalid' || error.code === 'crypto_nostr_event_shape_invalid')
		) {
			return fail('bid_leg_root_signature_invalid')
		}

		return fail('bid_leg_root_invalid')
	}
}

const assertSecurityCriticalSingletonTags = (event: ExactPredecessorEnvelope): string => {
	for (const name of ['e', 'a', 'p', 'amount'] as const) {
		const matches = event.tags.filter((tag) => tag[0] === name)

		if (matches.length !== 1 || matches[0].length !== 2) {
			fail(name === 'amount' ? 'bid_leg_predecessor_amount_invalid' : 'bid_leg_predecessor_event_invalid')
		}
	}

	const previousBidTags = event.tags.filter((tag) => tag[0] === 'prev_bid')
	if (previousBidTags.length > 1 || (previousBidTags.length === 1 && previousBidTags[0].length !== 2)) {
		fail('bid_leg_predecessor_event_invalid')
	}
	if (previousBidTags.length === 1 && !HEX64.test(previousBidTags[0][1])) {
		fail('bid_leg_predecessor_event_invalid')
	}

	const rawAmount = event.tags.find((tag) => tag[0] === 'amount')![1]

	if (!CANONICAL_POSITIVE_INTEGER.test(rawAmount)) {
		fail('bid_leg_predecessor_amount_invalid')
	}

	if (
		rawAmount.length > MAX_GROSS_SATS_DECIMAL.length ||
		(rawAmount.length === MAX_GROSS_SATS_DECIMAL.length && rawAmount > MAX_GROSS_SATS_DECIMAL)
	) {
		fail('bid_leg_predecessor_amount_invalid')
	}

	return rawAmount
}

const verifySignature = (event: ExactPredecessorEnvelope): void => {
	const exactEvent: Event = {
		id: event.id,
		pubkey: event.pubkey,
		kind: event.kind,
		created_at: event.created_at,
		content: event.content,
		tags: event.tags,
		sig: event.sig,
	}

	let verified = false

	try {
		verified = verifyNostrEventSignature(exactEvent)
	} catch {
		verified = false
	}

	if (!verified) {
		fail('bid_leg_predecessor_signature_invalid')
	}
}

const validatePredecessor = (
	event: ExactPredecessorEnvelope,
	root: ReturnType<typeof authenticateRoot>['value'],
	bidderPubkey: string,
): ValidatedPredecessor => {
	const rawGrossSats = assertSecurityCriticalSingletonTags(event)

	const parsed = parseBidEvent(event)
	const parsedBid = parsed.ok ? parsed.value : fail('bid_leg_predecessor_event_invalid')

	verifySignature(event)

	const grossSats = BigInt(rawGrossSats)

	if (parsedBid.auctionRootEventId !== root.id) {
		fail('bid_leg_predecessor_root_mismatch')
	}

	if (parsedBid.auctionCoordinate !== root.coordinate) {
		fail('bid_leg_predecessor_coordinate_mismatch')
	}

	if (parsedBid.sellerPubkey !== root.seller_pubkey) {
		fail('bid_leg_predecessor_seller_mismatch')
	}

	if (parsedBid.bidderPubkey !== bidderPubkey) {
		fail('bid_leg_predecessor_bidder_mismatch')
	}

	if (!Number.isSafeInteger(parsedBid.amount) || BigInt(parsedBid.amount) !== grossSats) {
		fail('bid_leg_predecessor_amount_invalid')
	}

	return Object.freeze({
		id: parsedBid.id,
		prevBidId: parsedBid.prevBidId ?? null,
		grossSats,
	})
}

const assertAcyclicAndIncreasing = (
	predecessors: readonly ValidatedPredecessor[],
	byId: ReadonlyMap<string, ValidatedPredecessor>,
): void => {
	for (const predecessor of predecessors) {
		if (predecessor.prevBidId === predecessor.id) {
			fail('bid_leg_predecessor_self_reference')
		}

		if (predecessor.prevBidId !== null && !byId.has(predecessor.prevBidId)) {
			fail('bid_leg_predecessor_parent_unavailable')
		}
	}

	for (const start of predecessors) {
		const seen = new Set<string>()
		let current: ValidatedPredecessor | undefined = start

		while (current) {
			if (seen.has(current.id)) {
				fail('bid_leg_predecessor_cycle')
			}

			seen.add(current.id)

			if (current.prevBidId === null) break

			const parent = byId.get(current.prevBidId)

			if (!parent) {
				fail('bid_leg_predecessor_parent_unavailable')
			}

			current = parent
		}
	}

	for (const predecessor of predecessors) {
		if (predecessor.prevBidId === null) continue

		const parent = byId.get(predecessor.prevBidId) ?? fail('bid_leg_predecessor_parent_unavailable')

		if (predecessor.grossSats <= parent.grossSats) {
			fail('bid_leg_predecessor_amount_not_increasing')
		}
	}
}

const selectChainHead = (
	predecessorEventId: string,
	predecessors: readonly ValidatedPredecessor[],
	byId: ReadonlyMap<string, ValidatedPredecessor>,
): ValidatedPredecessor => {
	const selected = byId.get(predecessorEventId) ?? fail('bid_leg_predecessor_event_unavailable')

	const referencedIds = new Set(predecessors.flatMap((predecessor) => (predecessor.prevBidId === null ? [] : [predecessor.prevBidId])))
	const heads = predecessors.filter((predecessor) => !referencedIds.has(predecessor.id))

	if (referencedIds.has(selected.id) || (heads.length === 1 && heads[0].id !== selected.id)) {
		fail('bid_leg_predecessor_not_chain_head')
	}

	if (heads.length !== 1) {
		fail('bid_leg_predecessor_chain_disconnected')
	}

	const visited = new Set<string>()
	let current: ValidatedPredecessor | undefined = selected

	while (current) {
		visited.add(current.id)
		current = current.prevBidId === null ? undefined : byId.get(current.prevBidId)
	}

	if (visited.size !== predecessors.length) {
		fail('bid_leg_predecessor_chain_disconnected')
	}

	return selected
}

export function buildValidatedMultipartyBidLegContext(input: BuildValidatedMultipartyBidLegContextInput): ValidatedMultipartyBidLegContext
export function buildValidatedMultipartyBidLegContext(input: unknown): ValidatedMultipartyBidLegContext {
	const data = snapshotInputContainer(input)
	const root = authenticateRoot(data.rootEvent).value

	const bidderPubkey =
		typeof data.bidderPubkey === 'string' && HEX64.test(data.bidderPubkey) ? data.bidderPubkey : fail('bid_leg_bidder_pubkey_invalid')

	const currentGrossSats =
		typeof data.currentGrossSats === 'bigint' && data.currentGrossSats > 0n && data.currentGrossSats <= AUCTION_MULTIPARTY_MAX_GROSS_SATS
			? data.currentGrossSats
			: fail('bid_leg_current_gross_sats_invalid')

	const predecessorEventId =
		data.predecessorEventId === null
			? null
			: typeof data.predecessorEventId === 'string' && HEX64.test(data.predecessorEventId)
				? data.predecessorEventId
				: fail('bid_leg_predecessor_event_id_invalid')

	const predecessorEvents = data.predecessorEvents

	if (predecessorEventId === null) {
		if (predecessorEvents.length !== 0) {
			fail('bid_leg_first_bid_predecessors_forbidden')
		}

		return createContext({
			profile: root.settlement_policy,
			auctionRootEventId: root.id,
			auctionCoordinate: root.coordinate,
			bidderPubkey,
			currentGrossSats,
			predecessorEventId: null,
			predecessorGrossSats: null,
			principalSats: currentGrossSats,
		})
	}

	if (predecessorEvents.length === 0) {
		fail('bid_leg_predecessor_missing')
	}

	const snapshots = predecessorEvents
		.map((event) => snapshotExactPredecessorEnvelope(event))
		.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

	for (let index = 1; index < snapshots.length; index++) {
		if (snapshots[index - 1].id === snapshots[index].id) {
			fail('bid_leg_predecessor_event_duplicate')
		}
	}

	const predecessors = snapshots.map((event) => validatePredecessor(event, root, bidderPubkey))

	const byId = new Map<string, ValidatedPredecessor>()

	for (const predecessor of predecessors) {
		byId.set(predecessor.id, predecessor)
	}

	assertAcyclicAndIncreasing(predecessors, byId)

	const selected = selectChainHead(predecessorEventId, predecessors, byId)

	if (currentGrossSats <= selected.grossSats) {
		fail('bid_leg_current_amount_not_increasing')
	}

	return createContext({
		profile: root.settlement_policy,
		auctionRootEventId: root.id,
		auctionCoordinate: root.coordinate,
		bidderPubkey,
		currentGrossSats,
		predecessorEventId: selected.id,
		predecessorGrossSats: selected.grossSats,
		principalSats: currentGrossSats - selected.grossSats,
	})
}

const createContext = (
	value: Omit<ValidatedMultipartyBidLegContext, typeof VALIDATED_MULTIPARTY_BID_LEG_CONTEXT>,
): ValidatedMultipartyBidLegContext => {
	const context: ValidatedMultipartyBidLegContext = {
		[VALIDATED_MULTIPARTY_BID_LEG_CONTEXT]: true,
		...value,
	}

	validatedMultipartyBidLegContexts.add(context)

	return Object.freeze(context)
}

export const isValidatedMultipartyBidLegContext = (value: unknown): value is ValidatedMultipartyBidLegContext =>
	typeof value === 'object' && value !== null && validatedMultipartyBidLegContexts.has(value)

export function assertValidatedMultipartyBidLegContext(value: unknown): asserts value is ValidatedMultipartyBidLegContext {
	if (!isValidatedMultipartyBidLegContext(value)) {
		fail('bid_leg_context_provenance_invalid')
	}
}
