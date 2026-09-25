/**
 * Multiparty leg construction journal — the sequence, and the recovery of an ambiguous swap.
 *
 * A multiparty leg is built as **N sequential swaps** (D16), and each one is irreversible. Two
 * different failures have to be survivable, and they need different records:
 *
 * - **the keys** — a row's child key and its projection, the leg's refund authority. That is the
 *   recovery record's job (`multipartyRecoveryRecord.ts`), written with confirmed-write semantics
 *   before the first swap.
 * - **the sequence** — which rows were sent, and what is known about each. That is this module's job,
 *   and without it a crash mid-leg leaves a bidder holding *inputs whose fate is unknown* with no
 *   record of which swap was in flight.
 *
 * ## The one rule that makes recovery possible: an attempt is recorded before the request
 *
 * `planned → attempted` is written with confirmed-write semantics **before** the swap is sent. From
 * that moment the row has been attempted, and it is never sent again: a swap whose outcome is
 * unknown may already have consumed its inputs, so a second request would either double-spend them
 * or lock the same amount twice. A row that was attempted and whose outcome cannot be determined
 * stays `uncertain` until evidence (the proofs the wallet holds, or a failure proved to precede the
 * mint call) resolves it. There is deliberately no transition back to `planned`, with exactly one
 * exception: a row settled as `failed_pre_mint` was proved never to have reached the mint, its inputs
 * are untouched, and `reopenMultipartyLegRow` may return it to `planned` so it can be attempted again.
 *
 * ## What this module does NOT hold
 *
 * No proofs, and no key material beyond the refund pubkey that links it to the record. The single-party
 * pre-lock record made a deliberate choice here — it is not a second spendable-proof authority — and
 * that choice is kept: proofs arrive as *evidence* at reconciliation, are verified against the row's
 * own key by `multipartyLegLockOutcome.ts`, and are never stored.
 *
 * ## Where the row facts come from
 *
 * The journal holds state, not keys: each row's compressed key, projection and amount live in the
 * recovery record, so a leg has exactly one copy of that material.
 * `journalMatchesRecoveryRecord` asserts the two describe the same leg before anything acts on them.
 *
 * Pure, except the four persistence helpers, which mirror the two existing stores' semantics
 * (user-scoped, confirmed write, fail closed at the bound). Nothing here is wired into the bid flow.
 */

import type { Proof } from '@cashu/cashu-ts'
import { loadUserData, saveUserData } from '../wallet/storage'
import type { MultipartyLegLock } from './multipartyLegLockPlan'
import { verifyMultipartyLegLockOutcome } from './multipartyLegLockOutcome'
import type { AuctionMultipartyPreLockRecoveryRecord } from './multipartyRecoveryRecord'

const MULTIPARTY_LEG_JOURNAL_KEY = 'auction_bid_leg_journal_multiparty_v1'

/** Same bound as the two record stores, and for the same reason: never evict a pending leg. */
const MULTIPARTY_LEG_JOURNAL_MAX_ENTRIES = 25

const COMPRESSED = /^0[23][0-9a-f]{64}$/

/**
 * A row's state. `planned` and `attempted` are the only ones with an outgoing transition; the other
 * four are settled for the row as far as the journal is concerned, and only reconciliation may
 * resolve `uncertain` further.
 *
 * `locked_to_foreign_key` exists because a mint that returns a row's proofs locked to a key that is
 * **not** that row's has not given an unknown answer — it has given a definite, bad one. The swap
 * consumed the row's inputs and the send set exists, so the row is neither `locked` (the leg cannot
 * settle from it) nor `uncertain` (nothing is unknown). It is reclaimable through the refund branch
 * once the locktime opens, which is what makes it worth naming separately rather than folding into
 * either neighbour.
 */
export const MULTIPARTY_LEG_ROW_STATES = [
	'planned',
	'attempted',
	'locked',
	'failed_pre_mint',
	'locked_to_foreign_key',
	'uncertain',
] as const

export type MultipartyLegRowState = (typeof MULTIPARTY_LEG_ROW_STATES)[number]

/** What a row's swap settled as, once its outcome is known. Never `planned`, never `attempted`. */
export type MultipartyLegRowOutcome = Extract<MultipartyLegRowState, 'locked' | 'failed_pre_mint' | 'locked_to_foreign_key' | 'uncertain'>

