/**
 * Multiparty leg construction — driving the leg's swaps, safely, over an injected mint seam.
 *
 * This is the orchestrator the pure pieces were built for: `planMultipartyLegSwaps` decides what to
 * send, `multipartyLegJournal` records what was sent, `multipartyLegLockOutcome` checks what came
 * back. What was missing is the loop between them, and the loop is where a leg is lost if it is
 * written carelessly.
 *
 * ## The two orderings that are the whole design
 *
 * 1. **The journal entry is durable before the first swap.** A leg with no attempt record is a leg
 *    whose next crash is unrecoverable, so if the record cannot be confirmed on disk this function
 *    refuses having sent nothing.
 * 2. **A row is marked `attempted` — and that mark confirmed on disk — before its swap is sent.**
 *    From then on the row is never re-sent, by this function or any later pass over the same
 *    journal. The cost is that a crash between the mark and the response leaves a row `uncertain`
 *    forever until evidence resolves it; the alternative cost is spending a proof twice.
 *
 * Both orderings are asserted from the *seam itself* in the tests: the fake mint reads the journal
 * back off disk on every call and refuses to answer if the row it is being asked about is not
 * already recorded as attempted.
 *
 * ## What stops the leg
 *
 * The loop stops at the first row that does not lock, and it never continues past it. A row whose
 * outcome is unknown may already have consumed its inputs, so funding later rows from the same pool
 * would be building on a guess; and "one pass over the leg" is what makes the returned summary a
 * statement about one attempt rather than a mixture of attempts. The caller may reopen a row that
 * was proved pre-mint (`reopenMultipartyLegRow`) and run the leg again — that is the retry path, and
 * it is deliberate rather than implicit.
 *
 * ## What it returns, and what it deliberately does not do
 *
 * Per row: the locked `send` set and the `keep` (change) the mint returned. Those are the caller's to
 * persist — this module touches no wallet store, publishes nothing, and its only I/O is the journal.
 * It is not wired into the bid flow; the caller that would do that is the gated step.
 */

import type { Proof } from '@cashu/cashu-ts'
import type { MultipartyLegLock } from './multipartyLegLockPlan'
import { verifyMultipartyLegLockOutcome } from './multipartyLegLockOutcome'
import { planMultipartyLegSwaps, type MultipartyLegLockPlan, type MultipartyLegSwapRequest } from './multipartyLegSwapPlan'
import {
	findMultipartyLegJournalByRefundPubkey,
	markMultipartyLegRowAttempted,
	openMultipartyLegJournal,
	persistMultipartyLegJournal,
	settleMultipartyLegRow,
	summarizeMultipartyLeg,
	type MultipartyLegJournalEntry,
	type MultipartyLegRowOutcome,
	type MultipartyLegSummary,
} from './multipartyLegJournal'

/** Re-exported so a caller of this module does not need to import the planner as well. */
export type { MultipartyLegLockPlan }

/**
 * Thrown by a seam to declare that the request **provably never left** — the failure happened before
 * anything could reach the mint, so the row's inputs are untouched and the row may be reopened.
 *
 * Anything else a seam throws is treated as mutation-possible, which is the fail-closed default: a
 * generic error cannot prove the request was not sent, so the row is recorded `uncertain`.
 */
export class MultipartyLegSwapNotSentError extends Error {
	readonly code: string

	constructor(code: string, message?: string) {
		super(message ?? code)
		this.name = 'MultipartyLegSwapNotSentError'
		this.code = code
	}
}

/**
 * The one mint interaction. Mirrors `CashuWallet.swap(amount, proofs, { p2pk })`: the caller's
 * adapter resolves the mint's wallet, and this module only ever hands it a decision the plan made.
 */
export interface MultipartyLegMintSeam {
	readonly swap: (request: MultipartyLegSwapRequest) => Promise<{ readonly send: readonly Proof[]; readonly keep: readonly Proof[] }>
}

