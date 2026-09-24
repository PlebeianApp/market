/**
 * Multiparty leg lock outcome — what the mint actually returned, checked row by row.
 *
 * Every row's swap returns its own proof set, and the one thing that must be true of each is the
 * thing the lock plan could only *request*: the proofs are locked to **that row's own key**. A mint
 * (or a wallet bug) that returns a row locked to the wrong key produces a leg that cannot settle —
 * and in the worst case a key nobody holds the private key for, because the x-only projection of
 * `02||x` and `03||x` is identical and only the compressed form carries the parity.
 *
 * This is the same verification a validator runs at release (`docs/protocol/auction-multiparty-manifest-v1.md`
 * §6 rules 1–3), applied on the **near side** of the irreversible call, while the proofs are still
 * in the bidder's hands: the x-only child key of each row is re-projected from the compressed key
 * in the proof's own secret, the row sum is checked against the manifest's amount, and the leg total
 * is checked against the manifest's total. Rule 1 (derivation reproduces the manifest) is enforced
 * where the derivation happens — `planMultipartyLegLock`'s `expectedXOnly` — and is not repeated
 * here, because a returned proof carries no derivation path.
 *
 * Pure: the secrets are parsed, never signed, and nothing is sent anywhere.
 */

import type { Proof } from '@cashu/cashu-ts'
import { getAuctionP2pkLockPubkeyFromSecret, toCompressedAuctionP2pkPubkey } from '../auctionP2pk'
import type { MultipartyLegLock } from './multipartyLegLockPlan'

export interface MultipartyLegLockOutcomeRow {
	readonly manifestIndex: number
	/** The `send` set of that row's swap — the locked part, not the change. */
	readonly proofs: readonly Proof[]
}

export interface MultipartyLegLockOutcomeInput {
	readonly locks: readonly MultipartyLegLock[]
	readonly rows: readonly MultipartyLegLockOutcomeRow[]
}

export interface VerifiedMultipartyLegLockRow {
	readonly manifestIndex: number
	/** The key every proof in the row is locked to, as read from the proofs themselves. */
	readonly lockPubkeyCompressed: string
	/** Its manifest projection — what the row's child key is on the wire. */
	readonly lockPubkeyXOnly: string
	readonly amountSats: number
	readonly proofCount: number
}

export type MultipartyLegLockOutcomeResult =
	| {
			readonly ok: true
			readonly rows: readonly VerifiedMultipartyLegLockRow[]
			readonly totalSats: number
	  }
	| { readonly ok: false; readonly code: string; readonly detail: string }

const fail = (code: string, detail: string): MultipartyLegLockOutcomeResult => ({ ok: false, code, detail })

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const frozen = (rows: VerifiedMultipartyLegLockRow[]): readonly VerifiedMultipartyLegLockRow[] =>
	Object.freeze(rows.map((row) => Object.freeze(row))) as readonly VerifiedMultipartyLegLockRow[]

/**
 * Verify one leg's worth of returned proofs against the plan that requested them.
 *
 * Refusals, in the order a failure matters rather than the order they are checked:
 *
 * - a row the plan asked for is missing (`outcome_row_missing`) — a partial lock, the one state the
 *   construction cannot prevent and must therefore always report;
 * - a row is reported twice, or for an index the plan never had (`outcome_row_duplicated`,
 *   `outcome_row_unknown`);
 * - a proof is not a P2PK secret at all (`outcome_proof_not_locked`);
 * - a proof is locked to a **different row's** key (`outcome_row_lock_key_crossed`) — two rows
 *   sharing a lock key is refused at plan time, so this means the mint returned a crossed result;
 * - a proof is locked to a key that is neither this row's nor any row's (`outcome_row_lock_key_mismatch`)
 *   — the parity case lands here, since a proof locked to `02||x` while the row's key is `03||x`
 *   parses perfectly well and projects to the same x-only value;
 * - a row's proofs do not sum to the row's amount (`outcome_row_sum_mismatch`), or the leg's rows do
 *   not sum to the manifest's leg total (`outcome_leg_total_mismatch`) — the release's own check
 *   (§6 rule 3), run before the leg is published.
 */
