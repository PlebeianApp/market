/**
 * Multiparty leg — restart recovery.
 *
 * The question this file answers is the one the journal exists for: **after the process dies mid-leg, is
 * the persisted state alone enough to finish or to recover it?** So every step here re-reads from storage
 * rather than carrying anything in memory: a leg is built until it stops, storage is the only thing that
 * survives, and a fresh pass is started from what was written.
 *
 * The scenarios are the three a crash can leave behind: a row that locked, a row whose outcome is unknown
 * (attempted, no answer), and rows that were never touched. The assertions are about what a *restarted*
 * client can know and must not do — above all, that it never re-sends a row whose swap was already sent.
 *
 * User-scoped localStorage; polyfilled as in `preLockRecoveryRecordBound.test.ts`.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Proof } from '@cashu/cashu-ts'
import { authStore } from '../stores/auth'
import { MultipartyLegSwapNotSentError, constructMultipartyLeg, type MultipartyLegMintSeam } from '../auction/multipartyLegConstruction'
import {
	findMultipartyLegJournalByRefundPubkey,
	journalMatchesRecoveryRecord,
	reconcileMultipartyLeg,
	reopenMultipartyLegRow,
	summarizeMultipartyLeg,
} from '../auction/multipartyLegJournal'
import { planMultipartyLegLock } from '../auction/multipartyLegLockPlan'
import { buildMultipartyPreLockRecoveryRecord, persistMultipartyPreLockRecoveryRecord } from '../auction/multipartyRecoveryRecord'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'

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

const LOCKTIME = 1_790_000_600
const REFUND = `02${'c'.repeat(64)}`
const MINT = 'https://mint.example.com'
const AMOUNTS = [8_800, 200, 1_000]
const AT = 1_790_000_000_000

const CHILDREN = ['restart-a', 'restart-b', 'restart-c'].map((seed) => {
	const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode(seed)))
	return deriveAuctionChildP2pkPubkeyFromXpub(master.publicExtendedKey as string, 'm/0/81')
})

const proof = (amount: number, tag: string, secret?: string): Proof =>
	({ amount, id: `00${'a'.repeat(14)}`, secret: secret ?? `secret-${tag}`, C: 'b'.repeat(64) }) as unknown as Proof

/** A NUT-11 proof as a mint returns it: the secret carries the COMPRESSED lock key (as `CHILDREN` are). */
const p2pkProof = (amount: number, child: string, tag: string): Proof =>
	proof(
		amount,
		tag,
		JSON.stringify([
			'P2PK',
			{
				nonce: tag,
				data: child,
				tags: [
					['locktime', String(LOCKTIME)],
					['refund', REFUND],
				],
			},
		]),
	)

const legPlan = () => {
	const plan = planMultipartyLegLock({
		legDeltaSats: AMOUNTS.reduce((sum, amount) => sum + amount, 0),
		locktime: LOCKTIME,
		refundPubkey: REFUND,
		mintCandidates: [MINT],
		rows: AMOUNTS.map((amountSats, index) => ({
			manifest_index: index,
			child_pubkey_compressed: CHILDREN[index],
			amount_sats: amountSats,
		})),
	})
	if (!plan.ok) throw new Error(`fixture plan refused: ${plan.code}`)
	return plan
}

const pool = () => AMOUNTS.map((amount, index) => proof(amount, `in-${index}`))

/** The mint seam: answers per row, and records every row it was asked about across all passes. */
const seam = (behaviour: Record<number, 'ok' | 'throw' | 'not_sent'>, asked: number[]): MultipartyLegMintSeam => ({
	swap: async (request) => {
		asked.push(request.manifestIndex)
		const answer = behaviour[request.manifestIndex] ?? 'ok'
		if (answer === 'throw') throw new Error('mint said nothing useful')
		if (answer === 'not_sent') throw new MultipartyLegSwapNotSentError('insufficient_inputs')
		return { send: [p2pkProof(request.amountSats, CHILDREN[request.manifestIndex], `send-${request.manifestIndex}`)], keep: [] }
	},
})

let clock = AT
const now = () => (clock += 1)

/** Read the leg back from STORAGE only — this is what a restarted process has. */
const loadJournal = () => {
	const entry = findMultipartyLegJournalByRefundPubkey(REFUND)
	if (!entry) throw new Error('the journal is not on disk')
	return entry
}

beforeEach(() => {
	globalThis.localStorage.clear()
	setAuthUser()
	clock = AT
})