export interface ConstructMultipartyLegInput {
	readonly plan: MultipartyLegLockPlan
	/** The leg's spendable proofs at the leg's mint. */
	readonly availableProofs: readonly Proof[]
	readonly seam: MultipartyLegMintSeam
	/** Local id for a new journal entry; unused when `journal` is supplied. */
	readonly legId: string
	readonly now: () => number
	/** An existing journal for this leg, to resume instead of opening a fresh one. */
	readonly journal?: MultipartyLegJournalEntry
}

export interface MultipartyLegRowExecution {
	readonly manifestIndex: number
	readonly state: MultipartyLegRowOutcome | 'already_settled'
	/** The row's locked `send` set — present only for a `locked` row. */
	readonly send?: readonly Proof[]
	/** What the mint returned as change for this row, for the caller to persist. */
	readonly keep?: readonly Proof[]
	/** Why the row did not lock, for an unverified, failed or refused row. */
	readonly code?: string
	readonly detail?: string
}

/**
 * What one row's swap settled as — the narrower record the swap step returns, before the loop adds
 * its own outcomes (`already_settled` for a row a resumed pass does not send again).
 */
interface MultipartyLegRowSwapOutcome {
	readonly manifestIndex: number
	readonly state: MultipartyLegRowOutcome
	readonly send?: readonly Proof[]
	readonly keep?: readonly Proof[]
	readonly code?: string
	readonly detail?: string
}

export type ConstructMultipartyLegResult =
	| { readonly ok: false; readonly code: string; readonly detail: string }
	| {
			readonly ok: true
			readonly journal: MultipartyLegJournalEntry
			readonly summary: MultipartyLegSummary
			readonly rows: readonly MultipartyLegRowExecution[]
	  }

const refuse = (code: string, detail: string): ConstructMultipartyLegResult => ({ ok: false, code, detail })