export const verifyMultipartyLegLockOutcome = (input: MultipartyLegLockOutcomeInput): MultipartyLegLockOutcomeResult => {
	if (input.locks.length === 0) {
		return fail('outcome_no_locks', 'the plan carries no lock rows, so there is nothing to verify')
	}

	const expected = new Map<number, MultipartyLegLock>()
	for (const lock of input.locks) expected.set(lock.manifestIndex, lock)

	// Every key the leg plans to lock to, by compressed form — used to tell a crossed result from a
	// merely wrong one, which are different failures with different owners.
	const plannedKeys = new Set(input.locks.map((lock) => lock.childPubkeyCompressed))

	const seenRows = new Set<number>()
	for (const row of input.rows) {
		if (seenRows.has(row.manifestIndex)) {
			return fail('outcome_row_duplicated', `row ${row.manifestIndex} was reported twice`)
		}
		seenRows.add(row.manifestIndex)
		if (!expected.has(row.manifestIndex)) {
			return fail('outcome_row_unknown', `row ${row.manifestIndex} is not in the plan`)
		}
	}
	for (const lock of input.locks) {
		if (!seenRows.has(lock.manifestIndex)) {
			return fail(
				'outcome_row_missing',
				`row ${lock.manifestIndex} was never returned; the leg is partially locked and must be published as incomplete, not as a leg`,
			)
		}
	}

	const verified: VerifiedMultipartyLegLockRow[] = []
	let totalSats = 0

	for (const lock of input.locks) {
		const row = input.rows.find((candidate) => candidate.manifestIndex === lock.manifestIndex) as MultipartyLegLockOutcomeRow
		if (row.proofs.length === 0) {
			return fail('outcome_row_empty', `row ${lock.manifestIndex} returned no proofs, so it is not locked`)
		}

		let rowTotal = 0
		for (const proof of row.proofs) {
			if (!isPositiveInteger(proof.amount)) {
				return fail('outcome_proof_amount_invalid', `a proof in row ${lock.manifestIndex} carries a non-positive amount (${proof.amount})`)
			}
			let proofKey: string
			try {
				proofKey = toCompressedAuctionP2pkPubkey(getAuctionP2pkLockPubkeyFromSecret(proof.secret))
			} catch (error) {
				return fail(
					'outcome_proof_not_locked',
					`a proof in row ${lock.manifestIndex} is not a valid P2PK lock: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			if (proofKey !== lock.childPubkeyCompressed) {
				const code = plannedKeys.has(proofKey) ? 'outcome_row_lock_key_crossed' : 'outcome_row_lock_key_mismatch'
				return fail(
					code,
					`a proof in row ${lock.manifestIndex} is locked to ${proofKey} but the row locks to ${lock.childPubkeyCompressed}` +
						(code === 'outcome_row_lock_key_crossed' ? ' — that key belongs to another row' : ''),
				)
			}
			rowTotal += proof.amount
		}

		if (rowTotal !== lock.amountSats) {
			return fail(
				'outcome_row_sum_mismatch',
				`row ${lock.manifestIndex} returned ${rowTotal} sats but the manifest records ${lock.amountSats}; the release would fail its per-row sum check`,
			)
		}

		totalSats += rowTotal
		verified.push({
			manifestIndex: lock.manifestIndex,
			lockPubkeyCompressed: lock.childPubkeyCompressed,
			lockPubkeyXOnly: lock.childPubkeyCompressed.slice(2),
			amountSats: rowTotal,
			proofCount: row.proofs.length,
		})
	}

	const plannedTotal = input.locks.reduce((sum, lock) => sum + lock.amountSats, 0)
	if (totalSats !== plannedTotal) {
		return fail('outcome_leg_total_mismatch', `the leg returned ${totalSats} sats but the manifest records ${plannedTotal}`)
	}

	return { ok: true, rows: frozen(verified), totalSats }
}
