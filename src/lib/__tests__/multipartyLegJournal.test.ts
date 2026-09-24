/**
 * Multiparty leg construction journal.
 *
 * The test that carries the weight is the exactly-once one: a row that has been attempted must not be
 * attempted again, because a swap whose outcome is unknown may already have consumed its inputs. The
 * second is the reconciliation table — proofs resolve a row to `locked` only after they verify against
 * that row's own key, silence resolves nothing, and a proven pre-mint failure is the only thing that
 * settles a row as not-locked.
 *
 * User-scoped localStorage; polyfilled as in `preLockRecoveryRecordBound.test.ts`.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Proof } from '@cashu/cashu-ts'
import { authStore } from '../stores/auth'
import {
	describeMultipartyLegVerdict,
	findMultipartyLegJournalByRefundPubkey,
	journalMatchesRecoveryRecord,
	loadMultipartyLegJournal,
	markMultipartyLegRowAttempted,
	openMultipartyLegJournal,
	persistMultipartyLegJournal,
	reconcileMultipartyLeg,
	removeMultipartyLegJournal,
	settleMultipartyLegRow,
	summarizeMultipartyLeg,
	type MultipartyLegJournalEntry,
} from '../auction/multipartyLegJournal'
import { planMultipartyLegLock, type MultipartyLegLock } from '../auction/multipartyLegLockPlan'
import { buildMultipartyPreLockRecoveryRecord } from '../auction/multipartyRecoveryRecord'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'

// ---------- polyfill ----------

const installLocalStoragePolyfill = (): void => {
	if (typeof globalThis.localStorage !== 'undefined') return
	const store = new Map<string, string>()
	;(globalThis as { localStorage: Storage }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value)
		},
		removeItem: (key: string) => {
			store.delete(key)
		},
		clear: () => store.clear(),
		key: (i: number) => Array.from(store.keys())[i] ?? null,
		get length() {
			return store.size
		},
	}
}
installLocalStoragePolyfill()

const FAKE_USER_PUBKEY = 'f'.repeat(64)
const setAuthUser = () =>
	authStore.setState((s) => ({
		...s,
		user: { pubkey: FAKE_USER_PUBKEY } as unknown as NonNullable<typeof s.user>,
		isAuthenticated: true,
	}))

// ---------- fixtures ----------

const LOCKTIME = 1_790_000_600
const REFUND = `02${'c'.repeat(64)}`
const MINT = 'https://mint.example.com'
const AMOUNTS = [8_800, 200, 1_000]
const AT = 1_790_000_000_000

const childKeysFor = (seeds: string[], path: string) =>
	seeds.map((seed) => {
		const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode(seed)))
		return deriveAuctionChildP2pkPubkeyFromXpub(master.publicExtendedKey as string, path)
	})

const CHILDREN = childKeysFor(['journal-a', 'journal-b', 'journal-c'], 'm/0/51')

const locks = (amounts: number[] = AMOUNTS): readonly MultipartyLegLock[] => {
	const result = planMultipartyLegLock({
		legDeltaSats: amounts.reduce((sum, amount) => sum + amount, 0),
		locktime: LOCKTIME,
		refundPubkey: REFUND,
		mintCandidates: [MINT],
		rows: amounts.map((amountSats, index) => ({
			manifest_index: index,
			child_pubkey_compressed: CHILDREN[index],
			amount_sats: amountSats,
		})),
	})
	if (!result.ok) throw new Error(`fixture plan refused: ${result.code} ${result.detail}`)
	return result.locks
}

const lockedProof = (amount: number, key: string, nonce: string): Proof =>
	({
		amount,
		id: `00${'a'.repeat(14)}`,
		secret: JSON.stringify([
			'P2PK',
			{
				nonce,
				data: key,
				tags: [
					['locktime', String(LOCKTIME)],
					['refund', REFUND],
				],
			},
		]),
		C: 'b'.repeat(64),
	}) as unknown as Proof

/** The proofs a row's swap returns, locked to that row's own key. */
const rowProofs = (index: number): readonly Proof[] => [lockedProof(AMOUNTS[index], CHILDREN[index], `n-${index}`)]