/** A verification failure that means the send set is locked to something that is not the row's key. */
const FOREIGN_KEY_CODES = ['outcome_proof_not_locked', 'outcome_row_lock_key_mismatch', 'outcome_row_lock_key_crossed'] as const

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Construct one multiparty leg: one swap per row, in manifest index order, stopping at the first row
 * that does not lock.
 *
 * Refusals, all of them before anything is sent: a leg whose rows cannot be planned from the supplied
 * proofs (the swap plan's own refusal, passed through), and a journal entry that cannot be confirmed
 * on disk — `leg_journal_not_durable` means no swap was sent and nothing needs recovering.
 */
export const constructMultipartyLeg = async (input: ConstructMultipartyLegInput): Promise<ConstructMultipartyLegResult> => {
	const planned = planMultipartyLegSwaps({ plan: input.plan, availableProofs: input.availableProofs })
	if (!planned.ok) {
		// Nothing was attempted, so there is nothing to recover and no journal entry is opened.
		return refuse(`leg_unplannable:${planned.code}`, planned.detail)
	}

	let journal = input.journal
	if (!journal) {
		const opened = openMultipartyLegJournal({
			legId: input.legId,
			refundPubkey: input.plan.refundPubkey,
			createdAt: input.now(),
			manifestIndexes: input.plan.locks.map((lock) => lock.manifestIndex),
		})
		if (!opened.ok) return refuse(`leg_journal_unopenable:${opened.code}`, opened.detail)
		journal = opened.entry
	}

	// Ordering 1: the journal is on disk before the first swap can be sent.
	try {
		persistMultipartyLegJournal(journal)
	} catch (error) {
		return refuse('leg_journal_not_durable', `the journal entry could not be confirmed on disk (${message(error)}); no swap was sent`)
	}

	const rows: MultipartyLegRowExecution[] = []
	let current = journal

	for (const request of planned.requests) {
		const progress = current.rows.find((row) => row.manifestIndex === request.manifestIndex)
		if (!progress) return refuse('leg_journal_row_missing', `the journal has no row ${request.manifestIndex}`)

		if (progress.state === 'locked') {
			// A resumed pass: this row is done, and nothing about it is sent again.
			rows.push({ manifestIndex: request.manifestIndex, state: 'already_settled' })
			continue
		}
		if (progress.state !== 'planned') {
			// Attempted, uncertain, foreign or pre-mint-failed: the row must not be sent again in this
			// pass. Stop the leg here rather than skipping it, so the result describes one attempt.
			rows.push({ manifestIndex: request.manifestIndex, state: 'already_settled', code: `leg_row_${progress.state}` })
			break
		}

		// Ordering 2: attempted, confirmed on disk, and only then sent.
		const attempted = markMultipartyLegRowAttempted(current, { manifestIndex: request.manifestIndex, at: input.now() })
		if (!attempted.ok) return refuse(`leg_attempt_unrecordable:${attempted.code}`, attempted.detail)
		current = attempted.entry
		try {
			persistMultipartyLegJournal(current)
		} catch (error) {
			return refuse(
				'leg_attempt_not_durable',
				`row ${request.manifestIndex} could not be recorded as attempted (${message(error)}); no swap was sent for it`,
			)
		}

		const row = await swapRow({ seam: input.seam, request })
		const settled = settleMultipartyLegRow(current, { manifestIndex: request.manifestIndex, outcome: row.state, at: input.now() })
		if (!settled.ok) return refuse(`leg_row_unsettleable:${settled.code}`, settled.detail)
		current = settled.entry
		try {
			persistMultipartyLegJournal(current)
		} catch (error) {
			// The swap already happened, so this is not a refusal: the leg's state is simply not durable,
			// and the honest answer is a summary of what is on disk plus this code.
			rows.push({ ...row, code: row.code ?? 'leg_row_settle_not_durable', detail: message(error) })
			break
		}

		rows.push(row)
		if (row.state !== 'locked') break
	}

	return {
		ok: true,
		journal: current,
		summary: summarizeMultipartyLeg(current),
		rows: Object.freeze(rows) as readonly MultipartyLegRowExecution[],
	}
}

/** One row's swap, its verification, and the state its outcome settles as. */
const swapRow = async (input: {
	readonly seam: MultipartyLegMintSeam
	readonly request: MultipartyLegSwapRequest
}): Promise<MultipartyLegRowSwapOutcome> => {
	let returned: { readonly send: readonly Proof[]; readonly keep: readonly Proof[] }
	try {
		returned = await input.seam.swap(input.request)
	} catch (error) {
		if (error instanceof MultipartyLegSwapNotSentError) {
			// Proved never to have left: the row consumed nothing and may be reopened.
			return {
				manifestIndex: input.request.manifestIndex,
				state: 'failed_pre_mint',
				code: `leg_swap_not_sent:${error.code}`,
				detail: error.message,
			}
		}
		// Fail closed: a generic failure cannot prove the request was not sent.
		return { manifestIndex: input.request.manifestIndex, state: 'uncertain', code: 'leg_swap_outcome_unknown', detail: message(error) }
	}

	const verification = verifyMultipartyLegLockOutcome({
		locks: [lockFor(input.request)],
		rows: [{ manifestIndex: input.request.manifestIndex, proofs: returned.send }],
	})
	if (!verification.ok) {
		const state: MultipartyLegRowOutcome = (FOREIGN_KEY_CODES as readonly string[]).includes(verification.code)
			? 'locked_to_foreign_key'
			: 'uncertain'
		return {
			manifestIndex: input.request.manifestIndex,
			state,
			keep: returned.keep,
			code: `leg_row_unverified:${verification.code}`,
			detail: verification.detail,
		}
	}

	return { manifestIndex: input.request.manifestIndex, state: 'locked', send: returned.send, keep: returned.keep }
}

/** The lock a request was planned from — reconstructed so verification reads the same key the plan fixed. */
const lockFor = (request: MultipartyLegSwapRequest): MultipartyLegLock => ({
	manifestIndex: request.manifestIndex,
	childPubkeyCompressed: request.p2pk.pubkey,
	childPubkeyXOnly: request.p2pk.pubkey.slice(2),
	amountSats: request.amountSats,
	mintUrl: request.mintUrl,
})

/**
 * The journal entry for a leg, if one was already written — the read half a resuming caller needs
 * before it decides to run a pass at all.
 */
export const findMultipartyLegJournalForLeg = (refundPubkey: string): MultipartyLegJournalEntry | undefined =>
	findMultipartyLegJournalByRefundPubkey(refundPubkey)
