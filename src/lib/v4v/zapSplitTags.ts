/**
 * The wire for the zap-payout packet — §4 and §7.2: how the announced split rides on the auction root
 * and how the payout ledger rides on the settlement.
 *
 * ## Why tags, and why the reader is the strict one
 *
 * The commitment is meaningless without the rows it commits to, and the payout claims are meaningless
 * without the rows they answer. Both therefore travel with the events they belong to, and both are
 * **untrusted input** on the way back in — this is the code a validator runs over an event a stranger
 * published.
 *
 * The writer is permissive and the reader is not:
 *
 * - the writer emits one `v4v_row` tag per announced row and one `v4v_payout` tag per settled row, in
 *   the split's canonical order, so two honest sellers produce byte-identical tags for the same split;
 * - the reader **refuses** a row it cannot understand rather than skipping it. A skipped row is a share
 *   that disappears, and a payout ledger that quietly drops a recipient is exactly the failure this
 *   packet exists to prevent. An unknown status is refused for the same reason: guessing that
 *   `probably_fine` means paid is how a validator ends up attesting something it cannot check.
 *
 * The reader also does **not** verify anything beyond structure: whether the commitment matches, whether
 * the receipts verify, whether the arithmetic closes — that is `splitMatchesCommitment` and
 * `verifySettlementPayoutClaims`, and putting those here would duplicate them.
 */

import type { SettlementPayoutClaim, SettlementPayoutClaimRow } from './settlementPayoutEvidence'
import { SPLIT_COMMITMENT_ENCODING, type V4VSplitRow } from './splitAnnouncement'
import { ZAP_PAYOUT_ROW_STATUSES, type ZapPayoutRowStatus } from './payoutLedger'

/** Tag names. Short, namespaced, and stable: they are part of the packet's wire. */
export const V4V_SPLIT_TAG = 'v4v_split'
export const V4V_ROW_TAG = 'v4v_row'
export const V4V_PAYOUT_TAG = 'v4v_payout'
export const V4V_SETTLED_TAG = 'v4v_settled'
export const V4V_SELLER_TAG = 'v4v_seller'

export type V4VSplitTagRefusal =
	| 'split_tag_missing'
	| 'split_version_unsupported'
	| 'split_tag_malformed'
	| 'row_tag_malformed'
	| 'row_status_unknown'
	| 'payout_tag_malformed'

export type V4VSplitTagResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly code: V4VSplitTagRefusal; readonly detail: string }

const isTags = (value: unknown): value is readonly (readonly string[])[] =>
	Array.isArray(value) && value.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))

const intOrNull = (value: string | undefined): number | null => {
	if (typeof value !== 'string' || value.trim() === '') return null
	const parsed = Number(value)
	return Number.isInteger(parsed) ? parsed : null
}

/**
 * The tags an auction root carries for an announced split.
 *
 * The commitment tag carries the encoding version, so a future change to the canonical form can be
 * recognised by a reader instead of silently failing to match.
 */
export const splitTagsForRoot = (input: {
	readonly rows: readonly V4VSplitRow[]
	readonly commitment: string
	readonly encoding?: string
}): string[][] => [
	[V4V_SPLIT_TAG, input.commitment, input.encoding ?? SPLIT_COMMITMENT_ENCODING, String(input.rows.length)],
	...input.rows.map((row) => [V4V_ROW_TAG, row.id, row.destination, String(row.bps), ...(row.name ? [row.name] : [])]),
]

/** Read an announced split back off an event's tags. Structural only; the commitment is checked elsewhere. */
export const readSplitFromTags = (
	tags: unknown,
): V4VSplitTagResult<{
	readonly rows: readonly V4VSplitRow[]
	readonly commitment: string
	readonly encoding: string
	readonly declaredRows: number
}> => {
	if (!isTags(tags)) return { ok: false, code: 'split_tag_missing', detail: 'the event carries no usable tags' }
	const split = tags.find((tag) => tag[0] === V4V_SPLIT_TAG)
	if (!split) return { ok: false, code: 'split_tag_missing', detail: 'the event announces no value-for-value split' }

	const [, commitment, encoding, declared] = split
	if (typeof commitment !== 'string' || !/^[0-9a-f]{64}$/i.test(commitment)) {
		return { ok: false, code: 'split_tag_malformed', detail: `the split tag has no usable commitment: ${String(commitment)}` }
	}
	if (encoding !== SPLIT_COMMITMENT_ENCODING) {
		// A different encoding means the commitment is over different bytes; treating it as the same would
		// be comparing two things that were never meant to match.
		return {
			ok: false,
			code: 'split_version_unsupported',
			detail: `the split is committed under ${String(encoding)}, this reader knows ${SPLIT_COMMITMENT_ENCODING}`,
		}
	}
	const declaredRows = intOrNull(declared)
	if (declaredRows === null || declaredRows < 0) {
		return { ok: false, code: 'split_tag_malformed', detail: `the split tag declares no usable row count: ${String(declared)}` }
	}

	const rows: V4VSplitRow[] = []
	for (const tag of tags.filter((candidate) => candidate[0] === V4V_ROW_TAG)) {
		const [, id, destination, bps, name] = tag
		if (typeof id !== 'string' || !id || typeof destination !== 'string' || !destination) {
			return { ok: false, code: 'row_tag_malformed', detail: `a row tag has no id or destination: ${tag.join('|')}` }
		}
		const parsedBps = intOrNull(bps)
		if (parsedBps === null || parsedBps < 0) {
			return { ok: false, code: 'row_tag_malformed', detail: `row ${id} has no usable share: ${String(bps)}` }
		}
		rows.push({ id, destination, bps: parsedBps, ...(name ? { name } : {}) })
	}

	// The declared count is honoured rather than ignored: a root that says three rows and carries two is a
	// broken announcement, and reading it as a two-row split would commit to something nobody wrote.
	if (rows.length !== declaredRows) {
		return {
			ok: false,
			code: 'split_tag_malformed',
			detail: `the split declares ${declaredRows} rows and carries ${rows.length}`,
		}
	}

	return { ok: true, value: { rows, commitment: commitment.toLowerCase(), encoding, declaredRows } }
}