const openJournal = (indexes: number[] = [0, 1, 2]): MultipartyLegJournalEntry => {
	const result = openMultipartyLegJournal({ legId: 'leg-1', refundPubkey: REFUND, createdAt: AT, manifestIndexes: indexes })
	if (!result.ok) throw new Error(`fixture journal refused: ${result.code} ${result.detail}`)
	return result.entry
}

const attempted = (indexes: number[] = [0, 1, 2]): MultipartyLegJournalEntry => {
	let entry = openJournal(indexes)
	for (const index of indexes) {
		const result = markMultipartyLegRowAttempted(entry, { manifestIndex: index, at: AT + 1 })
		if (!result.ok) throw new Error(`fixture attempt refused: ${result.code} ${result.detail}`)
		entry = result.entry
	}
	return entry
}

const settleAll = (
	entry: MultipartyLegJournalEntry,
	outcome: 'locked' | 'failed_pre_mint' | 'uncertain',
	at = AT + 2,
): MultipartyLegJournalEntry => {
	let next = entry
	for (const row of entry.rows) {
		const result = settleMultipartyLegRow(next, { manifestIndex: row.manifestIndex, outcome, at })
		if (!result.ok) throw new Error(`fixture settle refused: ${result.code} ${result.detail}`)
		next = result.entry
	}
	return next
}

beforeEach(() => {
	globalThis.localStorage.clear()
	setAuthUser()
})