export interface MultipartyLegRowProgress {
	readonly manifestIndex: number
	readonly state: MultipartyLegRowState
	/** Unix ms when this row's swap was sent. Present for every state except `planned`. */
	readonly attemptedAt?: number
	/** Unix ms when the row settled out of `attempted`. */
	readonly settledAt?: number
}

export interface MultipartyLegJournalEntry {
	readonly legId: string
	/** The leg's refund authority — the link to its recovery record, and the store's key. */
	readonly refundPubkey: string
	readonly createdAt: number
	readonly updatedAt: number
	readonly rows: readonly MultipartyLegRowProgress[]
}

export type MultipartyLegJournalResult =
	| { readonly ok: true; readonly entry: MultipartyLegJournalEntry }
	| { readonly ok: false; readonly code: string; readonly detail: string }

const fail = (code: string, detail: string): MultipartyLegJournalResult => ({ ok: false, code, detail })

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const freezeEntry = (entry: MultipartyLegJournalEntry): MultipartyLegJournalEntry =>
	Object.freeze({ ...entry, rows: Object.freeze(entry.rows.map((row) => Object.freeze({ ...row }))) }) as MultipartyLegJournalEntry

const rowAt = (entry: MultipartyLegJournalEntry, manifestIndex: number): MultipartyLegRowProgress | undefined =>
	entry.rows.find((row) => row.manifestIndex === manifestIndex)

/**
 * Open a leg's journal: every row `planned`, nothing attempted yet.
 *
 * Refusals: no rows; indexes that are not `0..n-1` in order (the manifest's own rule, so a journal
 * cannot describe a leg that could never exist); a missing leg id; an uncompressed refund key — the
 * journal is keyed by it, and an x-only key could not be matched back to the record; a non-positive
 * timestamp.
 */
export const openMultipartyLegJournal = (input: {
	readonly legId: string
	readonly refundPubkey: string
	readonly createdAt: number
	readonly manifestIndexes: readonly number[]
}): MultipartyLegJournalResult => {
	if (!input.legId?.trim()) return fail('journal_leg_id_missing', 'the journal needs a leg id')
	if (!COMPRESSED.test(input.refundPubkey)) {
		return fail(
			'journal_refund_pubkey_invalid',
			'the leg refund key must be compressed secp256k1 (02/03 + 64 hex) — it is the journal\u2019s key',
		)
	}
	if (!isPositiveInteger(input.createdAt))
		return fail('journal_created_at_invalid', `createdAt must be a positive unix ms; got ${input.createdAt}`)
	if (input.manifestIndexes.length === 0) return fail('journal_rows_empty', 'a leg has at least one row')
	const indexes = [...input.manifestIndexes]
	if (indexes.some((index, position) => index !== position)) {
		return fail('journal_rows_indexes_noncontiguous', `row indexes must be 0..n-1 in order; got [${indexes.join(', ')}]`)
	}

	return {
		ok: true,
		entry: freezeEntry({
			legId: input.legId,
			refundPubkey: input.refundPubkey,
			createdAt: input.createdAt,
			updatedAt: input.createdAt,
			rows: indexes.map((manifestIndex) => ({ manifestIndex, state: 'planned' as const })),
		}),
	}
}

/**
 * Record that a row's swap is about to be sent, **before** the request leaves.
 *
 * This is the exactly-once guard. It succeeds only from `planned`; a row already `attempted`,
 * `locked`, `failed_pre_mint` or `uncertain` is refused with `journal_row_already_attempted`, because
 * re-sending a swap whose outcome is unknown can consume the same inputs twice. Persist the returned
 * entry before calling the mint: the entry is what makes the attempt durable.
 */
export const markMultipartyLegRowAttempted = (
	entry: MultipartyLegJournalEntry,
	input: { readonly manifestIndex: number; readonly at: number },
): MultipartyLegJournalResult => {
	const row = rowAt(entry, input.manifestIndex)
	if (!row) return fail('journal_row_unknown', `row ${input.manifestIndex} is not part of this leg`)
	if (!isPositiveInteger(input.at))
		return fail('journal_attempt_time_invalid', `the attempt time must be a positive unix ms; got ${input.at}`)
	if (row.state !== 'planned') {
		return fail(
			'journal_row_already_attempted',
			`row ${input.manifestIndex} is ${row.state}; a swap whose outcome is unknown must not be sent again`,
		)
	}

	return {
		ok: true,
		entry: freezeEntry({
			...entry,
			updatedAt: input.at,
			rows: entry.rows.map((candidate) =>
				candidate.manifestIndex === input.manifestIndex ? { ...candidate, state: 'attempted' as const, attemptedAt: input.at } : candidate,
			),
		}),
	}
}

