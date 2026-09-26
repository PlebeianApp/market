/**
 * Multiparty leg lock plan — what a multiparty bidder must lock, exactly.
 *
 * A single-party leg locks one output to one child key. A multiparty leg locks **one output per
 * manifest row**, all at the same mint, the same locktime, and under the same per-leg refund
 * authority. This module turns the derived child keys into that list of locks, and refuses to
 * produce a plan the wire would reject or the wallet could not settle.
 *
 * ## The form of the key matters, and only one direction is safe
 *
 * The manifest records child keys **x-only** (64 hex); the NUT-11 lock takes a **compressed**
 * key (02/03 + 64 hex). Those are the same key only when the parity byte is the one that came out
 * of the derivation — and **parity cannot be recovered from an x-only value.** Reconstructing
 * `02 || x` and locking to that would, for a key whose y is odd, lock funds to a point nobody
 * holds the private key for: the payee's signature verifies against `03 || x`, not `02 || x`.
 *
 * So the conversion runs one way only: derivation gives the compressed key, and the x-only form
 * is derived *from* it for the manifest. This module therefore requires the compressed key and
 * refuses an x-only one, rather than guessing a parity and stranding a fee.
 *
 * ## Why a separate, pure step
 *
 * The mint call is irreversible, and the existing bid path treats it that way: a pre-lock recovery
 * record is written with confirmed-write semantics *before* any call that can mutate mint state.
 * Planning belongs on the near side of that line, so the all-or-nothing checks below run while
 * nothing has happened yet — and can be tested without a mint.
 *
 * Deliberately not here (next slice): the mint calls, token persistence, amending the recovery
 * record, and the D9 per-leg floor policy computed from the schedule.
 */

import { AUCTION_MIN_BID_LEG_SATS } from './constants'

export interface MultipartyLegLockRow {
	readonly manifest_index: number
	/**
	 * The derived child key, **compressed** (02/03 + 64 hex) — the form the mint locks and the only
	 * form that carries the parity. Its x-only projection is what the manifest carries.
	 */
	readonly child_pubkey_compressed: string
	readonly amount_sats: number
}

export interface MultipartyLegLockPlanInput {
	/** The amount this leg locks — the DELTA for an incremental leg, not the cumulative bid. */
	readonly legDeltaSats: number
	/** The chain's shared locktime (`max_end_at + settlement_grace`), identical on every leg. */
	readonly locktime: number
	/** The leg's refund key: compressed secp256k1 hex, as NUT-11 `refund` expects. */
	readonly refundPubkey: string
	/** Acceptable mints in preference order; the first is used for this leg. */
	readonly mintCandidates: readonly string[]
	readonly rows: readonly MultipartyLegLockRow[]
	/**
	 * The manifest's x-only child keys, in row order. When supplied, the plan asserts that the
	 * derivation reproduces them — the same check a validator runs at release (manifest §6).
	 */
	readonly expectedXOnly?: readonly string[]
}

export interface MultipartyLegLock {
	readonly manifestIndex: number
	/** Passed to the mint as the P2PK lock key. */
	readonly childPubkeyCompressed: string
	/** The manifest's projection of the same key, for comparison and for the bid's rows. */
	readonly childPubkeyXOnly: string
	readonly amountSats: number
	readonly mintUrl: string
}

export type MultipartyLegLockPlanResult =
	| {
			readonly ok: true
			readonly locks: readonly MultipartyLegLock[]
			readonly totalSats: number
			readonly locktime: number
			readonly refundPubkey: string
			readonly mintUrl: string
	  }
	| { readonly ok: false; readonly code: string; readonly detail: string }

const fail = (code: string, detail: string): MultipartyLegLockPlanResult => ({ ok: false, code, detail })

const X_ONLY = /^[0-9a-f]{64}$/
const COMPRESSED = /^0[23][0-9a-f]{64}$/

/** The manifest's projection of a compressed key. One direction only — see the module comment. */
export const xOnlyFromCompressed = (compressed: string): string => {
	if (!COMPRESSED.test(compressed)) {
		throw new Error(
			`expected a compressed secp256k1 pubkey (02/03 + 64 hex); got ${compressed.length} character(s). ` +
				'An x-only key cannot be completed into a lock key: the parity is not recoverable from it.',
		)
	}
	return compressed.slice(2)
}

/**
 * Plan the locks for one multiparty leg.
 *
 * Refusals, all of them states that would otherwise produce a leg the release cannot settle:
 * rows that do not sum to the locked delta (the release's per-row sum check would fail), a
 * reused child key (the manifest forbids it — two rows would share one output), a payout below
 * the leg floor (spending a fee to move less than the floor), a missing mint, an unusable refund
 * key or locktime, and a derivation that does not reproduce the manifest's own child keys.
 *
 * Multi-mint legs are refused by construction: the spec defers multi-mint payout construction
 * (gates E/F), so a leg is single-mint until that is decided.
 */