describe('multiparty leg journal', () => {
	test('opens with every row planned and nothing attempted', () => {
		const entry = openJournal()

		expect(entry.rows.map((row) => row.manifestIndex)).toEqual([0, 1, 2])
		expect(entry.rows.every((row) => row.state === 'planned')).toBe(true)
		expect(entry.rows.every((row) => row.attemptedAt === undefined)).toBe(true)
		expect(entry.updatedAt).toBe(AT)
	})

	test('refuses a journal with no rows', () => {
		const result = openMultipartyLegJournal({ legId: 'leg-1', refundPubkey: REFUND, createdAt: AT, manifestIndexes: [] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('journal_rows_empty')
	})

	test('refuses row indexes that are not 0..n-1 in order', () => {
		const result = openMultipartyLegJournal({ legId: 'leg-1', refundPubkey: REFUND, createdAt: AT, manifestIndexes: [0, 2] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('journal_rows_indexes_noncontiguous')
	})

	test('refuses a missing leg id, an x-only refund key, or a non-positive time', () => {
		const base = { legId: 'leg-1', refundPubkey: REFUND, createdAt: AT, manifestIndexes: [0] }

		const noId = openMultipartyLegJournal({ ...base, legId: '  ' })
		const xOnly = openMultipartyLegJournal({ ...base, refundPubkey: REFUND.slice(2) })
		const noTime = openMultipartyLegJournal({ ...base, createdAt: 0 })

		expect(noId.ok).toBe(false)
		expect(xOnly.ok).toBe(false)
		expect(noTime.ok).toBe(false)
		if (noId.ok || xOnly.ok || noTime.ok) return
		expect(noId.code).toBe('journal_leg_id_missing')
		expect(xOnly.code).toBe('journal_refund_pubkey_invalid')
		expect(noTime.code).toBe('journal_created_at_invalid')
	})

	test('records the attempt and its time before the swap is sent', () => {
		const result = markMultipartyLegRowAttempted(openJournal(), { manifestIndex: 1, at: AT + 5 })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		const row = result.entry.rows[1]
		expect(row.state).toBe('attempted')
		expect(row.attemptedAt).toBe(AT + 5)
		expect(result.entry.updatedAt).toBe(AT + 5)
	})

	test('refuses to attempt a row twice — a swap whose outcome is unknown is never re-sent', () => {
		const first = markMultipartyLegRowAttempted(openJournal(), { manifestIndex: 0, at: AT + 1 })
		if (!first.ok) throw new Error('fixture attempt refused')

		const second = markMultipartyLegRowAttempted(first.entry, { manifestIndex: 0, at: AT + 2 })

		expect(second.ok).toBe(false)
		if (second.ok) return
		expect(second.code).toBe('journal_row_already_attempted')
	})

	test('refuses to attempt a row that is not part of the leg, or with an invalid time', () => {
		const unknown = markMultipartyLegRowAttempted(openJournal(), { manifestIndex: 7, at: AT + 1 })
		const noTime = markMultipartyLegRowAttempted(openJournal(), { manifestIndex: 0, at: 0 })

		expect(unknown.ok).toBe(false)
		expect(noTime.ok).toBe(false)
		if (unknown.ok || noTime.ok) return
		expect(unknown.code).toBe('journal_row_unknown')
		expect(noTime.code).toBe('journal_attempt_time_invalid')
	})

	test('settles an attempted row as locked, failed pre-mint, or uncertain', () => {
		for (const outcome of ['locked', 'failed_pre_mint', 'uncertain'] as const) {
			const result = settleMultipartyLegRow(attempted(), { manifestIndex: 2, outcome, at: AT + 9 })
			expect(result.ok).toBe(true)
			if (!result.ok) continue
			expect(result.entry.rows[2].state).toBe(outcome)
			expect(result.entry.rows[2].settledAt).toBe(AT + 9)
		}
	})

	test('refuses to settle a row that was never attempted', () => {
		const result = settleMultipartyLegRow(openJournal(), { manifestIndex: 1, outcome: 'locked', at: AT + 9 })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('journal_row_never_attempted')
	})

	test('refuses to settle a row twice', () => {
		const once = settleMultipartyLegRow(attempted(), { manifestIndex: 0, outcome: 'locked', at: AT + 9 })
		if (!once.ok) throw new Error('fixture settle refused')

		const twice = settleMultipartyLegRow(once.entry, { manifestIndex: 0, outcome: 'locked', at: AT + 10 })

		expect(twice.ok).toBe(false)
		if (twice.ok) return
		expect(twice.code).toBe('journal_row_already_settled')
	})

	test('summarizes a fully locked leg as complete', () => {
		const summary = summarizeMultipartyLeg(settleAll(attempted(), 'locked'))

		expect(summary.verdict).toBe('complete')
		expect(summary.lockedRowCount).toBe(3)
		expect(summary.attemptedRowCount).toBe(0)
	})

	test('an unknown row makes the leg uncertain even when other rows are locked', () => {
		let entry = settleMultipartyLegRow(attempted(), { manifestIndex: 0, outcome: 'locked', at: AT + 2 })
		if (!entry.ok) throw new Error('fixture settle refused')

		const summary = summarizeMultipartyLeg(entry.entry)

		// Rows 1 and 2 are still attempted: their locks may exist, so "partial" would be a claim.
		expect(summary.verdict).toBe('uncertain')
		expect(summary.lockedRowCount).toBe(1)
		expect(summary.attemptedRowCount).toBe(2)
		expect(summary.lockedRowIndexes).toEqual([0])
	})

	test('a leg with some rows locked and the rest provably not locked is partial, naming the locked ones', () => {
		let entry = settleMultipartyLegRow(attempted(), { manifestIndex: 0, outcome: 'locked', at: AT + 2 })
		if (!entry.ok) throw new Error('fixture settle refused')
		for (const index of [1, 2]) {
			const settled = settleMultipartyLegRow(entry.entry, { manifestIndex: index, outcome: 'failed_pre_mint', at: AT + 3 })
			if (!settled.ok) throw new Error('fixture settle refused')
			entry = settled
		}

		const summary = summarizeMultipartyLeg(entry.entry)

		expect(summary.verdict).toBe('partial')
		expect(summary.lockedRowIndexes).toEqual([0])
		expect(summary.lockedRowCount).toBe(1)
	})

	test('a leg with nothing attempted is unsent', () => {
		const entry = settleAll(attempted(), 'failed_pre_mint')

		expect(summarizeMultipartyLeg(openJournal()).verdict).toBe('unsent')
		expect(summarizeMultipartyLeg(entry).verdict).toBe('unsent')
	})

	test('every verdict has one sentence, and the uncertain one says it will not be retried', () => {
		const complete = settleAll(attempted(), 'locked')
		const unsent = openJournal()
		const uncertain = attempted()

		expect(describeMultipartyLegVerdict(summarizeMultipartyLeg(complete))).toContain('All 3 payout legs are locked')
		expect(describeMultipartyLegVerdict(summarizeMultipartyLeg(unsent))).toContain('nothing has to be recovered')
		expect(describeMultipartyLegVerdict(summarizeMultipartyLeg(uncertain))).toContain('unknown')
		expect(describeMultipartyLegVerdict(summarizeMultipartyLeg(uncertain))).toContain('will not be retried')
	})

	test('resolves an attempted row to locked when its proofs verify against its own key', () => {
		const result = reconcileMultipartyLeg(attempted(), {
			locks: locks(),
			evidence: [{ manifestIndex: 0, proofs: rowProofs(0) }],
			at: AT + 20,
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.resolved).toEqual([{ manifestIndex: 0, state: 'locked' }])
		expect(result.entry.rows[0].state).toBe('locked')
		// The other two rows are untouched: silence resolves nothing.
		expect(result.entry.rows[1].state).toBe('attempted')
		expect(result.summary.verdict).toBe('uncertain')
	})

	test('resolves an attempted row to failed pre-mint on a proven pre-mint failure', () => {
		const result = reconcileMultipartyLeg(attempted(), {
			locks: locks(),
			evidence: [{ manifestIndex: 2, provenPreMintFailure: true }],
			at: AT + 20,
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.resolved).toEqual([{ manifestIndex: 2, state: 'failed_pre_mint' }])
		expect(result.summary.verdict).toBe('uncertain')
	})

	test('reconciles a crash mid-leg: rows 0 and 1 locked, row 2 silent, and the leg stays uncertain', () => {
		const result = reconcileMultipartyLeg(attempted(), {
			locks: locks(),
			evidence: [
				{ manifestIndex: 0, proofs: rowProofs(0) },
				{ manifestIndex: 1, proofs: rowProofs(1) },
			],
			at: AT + 21,
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.entry.rows.map((row) => row.state)).toEqual(['locked', 'locked', 'attempted'])
		expect(result.summary.verdict).toBe('uncertain')
		expect(result.summary.lockedRowCount).toBe(2)
	})

	test('refuses proofs that do not verify against the row’s own key', () => {
		// Row 1's proofs locked to row 0's key: crossed, and only the compressed comparison sees it.
		const result = reconcileMultipartyLeg(attempted(), {
			locks: locks(),
			evidence: [{ manifestIndex: 1, proofs: [lockedProof(AMOUNTS[1], CHILDREN[0], 'n-crossed')] }],
			at: AT + 20,
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		// Row 0's key is not in scope for this pass (only the rows that came back are), so the mismatch
		// is reported as a foreign key rather than as a crossed one — see the module comment.
		expect(result.code).toBe('journal_evidence_unverified:outcome_row_lock_key_mismatch')
	})

	test('refuses a row amount that does not match the manifest', () => {
		const result = reconcileMultipartyLeg(attempted(), {
			locks: locks(),
			evidence: [{ manifestIndex: 0, proofs: [lockedProof(8_000, CHILDREN[0], 'n-short')] }],
			at: AT + 20,
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('journal_evidence_unverified:outcome_row_sum_mismatch')
	})

	test('refuses evidence for a row that was never attempted', () => {
		const result = reconcileMultipartyLeg(openJournal(), {
			locks: locks(),
			evidence: [{ manifestIndex: 0, proofs: rowProofs(0) }],
			at: AT + 20,
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('journal_evidence_for_unattempted_row')
	})

	test('refuses contradictory evidence, a duplicated row, an unknown row, or a bad time', () => {
		const contradictory = reconcileMultipartyLeg(attempted(), {
			locks: locks(),
			evidence: [{ manifestIndex: 0, proofs: rowProofs(0), provenPreMintFailure: true }],
			at: AT + 20,
		})
		const duplicated = reconcileMultipartyLeg(attempted(), {
			locks: locks(),
			evidence: [
				{ manifestIndex: 0, proofs: rowProofs(0) },
				{ manifestIndex: 0, provenPreMintFailure: true },
			],
			at: AT + 20,
		})
		const unknown = reconcileMultipartyLeg(attempted(), {
			locks: locks(),
			evidence: [{ manifestIndex: 9, provenPreMintFailure: true }],
			at: AT + 20,
		})
		const noTime = reconcileMultipartyLeg(attempted(), { locks: locks(), evidence: [], at: 0 })

		expect(contradictory.ok).toBe(false)
		expect(duplicated.ok).toBe(false)
		expect(unknown.ok).toBe(false)
		expect(noTime.ok).toBe(false)
		if (contradictory.ok || duplicated.ok || unknown.ok || noTime.ok) return
		expect(contradictory.code).toBe('journal_evidence_contradictory')
		expect(duplicated.code).toBe('journal_evidence_duplicated')
		expect(unknown.code).toBe('journal_evidence_row_unknown')
		expect(noTime.code).toBe('journal_reconcile_time_invalid')
	})

	test('matches its recovery record by authority, row count and index order', () => {
		const entry = openJournal()
		const record = buildMultipartyPreLockRecoveryRecord({
			id: 'record-1',
			createdAt: AT,
			auctionEventId: '1'.repeat(64),
			auctionCoordinates: `30408:${'a'.repeat(64)}:lot-1`,
			sellerPubkey: 'a'.repeat(64),
			derivationPath: 'm/0/51',
			refundPubkey: REFUND,
			refundPrivateKey: 'd'.repeat(64),
			mintUrl: MINT,
			legDeltaSats: 10_000,
			cumulativeAmountSats: 25_000,
			locktime: LOCKTIME,
			prevBidEventId: null,
			rows: AMOUNTS.map((amountSats, index) => ({
				manifestIndex: index,
				childPubkeyCompressed: CHILDREN[index],
				childPubkeyXOnly: CHILDREN[index].slice(2),
				amountSats,
			})),
		})
		if (!record.ok) throw new Error(`fixture record refused: ${record.code} ${record.detail}`)

		expect(journalMatchesRecoveryRecord(entry, record.record)).toEqual({ ok: true })

		const otherAuthority = journalMatchesRecoveryRecord(openJournal(), { ...record.record, refundPubkey: `03${'e'.repeat(64)}` })
		const fewerRows = journalMatchesRecoveryRecord(openJournal([0, 1]), record.record)
		const otherIndex = journalMatchesRecoveryRecord(openJournal(), {
			...record.record,
			rows: record.record.rows.map((row) => ({ ...row, manifestIndex: row.manifestIndex + 1 })),
		})

		expect(otherAuthority.ok).toBe(false)
		expect(fewerRows.ok).toBe(false)
		expect(otherIndex.ok).toBe(false)
		if (otherAuthority.ok || fewerRows.ok || otherIndex.ok) return
		expect(otherAuthority.code).toBe('journal_record_refund_mismatch')
		expect(fewerRows.code).toBe('journal_record_row_count_mismatch')
		expect(otherIndex.code).toBe('journal_record_index_mismatch')
	})

	test('persists with confirmed-write semantics and reads back by refund pubkey, case-insensitively', () => {
		persistMultipartyLegJournal(attempted())

		const found = findMultipartyLegJournalByRefundPubkey(REFUND)
		expect(found?.rows.map((row) => row.state)).toEqual(['attempted', 'attempted', 'attempted'])
		expect(findMultipartyLegJournalByRefundPubkey(REFUND.toUpperCase())?.legId).toBe('leg-1')
	})

	test('fails closed at the bound, and still supersedes an existing leg at the bound', () => {
		for (let index = 0; index < 25; index += 1) {
			persistMultipartyLegJournal({
				...openJournal([0]),
				legId: `leg-${index}`,
				refundPubkey: `03${index.toString(16).padStart(2, '0')}${'e'.repeat(62)}`,
			})
		}
		expect(Object.keys(loadMultipartyLegJournal())).toHaveLength(25)

		expect(() =>
			persistMultipartyLegJournal({
				...openJournal([0]),
				legId: 'leg-26',
				refundPubkey: `03${(26).toString(16).padStart(2, '0')}${'e'.repeat(62)}`,
			}),
		).toThrow(/journal is full/)

		// A supersede of an existing leg keeps the count unchanged and must still succeed: this is the
		// path every attempt and settle takes.
		const existingKey = `03${(0).toString(16).padStart(2, '0')}${'e'.repeat(62)}`
		persistMultipartyLegJournal({ ...attempted([0]), legId: 'leg-0', refundPubkey: existingKey })
		expect(findMultipartyLegJournalByRefundPubkey(existingKey)?.rows[0].state).toBe('attempted')
	})

	test('removes an entry, and tolerates removing one that is not there', () => {
		persistMultipartyLegJournal(attempted())
		removeMultipartyLegJournal(REFUND)

		expect(findMultipartyLegJournalByRefundPubkey(REFUND)).toBeUndefined()
		expect(() => removeMultipartyLegJournal(REFUND)).not.toThrow()
	})
})