/**
 * Settle a row that was attempted, once its outcome is known.
 *
 * Refusal that matters: settling a row that is still `planned` (`journal_row_never_attempted`) — a
 * row whose swap was never sent cannot have an outcome, and accepting one would record a locked row
 * that has no proofs anywhere.
 */
export const settleMultipartyLegRow = (
	entry: MultipartyLegJournalEntry,
	input: { readonly manifestIndex: number; readonly outcome: MultipartyLegRowOutcome; readonly at: number },
): MultipartyLegJournalResult => {
	const row = rowAt(entry, input.manifestIndex)
	if (!row) return fail('journal_row_unknown', `row ${input.manifestIndex} is not part of this leg`)
	if (!isPositiveInteger(input.at))
		return fail('journal_settle_time_invalid', `the settle time must be a positive unix ms; got ${input.at}`)
	if (row.state === 'planned') {
		return fail('journal_row_never_attempted', `row ${input.manifestIndex} was never attempted, so it has no outcome to record`)
	}
	// A row settled as `uncertain` is *unresolved* rather than done: evidence may resolve it once, to
	// `locked` or `failed_pre_mint`. Any other settled state is final here (`failed_pre_mint` is reopened
	// explicitly instead), and re-marking a row uncertain would be a write that changes nothing.
	const resolvesUncertain = row.state === 'uncertain' && input.outcome !== 'uncertain'
	if (row.state !== 'attempted' && !resolvesUncertain) {
		return fail('journal_row_already_settled', `row ${input.manifestIndex} is already ${row.state}`)
	}

	return {
		ok: true,
		entry: freezeEntry({
			...entry,
			updatedAt: input.at,
			rows: entry.rows.map((candidate) =>
				candidate.manifestIndex === input.manifestIndex ? { ...candidate, state: input.outcome, settledAt: input.at } : candidate,
			),
		}),
	}
}

/**
 * Return a row settled as `failed_pre_mint` to `planned`, so it may be attempted again.
 *
 * This is the single exception to "an attempted row is never sent again", and it earns the exception
 * because `failed_pre_mint` is not a guess: the failure was proved to precede the mint call, so the
 * row's inputs were never consumed and a retry is legitimate — the same reasoning the single-party
 * flow uses when it lets a provably pre-mint failure stay retryable. Nothing else may be reopened:
 * `uncertain` because the outcome is unknown, and `locked` or `locked_to_foreign_key` because the
 * inputs are gone.
 */
export const reopenMultipartyLegRow = (
	entry: MultipartyLegJournalEntry,
	input: { readonly manifestIndex: number; readonly at: number },
): MultipartyLegJournalResult => {
	const row = rowAt(entry, input.manifestIndex)
	if (!row) return fail('journal_row_unknown', `row ${input.manifestIndex} is not part of this leg`)
	if (!isPositiveInteger(input.at))
		return fail('journal_reopen_time_invalid', `the reopen time must be a positive unix ms; got ${input.at}`)
	if (row.state !== 'failed_pre_mint') {
		return fail(
			'journal_row_not_reopenable',
			`row ${input.manifestIndex} is ${row.state}; only a row proved not to have reached the mint may be attempted again`,
		)
	}

	return {
		ok: true,
		entry: freezeEntry({
			...entry,
			updatedAt: input.at,
			rows: entry.rows.map((candidate) =>
				candidate.manifestIndex === input.manifestIndex ? { manifestIndex: candidate.manifestIndex, state: 'planned' as const } : candidate,
			),
		}),
	}
}

export type MultipartyLegVerdict = 'complete' | 'partial' | 'unsent' | 'uncertain'

export interface MultipartyLegSummary {
	readonly verdict: MultipartyLegVerdict
	readonly rowCount: number
	readonly lockedRowCount: number
	readonly attemptedRowCount: number
	/** The rows that are locked — for a partial leg these are the ones that can settle. */
	readonly lockedRowIndexes: readonly number[]
	/**
	 * Rows the mint returned locked to a foreign key: not usable by the leg, and reclaimable through
	 * the refund branch once the locktime opens. Kept separate from the locked rows because the two
	 * sets lead to different actions.
	 */
	readonly foreignKeyRowIndexes: readonly number[]
}

