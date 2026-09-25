/**
 * Multiparty leg construction — the loop between the plan, the journal and the mint.
 *
 * The two tests that carry the weight are the ordering ones: the fake mint reads the journal back off
 * disk on every call and refuses to answer unless the row it is being asked about is ALREADY recorded
 * as attempted. That is the exactly-once guarantee proved from the far side of the call, not asserted
 * about it. The third is the stop rule: after a row whose outcome is unknown, no later row is sent.
 *
 * User-scoped localStorage; polyfilled as in `preLockRecoveryRecordBound.test.ts`.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Proof } from '@cashu/cashu-ts'
import { authStore } from '../stores/auth'
import {
	MultipartyLegSwapNotSentError,
	constructMultipartyLeg,
	findMultipartyLegJournalForLeg,
	type MultipartyLegMintSeam,
} from '../auction/multipartyLegConstruction'
import { findMultipartyLegJournalByRefundPubkey, loadMultipartyLegJournal } from '../auction/multipartyLegJournal'
import { planMultipartyLegLock, type MultipartyLegLock } from '../auction/multipartyLegLockPlan'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'
import type { MultipartyLegSwapRequest } from '../auction/multipartyLegSwapPlan'

// ---------- polyfill ----------

const installLocalStoragePolyfill = (): void => {
	if (typeof globalThis.localStorage !== 'undefined') return
	const store = new Map<string, string>()
	;(globalThis as unknown as { localStorage: Storage }).localStorage = {
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

const setAuthUser = () =>
	authStore.setState((s) => ({
		...s,
		user: { pubkey: 'f'.repeat(64) } as unknown as NonNullable<typeof s.user>,
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

const CHILDREN = childKeysFor(['construct-a', 'construct-b', 'construct-c'], 'm/0/61')

const plan = (amounts: number[] = AMOUNTS): Extract<ReturnType<typeof planMultipartyLegLock>, { ok: true }> => {
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
	return result
}

const inputProof = (amount: number, tag: string): Proof =>
	({ amount, id: `00${'a'.repeat(14)}`, secret: `secret-${tag}`, C: 'b'.repeat(64) }) as unknown as Proof

const pool = (amounts: number[] = AMOUNTS) => amounts.map((amount, index) => inputProof(amount, `${index}`))

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

/** Every call the seam saw, in order. */
interface SeamLog {
	readonly manifestIndex: number
	readonly rowWasRecordedAsAttempted: boolean
	readonly amountSats: number
	readonly pubkey: string
}

interface SeamOptions {
	/** Per row: what the swap should do. */
	readonly behaviour?: Record<number, 'ok' | 'throw' | 'not_sent' | 'foreign_key' | 'short'>
	readonly log?: SeamLog[]
}

/**
 * The fake mint. It answers **only** when the journal on disk already records the row as attempted —
 * the ordering the whole module exists for, checked from the far side of the call.
 */
const seam = (options: SeamOptions = {}): MultipartyLegMintSeam => ({
	swap: async (request: MultipartyLegSwapRequest) => {
		const journal = findMultipartyLegJournalByRefundPubkey(REFUND)
		const row = journal?.rows.find((candidate) => candidate.manifestIndex === request.manifestIndex)
		options.log?.push({
			manifestIndex: request.manifestIndex,
			rowWasRecordedAsAttempted: row?.state === 'attempted',
			amountSats: request.amountSats,
			pubkey: request.p2pk.pubkey,
		})

		const behaviour = options.behaviour?.[request.manifestIndex] ?? 'ok'
		if (behaviour === 'throw') throw new Error('mint said no, and did not say whether it consumed the inputs')
		if (behaviour === 'not_sent')
			throw new MultipartyLegSwapNotSentError('insufficient_inputs', 'the mint refused before touching anything')
		if (behaviour === 'foreign_key') {
			const foreign = request.p2pk.pubkey.startsWith('03') ? `02${request.p2pk.pubkey.slice(2)}` : `03${request.p2pk.pubkey.slice(2)}`
			return { send: [lockedProof(request.amountSats, foreign, 'n-foreign')], keep: [] }
		}
		if (behaviour === 'short') return { send: [lockedProof(request.amountSats - 1, request.p2pk.pubkey, 'n-short')], keep: [] }

		return {
			send: [lockedProof(request.amountSats, request.p2pk.pubkey, `n-${request.manifestIndex}`)],
			keep: [inputProof(1, `keep-${request.manifestIndex}`)],
		}
	},
})

