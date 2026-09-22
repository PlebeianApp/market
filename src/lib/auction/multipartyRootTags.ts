/**
 * Auction multiparty root tags (wire packet D2, section 2).
 *
 * The multiparty root is a single-party root plus the canonical schedule and its
 * commitment, with the settlement policy literal switched. This module is an
 * **additive projection** over the existing single-party builder's output: the live
 * builder is not modified, so no existing auction changes shape.
 *
 * See `docs/protocol/auction-multiparty-manifest-v1.md`.
 */

import { base64urlnopad } from '@scure/base'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY, type AuctionMultipartyCanonicalSchedule } from './multipartySchedule'

export const AUCTION_MULTIPARTY_ROOT_TAG_ERROR_CODES = [
	'root_settlement_policy_missing',
	'root_settlement_policy_ambiguous',
	'root_schedule_tag_already_present',
	'root_schedule_tags_incomplete',
] as const

export type AuctionMultipartyRootTagErrorCode = (typeof AUCTION_MULTIPARTY_ROOT_TAG_ERROR_CODES)[number]

/**
 * Binary tag payloads carry an explicit `b64u:` prefix.
 *
 * The schedule packet fixes this convention for `payout_schedule`, and the read
 * side (`parseMultipartyRoot`) rejects a bare base64url value. The manifest reuses
 * the same prefix so every binary payload on this wire is unambiguous — a reader
 * never has to guess whether a tag holds text or bytes.
 */
export const AUCTION_MULTIPARTY_BINARY_TAG_PREFIX = 'b64u:'

export class AuctionMultipartyRootTagError extends Error {
	readonly code: AuctionMultipartyRootTagErrorCode

	constructor(code: AuctionMultipartyRootTagErrorCode) {
		super(code)
		this.name = 'AuctionMultipartyRootTagError'
		this.code = code
	}
}

const fail = (code: AuctionMultipartyRootTagErrorCode): never => {
	throw new AuctionMultipartyRootTagError(code)
}

export interface MultipartyRootTagsInput {
	/** Tags from the single-party builder, unmodified. */
	readonly baseTags: readonly (readonly string[])[]
	readonly schedule: AuctionMultipartyCanonicalSchedule
}

/**
 * Produce multiparty root tags: the settlement policy is switched in place and the
 * schedule plus commitment are appended. Refuses to overwrite an existing schedule
 * tag rather than silently replacing it.
 */
export const buildMultipartyRootTags = (input: MultipartyRootTagsInput): string[][] => {
	const policyIndexes: number[] = []
	input.baseTags.forEach((tag, index) => {
		if (tag[0] === 'settlement_policy') policyIndexes.push(index)
	})
	if (policyIndexes.length === 0) {
		return fail('root_settlement_policy_missing')
	}
	if (policyIndexes.length > 1) {
		return fail('root_settlement_policy_ambiguous')
	}
	if (input.baseTags.some((tag) => tag[0] === 'payout_schedule')) {
		return fail('root_schedule_tag_already_present')
	}

	const tags = input.baseTags.map((tag) => [...tag])
	const policyIndex = policyIndexes[0] as number
	tags[policyIndex] = ['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY]
	tags.push(['payout_schedule', `${AUCTION_MULTIPARTY_BINARY_TAG_PREFIX}${base64urlnopad.encode(input.schedule.canonical_bytes)}`])
	tags.push(['payout_schedule_commitment', input.schedule.schedule_commitment])
	return tags
}

export interface MultipartyRootScheduleTags {
	readonly settlementPolicy: string
	readonly payoutScheduleB64u: string
	readonly payoutScheduleCommitment: string
}

/**
 * Read the multiparty root's schedule tags, fail-closed. Used by the read path so a
 * malformed or partial root is never treated as a valid multiparty auction.
 */
export const readMultipartyRootScheduleTags = (tags: readonly (readonly string[])[]): MultipartyRootScheduleTags => {
	const policy = tags.find((tag) => tag[0] === 'settlement_policy')?.[1]
	const scheduleTags = tags.filter((tag) => tag[0] === 'payout_schedule')
	const commitmentTags = tags.filter((tag) => tag[0] === 'payout_schedule_commitment')
	if (!policy) {
		return fail('root_settlement_policy_missing')
	}
	if (scheduleTags.length !== 1 || commitmentTags.length !== 1) {
		return fail('root_schedule_tags_incomplete')
	}
	const payoutScheduleValue = scheduleTags[0]?.[1]
	const payoutScheduleCommitment = commitmentTags[0]?.[1]
	if (!payoutScheduleValue || !payoutScheduleCommitment) {
		return fail('root_schedule_tags_incomplete')
	}
	// The prefix is required, exactly as the read side requires it: a bare base64url
	// value is not a valid payload on this wire.
	if (!payoutScheduleValue.startsWith(AUCTION_MULTIPARTY_BINARY_TAG_PREFIX)) {
		return fail('root_schedule_tags_incomplete')
	}
	const payoutScheduleB64u = payoutScheduleValue.slice(AUCTION_MULTIPARTY_BINARY_TAG_PREFIX.length)
	if (payoutScheduleB64u.length === 0) {
		return fail('root_schedule_tags_incomplete')
	}
	return Object.freeze({ settlementPolicy: policy, payoutScheduleB64u, payoutScheduleCommitment })
}