/**
 * The leg's verdict from its rows alone.
 *
 * `uncertain` dominates: if any row's outcome is unknown the leg's true state is unknown, and saying
 * "partial" would assert that the uncertain row is not locked. `complete` and `unsent` are exact —
 * every row locked, or no row sent at all. Everything else is `partial`, which deliberately includes
 * the case of a leg whose rows were all sent and none of which locked: "partial" with a locked count
 * of zero is the honest description of a leg that consumed inputs and holds nothing usable, and the
 * counts carry that, so the verdict does not need a fifth name.
 */
export const summarizeMultipartyLeg = (entry: MultipartyLegJournalEntry): MultipartyLegSummary => {
	const lockedRowIndexes = entry.rows.filter((row) => row.state === 'locked').map((row) => row.manifestIndex)
	const foreignKeyRowIndexes = entry.rows.filter((row) => row.state === 'locked_to_foreign_key').map((row) => row.manifestIndex)
	const attemptedRowCount = entry.rows.filter((row) => row.state === 'attempted' || row.state === 'uncertain').length
	const everyRowPlanned = entry.rows.every((row) => row.state === 'planned')

	const verdict: MultipartyLegVerdict =
		attemptedRowCount > 0
			? 'uncertain'
			: lockedRowIndexes.length === entry.rows.length
				? 'complete'
				: everyRowPlanned
					? 'unsent'
					: 'partial'

	return Object.freeze({
		verdict,
		rowCount: entry.rows.length,
		lockedRowCount: lockedRowIndexes.length,
		attemptedRowCount,
		lockedRowIndexes: Object.freeze(lockedRowIndexes) as readonly number[],
		foreignKeyRowIndexes: Object.freeze(foreignKeyRowIndexes) as readonly number[],
	})
}

/**
 * One shared sentence per verdict (D14), with the counts substituted so the same function answers for
 * a leg of one row and a leg of seventeen. This is the new layer's own wording for the states it owns;
 * the single-party flow's sentence for an uncertain lock is untouched and remains its own — see the
 * stage report for the question of unifying them.
 */
export const describeMultipartyLegVerdict = (summary: MultipartyLegSummary): string => {
	const legs = summary.rowCount === 1 ? 'payout leg' : 'payout legs'
	switch (summary.verdict) {
		case 'complete':
			return `All ${summary.rowCount} ${legs} are locked.`
		case 'partial': {
			const reclaim =
				summary.foreignKeyRowIndexes.length > 0
					? ' The rows locked to a foreign key stay reclaimable through the refund branch once the locktime opens.'
					: ''
			return `Only ${summary.lockedRowCount} of ${summary.rowCount} ${legs} are locked.${reclaim}`
		}
		case 'unsent':
			return 'No swap was sent yet, so nothing was locked and nothing has to be recovered.'
		case 'uncertain':
			return `The outcome of ${summary.attemptedRowCount} ${summary.attemptedRowCount === 1 ? 'payout leg' : 'payout legs'} is unknown and will not be retried; ${
				summary.lockedRowCount
			} of ${summary.rowCount} are known locked.`
	}
}

export interface MultipartyLegRowEvidence {
	readonly manifestIndex: number
	/** The row's `send` set, as the wallet holds it — verified against the row's own key. */
	readonly proofs?: readonly Proof[]
	/** A failure proved to precede any mint mutation, so the row provably never locked. */
	readonly provenPreMintFailure?: boolean
}

export type MultipartyLegReconciliationResult =
	| {
			readonly ok: true
			readonly entry: MultipartyLegJournalEntry
			readonly summary: MultipartyLegSummary
			/** Rows whose state changed in this pass, with the state they settled as. */
			readonly resolved: readonly { readonly manifestIndex: number; readonly state: MultipartyLegRowOutcome }[]
	  }
	| { readonly ok: false; readonly code: string; readonly detail: string }

