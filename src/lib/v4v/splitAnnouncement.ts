/**
 * The seller's announced V4V split, and the commitment that makes it checkable afterwards — §4 of the
 * zap-payout packet.
 *
 * ## Why there is a commitment at all
 *
 * The escrow model enforced the split by locking each share to the recipient's key. With zap payouts
 * the seller holds the money, so the split cannot be enforced — it can only be **made checkable**. The
 * commitment is that: a hash over a canonical encoding of the announced rows, published with the
 * auction, so anyone can take the settlement's payout ledger and verify that what was paid is what was
 * announced. Without it, "the seller advertised 5% to charity" is unfalsifiable.
 *
 * ## Why the encoding is written down here rather than being "just JSON.stringify"
 *
 * A commitment is only worth as much as its encoding's determinism: key order, whitespace, row order
 * and number formatting all change the hash without changing the meaning. The canonical form is
 * therefore defined explicitly — **rows sorted by their normalized destination**, one line per row,
 * tab-separated `destination`, `bps`, `name` — and it is versioned, because changing the encoding later
 * would silently invalidate every existing commitment.
 *
 * A commitment proves nothing on its own, and this module does not pretend otherwise: it makes the
 * announcement *fixed*, not *enforced*. Detection still requires someone to compare.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { ALLOCATION_TOTAL_BPS } from './allocations'
import { findDuplicateZapDestinations, normalizeZapDestination, parseZapDestination, type ZapDestinationRefusal } from './zapDestination'

/** The commitment encoding's version. A change to the encoding is a new version, never a quiet edit. */
export const SPLIT_COMMITMENT_ENCODING = 'v4v-split-v1'

/** The most rows an announcement may carry. A split is a short list, not a payroll. */
export const SPLIT_MAX_ROWS = 32

export interface V4VSplitRow {
	/** Stable within one announcement; used by the payout ledger to refer to a row. */
	readonly id: string
	/** The Lightning destination, as announced (normalised before commitment). */
	readonly destination: string
	/** The row's share of the seller's net, in basis points. `0` is legal: announced, pays nothing. */
	readonly bps: number
	/** Optional display label. Not committed to — labels are presentation, not money. */
	readonly name?: string
}

export interface V4VSplitAnnouncement {
	readonly rows: readonly V4VSplitRow[]
	/** The canonical encoding's sha256, hex. */
	readonly commitment: string
	/** The encoding this commitment was made under. */
	readonly encoding: string
	/** Sum of the rows' bps. */
	readonly totalBps: number
	/** What remains for the seller. */
	readonly sellerBps: number
}

export type SplitAnnouncementRefusal =
	| ZapDestinationRefusal
	| 'destination_duplicate'
	| 'split_over_allocated'
	| 'row_count_exceeded'
	| 'bps_not_a_positive_integer'
	| 'row_id_missing'

export type SplitAnnouncementResult =
	| { readonly ok: true; readonly announcement: V4VSplitAnnouncement }
	| { readonly ok: false; readonly code: SplitAnnouncementRefusal; readonly detail: string; readonly rowId?: string }

/**
 * The canonical encoding of a split: the bytes the commitment hashes.
 *
 * Rows are sorted by normalized destination (never the display text, never the input order), and each
 * row contributes exactly one line of `destination<TAB>bps`. Names are excluded deliberately: a label
 * is presentation, and including it would mean a seller could invalidate their own commitment by fixing
 * a typo.
 */
export const canonicalSplitRows = (rows: readonly V4VSplitRow[]): string[] =>
	rows
		.map((row) => {
			const destination = normalizeZapDestination(row.destination) ?? row.destination.trim().toLowerCase()
			return { destination, bps: row.bps }
		})
		.sort((a, b) => (a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0))
		.map((row) => `${row.destination}\t${row.bps}`)

/** The committed bytes, including the encoding version line. */
export const canonicalSplitBytes = (rows: readonly V4VSplitRow[]): string =>
	[SPLIT_COMMITMENT_ENCODING, ...canonicalSplitRows(rows)].join('\n')

/** `sha256` of the canonical encoding, as hex. Deterministic in the rows' *meaning*, not their order. */
export const splitCommitment = (rows: readonly V4VSplitRow[]): string =>
	Array.from(sha256(new TextEncoder().encode(canonicalSplitBytes(rows))))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

/**
 * Validate and commit to a split.
 *
 * Every refusal is fail-closed and named, and the row it concerns is identified when there is one, so
 * the seller is told *which* row to fix rather than that "the split is invalid". A malformed row is
 * never dropped silently: a silently shortened split would be committed to as if the seller had meant
 * it, which is exactly the failure this function exists to prevent.
 */
export const announceV4VSplit = (rows: readonly V4VSplitRow[]): SplitAnnouncementResult => {
	if (rows.length > SPLIT_MAX_ROWS) {
		return { ok: false, code: 'row_count_exceeded', detail: `a split carries at most ${SPLIT_MAX_ROWS} rows, this one has ${rows.length}` }
	}

	const normalized: string[] = []
	for (const row of rows) {
		if (typeof row.id !== 'string' || !row.id.trim()) {
			return { ok: false, code: 'row_id_missing', detail: 'every row needs an id the payout ledger can refer to' }
		}
		if (typeof row.bps !== 'number' || !Number.isInteger(row.bps) || row.bps < 0) {
			return { ok: false, code: 'bps_not_a_positive_integer', detail: `row ${row.id} has a share of ${String(row.bps)}`, rowId: row.id }
		}
		const parsed = parseZapDestination(row.destination)
		if (!parsed.ok) {
			return { ok: false, code: parsed.code, detail: `row ${row.id}: ${parsed.detail}`, rowId: row.id }
		}
		normalized.push(parsed.destination.normalized)
	}

	const duplicates = findDuplicateZapDestinations(rows.map((row) => row.destination))
	if (duplicates.length > 0) {
		return {
			ok: false,
			code: 'destination_duplicate',
			detail: `the same destination is announced more than once: ${duplicates.join(', ')}`,
		}
	}

	const totalBps = rows.reduce((total, row) => total + row.bps, 0)
	if (totalBps > ALLOCATION_TOTAL_BPS) {
		return {
			ok: false,
			code: 'split_over_allocated',
			detail: `the rows ask for ${totalBps} of ${ALLOCATION_TOTAL_BPS} basis points`,
		}
	}

	return {
		ok: true,
		announcement: {
			rows: rows.map((row) => ({ ...row })),
			commitment: splitCommitment(rows),
			encoding: SPLIT_COMMITMENT_ENCODING,
			totalBps,
			sellerBps: ALLOCATION_TOTAL_BPS - totalBps,
		},
	}
}

/**
 * Whether an announcement is the one a commitment was made to.
 *
 * This is the check that turns the commitment into evidence: it is what a client or a validator runs
 * against the rows it can see, and it is deliberately the *same* comparison for both.
 */
export const splitMatchesCommitment = (rows: readonly V4VSplitRow[], commitment: string): boolean => {
	if (typeof commitment !== 'string' || !/^[0-9a-f]{64}$/.test(commitment.toLowerCase())) return false
	return splitCommitment(rows) === commitment.toLowerCase()
}