export const planMultipartyLegLock = (input: MultipartyLegLockPlanInput): MultipartyLegLockPlanResult => {
	if (!Number.isSafeInteger(input.legDeltaSats) || input.legDeltaSats <= 0) {
		return fail('leg_delta_invalid', `the leg delta must be a positive integer number of sats; got ${input.legDeltaSats}`)
	}
	if (!Number.isSafeInteger(input.locktime) || input.locktime <= 0) {
		return fail('leg_locktime_invalid', `the locktime must be a positive integer unix timestamp; got ${input.locktime}`)
	}
	if (!COMPRESSED.test(input.refundPubkey)) {
		return fail(
			'leg_refund_pubkey_invalid',
			'the refund key must be a compressed secp256k1 pubkey (02/03 + 64 hex), as NUT-11 `refund` expects',
		)
	}
	if (input.mintCandidates.length === 0) {
		return fail('leg_mint_missing', 'no mint candidate was supplied, so there is nowhere to lock')
	}
	if (input.rows.length === 0) {
		return fail('leg_rows_empty', 'the manifest has no rows, so there is nothing to lock')
	}
	if (input.expectedXOnly && input.expectedXOnly.length !== input.rows.length) {
		return fail(
			'leg_manifest_row_count_mismatch',
			`the manifest carries ${input.expectedXOnly.length} child key(s) but the plan has ${input.rows.length} row(s)`,
		)
	}

	const indexes = input.rows.map((row) => row.manifest_index)
	if (indexes.some((index, position) => index !== position)) {
		return fail('leg_rows_indexes_noncontiguous', `manifest indexes must be 0..n-1 in order; got [${indexes.join(', ')}]`)
	}

	const seen = new Set<string>()
	for (const row of input.rows) {
		if (!COMPRESSED.test(row.child_pubkey_compressed)) {
			return fail(
				'leg_child_pubkey_invalid',
				`row ${row.manifest_index} does not carry a compressed child key; an x-only value cannot be completed into a lock key`,
			)
		}
		const xOnly = row.child_pubkey_compressed.slice(2)
		if (seen.has(xOnly)) {
			return fail(
				'leg_child_pubkey_reused',
				`row ${row.manifest_index} reuses child key ${xOnly.slice(0, 12)}…; two rows must not share a lock key`,
			)
		}
		seen.add(xOnly)

		if (!Number.isSafeInteger(row.amount_sats) || row.amount_sats <= 0) {
			return fail('leg_row_amount_invalid', `row ${row.manifest_index} must carry a positive integer amount; got ${row.amount_sats}`)
		}
		// The floor is a client policy (D9), and this is the client: a row below it cannot be
		// redeemed economically, so locking it would spend a fee to move less than the floor.
		if (row.amount_sats < AUCTION_MIN_BID_LEG_SATS) {
			return fail(
				'leg_row_below_floor',
				`row ${row.manifest_index} locks ${row.amount_sats} sats, below the ${AUCTION_MIN_BID_LEG_SATS}-sat leg floor`,
			)
		}
	}

	if (input.expectedXOnly) {
		for (const [position, row] of input.rows.entries()) {
			const derived = row.child_pubkey_compressed.slice(2)
			if (derived !== input.expectedXOnly[position]) {
				// The same check a validator runs at release: derivation must reproduce the manifest.
				return fail(
					'leg_derivation_mismatch',
					`row ${row.manifest_index} derives ${derived} but the manifest records ${input.expectedXOnly[position]}`,
				)
			}
		}
	}

	const totalSats = input.rows.reduce((sum, row) => sum + row.amount_sats, 0)
	if (totalSats !== input.legDeltaSats) {
		// The release check is "amount_sats per row sums to the released leg total", so a plan that
		// does not sum to the delta produces a release that fails verification.
		return fail(
			'leg_rows_sum_mismatch',
			`the rows sum to ${totalSats} sats but this leg locks ${input.legDeltaSats}; the release would fail its per-row sum check`,
		)
	}

	const mintUrl = input.mintCandidates[0]
	return {
		ok: true,
		locks: input.rows.map((row) => ({
			manifestIndex: row.manifest_index,
			childPubkeyCompressed: row.child_pubkey_compressed,
			childPubkeyXOnly: row.child_pubkey_compressed.slice(2),
			amountSats: row.amount_sats,
			mintUrl,
		})),
		totalSats,
		locktime: input.locktime,
		refundPubkey: input.refundPubkey,
		mintUrl,
	}
}