/**
 * Reconcile a journal against what the wallet can observe, and settle every row whose outcome is still
 * unresolved — an `attempted` row, or one already settled as `uncertain` — from evidence.
 *
 * The resolution table, and nothing beyond it:
 *
 * - **proofs** → the rows are handed to `verifyMultipartyLegLockOutcome`, which checks them against
 *   the plan's locks (row key, row sum, leg total). They pass and the row becomes `locked`; they fail
 *   and the whole reconciliation is refused with that module's code, because a leg whose proofs do not
 *   verify is a state nobody should paper over — not a row that can be quietly settled. The locks in
 *   scope are exactly the rows that came back, so a proof locked to some other row's key is reported
 *   as a foreign key (`outcome_row_lock_key_mismatch`) rather than as a crossed one: the
 *   crossed-versus-foreign distinction belongs to a verification that has every row in scope, which is
 *   the release's, not a mid-construction pass.
 * - **a proven pre-mint failure** → `failed_pre_mint`.
 * - **nothing** → the row stays `uncertain`. Silence is not evidence of failure, and it is not
 *   evidence of success either.
 *
 * Refusals: evidence for a row the journal does not have; evidence for a row that is still `planned`
 * (proofs for a swap that was never sent is a contradiction); both proofs and a pre-mint failure for
 * the same row; missing plan locks for the rows that did come back.
 */
export const reconcileMultipartyLeg = (
	entry: MultipartyLegJournalEntry,
	input: { readonly locks: readonly MultipartyLegLock[]; readonly evidence: readonly MultipartyLegRowEvidence[]; readonly at: number },
): MultipartyLegReconciliationResult => {
	if (!isPositiveInteger(input.at)) {
		return { ok: false, code: 'journal_reconcile_time_invalid', detail: `the reconcile time must be a positive unix ms; got ${input.at}` }
	}

	const seen = new Set<number>()
	for (const evidence of input.evidence) {
		if (seen.has(evidence.manifestIndex)) {
			return { ok: false, code: 'journal_evidence_duplicated', detail: `row ${evidence.manifestIndex} was reconciled twice in one pass` }
		}
		seen.add(evidence.manifestIndex)
		const row = rowAt(entry, evidence.manifestIndex)
		if (!row) return { ok: false, code: 'journal_evidence_row_unknown', detail: `row ${evidence.manifestIndex} is not part of this leg` }
		if (evidence.proofs && evidence.provenPreMintFailure) {
			return {
				ok: false,
				code: 'journal_evidence_contradictory',
				detail: `row ${evidence.manifestIndex} carries proofs and a pre-mint failure at once; only one of them can be true`,
			}
		}
		if ((evidence.proofs || evidence.provenPreMintFailure) && row.state === 'planned') {
			return {
				ok: false,
				code: 'journal_evidence_for_unattempted_row',
				detail: `row ${evidence.manifestIndex} was never attempted, so it cannot have proofs or a swap failure`,
			}
		}
	}

	const withProofs = input.evidence.filter((evidence) => evidence.proofs && evidence.proofs.length > 0)
	if (withProofs.length > 0) {
		// Verify exactly the rows that came back, against exactly their own locks: the outcome module
		// then checks per-row keys, per-row sums and the (subset) leg total, and `outcome_row_missing`
		// cannot arise — every lock handed in has a row. So any failure here is a genuine refusal rather
		// than an artifact of partial evidence.
		const returned = new Set(withProofs.map((evidence) => evidence.manifestIndex))
		const verification = verifyMultipartyLegLockOutcome({
			locks: input.locks.filter((lock) => returned.has(lock.manifestIndex)),
			rows: withProofs.map((evidence) => ({ manifestIndex: evidence.manifestIndex, proofs: evidence.proofs as readonly Proof[] })),
		})
		if (!verification.ok) {
			return { ok: false, code: `journal_evidence_unverified:${verification.code}`, detail: verification.detail }
		}
	}

	const resolved: { manifestIndex: number; state: MultipartyLegRowOutcome }[] = []
	let next: MultipartyLegJournalEntry = entry

	for (const row of entry.rows) {
		// Both an `attempted` row and one already settled as `uncertain` are unresolved: the journal's own
		// promise is that a row whose outcome could not be determined stays uncertain *until evidence
		// resolves it*. Settled states are left alone — and `failed_pre_mint` is reopened explicitly, not
		// resolved by evidence.
		if (row.state !== 'attempted' && row.state !== 'uncertain') continue
		const evidence = input.evidence.find((candidate) => candidate.manifestIndex === row.manifestIndex)
		const outcome: MultipartyLegRowOutcome | null =
			evidence?.proofs && evidence.proofs.length > 0 ? 'locked' : evidence?.provenPreMintFailure ? 'failed_pre_mint' : null
		if (!outcome) continue

		const settled = settleMultipartyLegRow(next, { manifestIndex: row.manifestIndex, outcome, at: input.at })
		if (!settled.ok) return settled
		next = settled.entry
		resolved.push({ manifestIndex: row.manifestIndex, state: outcome })
	}

	return {
		ok: true,
		entry: next,
		summary: summarizeMultipartyLeg(next),
		resolved: Object.freeze(resolved) as readonly { manifestIndex: number; state: MultipartyLegRowOutcome }[],
	}
}