/**
 * Wrap the ambient storage so every write is recorded, whatever shape it has.
 *
 * `Object.create(real)` rather than `{...real}`: a spread copies only OWN properties, and in the full
 * suite the ambient `localStorage` may carry its methods on the prototype (a real `Storage` installed
 * by another test file), which a spread silently drops — the wrapper then has no `getItem`, every read
 * throws, and the leg is refused for a reason that has nothing to do with this test. It passes in
 * isolation and fails only in the suite, which is exactly the class of bug a full run exists to catch.
 */
const withRecordingStorage = (): { readonly written: string[]; readonly restore: () => void } => {
	const real = globalThis.localStorage
	const written: string[] = []
	const recorder = Object.create(real) as Storage
	recorder.setItem = (key: string, value: string) => {
		written.push(key)
		real.setItem(key, value)
	}
	;(globalThis as unknown as { localStorage: Storage }).localStorage = recorder
	return { written, restore: () => ((globalThis as unknown as { localStorage: Storage }).localStorage = real) }
}

/** The same shape, for a storage that refuses every write. */
const withFailingStorage = (): { readonly restore: () => void } => {
	const real = globalThis.localStorage
	const failing = Object.create(real) as Storage
	failing.setItem = () => {
		throw new Error('quota exceeded')
	}
	;(globalThis as unknown as { localStorage: Storage }).localStorage = failing
	return { restore: () => ((globalThis as unknown as { localStorage: Storage }).localStorage = real) }
}

let clock = AT
const now = () => (clock += 1)

const construct = (overrides: Record<string, unknown> = {}) =>
	constructMultipartyLeg({
		plan: plan(),
		availableProofs: pool(),
		seam: seam(),
		legId: 'leg-1',
		now,
		...overrides,
	})

beforeEach(() => {
	globalThis.localStorage.clear()
	setAuthUser()
	clock = AT
})