/** The tags a settlement carries for its payout ledger. */
export const payoutLedgerTagsForSettlement = (input: {
	readonly claim: SettlementPayoutClaim
	readonly sellerSats: number
}): string[][] => [
	[V4V_SETTLED_TAG, String(input.claim.settledSats), input.claim.commitment],
	[V4V_SELLER_TAG, String(input.sellerSats)],
	...input.claim.rows.map((row) => [
		V4V_PAYOUT_TAG,
		row.id,
		row.destination,
		String(row.bps),
		String(row.sats),
		row.status,
		...(row.receiptId ? [row.receiptId] : []),
	]),
]

/**
 * Read a settlement's payout ledger back off its tags, into the shape the validator's check consumes.
 *
 * A row with an unknown status is refused, and the whole read fails rather than returning the rows it
 * did understand: a partial ledger would let a validator attest a settlement with a share missing from
 * its own view of it.
 */
export const readPayoutLedgerFromTags = (
	tags: unknown,
): V4VSplitTagResult<{ readonly claim: SettlementPayoutClaim; readonly sellerSats: number }> => {
	if (!isTags(tags)) return { ok: false, code: 'payout_tag_malformed', detail: 'the event carries no usable tags' }
	const settled = tags.find((tag) => tag[0] === V4V_SETTLED_TAG)
	const seller = tags.find((tag) => tag[0] === V4V_SELLER_TAG)
	if (!settled) return { ok: false, code: 'payout_tag_malformed', detail: 'the settlement declares no settled amount' }

	const settledSats = intOrNull(settled[1])
	const commitment = settled[2]
	if (settledSats === null || settledSats < 0) {
		return { ok: false, code: 'payout_tag_malformed', detail: `the settled amount is unusable: ${String(settled[1])}` }
	}
	if (typeof commitment !== 'string' || !/^[0-9a-f]{64}$/i.test(commitment)) {
		return { ok: false, code: 'payout_tag_malformed', detail: `the settlement cites no usable commitment: ${String(commitment)}` }
	}
	const sellerSats = seller ? intOrNull(seller[1]) : null
	if (seller && (sellerSats === null || sellerSats < 0)) {
		return { ok: false, code: 'payout_tag_malformed', detail: `the seller remainder is unusable: ${String(seller[1])}` }
	}

	const rows: SettlementPayoutClaimRow[] = []
	for (const tag of tags.filter((candidate) => candidate[0] === V4V_PAYOUT_TAG)) {
		const [, id, destination, bps, sats, status, receiptId] = tag
		if (typeof id !== 'string' || !id || typeof destination !== 'string' || !destination) {
			return { ok: false, code: 'payout_tag_malformed', detail: `a payout tag has no id or destination: ${tag.join('|')}` }
		}
		const parsedBps = intOrNull(bps)
		const parsedSats = intOrNull(sats)
		if (parsedBps === null || parsedBps < 0 || parsedSats === null || parsedSats < 0) {
			return {
				ok: false,
				code: 'payout_tag_malformed',
				detail: `row ${id} has an unusable share or amount: ${String(bps)}/${String(sats)}`,
			}
		}
		if (typeof status !== 'string' || !(ZAP_PAYOUT_ROW_STATUSES as readonly string[]).includes(status)) {
			return { ok: false, code: 'row_status_unknown', detail: `row ${id} claims the unknown status ${String(status)}` }
		}
		rows.push({
			id,
			destination,
			bps: parsedBps,
			sats: parsedSats,
			status: status as ZapPayoutRowStatus,
			...(receiptId ? { receiptId } : {}),
		})
	}

	return { ok: true, value: { claim: { rows, commitment: commitment.toLowerCase(), settledSats }, sellerSats: sellerSats ?? 0 } }
}