/**
 * Whether a journal and a recovery record describe the same leg: same row count, same row indexes.
 * The keys themselves are compared by the record's own check against the manifest
 * (`multipartyRecoveryRecordMatchesManifest`); this is the cheap structural link between the two
 * stores, asserted before anything acts on either.
 */
export const journalMatchesRecoveryRecord = (
	entry: MultipartyLegJournalEntry,
	record: AuctionMultipartyPreLockRecoveryRecord,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string } => {
	if (entry.refundPubkey.trim().toLowerCase() !== record.refundPubkey.trim().toLowerCase()) {
		return { ok: false, code: 'journal_record_refund_mismatch', detail: 'the journal and the record name different refund authorities' }
	}
	if (entry.rows.length !== record.rows.length) {
		return {
			ok: false,
			code: 'journal_record_row_count_mismatch',
			detail: `the journal carries ${entry.rows.length} row(s) and the record ${record.rows.length}`,
		}
	}
	for (const [position, row] of entry.rows.entries()) {
		if (row.manifestIndex !== record.rows[position].manifestIndex) {
			return {
				ok: false,
				code: 'journal_record_index_mismatch',
				detail: `position ${position} is row ${row.manifestIndex} in the journal and row ${record.rows[position].manifestIndex} in the record`,
			}
		}
	}
	return { ok: true }
}

type MultipartyLegJournalMap = Record<string, MultipartyLegJournalEntry>

export const loadMultipartyLegJournal = (): MultipartyLegJournalMap => loadUserData<MultipartyLegJournalMap>(MULTIPARTY_LEG_JOURNAL_KEY, {})

const persistMultipartLegJournalMap = (map: MultipartyLegJournalMap): void => {
	// Fail closed at the bound, never evict: each entry is the only durable record of which swaps a
	// pending leg sent. The throw precedes the write, so a caller that aborts on it has locked nothing.
	if (Object.keys(map).length > MULTIPARTY_LEG_JOURNAL_MAX_ENTRIES) {
		throw new Error(
			`Multiparty leg journal is full (${MULTIPARTY_LEG_JOURNAL_MAX_ENTRIES} entries) — refusing to persist a NEW entry instead of ` +
				'evicting an existing one. Each entry is the only durable record of a pending leg\u2019s swap sequence. Nothing was locked; ' +
				're-submitting once the store has room is safe.',
		)
	}
	saveUserData(MULTIPARTY_LEG_JOURNAL_KEY, map, { strict: true })
}

/**
 * Persist with CONFIRMED-WRITE semantics: the strict save must succeed **and** a read-back must
 * deep-equal what was intended. Any throw or mismatch propagates — the caller must not send the next
 * swap on an attempt record that is not durably present.
 */
export const persistMultipartyLegJournal = (entry: MultipartyLegJournalEntry): void => {
	const map = { ...loadMultipartyLegJournal() }
	const key = entry.refundPubkey.trim().toLowerCase()
	map[key] = entry
	persistMultipartLegJournalMap(map)

	const readBack = loadMultipartyLegJournal()[key]
	if (!readBack || JSON.stringify(readBack) !== JSON.stringify(entry)) {
		throw new Error(
			`Failed to confirm the multiparty leg journal write for refund pubkey ${entry.refundPubkey} ` +
				'(read-back mismatch — the attempt record is not durably present, so no swap may be sent).',
		)
	}
}

export const findMultipartyLegJournalByRefundPubkey = (refundPubkey: string): MultipartyLegJournalEntry | undefined => {
	const needle = refundPubkey.trim().toLowerCase()
	if (!needle) return undefined
	return loadMultipartyLegJournal()[needle]
}

/** Best-effort removal, as in the two record stores: a stale entry is harmless and still valid. */
export const removeMultipartyLegJournal = (refundPubkey: string): void => {
	const map = { ...loadMultipartyLegJournal() }
	const key = refundPubkey.trim().toLowerCase()
	if (!(key in map)) return
	delete map[key]
	saveUserData(MULTIPARTY_LEG_JOURNAL_KEY, map)
}