describe('multiparty leg construction', () => {
	test('lays the journal down before the first swap, then sends one swap per row in index order', async () => {
		const log: SeamLog[] = []
		const result = await construct({ seam: seam({ log }) })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.summary.verdict).toBe('complete')
		expect(log.map((entry) => entry.manifestIndex)).toEqual([0, 1, 2])
		expect(log.map((entry) => entry.amountSats)).toEqual(AMOUNTS)
		expect(log.map((entry) => entry.pubkey)).toEqual(CHILDREN)
	})

	test('every swap is asked for only after its row is recorded as attempted on disk', async () => {
		const log: SeamLog[] = []
		const result = await construct({ seam: seam({ log }) })

		expect(result.ok).toBe(true)
		// The seam itself read the journal back for every call and never once saw a row it was not
		// allowed to be asked about.
		expect(log).toHaveLength(3)
		expect(log.every((entry) => entry.rowWasRecordedAsAttempted)).toBe(true)
	})

	test('returns the locked send sets and the change, and leaves the leg complete on disk', async () => {
		const result = await construct()

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.rows.map((row) => row.state)).toEqual(['locked', 'locked', 'locked'])
		expect(result.rows.map((row) => row.send?.length)).toEqual([1, 1, 1])
		expect(result.rows.every((row) => (row.keep?.length ?? 0) === 1)).toBe(true)
		expect(result.journal.rows.map((row) => row.state)).toEqual(['locked', 'locked', 'locked'])
		expect(findMultipartyLegJournalByRefundPubkey(REFUND)?.rows.every((row) => row.state === 'locked')).toBe(true)
	})

	test('a row whose outcome is unknown stops the leg: no later row is sent', async () => {
		const log: SeamLog[] = []
		const result = await construct({ seam: seam({ behaviour: { 1: 'throw' }, log }) })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(log.map((entry) => entry.manifestIndex)).toEqual([0, 1])
		expect(result.rows.map((row) => row.state)).toEqual(['locked', 'uncertain'])
		expect(result.journal.rows.map((row) => row.state)).toEqual(['locked', 'uncertain', 'planned'])
		// Row 2 must not be sent later either: it is still planned, and a fresh pass over the same leg
		// stops at row 1 rather than skipping it.
		expect(result.summary.verdict).toBe('uncertain')
		expect(result.summary.attemptedRowCount).toBe(1)
	})

	test('a swap the seam proves never left settles the row pre-mint, and no later row is sent in this pass', async () => {
		const log: SeamLog[] = []
		const result = await construct({ seam: seam({ behaviour: { 0: 'not_sent' }, log }) })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(log).toHaveLength(1)
		expect(result.rows[0].state).toBe('failed_pre_mint')
		expect(result.rows[0].code).toBe('leg_swap_not_sent:insufficient_inputs')
		expect(result.summary.verdict).toBe('partial')
	})

	test('a pre-mint row can be reopened and the leg re-run from the existing journal', async () => {
		const first = await construct({ seam: seam({ behaviour: { 0: 'not_sent' } }) })
		expect(first.ok).toBe(true)
		if (!first.ok) return

		const { reopenMultipartyLegRow } = await import('../auction/multipartyLegJournal')
		const reopened = reopenMultipartyLegRow(first.journal, { manifestIndex: 0, at: now() })
		if (!reopened.ok) throw new Error('fixture reopen refused')

		const second = await construct({ journal: reopened.entry })

		expect(second.ok).toBe(true)
		if (!second.ok) return
		expect(second.summary.verdict).toBe('complete')
	})

	test('a resumed pass never re-sends a row that is already locked, and stops at one that is not', async () => {
		const first = await construct({ seam: seam({ behaviour: { 1: 'throw' } }) })
		expect(first.ok).toBe(true)
		if (!first.ok) return

		// Row 0 locked, row 1 uncertain, row 2 planned: a second pass must not send row 0 again, and must
		// stop at row 1 rather than skipping to row 2.
		const log: SeamLog[] = []
		const second = await construct({ journal: first.journal, seam: seam({ log }) })

		expect(second.ok).toBe(true)
		if (!second.ok) return
		expect(log).toHaveLength(0)
		expect(second.rows.map((row) => row.state)).toEqual(['already_settled', 'already_settled'])
		expect(second.rows[1].code).toBe('leg_row_uncertain')
	})

	test('a row locked to a foreign key is settled as that, not as uncertainty, and carries its change', async () => {
		const result = await construct({ seam: seam({ behaviour: { 2: 'foreign_key' } }) })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		const row = result.rows[2]
		expect(row.state).toBe('locked_to_foreign_key')
		expect(row.code).toContain('leg_row_unverified:')
		expect(result.summary.foreignKeyRowIndexes).toEqual([2])
		expect(result.summary.verdict).toBe('partial')
	})

	test('a row that comes back short is uncertainty, not a foreign key', async () => {
		const result = await construct({ seam: seam({ behaviour: { 0: 'short' } }) })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.rows[0].state).toBe('uncertain')
		expect(result.rows[0].code).toBe('leg_row_unverified:outcome_row_sum_mismatch')
	})

	test('refuses before opening a journal when the leg cannot be planned from the proofs', async () => {
		const log: SeamLog[] = []
		const result = await construct({ availableProofs: [inputProof(10, 'tiny')], seam: seam({ log }) })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('leg_unplannable:swaps_row_unfundable')
		expect(log).toHaveLength(0)
		// Nothing was attempted, so there is nothing to recover and no journal was written.
		expect(findMultipartyLegJournalByRefundPubkey(REFUND)).toBeUndefined()
	})

	test('refuses having sent nothing when the journal cannot be confirmed on disk', async () => {
		const log: SeamLog[] = []
		// A storage that refuses every write: the confirmed-write check must fail before any swap.
		const storage = withFailingStorage()
		try {
			const result = await construct({ seam: seam({ log }) })

			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.code).toBe('leg_journal_not_durable')
			expect(log).toHaveLength(0)
		} finally {
			storage.restore()
		}
	})

	test('survives a hostile pool: a proof offered twice is refused before any journal exists', async () => {
		const duplicated = inputProof(8_800, 'dup')
		const result = await construct({ availableProofs: [duplicated, duplicated] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('leg_unplannable:swaps_input_duplicated')
		expect(loadMultipartyLegJournal()).toEqual({})
	})

	test('exposes the journal of a leg so a resuming caller can read it before running a pass', async () => {
		const result = await construct()

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(findMultipartyLegJournalForLeg(REFUND)?.legId).toBe('leg-1')
		expect(findMultipartyLegJournalForLeg(REFUND)?.rows).toHaveLength(3)
	})

	test('never touches a wallet store, a relay or a token: the journal is the only thing it writes', async () => {
		// Count the writes rather than the keys: the ambient Storage exposes its methods as own
		// properties or on its prototype depending on what installed it, so enumerating it measures the
		// storage, not what was stored.
		const storage = withRecordingStorage()
		try {
			const result = await construct()

			expect(result.ok).toBe(true)
			// One write per transition — open, then attempt and settle per row — and every one of them
			// to the journal's own key. No wallet store, no pending-token store, no relay.
			expect(storage.written.length).toBeGreaterThan(0)
			expect(new Set(storage.written).size).toBe(1)
			expect(storage.written[0]).toContain('auction_bid_leg_journal_multiparty')
		} finally {
			storage.restore()
		}
	})
})