describe('multiparty leg restart recovery', () => {
	test('a leg that stopped at an unknown row is recoverable from storage alone', async () => {
		const firstAsked: number[] = []
		const first = await constructMultipartyLeg({
			plan: legPlan(),
			availableProofs: pool(),
			seam: seam({ 1: 'throw' }, firstAsked),
			legId: 'leg-restart',
			now,
		})
		expect(first.ok).toBe(true)
		if (!first.ok) return
		// The process "dies" here: nothing below uses anything but what is on disk.
		expect(firstAsked).toEqual([0, 1])

		const persisted = loadJournal()
		expect(persisted.rows.map((row) => row.state)).toEqual(['locked', 'uncertain', 'planned'])
		expect(summarizeMultipartyLeg(persisted).verdict).toBe('uncertain')
	})

	test('a restarted pass never re-sends a row that was already sent', async () => {
		const asked: number[] = []
		await constructMultipartyLeg({ plan: legPlan(), availableProofs: pool(), seam: seam({ 1: 'throw' }, asked), legId: 'leg-restart', now })

		// A fresh pass, resumed from the persisted journal, must not touch rows 0 or 1.
		const resumedAsked: number[] = []
		const resumed = await constructMultipartyLeg({
			plan: legPlan(),
			availableProofs: pool(),
			seam: seam({}, resumedAsked),
			legId: 'leg-restart',
			now,
			journal: loadJournal(),
		})

		expect(resumed.ok).toBe(true)
		if (!resumed.ok) return
		expect(resumedAsked).toEqual([])
		expect(resumed.rows.map((row) => row.state)).toEqual(['already_settled', 'already_settled'])
		expect(resumed.summary.verdict).toBe('uncertain')
	})

	test('evidence resolves the unknown row, and the leg then finishes on a new pass', async () => {
		const asked: number[] = []
		await constructMultipartyLeg({ plan: legPlan(), availableProofs: pool(), seam: seam({ 1: 'throw' }, asked), legId: 'leg-restart', now })

		// What the wallet can observe after the restart: row 1's swap did land.
		const reconciled = reconcileMultipartyLeg(loadJournal(), {
			locks: legPlan().locks,
			evidence: [{ manifestIndex: 1, proofs: [p2pkProof(AMOUNTS[1], CHILDREN[1], 'send-1')] }],
			at: now(),
		})
		if (!reconciled.ok) throw new Error(`reconcile refused: ${reconciled.code}: ${reconciled.detail}`)
		expect(reconciled.ok).toBe(true)
		if (!reconciled.ok) return
		expect(reconciled.entry.rows.map((row) => row.state)).toEqual(['locked', 'locked', 'planned'])

		// And a third pass finishes the leg, sending only the row that was never touched.
		const finalAsked: number[] = []
		const final = await constructMultipartyLeg({
			plan: legPlan(),
			availableProofs: pool(),
			seam: seam({}, finalAsked),
			legId: 'leg-restart',
			now,
			journal: reconciled.entry,
		})

		expect(final.ok).toBe(true)
		if (!final.ok) return
		expect(finalAsked).toEqual([2])
		expect(final.summary.verdict).toBe('complete')
		expect(loadJournal().rows.every((row) => row.state === 'locked')).toBe(true)
	})

	test('a row proved never sent is reopened and re-attempted, and nothing else is', async () => {
		const asked: number[] = []
		const first = await constructMultipartyLeg({
			plan: legPlan(),
			availableProofs: pool(),
			seam: seam({ 0: 'not_sent' }, asked),
			legId: 'leg-restart',
			now,
		})
		expect(first.ok).toBe(true)
		if (!first.ok) return
		expect(loadJournal().rows[0].state).toBe('failed_pre_mint')

		const reopened = reopenMultipartyLegRow(loadJournal(), { manifestIndex: 0, at: now() })
		if (!reopened.ok) throw new Error('reopen refused')

		const secondAsked: number[] = []
		const second = await constructMultipartyLeg({
			plan: legPlan(),
			availableProofs: pool(),
			seam: seam({}, secondAsked),
			legId: 'leg-restart',
			now,
			journal: reopened.entry,
		})

		expect(second.ok).toBe(true)
		if (!second.ok) return
		expect(secondAsked).toEqual([0, 1, 2])
		expect(second.summary.verdict).toBe('complete')
	})

	test('the journal and the recovery record still describe the same leg after a restart', async () => {
		await constructMultipartyLeg({ plan: legPlan(), availableProofs: pool(), seam: seam({ 1: 'throw' }, []), legId: 'leg-restart', now })

		const record = buildMultipartyPreLockRecoveryRecord({
			id: 'record-1',
			createdAt: AT,
			auctionEventId: '1'.repeat(64),
			auctionCoordinates: `30408:${'a'.repeat(64)}:lot-1`,
			sellerPubkey: 'a'.repeat(64),
			derivationPath: 'm/0/81',
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
		if (!record.ok) throw new Error(`fixture record refused: ${record.code}`)
		persistMultipartyPreLockRecoveryRecord(record.record)

		// What a restarted client validates before it acts on either store.
		expect(journalMatchesRecoveryRecord(loadJournal(), record.record)).toEqual({ ok: true })
	})

	test('nothing about the leg lives in memory: the journal is the whole state', async () => {
		const asked: number[] = []
		const first = await constructMultipartyLeg({
			plan: legPlan(),
			availableProofs: pool(),
			seam: seam({ 2: 'throw' }, asked),
			legId: 'leg-restart',
			now,
		})
		expect(first.ok).toBe(true)
		if (!first.ok) return

		// Rows 0 and 1 locked, row 2 unknown — all of it readable from storage, and re-readable: a second
		// read returns the same thing, which is what makes a restart safe rather than lucky.
		const fromDisk = loadJournal()
		const again = loadJournal()
		expect(again).toEqual(fromDisk)
		expect(fromDisk.rows.map((row) => row.state)).toEqual(['locked', 'locked', 'uncertain'])
		expect(summarizeMultipartyLeg(fromDisk).lockedRowCount).toBe(2)
	})
})
