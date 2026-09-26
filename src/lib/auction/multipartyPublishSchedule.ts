/**
 * Seller-side resolution of the multiparty payout schedule at publish time.
 *
 * This is the bridge between the seller's form input and the canonical wire the
 * read side already accepts: the recipient lines are parsed, compiled through the
 * frozen schedule codec, and checked against the auction's own auditor list before
 * anything is signed. The root tags themselves come from `multipartyRootTags.ts`,
 * which is an additive projection over the single-party builder.
 *
 * Three consistency rules are enforced here rather than left to the reader, because
 * each of them produces an auction that looks fine and settles wrong:
 *
 * - the seller may not appear as a recipient (their remainder is implicit, so an
 *   explicit entry would double-count them);
 * - every validator-role recipient must also be listed in the root's `auditors`,
 *   otherwise clients have no verdict to consult for a recipient the schedule pays;
 * - a V4V recipient must not carry a validator offer id (there is no offer to make).
 *
 * A single-party auction is untouched: no recipients means no schedule, and the
 * publish path keeps emitting exactly what it emitted before.
 */

import {
	AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES,
	AuctionMultipartyScheduleError,
	type AuctionMultipartyCanonicalSchedule,
	type AuctionMultipartySourceScheduleEntry,
	compileSourceSchedule,
} from './multipartySchedule'

const HEX64 = /^[0-9a-f]{64}$/
const UINT = /^(0|[1-9][0-9]*)$/

export type AuctionMultipartyPublishRole = 'validator' | 'v4v'

export interface AuctionMultipartyRecipientLine {
	readonly role: AuctionMultipartyPublishRole
	readonly recipient_pubkey: string
	readonly allocation_bps: number
	readonly payout_capability_event_id: string
	readonly validator_offer_event_id?: string
}

export class AuctionMultipartyPublishScheduleError extends Error {
	readonly code: string

	constructor(code: string) {
		super(code)
		this.name = 'AuctionMultipartyPublishScheduleError'
		this.code = code
	}
}

const fail = (code: string): never => {
	throw new AuctionMultipartyPublishScheduleError(code)
}

const assertHex64 = (value: string, code: string): string => (HEX64.test(value) ? value : fail(code))

/**
 * One recipient per line: `role, pubkey, bps, capability_event_id[, offer_event_id]`.
 *
 * Commas or whitespace both separate fields, because the field is a textarea and
 * sellers paste from different places. Blank lines and `#` comments are ignored;
 * an input with nothing in it yields no recipients rather than an error, so the
 * single-party path is unaffected.
 */
export const parseMultipartyRecipientLines = (raw: string): AuctionMultipartyRecipientLine[] => {
	const lines = raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'))

	if (lines.length === 0) {
		return []
	}

	if (lines.length > AUCTION_MULTIPARTY_SCHEDULE_MAX_ENTRIES) {
		return fail('payout_recipient_count_exceeds_limit')
	}

	return lines.map((line, index) => {
		const fields = line.split(/[\s,]+/).filter(Boolean)
		const lineNumber = index + 1

		if (fields.length < 4 || fields.length > 5) {
			return fail(`payout_recipient_line_invalid:${lineNumber}`)
		}

		const [role, recipientPubkey, allocationBps, capabilityEventId, offerEventId] = fields

		if (role !== 'validator' && role !== 'v4v') {
			return fail(`payout_recipient_role_invalid:${lineNumber}`)
		}

		if (!UINT.test(allocationBps as string) || Number(allocationBps) === 0 || Number(allocationBps) > 10_000) {
			return fail(`payout_recipient_allocation_invalid:${lineNumber}`)
		}

		if (role === 'v4v' && offerEventId !== undefined) {
			return fail(`payout_recipient_offer_not_allowed_for_v4v:${lineNumber}`)
		}

		return {
			role,
			recipient_pubkey: assertHex64(recipientPubkey as string, `payout_recipient_pubkey_noncanonical:${lineNumber}`),
			allocation_bps: Number(allocationBps),
			payout_capability_event_id: assertHex64(capabilityEventId as string, `payout_recipient_capability_noncanonical:${lineNumber}`),
			...(offerEventId === undefined
				? {}
				: {
						validator_offer_event_id: assertHex64(offerEventId, `payout_recipient_offer_noncanonical:${lineNumber}`),
					}),
		}
	})
}

export interface MultipartyPayoutResolutionInput {
	readonly recipients: readonly AuctionMultipartyRecipientLine[]
	/** The auditor pubkeys the root will list, resolved by the publish path. */
	readonly auditors: readonly string[]
	/** The seller's own pubkey; the seller is the implicit remainder holder. */
	readonly sellerPubkey: string
}

export interface MultipartyPayoutResolution {
	readonly schedule: AuctionMultipartyCanonicalSchedule
	/** Recipients with their canonical schedule index, for display and testing. */
	readonly entries: readonly { readonly schedule_index: number; readonly role: AuctionMultipartyPublishRole }[]
}

/**
 * Compile the schedule for a multiparty auction, or return `null` when the seller
 * configured no recipients (the single-party case).
 */
export const resolveMultipartyPayoutSchedule = (input: MultipartyPayoutResolutionInput): MultipartyPayoutResolution | null => {
	if (input.recipients.length === 0) {
		return null
	}

	for (const recipient of input.recipients) {
		if (recipient.recipient_pubkey === input.sellerPubkey) {
			return fail('payout_recipient_seller_included')
		}
		if (recipient.role === 'validator' && !input.auditors.includes(recipient.recipient_pubkey)) {
			return fail('payout_recipient_validator_not_listed_as_auditor')
		}
		if (recipient.role === 'validator' && recipient.validator_offer_event_id === undefined) {
			return fail('payout_recipient_validator_offer_missing')
		}
	}

	// The codec owns every remaining rule (canonical order, duplicates, allocations,
	// entry limits) — this module does not restate them.
	const schedule = compileSourceSchedule(input.recipients as readonly AuctionMultipartySourceScheduleEntry[])

	return Object.freeze({
		schedule,
		entries: Object.freeze(schedule.entries.map((entry) => Object.freeze({ schedule_index: entry.schedule_index, role: entry.role }))),
	})
}

export { AuctionMultipartyScheduleError }
